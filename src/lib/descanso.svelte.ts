/**
 * Estado global del descanso entre series. Vive fuera de la pantalla de ejercicio
 * para que el contador, el aviso de fin y el wake lock sobrevivan al navegar a
 * otra pantalla (la barra se renderiza en el layout). La fuente de verdad son
 * timestamps, no un contador, así el tiempo sigue siendo correcto aunque se
 * bloquee la pantalla o la app pase a background.
 *
 * El fin de descanso es un ESTADO (vencido + segundos de excedido), no un flash:
 * queda visible hasta que el usuario lo atiende. Si venció con la app fuera de
 * vista, al volver suena igual (si fue hace poco) y el excedido siempre se ve.
 */
import { sonarDescansoTerminado } from './audio';
import { ajustesObs } from './extras';

const DESCANSO_KEY = 'gb-descanso';
const NOTIF_PEDIDA_KEY = 'gb-notif-pedida';
const NOTIF_TAG = 'gb-descanso';
/** Volver dentro de esta ventana tras vencer → la señal sonora todavía sirve. */
const SONAR_TARDE_MS = 60_000;
/** Vencido hace más que esto (app cerrada, otra cosa): se descarta sin señal. */
const MAX_VENCIDO_MS = 10 * 60_000;
const VIBRA_ALARMA = [300, 100, 300, 100, 500];
/** Vencido sin atender: la alarma insiste cada tanto, pocas veces. */
const REPETIR_SEG = 45;
const MAX_REPETICIONES = 2;

interface Persistido {
	inicio: number;
	hasta: number;
	glow?: string;
	siguiente?: string;
}

class Descanso {
	/** Segundos restantes (0 = sin descanso corriendo). */
	restoSeg = $state(0);
	/** Descanso vencido sin atender: la barra queda en "¡A la serie!". */
	vencido = $state(false);
	/** Segundos desde que venció, para el contador de excedido (+0:42). */
	vencidoSeg = $state(0);
	/** Color del ejercicio que inició el descanso, para teñir la barra. */
	glow = $state('124 92 255');
	/** Qué viene después del descanso (ej. "Press pecho · serie 3/4"), para no perder el hilo. */
	siguiente = $state('');

	#inicio: number | null = null;
	#hasta: number | null = null;
	#marcaRepeticion = 0;
	#intId: ReturnType<typeof setInterval> | null = null;
	#finId: ReturnType<typeof setTimeout> | null = null;
	#wakeLock: WakeLockSentinel | null = null;
	#sonido = true;
	#vibracion = true;
	#iniciado = false;
	/** Venció con la app fuera de vista: la señal sonora queda pendiente. */
	#senalPendiente = false;
	#notificado = false;

	/** Conecta listeners globales y restaura un descanso en curso. Idempotente. */
	init() {
		if (this.#iniciado || typeof window === 'undefined') return;
		this.#iniciado = true;
		ajustesObs().subscribe((a) => {
			this.#sonido = a.sonido;
			this.#vibracion = a.vibracion ?? true;
		});
		// Al volver del background o del bloqueo de pantalla, recalcular al instante.
		const refrescar = () => {
			this.#recalc();
			if (document.visibilityState !== 'visible') return;
			if (this.#hasta != null && !this.vencido) void this.#pedirWakeLock();
			if (this.#senalPendiente) {
				this.#senalPendiente = false;
				// Venció hace poco: avisar tarde sigue siendo útil; hace mucho, solo queda lo visual.
				if (this.vencido && Date.now() - (this.#hasta ?? 0) < SONAR_TARDE_MS) this.#sonarYVibrar();
			}
			void this.#cerrarNotificacion();
		};
		document.addEventListener('visibilitychange', refrescar);
		window.addEventListener('focus', refrescar);
		this.#restaurar();
	}

	/** Arranca un descanso de `minutos`, teñido con `glow`. */
	iniciar(minutos: number, glow: string, siguiente = '') {
		this.#pararTimers();
		this.vencido = false;
		this.vencidoSeg = 0;
		this.#senalPendiente = false;
		this.#notificado = false;
		this.#marcaRepeticion = 0;
		this.siguiente = siguiente;
		this.glow = glow;
		this.#inicio = Date.now();
		this.#hasta = this.#inicio + minutos * 60_000;
		this.restoSeg = Math.ceil((this.#hasta - Date.now()) / 1000);
		this.#armarTimers();
		this.#guardar();
		void this.#pedirWakeLock();
		this.#pedirPermisoNotificacion();
	}

	/** Si hay un descanso en curso, mueve su fin a inicio + minutos (no reinicia). */
	ajustarFin(minutos: number) {
		if (this.#inicio == null || this.#hasta == null || this.vencido) return;
		this.#hasta = this.#inicio + minutos * 60_000;
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

	#restaurar() {
		const crudo = localStorage.getItem(DESCANSO_KEY);
		if (!crudo) return;
		try {
			const d = JSON.parse(crudo) as Partial<Persistido>;
			const valido = typeof d.inicio === 'number' && typeof d.hasta === 'number';
			// Vencido hace mucho: ya no es accionable, se descarta en silencio.
			if (!valido || Date.now() - d.hasta! >= MAX_VENCIDO_MS) {
				localStorage.removeItem(DESCANSO_KEY);
				return;
			}
			this.#inicio = d.inicio!;
			this.#hasta = d.hasta!;
			if (typeof d.glow === 'string') this.glow = d.glow;
			if (typeof d.siguiente === 'string') this.siguiente = d.siguiente;
			this.#armarTimers();
			// Si ya venció, #recalc marca el estado y dispara la señal que corresponda.
			this.#recalc();
			if (!this.vencido) {
				this.restoSeg = Math.ceil((this.#hasta - Date.now()) / 1000);
				void this.#pedirWakeLock();
			}
		} catch {
			localStorage.removeItem(DESCANSO_KEY);
		}
	}

	#guardar() {
		if (this.#inicio == null || this.#hasta == null) return;
		localStorage.setItem(
			DESCANSO_KEY,
			JSON.stringify({
				inicio: this.#inicio,
				hasta: this.#hasta,
				glow: this.glow,
				siguiente: this.siguiente || undefined
			})
		);
	}

	async #pedirWakeLock() {
		try {
			if ('wakeLock' in navigator) this.#wakeLock = await navigator.wakeLock.request('screen');
		} catch {
			// Denegado o sin soporte: el timer por timestamps sigue siendo correcto igual.
		}
	}

	#soltarWakeLock() {
		void this.#wakeLock?.release().catch(() => {});
		this.#wakeLock = null;
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
			this.restoSeg = resto;
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
			// Si se restaura ya vencido hace rato, las repeticiones pasadas no se deben.
			this.#marcaRepeticion = Math.floor((ahora - this.#hasta) / 1000 / REPETIR_SEG);
			if (document.visibilityState === 'visible') {
				// Recién vencido a la vista → alarma; si venció hace rato (volvimos de un
				// background largo) la señal sonora ya quedó pendiente de visibilitychange.
				if (ahora - this.#hasta < SONAR_TARDE_MS) this.#sonarYVibrar();
			} else {
				this.#senalPendiente = true;
				void this.#notificar();
			}
		}
		this.vencidoSeg = Math.floor((ahora - this.#hasta) / 1000);
		// Sin atender, la alarma insiste un par de veces (solo con la app a la vista).
		const marca = Math.floor(this.vencidoSeg / REPETIR_SEG);
		if (
			marca > this.#marcaRepeticion &&
			marca <= MAX_REPETICIONES &&
			document.visibilityState === 'visible'
		) {
			this.#marcaRepeticion = marca;
			this.#sonarYVibrar();
		}
	}

	#sonarYVibrar() {
		if (this.#sonido) void sonarDescansoTerminado().catch(() => {});
		if (this.#vibracion && 'vibrate' in navigator) navigator.vibrate(VIBRA_ALARMA);
	}

	/**
	 * Pide permiso de notificaciones la primera vez que se usa el timer (gesto del
	 * usuario mediante). En Android la notificación suena en pantalla de bloqueo
	 * aunque la app esté en background; en iOS PWA no dispara con pantalla bloqueada.
	 */
	#pedirPermisoNotificacion() {
		if (!('Notification' in window) || Notification.permission !== 'default') return;
		if (localStorage.getItem(NOTIF_PEDIDA_KEY)) return;
		localStorage.setItem(NOTIF_PEDIDA_KEY, '1');
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
				badge: '/icons/icon-192.png'
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
		this.siguiente = '';
		this.#senalPendiente = false;
		this.#marcaRepeticion = 0;
		localStorage.removeItem(DESCANSO_KEY);
		this.#soltarWakeLock();
		void this.#cerrarNotificacion();
	}
}

export const descanso = new Descanso();
