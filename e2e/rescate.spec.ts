import { expect, test, type Page } from '@playwright/test';
import { apagarDescanso } from './descanso';

/**
 * Rompe SOLO la apertura con versión, que es la que usa Dexie.
 *
 * Simula el fallo que de verdad manda a la gente a esta pantalla: la máquina de
 * esquema/migración, no corrupción. La lectura de rescate abre sin versión, así que
 * sigue funcionando — que es exactamente lo que hay que poder demostrar.
 */
const romperAperturaDeDexie = () => {
	const original = indexedDB.open.bind(indexedDB);
	indexedDB.open = ((nombre: string, version?: number) => {
		if (version !== undefined) {
			const error = new Error('falla simulada de esquema');
			error.name = 'UnknownError';
			throw error;
		}
		return original(nombre);
	}) as typeof indexedDB.open;
};

async function entrenarUnaSerie(page: Page) {
	await page.goto('/dia/dia-piernas');
	await page.getByRole('link', { name: /Prensa de pierna 45/ }).click();
	await page.getByRole('textbox', { name: 'Peso de la serie 1 en kg' }).fill('100');
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await apagarDescanso(page);
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();
	await expect(page.getByText('1/4', { exact: true })).toBeVisible();
}

test('si la base no abre, primero se rescata y recién después se puede borrar', async ({
	page
}) => {
	await entrenarUnaSerie(page);

	await page.addInitScript(romperAperturaDeDexie);
	await page.reload();

	await expect(page.getByText('No pude abrir tus datos locales')).toBeVisible();
	// Lo que rompía: la única salida era también la única sin retorno.
	await expect(page.getByRole('button', { name: /borrar datos locales/i })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Reiniciar almacenamiento local/ })).toHaveCount(0);

	const descarga = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Descargar copia de rescate' }).click();
	const archivo = await descarga;
	expect(archivo.suggestedFilename()).toMatch(/^gym-brot-rescate-\d{4}-\d{2}-\d{2}\.json$/);

	const ruta = await archivo.path();
	const { readFile } = await import('node:fs/promises');
	const backup = JSON.parse(await readFile(ruta, 'utf8'));
	// El entrenamiento entero salió sin que Dexie pudiera abrir la base.
	expect(backup.dias.length).toBeGreaterThan(0);
	expect(backup.sesiones).toHaveLength(1);
	expect(backup.sesiones[0].ejercicios[0].sets[0]).toMatchObject({
		hecha: true,
		reps: 10,
		peso: 100
	});
	// El índice derivado no viaja, igual que en el backup normal.
	expect(backup.sesiones[0]).not.toHaveProperty('exerciseIds');

	await expect(page.getByText(/Descarga iniciada con/)).toBeVisible();
	// Recién con la copia bajada aparece la puerta sin retorno, y todavía en dos tiempos.
	const borrar = page.getByRole('button', { name: 'Reiniciar almacenamiento local' });
	await expect(borrar).toBeVisible();
	await borrar.click();
	await expect(page.getByRole('button', { name: 'Confirmar: borrar datos locales' })).toBeVisible();
	await expect(page.getByText('Hacelo solo si ya bajaste la copia de rescate')).toBeVisible();
});

test('un almacenamiento que el navegador puede vaciar se avisa donde se ve el historial', async ({
	page
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'storage', {
			configurable: true,
			value: { persisted: async () => false, persist: async () => false }
		});
	});
	await entrenarUnaSerie(page);

	await page.goto('/historial');
	const aviso = page.getByRole('link', { name: /puede borrar tu historial solo/ });
	await expect(aviso).toBeVisible();
	await expect(aviso).toContainText('Instalá la app en la pantalla de inicio');
	await aviso.click();
	await expect(page).toHaveURL(/\/ajustes/);
	await expect(page.getByText(/no.*se comprometió a conservar tus datos/)).toBeVisible();
});
