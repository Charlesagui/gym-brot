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
	await expect(page.getByText('20 kg', { exact: true })).toBeVisible();

	const disco125 = page.getByRole('button', { name: '1,25', exact: true });
	await disco125.click();
	await expect(disco125).toHaveAttribute('aria-pressed', 'false');

	await page.getByRole('button', { name: 'Subir peso objetivo 2.5 kg' }).click();
	await expect(page.getByRole('textbox', { name: 'Peso total objetivo en kg' })).toHaveValue(
		'62,5'
	);
	await expect(page.getByText('Sin carga exacta · opciones cercanas')).toBeVisible();
	await expect(page.getByText('60 kg', { exact: true })).toBeVisible();
	await expect(page.getByText('65 kg', { exact: true })).toBeVisible();

	await page.reload();
	await expect(page.getByRole('button', { name: '1,25', exact: true })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
});
