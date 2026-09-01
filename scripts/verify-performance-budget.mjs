import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const BUILD = new URL('../build/', import.meta.url);
/*
 * Techo del shell: lo que hay que bajar y ejecutar antes de ver la primera pantalla.
 * El que importa de los dos es el gzip, que es lo que viaja; el crudo mide lo que el
 * teléfono después tiene que parsear.
 *
 * Medido el 25/8/2026: 26 archivos, 301,4 KiB crudo y 100,8 KiB gzip, de los cuales los
 * tres chunks más grandes son el 65 % (32,8 + 22,4 + 10,1 KiB gzip). Es el layout, el
 * runtime de Svelte y la base de datos, que la portada necesita sí o sí para listar las
 * rutinas. El chunk pesado de los gráficos (189 KiB) NO está acá: entra recién al abrir
 * el progreso, y así tiene que seguir.
 *
 * Si algún día esto sube de golpe, la pregunta antes de tocar el número es cuál de esos
 * tres creció y si lo que se sumó hace falta en la primera pantalla.
 *
 * 31/8/2026: el techo crudo de 340 KiB se había quedado sin aire —en el commit anterior
 * quedaban 185 B— y lo rompió el arreglo del descanso a pantalla completa: sus salidas
 * caían fuera de la pantalla en cualquier teléfono de menos de 664 px de alto, y el
 * arreglo son dos media queries verticales (+992 B crudo, +201 B gzip).
 *
 * Las dos preguntas de arriba, respondidas: creció el CSS del shell, no un chunk nuevo;
 * y sí hace falta en la primera pantalla, porque `+layout.svelte` monta el descanso en
 * todas las rutas y un cronómetro no puede esperar a que baje un chunk aparte. El gzip
 * —el que viaja— ni se movió del 95 % de su propio techo.
 *
 * 352 KiB devuelve ~11 KiB de aire, en la misma proporción con la que se subió el
 * precache en agosto.
 */
const MAX_SHELL_BYTES = 352 * 1024;
const MAX_SHELL_GZIP_BYTES = 120 * 1024;
/*
 * Techo del precache: lo que la app se baja en la primera visita y revalida en cada
 * deploy. Sube cuando la app crece de verdad, no para tapar un asset que no debería
 * estar acá — por eso el guardia de arriba rechaza los videos.
 *
 * Medido el 26/8/2026: 1427,1 KiB en 131 entradas, de las cuales 1326,9 KiB (93 %) son
 * el JavaScript de las rutas, 64,7 KiB de CSS, 20,7 KiB de íconos y 13,7 KiB de la
 * tipografía de las cifras. La proporción no se movió desde agosto: el número sigue el
 * tamaño de la app, y la forma de bajarlo sería partir rutas, no borrar assets.
 *
 * El techo anterior (1425 KiB) se había comido su aire: quedaban 5,3 KiB. Antes de
 * subirlo se verificó que el crecimiento fuera código y no un asset colado ni una
 * dependencia duplicada — la rueda del tiempo sigue estando en dos chunks, los mismos
 * que antes, y ningún binario nuevo entró al precache.
 *
 * 1480 KiB devuelve ~53 KiB de aire y sigue siendo chico para que un mp4 o una imagen
 * grande lo rompan enseguida.
 */
const MAX_PRECACHE_BYTES = 1480 * 1024;

async function tamanio(url) {
	return stat(url).then((archivo) => archivo.size);
}

const index = await readFile(new URL('index.html', BUILD), 'utf8');
const recursosShell = [
	...new Set(
		[...index.matchAll(/(?:href|src)="([^\"]*\/_app\/[^\"]+)"/g)].map(
			(coincidencia) => new URL(`.${coincidencia[1]}`, BUILD)
		)
	)
];
const fuentesShell = await Promise.all(recursosShell.map((url) => readFile(url)));
const bytesShell = fuentesShell.reduce((total, fuente) => total + fuente.length, 0);
const gzipShell = fuentesShell.reduce((total, fuente) => total + gzipSync(fuente).length, 0);

if (bytesShell > MAX_SHELL_BYTES || gzipShell > MAX_SHELL_GZIP_BYTES) {
	throw new Error(
		`Presupuesto de shell excedido: ${bytesShell} B (${gzipShell} B gzip), máximo ${MAX_SHELL_BYTES} B (${MAX_SHELL_GZIP_BYTES} B gzip).`
	);
}

const sw = await readFile(new URL('sw.js', BUILD), 'utf8');
const precache = [
	...new Set([...sw.matchAll(/url:"([^"]+)"/g)].map((coincidencia) => coincidencia[1]))
];
if (precache.some((url) => url.startsWith('videos/'))) {
	throw new Error('Presupuesto de PWA inválido: los videos no deben entrar al precache.');
}
const bytesPrecache = (
	await Promise.all(precache.map((url) => tamanio(new URL(url, BUILD))))
).reduce((total, bytes) => total + bytes, 0);
if (bytesPrecache > MAX_PRECACHE_BYTES) {
	throw new Error(
		`Presupuesto de precache excedido: ${bytesPrecache} B, máximo ${MAX_PRECACHE_BYTES} B.`
	);
}

console.log(
	`Rendimiento verificado: shell ${bytesShell} B (${gzipShell} B gzip), precache ${bytesPrecache} B.`
);
