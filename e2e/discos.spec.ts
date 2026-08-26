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

	const disco125 = page.getByRole('button', { name: '1,25', exact: true });
	await disco125.click();
	await expect(disco125).toHaveAttribute('aria-pressed', 'false');

	await page.getByRole('button', { name: 'Subir peso objetivo 2.5 kg' }).click();
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
