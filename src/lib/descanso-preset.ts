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
 * Cuatro atajos redondos, no seis. La fila anterior (45s, 1′, 90s, 2′, 3′, 5′) más
 * Auto y Off eran ocho botones que se envolvían en tres renglones: había que leerla
 * entera para encontrar el que se buscaba.
 *
 * 45 s y 90 s siguen siendo descansos reales de accesorio, pero ya no necesitan chip
 * propio: cualquier valor de 15 s a 10 min se elige girando la rueda ("Otro"), que es
 * exactamente el caso para el que sirve un control rotatorio — rango corto, paso
 * grueso y ninguna necesidad de apuntar a un número exacto.
 */
export const PRESETS_DESCANSO = [1, 2, 4, 5] as const;

/** Rango y paso de la rueda de descanso, en segundos. */
export const RUEDA_DESCANSO = { min: 15, max: 600, paso: 15 } as const;

/** Segundos → minutos, para guardar lo que elige la rueda con la unidad de siempre. */
export function segundosAMinutos(segundos: number): number {
	return segundos / 60;
}

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
