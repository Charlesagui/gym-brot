/**
 * Escala semántica de duraciones (ms), en espejo de los tokens --dur-* de app.css:
 * FAST = presión/respuesta inmediata · BASE = cambio de estado · SLOW = celebración.
 */
export const DUR_FAST = 120;
export const DUR_BASE = 220;
export const DUR_SLOW = 340;

/** true si el sistema pide menos movimiento (prefers-reduced-motion). */
export function menosMovimiento(): boolean {
	return (
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}

/**
 * Duración de transición que respeta la preferencia de menor movimiento:
 * con reduce activado todo aparece al instante (sin animación).
 */
export function dur(ms: number): number {
	return menosMovimiento() ? 0 : ms;
}
