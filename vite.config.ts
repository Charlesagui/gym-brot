import { sveltekit } from '@sveltejs/kit/vite';
import { configDefaults, defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

/** Netlify expone COMMIT_REF; en desarrollo usamos el HEAD local como respaldo. */
function commitActual(): string {
	const commitNetlify = process.env.COMMIT_REF?.trim();
	if (commitNetlify) return commitNetlify.slice(0, 7);
	try {
		return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
			encoding: 'utf8'
		}).trim();
	} catch {
		return 'desconocido';
	}
}

export default defineConfig({
	define: {
		__APP_COMMIT__: JSON.stringify(commitActual())
	},
	test: {
		environment: 'node',
		exclude: [...configDefaults.exclude, 'e2e/**'],
		coverage: {
			provider: 'v8',
			include: [
				'src/lib/sesion.ts',
				'src/lib/sesion-reglas.ts',
				'src/lib/historial.ts',
				'src/lib/formato.ts',
				'src/lib/progreso.ts',
				// extras.ts (backup/import/unidades) y dias.ts (rutinas) tienen tests pero
				// quedaban fuera del informe: es donde más caro sale un bug silencioso.
				'src/lib/extras.ts',
				'src/lib/dias.ts',
				'src/lib/ejercicio-activo.ts',
				// El descanso es el módulo más sensible al tiempo y el único que se sincroniza
				// entre instancias: quedaba sin tests y fuera del informe justo donde más
				// barato salía un bug (ver descanso.test.ts).
				'src/lib/descanso.svelte.ts',
				// Qué descanso manda (ejercicio > general) y cómo se escribe: reglas puras
				// que antes vivían como números sueltos dentro de la pantalla de ejercicio.
				'src/lib/descanso-preset.ts',
				// El motor de calorías: aritmética pura donde un signo cambiado no rompe
				// nada visible, solo devuelve un número creíble y equivocado.
				'src/lib/energia.ts',
				// La calibración: si la señal y el ruido se confunden acá, la app propone
				// con confianza un número sacado de la sal de un asado.
				'src/lib/calibracion.ts',
				// Las frases dicen cosas verificables sobre el usuario: una condición mal puesta
				// no rompe nada, solo le afirma algo falso con cara de dato.
				'src/lib/frases.ts',
				'src/lib/esfuerzo.ts',
				'src/lib/heatmap.ts',
				'src/lib/musculos.ts',
				'src/lib/perfil-energia.ts',
				'src/lib/peso-corporal.ts',
				'src/lib/progresion.ts',
				'src/lib/wake-lock.ts',
				// Entrada numérica y búsqueda del catálogo: lógica pura que antes vivía
				// duplicada dentro de los componentes, sin forma de testearla.
				'src/lib/numeros.ts',
				'src/lib/catalog.ts',
				'src/lib/catalogo-propios.ts',
				// `hoy.svelte.ts` queda FUERA del informe a propósito: v8 no le atribuye
				// cobertura acá (nadie que corra en Node lo importa salvo su propio test) y
				// listarlo mostraría un 0 % que no dice nada. Sus tests igual corren:
				// `hoy.test.ts` cubre el temporizador de medianoche, el foco y la
				// idempotencia de `init`.
				// La lectura de rescate es la última red antes de borrar todo, y la única
				// señal de que el navegador puede vaciar los datos por su cuenta. Son
				// justo los dos módulos donde un fallo silencioso se paga con el historial.
				'src/lib/rescate.ts',
				'src/lib/persistencia.ts'
			],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 70,
				statements: 80
			}
		}
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			// SvelteKit usa un `base` relativo para que el build estatico sea portable.
			// Para el service worker eso es peligroso: abierto desde /dia/... convertia
			// `./sw.js` en /dia/.../sw.js y dejaba esa entrada sin cobertura offline.
			// Gym-brot se publica en la raiz, asi que registro y alcance son absolutos.
			base: '/',
			scope: '/',
			// 'prompt' en vez de 'autoUpdate': con autoUpdate el service worker nuevo
			// tomaba el control solo y podía recargar la app a mitad de una serie. Ahora
			// espera, y la app avisa cuando no estás entrenando (ver +layout.svelte).
			registerType: 'prompt',
			injectRegister: null,
			kit: {
				spa: true,
				adapterFallback: 'index.html'
			},
			manifest: {
				id: '/',
				name: 'Gym-brot',
				short_name: 'Gym-brot',
				description: 'Tu rutina de gym, simple y offline.',
				lang: 'es',
				theme_color: '#08080c',
				background_color: '#08080c',
				display: 'standalone',
				// 'any' y no 'portrait': la app tiene layouts de landscape trabajados y
				// bloquear la orientación los dejaba inalcanzables en la app instalada.
				orientation: 'any',
				categories: ['health', 'fitness', 'sports'],
				start_url: '/',
				shortcuts: [
					{ name: 'Historial', short_name: 'Historial', url: '/historial' },
					{ name: 'Ajustes', short_name: 'Ajustes', url: '/ajustes' }
				],
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
					{
						src: '/icons/icon-maskable-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			},
			workbox: {
				// Los 962 mp4 del catálogo pesan ~20 MB: precachearlos hacía que la primera
				// visita se bajara la videoteca entera (y la revalidara en cada deploy).
				// El shell precacheado queda en ~1 MB; la videoteca se descarga solo desde Ajustes.
				globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
				// El preview de SvelteKit (y algunos hosts con fallback SPA) sirve `/` pero
				// responde 404 a `/index.html`. Precachear el documento bajo su URL pública
				// real evita que la instalación completa del service worker quede pendiente.
				//
				// La revisión se deriva del resto del manifest y no puede ser `null`: Workbox
				// usa URL + revisión como clave de caché, así que un `/` sin revisión tiene la
				// misma clave en todos los deploys. El service worker nuevo entonces nunca
				// vuelve a bajar el shell, pero sí borra del precache los bundles del deploy
				// anterior: queda un documento viejo pidiendo archivos que ya no existen y la
				// app arranca en blanco, con o sin conexión. `index.html` todavía no existe
				// acá (lo escribe `adapter-static` después), así que su hash no sirve; el del
				// manifest sí, porque si cambió cualquier asset cambió el documento que los
				// referencia.
				manifestTransforms: [
					async (entries) => {
						const revision = createHash('sha256')
							.update(entries.map((entry) => `${entry.url}:${entry.revision ?? ''}`).join('\n'))
							.digest('hex')
							.slice(0, 16);
						// `size` sólo alimenta el reporte de tamaño del precache; el documento todavía
						// no está en disco, así que no hay nada que medir y queda en 0.
						return { manifest: [...entries, { url: '/', revision, size: 0 }], warnings: [] };
					}
				],
				modifyURLPrefix: { 'client/': '' },
				navigateFallback: '/',
				maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
				runtimeCaching: [
					{
						urlPattern: ({ url }) => url.pathname.startsWith('/videos/'),
						handler: 'CacheFirst',
						options: {
							cacheName: 'gb-videos',
							// CacheFirst sigue atendiendo lo guardado explícitamente por la app, pero
							// esta lista vacía impide que Workbox persista previews vistos por accidente.
							cacheableResponse: { statuses: [] },
							// El catálogo completo tiene 962 videos. El límite debe cubrir la
							// promesa de "Descargar todos" sin expulsar parte del historial LRU.
							expiration: { maxEntries: 1000, maxAgeSeconds: 60 * 60 * 24 * 365 },
							rangeRequests: true
						}
					}
				]
			},
			devOptions: { enabled: false }
		})
	]
});
