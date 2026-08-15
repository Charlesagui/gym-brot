import type { Ajustes } from './db';

/**
 * Cuánto se descansa y cómo se nombra. Vive aparte de la pantalla y del store del
 * descanso porque son reglas puras: qué valor manda (ejercicio > global) y cómo se
 * escribe un descanso que puede ser de segundos o de minutos.
 *
 * La duración se guarda SIEMPRE en minutos, igual que `ajustes.timer.minutos`, para
 * no tener dos unidades dando vueltas. 0,75 y 1,5 dan 45 y 90 segundos exactos.
 */

/**
 * 45 y 90 segundos existen porque son los descansos reales de los accesorios: antes
 * el mínimo era 1 minuto y no había forma de pedir menos. El 1 y el 4 conviven: se
 * conserva el 1 porque ya se podía elegir, y se deja fuera el 4 porque entre 3 y 5
 * nadie lo pedía y la fila tiene que seguir entrando de un vistazo.
 */
export const PRESETS_DESCANSO = [0.75, 1, 1.5, 2, 3, 5] as const;

/** Duración efectiva de un descanso resuelto (minutos), con su interruptor ya aplicado. */
export interface DescansoEfectivo {
	activo: boolean;
	minutos: number;
}

/** `0` guardado en un ejercicio significa "sin descanso acá", no "sin configurar". */
export function descansoPersonalizado(
	exerciseId: string | undefined,
	ajustes: Ajustes
): number | undefined {
	if (!exerciseId) return undefined;
	return ajustes.descansosEjercicio?.[exerciseId];
}

/** Personalización del ejercicio > ajuste global. */
export function descansoEfectivo(
	exerciseId: string | undefined,
	ajustes: Ajustes
): DescansoEfectivo {
	const propio = descansoPersonalizado(exerciseId, ajustes);
	if (propio == null) return { activo: ajustes.timer.activo, minutos: ajustes.timer.minutos };
	// Apagado en este ejercicio: se conserva el valor global como duración a proponer
	// si el usuario vuelve a encenderlo, en vez de dejarlo en 0 y tener que reelegir.
	if (propio <= 0) return { activo: false, minutos: ajustes.timer.minutos };
	return { activo: true, minutos: propio };
}

/** Segundos enteros de un descanso en minutos (1,5 → 90). */
export function descansoEnSegundos(minutos: number): number {
	return Math.max(1, Math.round(minutos * 60));
}

/** Etiqueta corta para un chip: "45s" · "90s" · "2′". */
export function etiquetaCortaDescanso(minutos: number): string {
	const segundos = descansoEnSegundos(minutos);
	if (segundos < 60) return `${segundos}s`;
	if (segundos % 60 !== 0) return `${segundos}s`;
	return `${segundos / 60}′`;
}

/** Etiqueta hablada, para `aria-label` y textos de apoyo: "45 segundos" · "2 minutos". */
export function etiquetaDescanso(minutos: number): string {
	const segundos = descansoEnSegundos(minutos);
	if (segundos % 60 !== 0) return `${segundos} segundos`;
	const mins = segundos / 60;
	return `${mins} ${mins === 1 ? 'minuto' : 'minutos'}`;
}
