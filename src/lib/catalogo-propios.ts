import type { Dia, Sesion } from './db';

/**
 * "Tus ejercicios": los que ya están en alguna rutina o entrenaste hace poco.
 *
 * El catálogo tiene 962 ejercicios y los que una persona usa son veinte. Buscar por
 * nombre sirve cuando sabés qué querés; esto sirve para lo otro, que es más frecuente:
 * volver a algo que ya hacés sin acordarte de cómo se llamaba en el catálogo.
 *
 * Es una regla pura sobre datos que ya existen. No confundir con un filtro por
 * equipamiento: el catálogo ya trae `equipo` clasificado en el 90% de los ejercicios
 * (ver `scripts/clasificar-equipo.mjs`), así que ese filtro ya se puede escribir, pero
 * sigue siendo otra cosa que esto — y falta decidir qué hace con el 10% sin clasificar.
 */
export function ejerciciosPropios(
	dias: Pick<Dia, 'ejercicios'>[],
	sesiones: Pick<Sesion, 'ejercicios'>[]
): Set<string> {
	const ids = new Set<string>();
	for (const dia of dias) {
		for (const item of dia.ejercicios) ids.add(item.exerciseId);
	}
	for (const sesion of sesiones) {
		for (const ejercicio of sesion.ejercicios) ids.add(ejercicio.exerciseId);
	}
	return ids;
}
