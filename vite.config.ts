import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
	test: {
		environment: 'node',
		coverage: {
			provider: 'v8',
			include: [
				'src/lib/sesion.ts',
				'src/lib/historial.ts',
				'src/lib/formato.ts',
				'src/lib/progreso.ts',
				// extras.ts (backup/import/unidades) y dias.ts (rutinas) tienen tests pero
				// quedaban fuera del informe: es donde más caro sale un bug silencioso.
				'src/lib/extras.ts',
				'src/lib/dias.ts',
				'src/lib/ejercicio-activo.ts'
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
				// Los 962 mp4 del catálogo pesan ~22 MB: precachearlos hacía que la primera
				// visita se bajara la videoteca entera (y la revalidara en cada deploy).
				// El shell precacheado queda en ~1 MB y los videos se cachean al verlos.
				globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
				modifyURLPrefix: { 'client/': '' },
				maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
				runtimeCaching: [
					{
						urlPattern: ({ url }) => url.pathname.startsWith('/videos/'),
						handler: 'CacheFirst',
						options: {
							cacheName: 'gb-videos',
							// Los mp4 son inmutables (el nombre es el id del ejercicio): una vez
							// bajados no hay motivo para volver a pedirlos.
							expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 },
							cacheableResponse: { statuses: [0, 200] },
							rangeRequests: true
						}
					}
				]
			},
			devOptions: { enabled: false }
		})
	]
});
