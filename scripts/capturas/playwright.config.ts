import { defineConfig, devices } from '@playwright/test';

/**
 * Capturas del README. No es un test: carga un mes y medio de entrenamiento inventado
 * y fotografía las pantallas que cuentan qué es la app. Se regenera con
 * `npm run build && npx playwright test -c scripts/capturas/playwright.config.ts`.
 */
export default defineConfig({
	testDir: '.',
	testMatch: /capturas\.pw\.ts/,
	workers: 1,
	reporter: 'list',
	use: {
		baseURL: 'http://127.0.0.1:4174',
		timezoneId: 'America/Argentina/Buenos_Aires',
		locale: 'es-AR',
		colorScheme: 'dark',
		acceptDownloads: true,
		...devices['Pixel 5']
	},
	webServer: {
		command: 'npm run preview -- --host 127.0.0.1 --port 4174',
		url: 'http://127.0.0.1:4174',
		reuseExistingServer: false,
		timeout: 120_000
	}
});
