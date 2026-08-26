import { expect, test } from '@playwright/test';

test('la calculadora vive fuera de la sesión, propone alternativas y recuerda los discos', async ({
	page
}) => {
	await page.goto('/');
	const abrir = page.getByRole('link', { name: 'Discos' });
	await expect(abrir).toBeVisible();
	await abrir.click();

	await expect(page).toHaveURL(/\/herramientas\/discos$/);
	await expect(page.getByRole('link', { name: 'Discos' })).toHaveAttribute('aria-current', 'page');
	await expect(page.getByText('Carga exacta')).toBeVisible();
	// La cifra y su unidad viven en el mismo párrafo, sin espacio entre medio.
	await expect(page.getByText('20kg', { exact: true })).toBeVisible();

	// El dibujo es visual: quien lo lee en voz alta es la lista de discos de al lado.
	await expect(page.getByText('Discos: 20')).toBeVisible();

	// El rótulo dice qué pesos hay, no cuántos discos se van a usar.
	await expect(page.getByRole('heading', { name: 'Pesos de disco que tenés' })).toBeVisible();

	const disco125 = page.getByRole('button', { name: '1,25', exact: true });
	await disco125.click();
	await expect(disco125).toHaveAttribute('aria-pressed', 'false');

	// La cinta es un slider: con teclado se mueve de a un paso, sin depender del gesto.
	const cinta = page.getByRole('slider', { name: 'Peso total objetivo en kg' });
	await cinta.focus();
	await cinta.press('ArrowRight');
	await expect(cinta).toHaveAttribute('aria-valuenow', '62.5');
	await expect(page.getByRole('textbox', { name: 'Peso total objetivo en kg' })).toHaveValue(
		'62,5'
	);

	// Sin carga exacta manda una sola cifra: la más cerca del objetivo. Ante empate, la de abajo.
	await expect(page.getByText('Sin carga exacta · lo más cerca')).toBeVisible();
	await expect(page.getByText('60kg', { exact: true })).toBeVisible();
	await expect(page.getByText('Menos que el objetivo')).toBeVisible();
	await expect(page.getByText('Por lado: 20')).toBeVisible();

	// La otra opción sigue estando, como alternativa y sin competir con la cifra.
	await expect(page.getByText('O más', { exact: true })).toBeVisible();
	await expect(page.getByText('65kg', { exact: true })).toBeVisible();

	await page.reload();
	await expect(page.getByRole('button', { name: '1,25', exact: true })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
});

test('la cinta se arrastra como una cinta y la cifra se sigue pudiendo escribir', async ({
	page
}) => {
	await page.goto('/herramientas/discos');
	const cinta = page.getByRole('slider', { name: 'Peso total objetivo en kg' });
	const cifra = page.getByRole('textbox', { name: 'Peso total objetivo en kg' });
	await expect(cinta).toHaveAttribute('aria-valuenow', '60');

	const caja = (await cinta.boundingBox())!;
	const centroX = caja.x + caja.width / 2;
	const centroY = caja.y + caja.height / 2;

	// La cinta sigue al dedo: llevarla a la derecha trae los números de abajo.
	// 14 px por paso de 2,5 kg, así que 56 px son cuatro pasos.
	await page.mouse.move(centroX, centroY);
	await page.mouse.down();
	await page.mouse.move(centroX + 56, centroY, { steps: 12 });
	await page.mouse.up();
	await expect(cinta).toHaveAttribute('aria-valuenow', '50');
	await expect(cifra).toHaveValue('50');

	// Y el mismo recorrido para el otro lado vuelve al punto de partida.
	await page.mouse.move(centroX, centroY);
	await page.mouse.down();
	await page.mouse.move(centroX - 56, centroY, { steps: 12 });
	await page.mouse.up();
	await expect(cinta).toHaveAttribute('aria-valuenow', '60');

	// Escribir un peso lejano sigue siendo un toque y el teclado: la cinta lo acompaña.
	await cifra.click();
	await cifra.fill('182,5');
	await cifra.press('Enter');
	await expect(cinta).toHaveAttribute('aria-valuenow', '182.5');
	await expect(page.getByText('Carga exacta')).toBeVisible();
});
