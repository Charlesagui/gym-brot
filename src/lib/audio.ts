/**
 * Audio compartido de la app: un único AudioContext con master + compresor,
 * y las melodías de cada recompensa. El chequeo de "sonido activado" queda
 * en quien llama (acá no se conocen los ajustes).
 */

type AudioContextConstructor = new () => AudioContext;
type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: AudioContextConstructor };

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterCompressor: DynamicsCompressorNode | null = null;

function getAudioContext(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	const audioWindow = window as AudioWindow;
	const Ctx = window.AudioContext ?? audioWindow.webkitAudioContext;
	if (!Ctx) return null;
	audioCtx ??= new Ctx();
	return audioCtx;
}

/**
 * Volumen general (0–1). Vive acá y no se pasa por parámetro en cada beep porque es
 * una propiedad de la salida, no de cada sonido: así los cinco puntos que suenan no
 * tienen que acordarse de leer los ajustes. Quien lo mantiene sincronizado es la
 * suscripción de `descanso.init()`, la única que existe siempre que algo puede sonar.
 * El tope sigue siendo 0,95 para dejarle margen al compresor: la alarma entra al
 * máximo a propósito y no queremos que recorte sucio.
 */
const GANANCIA_MAXIMA = 0.95;
let volumenMaestro = 1;

/** Cambia el volumen general; si el contexto ya existe, se aplica en el acto. */
export function setVolumenMaestro(volumen: number): void {
	volumenMaestro = Math.min(1, Math.max(0, volumen));
	if (masterGain) {
		masterGain.gain.setValueAtTime(
			GANANCIA_MAXIMA * volumenMaestro,
			masterGain.context.currentTime
		);
	}
}

function getMaster(ctx: AudioContext): GainNode {
	if (masterGain && masterCompressor && masterGain.context === ctx) return masterGain;
	masterGain = ctx.createGain();
	masterCompressor = ctx.createDynamicsCompressor();
	masterGain.gain.setValueAtTime(GANANCIA_MAXIMA * volumenMaestro, ctx.currentTime);
	masterCompressor.threshold.setValueAtTime(-22, ctx.currentTime);
	masterCompressor.knee.setValueAtTime(20, ctx.currentTime);
	masterCompressor.ratio.setValueAtTime(6, ctx.currentTime);
	masterCompressor.attack.setValueAtTime(0.004, ctx.currentTime);
	masterCompressor.release.setValueAtTime(0.18, ctx.currentTime);
	masterGain.connect(masterCompressor);
	masterCompressor.connect(ctx.destination);
	return masterGain;
}

function beep(
	ctx: AudioContext,
	start: number,
	freq: number,
	duracion: number,
	volumen = 0.16,
	tipo: OscillatorType = 'sine',
	detune = 0
): void {
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = tipo;
	osc.frequency.setValueAtTime(freq, start);
	osc.detune.setValueAtTime(detune, start);
	gain.gain.setValueAtTime(0.0001, start);
	gain.gain.exponentialRampToValueAtTime(volumen, start + 0.012);
	gain.gain.exponentialRampToValueAtTime(0.0001, start + duracion);
	osc.connect(gain);
	gain.connect(getMaster(ctx));
	osc.start(start);
	osc.stop(start + duracion + 0.03);
	// La alarma suena en loop hasta 10 min: sin esto quedan cientos de nodos colgando
	// del master esperando que el recolector se dé cuenta.
	osc.onended = () => {
		osc.disconnect();
		gain.disconnect();
	};
}

let keepAlive: AudioBufferSourceNode | null = null;

/**
 * Crea y reanuda el contexto. iOS solo permite `resume()` dentro de un gesto del
 * usuario, así que esto se llama desde el handler del toque, antes de cualquier await.
 */
export function desbloquearAudio(): void {
	const ctx = getAudioContext();
	if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
}

/**
 * Mantiene el contexto activo con una fuente muda en loop mientras corre un descanso.
 * En iOS el contexto se suspende al pasar a background y `resume()` fuera de un gesto
 * queda rechazado: sin esto, la alarma podía volver muda justo cuando hace falta.
 * Contrapartida aceptada: mientras dura el descanso la sesión de audio queda tomada.
 */
export function mantenerAudioDespierto(): void {
	const ctx = getAudioContext();
	if (!ctx || keepAlive) return;
	if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
	try {
		const source = ctx.createBufferSource();
		source.buffer = ctx.createBuffer(
			1,
			Math.max(1, Math.round(ctx.sampleRate / 2)),
			ctx.sampleRate
		);
		source.loop = true;
		const silencio = ctx.createGain();
		silencio.gain.setValueAtTime(0, ctx.currentTime);
		source.connect(silencio);
		silencio.connect(ctx.destination);
		source.start();
		keepAlive = source;
	} catch {
		// Sin soporte: el timer visual y la vibración siguen funcionando igual.
	}
}

/** Suelta la sesión de audio al terminar el descanso (devuelve el control a la música). */
export function soltarAudioDespierto(): void {
	if (!keepAlive) return;
	try {
		keepAlive.stop();
	} catch {
		// Ya estaba detenida.
	}
	keepAlive.disconnect();
	keepAlive = null;
}

async function conContexto(tocar: (ctx: AudioContext, now: number) => void): Promise<void> {
	const ctx = getAudioContext();
	if (!ctx) return;
	if (ctx.state === 'suspended') await ctx.resume();
	tocar(ctx, ctx.currentTime);
}

/** Microfeedback al marcar una serie hecha. */
export function sonarSetHecho(): Promise<void> {
	return conContexto((ctx, now) => {
		beep(ctx, now, 523, 0.09, 0.14, 'triangle');
		beep(ctx, now + 0.04, 784, 0.13, 0.2, 'triangle', 3);
		beep(ctx, now + 0.1, 1047, 0.17, 0.18, 'sine', -4);
		beep(ctx, now + 0.18, 1568, 0.22, 0.12, 'sine', 2);
	});
}

/** Cierre de ejercicio: fanfarria larga si hubo PR, corta si no. */
export function sonarExito(esPr: boolean): Promise<void> {
	return conContexto((ctx, now) => {
		if (esPr) {
			beep(ctx, now, 392, 0.14, 0.16, 'triangle');
			beep(ctx, now + 0.08, 659, 0.17, 0.18, 'triangle', 4);
			beep(ctx, now + 0.18, 988, 0.2, 0.2, 'sine', -3);
			beep(ctx, now + 0.32, 1319, 0.26, 0.19, 'triangle');
			beep(ctx, now + 0.5, 1760, 0.38, 0.14, 'sine', 5);
			return;
		}
		beep(ctx, now, 440, 0.12, 0.14, 'triangle');
		beep(ctx, now + 0.1, 659, 0.18, 0.17, 'sine');
		beep(ctx, now + 0.23, 988, 0.2, 0.11, 'sine');
	});
}

/**
 * Alarma de fin de descanso: tiene que oírse en un gym con música, no es un
 * "ding" de UI. Tres ráfagas de dos tonos agudos en onda cuadrada (armónicos
 * ricos = más volumen percibido en el parlante del teléfono).
 */
export function sonarDescansoTerminado(): Promise<void> {
	return conContexto((ctx, now) => {
		// Ganancia al tope: el compresor del master evita el clipping y de paso
		// aplica makeup gain, así que entrar fuerte = salir lo más fuerte posible.
		for (let r = 0; r < 3; r++) {
			const t = now + r * 0.55;
			beep(ctx, t, 1568, 0.18, 1, 'square');
			beep(ctx, t + 0.2, 1976, 0.28, 1, 'square');
		}
	});
}

/**
 * Tic de los últimos segundos del descanso. Corto y seco a propósito: sirve para
 * levantar la vista justo antes de que termine, no para competir con la alarma.
 */
export function sonarCuentaRegresiva(): Promise<void> {
	return conContexto((ctx, now) => {
		beep(ctx, now, 880, 0.07, 0.11, 'triangle');
	});
}

/** La recompensa mayor: día completo. */
export function sonarDiaTerminado(): Promise<void> {
	return conContexto((ctx, now) => {
		beep(ctx, now, 392, 0.14, 0.16, 'triangle');
		beep(ctx, now + 0.09, 587, 0.16, 0.18, 'triangle');
		beep(ctx, now + 0.2, 784, 0.22, 0.2, 'triangle');
		beep(ctx, now + 0.36, 1175, 0.32, 0.16, 'triangle');
	});
}
