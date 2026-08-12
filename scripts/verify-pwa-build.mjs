import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD = new URL('../build/', import.meta.url);
const APP = fileURLToPath(new URL('_app/immutable/', BUILD));

async function archivosJs(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) return archivosJs(path);
			return entry.name.endsWith('.js') ? [path] : [];
		})
	);
	return nested.flat();
}

const js = await archivosJs(APP);
const fuentes = await Promise.all(js.map((path) => readFile(path, 'utf8')));
// El nombre minificado del constructor no es un contrato: la parte estable es
// la URL y el scope que vite-plugin-pwa incrusta en el módulo virtual.
const registro = fuentes.find((fuente) =>
	/new \w+\([`"']\/sw\.js[`"'],\{scope:[`"']\/[`"']/.test(fuente)
);

if (!registro) {
	throw new Error('PWA invalida: el service worker no se registra como /sw.js con alcance /.');
}

if (fuentes.some((fuente) => /new \w+\([`"']\.\/sw\.js[`"']/.test(fuente))) {
	throw new Error('PWA invalida: reaparecio un registro relativo de ./sw.js.');
}

const sw = await readFile(new URL('sw.js', BUILD), 'utf8');
if (!sw.includes('NavigationRoute') || !sw.includes('index.html')) {
	throw new Error('PWA invalida: falta el fallback de navegacion a index.html.');
}

console.log('PWA verificada: /sw.js cubre desde / y conserva el fallback SPA.');
