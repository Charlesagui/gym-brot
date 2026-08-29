/**
 * La escala de cinco pasos con la que /historial dice "cuánto", en un solo lugar.
 *
 * La usan el calendario (series de un día) y el mapa corporal (series por semana de un
 * músculo). Las UNIDADES de cada uno son distintas y viven con ellos —`BUCKETS_HEATMAP`
 * en `heatmap.ts`, los cuartos de `SERIES_SEMANA_LLENO` en `musculos.ts`—; lo que se
 * comparte es qué color significa "poco" y qué color significa "mucho", que en la misma
 * pantalla no puede ser dos cosas.
 *
 * El paso 0 no es verde: es la silueta o la celda apenas insinuada. Con el verde tenue
 * que había antes, "no entrené esto" y "lo entrené poco" se separaban sólo por opacidad
 * y no se distinguían. El paso 4 es `--exito` exacto, el verde del día terminado: el
 * techo de la escala es el color de logro de la app y no una tonalidad más.
 *
 * Entre medio, el color se corre de TONO además de aclararse —167° a 142°, verde
 * azulado a verde de la app—, porque dos tonos se separan a simple vista mucho mejor
 * que dos opacidades del mismo color. Cada paso está a 1,59:1 o más del vecino; la
 * rampa continua anterior dejaba pasos contiguos reales en 1,08:1.
 */
export type NivelIntensidad = 0 | 1 | 2 | 3 | 4;

export const COLORES_INTENSIDAD: string[] = [
	'rgba(255, 255, 255, 0.06)',
	'#1e5a4d',
	'#27865d',
	'#35b06d',
	'rgb(var(--exito))'
];

/**
 * La tinta que se lee ENCIMA de cada paso, en rgb suelto para poder darle opacidad.
 *
 * El calendario escribe el número del día sobre el relleno, así que la escala no puede
 * elegir sus colores sola: por eso la anterior se cortaba en alfa 0,55, que era hasta
 * donde el blanco aguantaba. Con la tinta declarada por paso, la escala llega hasta el
 * verde pleno y el número sigue en 4,5:1 o mejor —los dos pasos claros se escriben con
 * la tinta oscura que la app ya usa sobre sus glows (`--on-bright`)—.
 *
 * También resuelve el contorno: a 0,28 separa dos celdas pegadas en cualquier paso, y a
 * 0,9 marca el día de hoy. Un borde verde fijo desaparecía sobre los pasos claros, y
 * sobre el paso 4 era literalmente el color del relleno.
 */
export const TINTA_INTENSIDAD: string[] = [
	'255 255 255',
	'255 255 255',
	'255 255 255',
	'8 8 12',
	'8 8 12'
];
