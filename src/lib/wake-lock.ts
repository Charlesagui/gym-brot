export interface WakeLockSentinelLike {
	released: boolean;
	release(): Promise<void>;
}

export type SolicitarWakeLock = () => Promise<WakeLockSentinelLike>;

function solicitarPantalla(): Promise<WakeLockSentinelLike> {
	if (typeof navigator === 'undefined' || !('wakeLock' in navigator))
		return Promise.reject(new Error('Wake Lock no disponible'));
	return navigator.wakeLock.request('screen');
}

/** Lifecycle tolerante a falta de soporte, rechazos y respuestas que llegan tarde. */
export class WakeLockSeguro {
	#activo = false;
	#sentinel: WakeLockSentinelLike | null = null;
	#solicitando = false;
	#escuchando = false;

	constructor(private readonly solicitar: SolicitarWakeLock = solicitarPantalla) {}

	/**
	 * El sistema suelta el lock apenas la pestaña se oculta y no lo devuelve al volver.
	 * Mientras el lock está activo lo recuperamos solos: mirar una notificación en medio
	 * del ejercicio alcanzaba para que la pantalla volviera a apagarse sola.
	 */
	#alVolver = () => {
		if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
		void this.reanudar();
	};

	async activar(): Promise<void> {
		this.#activo = true;
		this.#escuchar();
		await this.#pedir();
	}

	async reanudar(): Promise<void> {
		if (this.#activo) await this.#pedir();
	}

	desactivar(): void {
		this.#activo = false;
		this.#dejarDeEscuchar();
		const sentinel = this.#sentinel;
		this.#sentinel = null;
		void sentinel?.release().catch(() => {});
	}

	#escuchar(): void {
		if (this.#escuchando || typeof document === 'undefined') return;
		this.#escuchando = true;
		document.addEventListener('visibilitychange', this.#alVolver);
	}

	#dejarDeEscuchar(): void {
		if (!this.#escuchando) return;
		this.#escuchando = false;
		document.removeEventListener('visibilitychange', this.#alVolver);
	}

	async #pedir(): Promise<void> {
		if (!this.#activo || (this.#sentinel && !this.#sentinel.released) || this.#solicitando) return;
		this.#solicitando = true;
		try {
			const sentinel = await this.solicitar();
			if (!this.#activo) {
				void sentinel.release().catch(() => {});
				return;
			}
			this.#sentinel = sentinel;
		} catch {
			// Sin soporte o permiso: la sesión y el timer siguen funcionando normalmente.
		} finally {
			this.#solicitando = false;
		}
	}
}
