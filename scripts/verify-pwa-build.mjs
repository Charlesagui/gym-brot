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
if (!sw.includes('NavigationRoute') || !sw.includes('createHandlerBoundToURL("/")')) {
	throw new Error('PWA invalida: falta el fallback de navegacion a /.');
}

if (sw.includes('url:"index.html"') || sw.includes('createHandlerBoundToURL("index.html")')) {
	throw new Error('PWA invalida: /index.html reaparecio en el precache o fallback.');
}

// Workbox indexa el precache por URL + revision. El shell es el unico documento no
// versionado por nombre, asi que sin revision su clave es identica en cada deploy: el
// service worker nuevo deja de bajarlo, borra los bundles viejos que ese HTML referencia
// y la app arranca en blanco. Un build no puede pasar en verde con eso.
const shell = sw.match(/\{url:"\/",revision:(null|"[^"]*")\}/);
if (!shell) {
	throw new Error('PWA invalida: el shell / no quedo en el precache.');
}
if (shell[1] === 'null') {
	throw new Error(
		'PWA invalida: / se precachea con revision null. El shell nunca se actualizaria y tras ' +
			'el proximo deploy la app arrancaria en blanco para todo cliente ya instalado.'
	);
}

console.log(
	`PWA verificada: /sw.js cubre y precachea el fallback SPA en / (revision ${shell[1]}).`
);
