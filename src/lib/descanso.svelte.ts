/**
 * Estado global del descanso entre series. Vive fuera de la pantalla de ejercicio
 * para que el contador, el aviso de fin y el wake lock sobrevivan al navegar a
 * otra pantalla (la barra se renderiza en el layout). La fuente de verdad son
 * timestamps, no un contador, así el tiempo sigue siendo correcto aunque se
 * bloquee la pantalla o la app pase a background.
 *
 * El fin de descanso es un ESTADO (vencido + segundos de excedido), no un flash:
 * la alarma suena en loop y la barra queda visible hasta que el usuario lo
 * atiende (con tope de 10 min). Si venció con la app fuera de vista, al volver
 * el loop arranca solo y el excedido siempre se ve.
 */
import {
	desbloquearAudio,
	mantenerAudioDespierto,
	setVolumenMaestro,
	soltarAudioDespierto,
	sonarCuentaRegresiva,
	sonarDescansoTerminado
} from './audio';
import { ajustesObs } from './extras';
import { vibrar } from './vibracion';
import { WakeLockSeguro } from './wake-lock';

const DESCANSO_KEY = 'gb-descanso';
const NOTIF_PEDIDA_KEY = 'gb-notif-pedida';
const NOTIF_TAG = 'gb-descanso';
/** Vencido hace más que esto (app cerrada, otra cosa): se descarta sin señal. */
const MAX_VENCIDO_MS = 10 * 60_000;
const VIBRA_ALARMA = [300, 100, 300, 100, 500];
/** La alarma suena en loop con esta cadencia hasta que se atienda (el patrón dura ~1.7s). */
const ALARMA_CADA_MS = 2200;
/** Desde cuántos segundos restantes empieza la cuenta regresiva audible. */
const TIC_DESDE_SEG = 3;
/** Límites de lo que puede quedar tras girar la rueda del descanso en curso. */
const MIN_RESTO_SEG = 15;
const MAX_RESTO_SEG = 15 * 60;

/** La serie que arrancó este descanso, para poder verificarla (y corregirla) sin cerrarlo. */
export interface SerieRegistrada {
	/** Ya formateada por la pantalla: "Serie 2 · 60 kg × 10". */
	texto: string;
	setIndex: number;
	/**
	 * De qué ejercicio es esta serie. Sin esto, "Tocá para corregir" abría la fila de ese
	 * índice en CUALQUIER ejercicio que estuviera montado: el descanso es global y el
	 * índice, solo, no identifica nada.
	 */
	exerciseId: string;
	/** A dónde hay que volver para corregirla: el descanso corre en todas las pantallas. */
	href: string;
}

interface Persistido {
	inicio: number;
	hasta: number;
	glow?: string;
	siguiente?: string;
	registrada?: SerieRegistrada;
}

/** El descanso sigue funcionando sin persistencia si el navegador bloquea Storage. */
function leerStorage(clave: string): string | null {
	try {
		return localStorage.getItem(clave);
	} catch {
		return null;
	}
}

function guardarStorage(clave: string, valor: string): boolean {
	try {
		localStorage.setItem(clave, valor);
		return true;
	} catch {
		return false;
	}
}

/** El storage lo puede haber escrito una versión anterior (o cualquiera): se verifica. */
function serieRegistradaValida(valor: unknown): valor is SerieRegistrada {
	if (typeof valor !== 'object' || valor === null) return false;
	const s = valor as Partial<SerieRegistrada>;
	return (
		typeof s.texto === 'string' &&
		Number.isInteger(s.setIndex) &&
		s.setIndex! >= 0 &&
		typeof s.exerciseId === 'string' &&
		typeof s.href === 'string'
	);
}

function borrarStorage(clave: string): void {
	try {
		localStorage.removeItem(clave);
	} catch {
		// Sin persistencia, el contador de esta pestaña sigue siendo usable.
	}
}

class Descanso {
	/** Segundos restantes (0 = sin descanso corriendo). */
	restoSeg = $state(0);
	/** Descanso vencido sin atender: la barra queda en "¡A la serie!". */
	vencido = $state(false);
	/** Segundos desde que venció, para el contador de excedido (+0:42). */
	vencidoSeg = $state(0);
	/** Duración total del descanso activo, usada para mostrar progreso visual. */
	totalSeg = $state(0);
	/** Capa visual enfocada: puede cerrarse sin cortar el timer. */
	focusAbierto = $state(false);
	/** Color del ejercicio que inició el descanso, para teñir la barra. */
	glow = $state('124 92 255');
	/** Qué viene después del descanso (ej. "Press pecho · serie 3/4"), para no perder el hilo. */
	siguiente = $state('');
	/**
	 * La serie que acaba de registrarse. El descanso tapa la lista justo cuando el dato
	 * está más fresco y menos verificado: mostrarla acá permite ver que quedó bien —y
	 * pedir corregirla— sin tener que desarmar el descanso a mano.
	 */
	registrada = $state<SerieRegistrada | null>(null);
	/**
	 * Contador que sube cuando el usuario pide corregir la serie. La pantalla de
	 * ejercicio lo observa y enfoca la fila; se hace con un contador y no con un
	 * callback guardado para que navegar no deje una función apuntando a una pantalla
	 * que ya no existe.
	 */
	correccionPedida = $state(0);

	#inicio: number | null = null;
	#hasta: number | null = null;
	/** Última vez que sonó la alarma del loop de vencido. */
	#ultimaAlarma = 0;
	/** Último segundo en el que sonó el tic de cuenta regresiva (evita repetir). */
	#ultimoTic: number | null = null;
	#intId: ReturnType<typeof setInterval> | null = null;
	#finId: ReturnType<typeof setTimeout> | null = null;
	#wakeLock = new WakeLockSeguro();
	// Valores seguros hasta que IndexedDB entrega las preferencias reales: nunca
	// queremos sorprender al usuario con audio, vibración o fullscreen al restaurar.
	#sonido = false;
	#vibracion = false;
	#focusHabilitado = false;
	#ajustesCargados = false;
	#iniciado = false;
	#notificado = false;

	/** Conecta listeners globales y restaura un descanso en curso. Idempotente. */
	init() {
		if (this.#iniciado || typeof window === 'undefined') return;
		this.#iniciado = true;
		ajustesObs().subscribe((a) => {
			const sonidoAnterior = this.#sonido;
			this.#sonido = a.sonido;
			// Único suscriptor vivo de los ajustes que existe siempre que puede sonar algo:
			// desde acá se mantiene el volumen del master al día para toda la app.
			setVolumenMaestro(a.volumen);
			this.#vibracion = a.vibracion ?? true;
			this.#focusHabilitado = a.descansoPantallaCompleta ?? true;
			if (this.#hasta != null && this.#sonido && !sonidoAnterior) mantenerAudioDespierto();
			if (!this.#sonido && sonidoAnterior) soltarAudioDespierto();
			if (!this.#focusHabilitado) this.focusAbierto = false;
			if (!this.#ajustesCargados) {
				this.#ajustesCargados = true;
				this.#restaurar();
			}
		});
		// Al volver del background o del bloqueo de pantalla, recalcular al instante.
		const refrescar = () => {
			// Si hay un vencido sin atender, el loop de alarma se retoma solo en #recalc.
			this.#recalc();
			if (document.visibilityState !== 'visible') return;
			if (this.#hasta != null && this.#sonido) desbloquearAudio();
			// El wake lock se recupera solo (WakeLockSeguro escucha la visibilidad): antes
			// se pedía acá y solo si el descanso no había vencido, justo cuando más falta
			// hace que la pantalla no se apague.
			void this.#cerrarNotificacion();
		};
		document.addEventListener('visibilitychange', refrescar);
		window.addEventListener('focus', refrescar);
		// Red de seguridad para iOS: si el contexto quedó suspendido tras el background,
		// el primer toque en cualquier parte de la app lo reanuda.
		window.addEventListener(
			'pointerdown',
			() => {
				if (this.#hasta != null && this.#sonido) desbloquearAudio();
			},
			{ capture: true }
		);
		// Otra pestaña (o la app instalada) arrancó, ajustó o cortó el descanso:
		// sin esto las dos corren timers distintos y una sigue sonando sola.
		window.addEventListener('storage', (e) => {
			if (e.key !== DESCANSO_KEY) return;
			if (e.newValue == null) this.#limpiar();
			else this.#restaurar(false);
		});
	}

	/**
	 * Prepara audio y permisos desde el gesto del usuario, antes de cualquier `await`.
	 * `iniciar()` corre después de escribir en la base, y para entonces el navegador
	 * ya puede considerar vencida la activación por gesto.
	 */
	prepararDesdeGesto() {
		if (typeof window === 'undefined') return;
		if (this.#sonido) desbloquearAudio();
		this.#pedirPermisoNotificacion();
	}

	/** Arranca un descanso de `minutos`, teñido con `glow`. */
	iniciar(
		minutos: number,
		glow: string,
		siguiente = '',
		registrada: SerieRegistrada | null = null
	) {
		this.#pararTimers();
		this.vencido = false;
		this.vencidoSeg = 0;
		this.totalSeg = Math.max(1, Math.round(minutos * 60));
		this.focusAbierto = this.#focusHabilitado;
		this.#notificado = false;
		this.#ultimaAlarma = 0;
		this.#ultimoTic = null;
		this.siguiente = siguiente;
		this.registrada = registrada;
		this.glow = glow;
		this.#inicio = Date.now();
		this.#hasta = this.#inicio + minutos * 60_000;
		this.restoSeg = Math.ceil((this.#hasta - Date.now()) / 1000);
		this.#armarTimers();
		this.#guardar();
		void this.#wakeLock.activar();
		this.#pedirPermisoNotificacion();
		if (this.#sonido) mantenerAudioDespierto();
	}

	/**
	 * Si hay un descanso en curso, mueve su fin a inicio + minutos (no reinicia).
	 *
	 * Acepta un descanso YA VENCIDO y lo revive si la duración nueva todavía no se
	 * cumplió. Esto viene de elegir cuánto dura el descanso del ejercicio: bajarlo por
	 * debajo del tiempo ya transcurrido lo da por terminado —correcto—, pero antes el
	 * `vencido` de la guarda hacía que subirlo de nuevo no hiciera nada. Quedabas con la
	 * alarma sonando por un valor que acababas de corregir y sin forma de volver atrás.
	 *
	 * `ajustarResto` no hace esto a propósito: ahí la alarma ya sonó y el usuario ya se
	 * enteró; revivir ese descanso sería resucitar algo que terminó, no corregir un número.
	 */
	ajustarFin(minutos: number) {
		if (this.#inicio == null || this.#hasta == null) return;
		this.#hasta = this.#inicio + minutos * 60_000;
		this.totalSeg = Math.max(1, Math.round((this.#hasta - this.#inicio) / 1000));
		// Vuelve a tener futuro: la próxima vez que venza tiene que poder avisar de nuevo.
		if (this.#hasta > Date.now()) {
			this.#notificado = false;
			this.#ultimaAlarma = 0;
			this.#ultimoTic = null;
		}
		this.#armarTimers();
		this.#guardar();
		this.#recalc();
	}

	/**
	 * Cambia lo que FALTA del descanso en curso, sin tocar cuándo empezó.
	 *
	 * Es lo que pide la rueda del descanso a pantalla completa: ahí no se elige "cuánto
	 * dura este descanso" en abstracto, se decide "necesito medio minuto más". El total
	 * se estira junto con el resto para que el anillo siga contando la misma historia.
	 */
	ajustarResto(segundos: number) {
		if (this.#inicio == null || this.#hasta == null || this.vencido) return;
		const resto = Math.min(MAX_RESTO_SEG, Math.max(MIN_RESTO_SEG, Math.round(segundos)));
		const ahora = Date.now();
		this.#hasta = ahora + resto * 1000;
		this.totalSeg = Math.max(1, Math.round((this.#hasta - this.#inicio) / 1000));
		this.#armarTimers();
		this.#guardar();
		this.#recalc();
	}

	/** Corta el descanso sin señal alguna (Saltar, destildar serie, terminar ejercicio). */
	saltar() {
		this.#limpiar();
	}

	/** El usuario atendió el "¡A la serie!": se apaga el estado vencido. */
	atender() {
		this.#limpiar();
	}

	/** Cierra la pantalla enfocada sin apagar el descanso. */
	minimizarFocus() {
		this.focusAbierto = false;
	}

	/**
	 * El usuario quiere revisar la serie que acaba de cargar: se minimiza el descanso
	 * (que sigue corriendo) y se avisa a la pantalla para que enfoque esa fila.
	 */
	pedirCorreccion() {
		this.focusAbierto = false;
		this.correccionPedida++;
	}

	/**
	 * La pantalla del ejercicio ya enfocó la fila. Sin este acuse, el pedido quedaba
	 * vivo toda la sesión y volvía a abrir una fila sola cada vez que se montaba la
	 * pantalla —incluso la de otro ejercicio.
	 */
	correccionAtendida() {
		this.correccionPedida = 0;
	}

	/** Vuelve a abrir el descanso grande si sigue siendo accionable. */
	expandirFocus() {
		if (this.restoSeg > 0 || this.vencido) this.focusAbierto = true;
	}

	#restaurar(abrirFocus = true) {
		const crudo = leerStorage(DESCANSO_KEY);
		if (!crudo) return;
		try {
			const d = JSON.parse(crudo) as Partial<Persistido>;
			const valido = typeof d.inicio === 'number' && typeof d.hasta === 'number';
			// Vencido hace mucho: ya no es accionable, se descarta en silencio.
			if (!valido || Date.now() - d.hasta! >= MAX_VENCIDO_MS) {
				borrarStorage(DESCANSO_KEY);
				return;
			}
			// Es otro descanso, no el que ya venía siguiendo esta pestaña: el aviso del
			// sistema y la cadencia de la alarma tienen que poder dispararse de nuevo.
			if (this.#inicio !== d.inicio || this.#hasta !== d.hasta) {
				this.#notificado = false;
				this.#ultimaAlarma = 0;
				this.#ultimoTic = null;
			}
			this.#inicio = d.inicio!;
			this.#hasta = d.hasta!;
			this.totalSeg = Math.max(1, Math.round((this.#hasta - this.#inicio) / 1000));
			if (typeof d.glow === 'string') this.glow = d.glow;
			if (typeof d.siguiente === 'string') this.siguiente = d.siguiente;
			this.registrada = serieRegistradaValida(d.registrada) ? d.registrada : null;
			this.#armarTimers();
			// Si ya venció, #recalc marca el estado y dispara la señal que corresponda.
			this.#recalc();
			if (!this.vencido) {
				this.restoSeg = Math.ceil((this.#hasta - Date.now()) / 1000);
				void this.#wakeLock.activar();
			}
			if (this.#sonido) mantenerAudioDespierto();
			if (abrirFocus) {
				this.focusAbierto = this.#focusHabilitado && (this.restoSeg > 0 || this.vencido);
			}
		} catch {
			borrarStorage(DESCANSO_KEY);
		}
	}

	#guardar() {
		if (this.#inicio == null || this.#hasta == null) return;
		guardarStorage(
			DESCANSO_KEY,
			JSON.stringify({
				inicio: this.#inicio,
				hasta: this.#hasta,
				glow: this.glow,
				siguiente: this.siguiente || undefined,
				registrada: this.registrada ?? undefined
			})
		);
	}

	/** Interval de refresco + timeout puntual al vencimiento (más preciso en background). */
	#armarTimers() {
		this.#pararTimers();
		this.#intId = setInterval(() => this.#recalc(), 500);
		if (this.#hasta != null) {
			const falta = Math.max(0, this.#hasta - Date.now());
			this.#finId = setTimeout(() => this.#recalc(), falta + 30);
		}
	}

	#pararTimers() {
		if (this.#intId) clearInterval(this.#intId);
		if (this.#finId) clearTimeout(this.#finId);
		this.#intId = null;
		this.#finId = null;
	}

	#recalc() {
		if (this.#hasta == null) return;
		const ahora = Date.now();
		const resto = Math.ceil((this.#hasta - ahora) / 1000);
		if (resto > 0) {
			// El estado se DERIVA de los timestamps, no se acumula. Sin apagar acá el
			// vencido, restaurar un descanso nuevo (otra instancia lo arrancó) dejaba la
			// pantalla en "¡A la serie!" mientras corría el contador, y al vencer ese
			// descanso nuevo el `if (!this.vencido)` de abajo no entraba: `restoSeg` nunca
			// llegaba a 0 y la barra quedaba clavada en "0:01" con la alarma en loop.
			this.vencido = false;
			this.vencidoSeg = 0;
			this.restoSeg = resto;
			this.#ticCuentaRegresiva(resto);
			return;
		}
		// Vencido hace demasiado: dejar de insistir y limpiar en silencio.
		if (ahora - this.#hasta >= MAX_VENCIDO_MS) {
			this.#limpiar();
			return;
		}
		if (!this.vencido) {
			this.vencido = true;
			this.restoSeg = 0;
			// El wake lock NO se suelta acá. Vencer es justo cuando hay que mirar la
			// pantalla: soltarlo dejaba que se apagara durante la alarma, y entonces el
			// descanso terminaba sin que nadie se enterara. Lo suelta `#limpiar()`, que
			// corre al atender el descanso o al pasarse de `MAX_VENCIDO_MS`.
			// Además de sonar, avisamos al sistema: si la pestaña quedó congelada, la
			// notificación es la única señal que sobrevive.
			if (document.visibilityState !== 'visible') void this.#notificar();
		}
		this.vencidoSeg = Math.floor((ahora - this.#hasta) / 1000);
		// Alarma continua: suena en loop hasta que se atienda (✓ Listo, marcar la serie
		// o saltar) o hasta el tope de MAX_VENCIDO_MS.
		//
		// Suena también con la app oculta o la pantalla apagada, que es precisamente
		// cuando hace falta. `mantenerAudioDespierto()` ya sostiene el contexto con una
		// fuente muda desde que arranca el descanso —ese costo ya se paga— y una pestaña
		// con audio activo no queda congelada, así que el loop sigue corriendo. Antes
		// esto exigía `visibilityState === 'visible'`: el contexto se mantenía vivo para
		// nada y el descanso vencía en silencio en el bolsillo.
		//
		// El tic de la cuenta regresiva sí sigue pidiendo pantalla a la vista: ese es el
		// que no tiene que hacer ruido desde el bolsillo.
		if (ahora - this.#ultimaAlarma >= ALARMA_CADA_MS) {
			this.#ultimaAlarma = ahora;
			this.#sonarYVibrar();
		}
	}

	/**
	 * Un tic por segundo en los últimos `TIC_DESDE_SEG`: el descanso termina cuando ya
	 * estás mirando, en vez de sobresaltarte. `#recalc` corre cada 500 ms, así que el
	 * segundo se recuerda para no sonar dos veces; y solo con la app a la vista, para no
	 * ponerse a hacer ruido desde el bolsillo antes de la alarma.
	 */
	#ticCuentaRegresiva(resto: number) {
		if (resto > TIC_DESDE_SEG || resto === this.#ultimoTic) return;
		this.#ultimoTic = resto;
		if (!this.#sonido || document.visibilityState !== 'visible') return;
		void sonarCuentaRegresiva().catch(() => {});
	}

	#sonarYVibrar() {
		if (this.#sonido) void sonarDescansoTerminado().catch(() => {});
		vibrar(VIBRA_ALARMA, this.#vibracion);
	}

	/**
	 * Pide permiso de notificaciones la primera vez que se usa el timer (gesto del
	 * usuario mediante). En Android la notificación suena en pantalla de bloqueo
	 * aunque la app esté en background; en iOS PWA no dispara con pantalla bloqueada.
	 */
	#pedirPermisoNotificacion() {
		if (!('Notification' in window) || Notification.permission !== 'default') return;
		if (leerStorage(NOTIF_PEDIDA_KEY)) return;
		guardarStorage(NOTIF_PEDIDA_KEY, '1');
		void Notification.requestPermission().catch(() => {});
	}

	async #notificar() {
		if (this.#notificado) return;
		this.#notificado = true;
		try {
			if (!('Notification' in window) || Notification.permission !== 'granted') return;
			const reg = await navigator.serviceWorker?.getRegistration();
			await reg?.showNotification('⏱️ Descanso terminado', {
				body: '¡A la serie! 💪',
				tag: NOTIF_TAG,
				icon: '/icons/icon-192.png',
				badge: '/icons/icon-192.png',
				// La API web no permite separar de forma portable sonido y vibración de
				// una notificación. Si cualquiera de las dos preferencias está apagada,
				// se prioriza no sorprender al usuario con una señal del sistema.
				silent: !this.#sonido || !this.#vibracion
			});
		} catch {
			// Sin service worker (dev) o sin permiso: la señal visual/sonora sigue.
		}
	}

	async #cerrarNotificacion() {
		try {
			const reg = await navigator.serviceWorker?.getRegistration();
			const notifs = await reg?.getNotifications({ tag: NOTIF_TAG });
			notifs?.forEach((n) => n.close());
		} catch {
			// Sin soporte: nada que cerrar.
		}
	}

	#limpiar() {
		this.#pararTimers();
		this.#inicio = null;
		this.#hasta = null;
		this.restoSeg = 0;
		this.vencido = false;
		this.vencidoSeg = 0;
		this.totalSeg = 0;
		this.focusAbierto = false;
		this.siguiente = '';
		this.registrada = null;
		this.#ultimaAlarma = 0;
		this.#ultimoTic = null;
		borrarStorage(DESCANSO_KEY);
		this.#wakeLock.desactivar();
		soltarAudioDespierto();
		void this.#cerrarNotificacion();
	}
}

export const descanso = new Descanso();
