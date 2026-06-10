/**
 * Estado global del descanso entre series. Vive fuera de la pantalla de ejercicio
 * para que el contador, el aviso de fin y el wake lock sobrevivan al navegar a
 * otra pantalla (la barra se renderiza en el layout). La fuente de verdad son
 * timestamps, no un contador, así el tiempo sigue siendo correcto aunque se
 * bloquee la pantalla o la app pase a background.
 */
import { sonarDescansoTerminado } from './audio';
import { ajustesObs } from './extras';

const DESCANSO_KEY = 'gb-descanso';

interface Persistido {
	inicio: number;
	hasta: number;
	glow?: string;
}

class Descanso {
	/** Segundos restantes (0 = sin descanso activo). */
	restoSeg = $state(0);
	/** Señal breve de "descanso terminado" tras vencer. */
	avisoFin = $state(false);
	/** Color del ejercicio que inició el descanso, para teñir la barra. */
	glow = $state('124 92 255');

	#inicio: number | null = null;
	#hasta: number | null = null;
	#intId: ReturnType<typeof setInterval> | null = null;
	#avisoId: ReturnType<typeof setTimeout> | null = null;
	#wakeLock: WakeLockSentinel | null = null;
	#sonido = true;
	#vibracion = true;
	#iniciado = false;

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
			if (this.#hasta != null && document.visibilityState === 'visible') void this.#pedirWakeLock();
		};
		document.addEventListener('visibilitychange', refrescar);
		window.addEventListener('focus', refrescar);
		this.#restaurar();
	}

	/** Arranca un descanso de `minutos`, teñido con `glow`. */
	iniciar(minutos: number, glow: string) {
		if (this.#intId) clearInterval(this.#intId);
		this.#ocultarAviso();
		this.glow = glow;
		this.#inicio = Date.now();
		this.#hasta = this.#inicio + minutos * 60_000;
		this.restoSeg = Math.ceil((this.#hasta - Date.now()) / 1000);
		this.#intId = setInterval(() => this.#recalc(), 500);
		this.#guardar();
		void this.#pedirWakeLock();
	}

	/** Si hay un descanso en curso, mueve su fin a inicio + minutos (no reinicia). */
	ajustarFin(minutos: number) {
		if (this.#inicio == null || this.#hasta == null) return;
		this.#hasta = this.#inicio + minutos * 60_000;
		this.#guardar();
		this.#recalc();
	}

	/** Corta el descanso sin señal alguna (Saltar, destildar serie, terminar ejercicio). */
	saltar() {
		this.#limpiar();
		this.#ocultarAviso();
	}

	#restaurar() {
		const crudo = localStorage.getItem(DESCANSO_KEY);
		if (!crudo) return;
		try {
			const d = JSON.parse(crudo) as Partial<Persistido>;
			if (typeof d.inicio !== 'number' || typeof d.hasta !== 'number' || d.hasta <= Date.now()) {
				localStorage.removeItem(DESCANSO_KEY);
				return;
			}
			this.#inicio = d.inicio;
			this.#hasta = d.hasta;
			if (typeof d.glow === 'string') this.glow = d.glow;
			this.restoSeg = Math.ceil((d.hasta - Date.now()) / 1000);
			if (this.#intId) clearInterval(this.#intId);
			this.#intId = setInterval(() => this.#recalc(), 500);
			void this.#pedirWakeLock();
		} catch {
			localStorage.removeItem(DESCANSO_KEY);
		}
	}

	#guardar() {
		if (this.#inicio == null || this.#hasta == null) return;
		localStorage.setItem(
			DESCANSO_KEY,
			JSON.stringify({ inicio: this.#inicio, hasta: this.#hasta, glow: this.glow })
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

	#recalc() {
		if (this.#hasta == null) return;
		const resto = Math.ceil((this.#hasta - Date.now()) / 1000);
		if (resto > 0) {
			this.restoSeg = resto;
			return;
		}
		// Venció: sonar/vibrar solo si acaba de pasar con la app a la vista — al volver
		// de un bloqueo largo no tiene sentido avisar tarde; queda la señal visual breve.
		const recienVencido = Date.now() - this.#hasta < 3000;
		const visible = document.visibilityState === 'visible';
		this.#limpiar();
		if (recienVencido && visible) {
			if (this.#sonido) void sonarDescansoTerminado().catch(() => {});
			if (this.#vibracion && 'vibrate' in navigator) navigator.vibrate([200, 100, 200]);
		}
		this.avisoFin = true;
		if (this.#avisoId) clearTimeout(this.#avisoId);
		this.#avisoId = setTimeout(() => (this.avisoFin = false), 2500);
	}

	#limpiar() {
		if (this.#intId) clearInterval(this.#intId);
		this.#intId = null;
		this.#inicio = null;
		this.#hasta = null;
		this.restoSeg = 0;
		localStorage.removeItem(DESCANSO_KEY);
		this.#soltarWakeLock();
	}

	#ocultarAviso() {
		this.avisoFin = false;
		if (this.#avisoId) clearTimeout(this.#avisoId);
		this.#avisoId = null;
	}
}

export const descanso = new Descanso();
