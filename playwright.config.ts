import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: 'http://127.0.0.1:4173',
		// La app fecha las sesiones por día LOCAL, así que cualquier test que cruce
		// medianoche depende del huso del navegador. Sin fijarlo, esos tests pasan en
		// una máquina en -03 y fallan en una en UTC — el mismo commit, distinto
		// veredicto. Se fija el huso del usuario, que es el que define la regla.
		timezoneId: 'America/Argentina/Buenos_Aires',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	webServer: {
		command: 'npm run preview -- --host 127.0.0.1 --port 4173',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	},
	projects: [
		{
			name: 'mobile-chromium',
			use: { ...devices['Pixel 5'] }
		}
	]
});
