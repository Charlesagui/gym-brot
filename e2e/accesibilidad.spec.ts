import { expect, test } from '@playwright/test';

test('la navegación identifica la sección activa también en rutas internas', async ({ page }) => {
	await page.goto('/');

	const rutinas = page.getByRole('link', { name: 'Rutinas' });
	await expect(rutinas).toHaveAttribute('aria-current', 'page');

	const primeraRutina = page.locator('a[href^="/dia/"]').first();
	await expect(primeraRutina).toBeVisible();
	await primeraRutina.click();
	await expect(page).toHaveURL(/\/dia\//);
	await expect(rutinas).toHaveAttribute('aria-current', 'page');

	await page.getByRole('link', { name: 'Historial' }).click();
	await expect(page).toHaveURL(/\/historial$/);
	await expect(page.getByRole('link', { name: 'Historial' })).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('la confirmación encierra el foco y lo devuelve al cerrar', async ({ page }) => {
	await page.goto('/ajustes');

	const abrir = page.getByRole('button', { name: /Borrar todos mis datos/ });
	await abrir.click();

	const dialogo = page.getByRole('dialog', { name: 'Borrar todos mis datos' });
	const cancelar = dialogo.getByRole('button', { name: 'Cancelar' });
	const confirmar = dialogo.getByRole('button', { name: 'Borrar todo' });
	await expect(dialogo).toBeVisible();
	await expect(cancelar).toBeFocused();
	await expect(page.locator('main')).toHaveAttribute('inert', '');
	await expect(page.locator('main')).toHaveAttribute('aria-hidden', 'true');

	await page.keyboard.press('Shift+Tab');
	await expect(confirmar).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(cancelar).toBeFocused();

	await page.keyboard.press('Escape');
	await expect(dialogo).toBeHidden();
	await expect(abrir).toBeFocused();
	await expect(page.locator('main')).not.toHaveAttribute('inert', '');
	await expect(page.locator('main')).not.toHaveAttribute('aria-hidden', 'true');
});

test('reordenar rutinas ofrece controles táctiles además del arrastre', async ({ page }) => {
	await page.goto('/');

	await page.getByRole('button', { name: 'Reordenar rutinas' }).click();
	await expect(page.getByText('Arrastrá o usá las flechas para ordenar')).toBeVisible();

	const subir = page.getByRole('button', { name: /^Subir / }).first();
	const bajar = page.getByRole('button', { name: /^Bajar / }).first();
	await expect(subir).toBeDisabled();
	await expect(bajar).toBeEnabled();

	const caja = await bajar.boundingBox();
	expect(caja?.width).toBeGreaterThanOrEqual(44);
	expect(caja?.height).toBeGreaterThanOrEqual(44);
});
