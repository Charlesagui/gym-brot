import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// SPA: la app es client-side (datos en Dexie), con shell de respaldo.
		adapter: adapter({ fallback: 'index.html' }),
		// SvelteKit emite un único script inline (el bootstrap de hidratación) y acá le
		// calcula el sha256 en build, que va en un <meta> CSP junto al HTML. La cabecera
		// de `static/_headers` tiene que seguir permitiendo 'unsafe-inline' para scripts
		// (si no, bloquea ese mismo script antes de que el meta lo habilite): las dos
		// políticas se aplican en conjunto, así que el resultado efectivo es que solo
		// corre el inline cuyo hash coincide. Un inline inyectado queda bloqueado.
		//
		// OJO: esta política también se aplica en `vite dev` (SvelteKit la manda como
		// cabecera), no solo en el build. Es deseable —los problemas de CSP aparecen en
		// local y no recién en Netlify—, pero explica por qué dev es más estricto que antes.
		csp: {
			mode: 'hash',
			directives: {
				'script-src': ['self'],
				// Explícito a propósito: sin esto los workers caen por fallback a
				// `script-src`, que acá lleva un hash de script y no tiene sentido para un
				// worker. Así coincide exactamente con el `worker-src` de static/_headers.
				'worker-src': ['self']
			}
		}
	}
};

export default config;
