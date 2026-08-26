import { expect, test } from '@playwright/test';

/**
 * El usuario real no va en línea recta: termina, se arrepiente, vuelve, borra y agrega.
 * Estos caminos de vuelta eran los que se trababan.
 */

const RUTA = '/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-15';

async function hacerSerie(page: import('@playwright/test').Page, n: number, peso: string) {
	await page.getByRole('textbox', { name: `Peso de la serie ${n} en kg` }).fill(peso);
	await page.getByRole('textbox', { name: `Reps de la serie ${n}` }).fill('10');
	await page.getByRole('button', { name: `Marcar serie ${n}`, exact: true }).click();
	await expect(
		page.getByRole('button', { name: `Desmarcar serie ${n}`, exact: true })
	).toBeVisible();
}

test('terminar con menos series de las planeadas cierra el ejercicio de verdad', async ({
	page
}) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto(RUTA);
	// Sin descanso: el overlay taparía la lista entre serie y serie.
	await page.getByRole('button', { name: 'Sin descanso en este ejercicio' }).click();

	// La rutina pide 4 series; hoy salieron 2.
	await hacerSerie(page, 1, '100');
	await hacerSerie(page, 2, '100');
	await expect(page.getByLabel('2 de 4 series hechas')).toBeVisible();

	await page.getByRole('button', { name: 'Terminar con 2 series' }).click();
	const avisoCierre = page.getByRole('alertdialog');
	await expect(avisoCierre).toContainText('Se quitan las 2 series que quedaron sin marcar');
	await avisoCierre.getByRole('button', { name: 'Terminar', exact: true }).click();

	// Vuelve al día, y el ejercicio queda hecho: antes decía "Faltan 1 ejercicio".
	await expect(page).toHaveURL(/\/dia\/dia-piernas/);
	const tarjeta = page.getByRole('link', { name: /Prensa de pierna 45° Prensa/ });
	await expect(tarjeta).toContainText('hecho');
	// Y un ejercicio hecho ya no ofrece "Saltar", que lo rotulaba en gris por nada.
	await expect(
		page.getByRole('link', { name: 'Corregir o agregar series de Prensa de pierna 45°' })
	).toBeVisible();
	await expect(page.getByRole('button', { name: /^Saltar Prensa de pierna 45/ })).toBeHidden();
});

test('una serie del medio se quita sola, sin arrastrar a las de abajo', async ({ page }) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto(RUTA);
	await page.getByRole('button', { name: 'Sin descanso en este ejercicio' }).click();

	await hacerSerie(page, 1, '100');
	await hacerSerie(page, 2, '80');
	await hacerSerie(page, 3, '120');

	// La 2 estaba mal cargada: se abre y se quita esa, no la última.
	await page.getByRole('button', { name: 'Corregir serie 2' }).click();
	await page.getByRole('button', { name: 'Quitar la serie 2 de hoy' }).click();
	const avisoQuitar = page.getByRole('alertdialog');
	await expect(avisoQuitar).toContainText('La serie 2 está marcada como hecha');
	await avisoQuitar.getByRole('button', { name: 'Quitar', exact: true }).click();

	// Quedan la de 100 y la de 120; la de 80 desapareció.
	await expect(page.getByLabel('2 de 3 series hechas')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Corregir serie 1' })).toContainText('100');
	await expect(page.getByRole('button', { name: 'Corregir serie 2' })).toContainText('120');

	// Borrar un registro real tiene vuelta atrás, igual que reiniciar.
	await page.getByRole('status').getByRole('button', { name: 'Deshacer' }).click();
	await expect(page.getByLabel('3 de 4 series hechas')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Corregir serie 2' })).toContainText('80');
});

test('el día terminado dice por qué se reabre en vez de descelebrarse en silencio', async ({
	page
}) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto('/dia/dia-piernas?fecha=2026-08-15');

	// Camino corto a un día cerrado: se saltan los seis ejercicios.
	for (const nombre of [
		'Prensa de pierna 45°',
		'Extensión de cuádriceps',
		'Curl femoral sentado',
		'Abductores (apertura)',
		'Aductores (cierre)',
		'Elevación de gemelos sentado'
	]) {
		await page.getByRole('button', { name: `Saltar ${nombre} hoy`, exact: true }).click();
	}
	await page.getByRole('button', { name: 'Terminar día' }).click();
	await page.getByRole('button', { name: 'Cerrar resumen del día' }).click();
	await expect(page.getByText('Terminado', { exact: true })).toBeVisible();

	// Retomar un ejercicio reabre el día: ahora la pantalla lo explica.
	await page.getByRole('button', { name: 'Reanudar Curl femoral sentado hoy' }).click();
	await expect(page.getByRole('status')).toContainText('Este día dejó de estar terminado');
	await expect(page.getByRole('status')).toContainText('retomaste curl femoral sentado');

	await page.getByRole('button', { name: 'Descartar el aviso de reapertura' }).click();
	await expect(page.getByRole('status')).toBeHidden();
});

test('reiniciar el ejercicio pide confirmación en el aviso y se puede deshacer', async ({
	page
}) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto(RUTA);
	await page.getByRole('button', { name: 'Sin descanso en este ejercicio' }).click();

	await hacerSerie(page, 1, '100');
	await hacerSerie(page, 2, '105');
	await expect(page.getByLabel('2 de 4 series hechas')).toBeVisible();

	// Un toque NO reinicia: arma el aviso.
	await page.getByRole('button', { name: 'Reiniciar este ejercicio' }).click();
	const aviso = page.getByRole('alertdialog');
	await expect(aviso).toContainText('Se desmarcan las 2 series hechas');
	await expect(page.getByLabel('2 de 4 series hechas')).toBeVisible();

	// Recién el segundo toque, sobre el aviso, reinicia.
	await aviso.getByRole('button', { name: 'Reiniciar' }).click();
	await expect(page.getByLabel('0 de 4 series hechas')).toBeVisible();

	// Y vuelve entero, con las cargas intactas.
	await page.getByRole('status').getByRole('button', { name: 'Deshacer' }).click();
	await expect(page.getByLabel('2 de 4 series hechas')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Corregir serie 2' })).toContainText('105');
});

test('el aviso de reinicio se va solo si lo ignorás', async ({ page }) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto(RUTA);
	await page.getByRole('button', { name: 'Sin descanso en este ejercicio' }).click();
	await hacerSerie(page, 1, '100');

	await page.getByRole('button', { name: 'Reiniciar este ejercicio' }).click();
	await expect(page.getByRole('alertdialog')).toBeVisible();
	await page.clock.runFor('00:08');
	await expect(page.getByRole('alertdialog')).toBeHidden();
	await expect(page.getByLabel('1 de 4 series hechas')).toBeVisible();
});

test('reiniciar el día limpia series y saltos, y también se deshace', async ({ page }) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto(RUTA);
	await page.getByRole('button', { name: 'Sin descanso en este ejercicio' }).click();
	await hacerSerie(page, 1, '100');
	await page.getByRole('button', { name: 'Volver al día' }).click();

	await expect(page).toHaveURL(/\/dia\/dia-piernas/);
	await page.getByRole('button', { name: 'Saltar Curl femoral sentado hoy', exact: true }).click();
	await expect(page.getByText('· 1 saltado')).toBeVisible();

	await page.getByRole('button', { name: 'Reiniciar el día' }).click();
	const aviso = page.getByRole('alertdialog');
	await expect(aviso).toContainText('1 serie y 1 salto');
	await aviso.getByRole('button', { name: 'Reiniciar' }).click();

	await expect(page.getByText('· 1 saltado')).toBeHidden();
	await expect(page.getByText('0/6 ejercicios')).toBeVisible();

	await page.getByRole('status').getByRole('button', { name: 'Deshacer' }).click();
	await expect(page.getByText('· 1 saltado')).toBeVisible();
});

test('el deshacer de terminar con menos series sobrevive la navegación', async ({ page }) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto(RUTA);
	await page.getByRole('button', { name: 'Sin descanso en este ejercicio' }).click();
	await hacerSerie(page, 1, '100');
	await hacerSerie(page, 2, '105');

	await page.getByRole('button', { name: 'Terminar con 2 series' }).click();
	await page
		.getByRole('alertdialog')
		.getByRole('button', { name: 'Terminar', exact: true })
		.click();

	// La acción navega al día: el ofrecimiento tiene que haber viajado con nosotros.
	await expect(page).toHaveURL(/\/dia\/dia-piernas/);
	const deshacer = page.getByRole('status');
	await expect(deshacer).toContainText('Ejercicio terminado con 2 series');

	await deshacer.getByRole('button', { name: 'Deshacer' }).click();
	// Vuelven las dos series sin marcar que se habían quitado.
	await expect(page.getByRole('link', { name: /Prensa de pierna 45° Prensa/ })).toContainText(
		'2/4'
	);
});
