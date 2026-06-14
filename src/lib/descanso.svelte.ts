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
import { sonarDescansoTerminado } from './audio';
import { ajustesObs } from './extras';

const DESCANSO_KEY = 'gb-descanso';
const NOTIF_PEDIDA_KEY = 'gb-notif-pedida';
const NOTIF_TAG = 'gb-descanso';
/** Vencido hace más que esto (app cerrada, otra cosa): se descarta sin señal. */
const MAX_VENCIDO_MS = 10 * 60_000;
const VIBRA_ALARMA = [300, 100, 300, 100, 500];
/** La alarma suena en loop con esta cadencia hasta que se atienda (el patrón dura ~1.7s). */
const ALARMA_CADA_MS = 2200;

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
	/** Duración total del descanso activo, usada para mostrar progreso visual. */
	totalSeg = $state(0);
	/** Capa visual enfocada: puede cerrarse sin cortar el timer. */
	focusAbierto = $state(false);
	/** Color del ejercicio que inició el descanso, para teñir la barra. */
	glow = $state('124 92 255');
	/** Qué viene después del descanso (ej. "Press pecho · serie 3/4"), para no perder el hilo. */
	siguiente = $state('');

	#inicio: number | null = null;
	#hasta: number | null = null;
	/** Última vez que sonó la alarma del loop de vencido. */
	#ultimaAlarma = 0;
	#intId: ReturnType<typeof setInterval> | null = null;
	#finId: ReturnType<typeof setTimeout> | null = null;
	#wakeLock: WakeLockSentinel | null = null;
	#sonido = true;
	#vibracion = true;
	#focusHabilitado = true;
	#iniciado = false;
	#notificado = false;

	/** Conecta listeners globales y restaura un descanso en curso. Idempotente. */
	init() {
		if (this.#iniciado || typeof window === 'undefined') return;
		this.#iniciado = true;
		ajustesObs().subscribe((a) => {
			this.#sonido = a.sonido;
			this.#vibracion = a.vibracion ?? true;
			this.#focusHabilitado = a.descansoPantallaCompleta ?? true;
			if (!this.#focusHabilitado) this.focusAbierto = false;
		});
		// Al volver del background o del bloqueo de pantalla, recalcular al instante.
		const refrescar = () => {
			// Si hay un vencido sin atender, el loop de alarma se retoma solo en #recalc.
			this.#recalc();
			if (document.visibilityState !== 'visible') return;
			if (this.#hasta != null && !this.vencido) void this.#pedirWakeLock();
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
		this.totalSeg = Math.max(1, Math.round(minutos * 60));
		this.focusAbierto = this.#focusHabilitado;
		this.#notificado = false;
		this.#ultimaAlarma = 0;
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

	/** Vuelve a abrir el descanso grande si sigue siendo accionable. */
	expandirFocus() {
		if (this.restoSeg > 0 || this.vencido) this.focusAbierto = true;
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
			this.totalSeg = Math.max(1, Math.round((this.#hasta - this.#inicio) / 1000));
			if (typeof d.glow === 'string') this.glow = d.glow;
			if (typeof d.siguiente === 'string') this.siguiente = d.siguiente;
			this.#armarTimers();
			// Si ya venció, #recalc marca el estado y dispara la señal que corresponda.
			this.#recalc();
			if (!this.vencido) {
				this.restoSeg = Math.ceil((this.#hasta - Date.now()) / 1000);
				void this.#pedirWakeLock();
			}
			this.focusAbierto = this.#focusHabilitado && (this.restoSeg > 0 || this.vencido);
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
			// Vencido en background: notificación del sistema (la web no puede sonar oculta).
			if (document.visibilityState !== 'visible') void this.#notificar();
		}
		this.vencidoSeg = Math.floor((ahora - this.#hasta) / 1000);
		// Alarma continua: suena en loop hasta que se atienda (✓ Listo, marcar la serie
		// o saltar) o hasta el tope de MAX_VENCIDO_MS. Solo con la app a la vista; si se
		// vuelve de un bloqueo con el vencido activo, el loop arranca solo acá.
		if (document.visibilityState === 'visible' && ahora - this.#ultimaAlarma >= ALARMA_CADA_MS) {
			this.#ultimaAlarma = ahora;
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
		this.totalSeg = 0;
		this.focusAbierto = false;
		this.siguiente = '';
		this.#ultimaAlarma = 0;
		localStorage.removeItem(DESCANSO_KEY);
		this.#soltarWakeLock();
		void this.#cerrarNotificacion();
	}
}

export const descanso = new Descanso();
