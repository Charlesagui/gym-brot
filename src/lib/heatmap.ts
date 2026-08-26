/**
 * Intensidad de un día entrenado, para teñir la celda del calendario en /historial.
 *
 * Existió como mapa anual estilo GitHub y se retiró: mostraba el mismo hecho que el
 * calendario, linkeaba al mismo detalle y sus 53 columnas medían 1.480 px, así que en
 * un teléfono se veían once semanas de las cincuenta y dos. Lo que sí aportaba —cuánto
 * entrenaste ese día, no sólo si entrenaste— vive ahora en el relleno del calendario.
 */

/** Topes de cada nivel: 0, 1–4, 5–8, 9–12 y 13+. Fijos, explicables y testeados. */
export const BUCKETS_HEATMAP = [0, 4, 8, 12] as const;

export type NivelActividad = 0 | 1 | 2 | 3 | 4;

export function nivelActividad(sets: number): NivelActividad {
	if (sets <= 0) return 0;
	if (sets <= BUCKETS_HEATMAP[1]) return 1;
	if (sets <= BUCKETS_HEATMAP[2]) return 2;
	if (sets <= BUCKETS_HEATMAP[3]) return 3;
	return 4;
}

/** Rótulos de la leyenda, derivados de los mismos topes que `nivelActividad`. */
export const ETIQUETAS_NIVEL: string[] = [
	'sin series',
	...BUCKETS_HEATMAP.slice(0, -1).map(
		(tope, indice) => `${tope + 1} a ${BUCKETS_HEATMAP[indice + 1]}`
	),
	`${BUCKETS_HEATMAP[BUCKETS_HEATMAP.length - 1]! + 1} o más`
];
