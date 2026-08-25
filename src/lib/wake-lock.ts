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

	constructor(private readonly solicitar: SolicitarWakeLock = solicitarPantalla) {}

	async activar(): Promise<void> {
		this.#activo = true;
		await this.#pedir();
	}

	async reanudar(): Promise<void> {
		if (this.#activo) await this.#pedir();
	}

	desactivar(): void {
		this.#activo = false;
		const sentinel = this.#sentinel;
		this.#sentinel = null;
		void sentinel?.release().catch(() => {});
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
