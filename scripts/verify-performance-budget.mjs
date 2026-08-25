import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const BUILD = new URL('../build/', import.meta.url);
const MAX_SHELL_BYTES = 300 * 1024;
const MAX_SHELL_GZIP_BYTES = 110 * 1024;
// La calculadora de discos agrega una ruta offline de ~12 KiB al precache.
// Conservamos un margen acotado sin relajar los presupuestos del shell.
const MAX_PRECACHE_BYTES = 1320 * 1024;

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
