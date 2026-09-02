import { expect, test } from '@playwright/test';

/**
 * Los acuses de Ajustes: que la respuesta se vea, que el error no se borre solo, y que
 * el backup a medio confirmar sobreviva a salir de la pantalla.
 *
 * Los tres nacen de la misma auditoría: el mensaje vivía dibujado adentro de la tarjeta
 * de Backup, así que catorce acciones repartidas por toda la pantalla contestaban en un
 * lugar que no estabas mirando, y el pendiente de confirmación moría al navegar.
 */

test('el acuse se ve aunque la pantalla esté en otra parte', async ({ page }) => {
	await page.goto('/ajustes');

	// Mantenimiento está abajo de todo; el acuse se dibujaba arriba, en Backup.
	await page.getByRole('button', { name: 'Volver a mostrar los carteles de ayuda' }).click();
	const acuse = page.getByRole('status').filter({ hasText: 'Vas a volver a ver los carteles' });
	await expect(acuse).toBeVisible();

	// Lo que separa un acuse al pie de un párrafo adentro de una tarjeta: seguir a la
	// vista cuando la pantalla se mueve. Ajustes mide catorce secciones.
	await page.evaluate(() => window.scrollTo(0, 0));
	await expect(acuse).toBeInViewport();
});

test('lo que falló espera a que lo cierren; lo que salió bien se va solo', async ({ page }) => {
	await page.goto('/ajustes');

	// Un backup ilegible: `parseBackup` corta antes de tocar nada.
	await page.locator('input[type="file"]').setInputFiles({
		name: 'roto.json',
		mimeType: 'application/json',
		buffer: Buffer.from('{{{')
	});

	// `alert` y no `status`: pide atención, pero no es un diálogo porque no hay nada
	// que contestar. Y no lleva botón de acción, así que tampoco es `alertdialog`.
	const falla = page.getByRole('alert');
	await expect(falla).toBeVisible();

	// El acuse de éxito dura 6 s. El error tiene que seguir ahí pasado ese plazo: uno
	// que se borra solo es un error que nadie leyó.
	await page.waitForTimeout(7000);
	await expect(falla).toBeVisible();

	await page.getByRole('button', { name: 'Cerrar aviso' }).click();
	await expect(falla).toBeHidden();
});

test('el backup a medio confirmar sobrevive a ir a mirar Descargas', async ({ page }) => {
	await page.goto('/ajustes');
	await expect(page.getByText('Todavía no guardaste ninguna copia.')).toBeVisible();

	const descarga = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Guardar copia de seguridad' }).click();
	await descarga;

	const confirmar = page.getByRole('button', { name: 'Ya guardé el archivo' });
	await expect(confirmar).toBeVisible();

	// Confirmar exige salir de la app a mirar el archivo. Cuando el pendiente vivía en
	// el componente, este viaje se lo llevaba puesto: al volver no había nada que tocar,
	// `registrarBackup` no corría nunca y la fecha del último backup no se escribía.
	await page.goto('/');
	await page.goto('/ajustes');
	await expect(confirmar).toBeVisible();

	await confirmar.click();
	await expect(page.getByRole('status').filter({ hasText: 'Backup confirmado' })).toBeVisible();
	await expect(confirmar).toBeHidden();
	// Y la pantalla que trata de backups ya contesta cuándo fue el último.
	await expect(page.getByText('Última copia: hoy.')).toBeVisible();

	// La confirmación también sobrevive: no vuelve a pedirla al entrar de nuevo.
	await page.goto('/ajustes');
	await expect(page.getByRole('button', { name: 'Ya guardé el archivo' })).toBeHidden();
	await expect(page.getByText('Última copia: hoy.')).toBeVisible();
});
