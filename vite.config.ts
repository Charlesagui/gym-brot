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
				'src/lib/progreso.ts'
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
			registerType: 'autoUpdate',
			injectRegister: 'auto',
			manifest: {
				name: 'Gym-brot',
				short_name: 'Gym-brot',
				description: 'Tu rutina de gym, simple y offline.',
				lang: 'es',
				theme_color: '#08080c',
				background_color: '#08080c',
				display: 'standalone',
				orientation: 'portrait',
				start_url: '/',
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
				globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2,mp4}'],
				maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
			},
			devOptions: { enabled: false }
		})
	]
});
