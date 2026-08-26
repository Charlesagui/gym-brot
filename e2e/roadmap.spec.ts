import { expect, test } from '@playwright/test';

test('peso corporal conserva el valor canónico al alternar kg y lb', async ({ page }) => {
	const errores: Error[] = [];
	page.on('pageerror', (error) => errores.push(error));
	await page.goto('/peso');
	const registro = page
		.locator('section')
		.filter({ has: page.getByRole('heading', { name: 'Registrar peso' }) });
	await registro.getByLabel('Peso entero en kg').selectOption('80');
	await registro.getByLabel('Décima de peso').selectOption('5');
	await registro.getByRole('button', { name: 'Guardar' }).click();
	await expect(page.getByRole('status')).toHaveText('Medición guardada.');
	await expect(page.getByText('80.5 kg', { exact: true }).first()).toBeVisible();
	await page.goto('/');
	await expect(page.getByText('80.5 kg', { exact: true })).toBeVisible();
	await expect(page.getByText('Registrar primera medición')).toHaveCount(0);
	await page.goto('/peso');

	await page.getByText('Meta opcional', { exact: true }).click();
	const meta = page.locator('details').filter({ hasText: 'Meta opcional' });
	await meta.getByLabel('Meta de peso en kg').fill('78');
	await meta.getByRole('button', { name: 'Guardar' }).click();
	await expect(meta.locator('summary')).toContainText('78 kg');

	await page.goto('/ajustes');
	const unidadLb = page.getByRole('button', { name: 'Seleccionar unidad lb' });
	await unidadLb.click();
	await expect(unidadLb).toHaveAttribute('aria-pressed', 'true');
	await page.goto('/peso');
	await expect(page.getByText('177.5 lb', { exact: true }).first()).toBeVisible();
	await expect(
		page.locator('details').filter({ hasText: 'Meta opcional' }).locator('summary')
	).toContainText('172 lb');

	await page.goto('/ajustes');
	const unidadKg = page.getByRole('button', { name: 'Seleccionar unidad kg' });
	await unidadKg.click();
	await expect(unidadKg).toHaveAttribute('aria-pressed', 'true');
	await page.goto('/peso');
	await expect(page.getByText('80.5 kg', { exact: true }).first()).toBeVisible();
	const rango7Dias = page.getByRole('button', { name: '7 días' });
	await rango7Dias.click();
	await expect(rango7Dias).toHaveAttribute('aria-pressed', 'true');

	await page.getByLabel('Fecha').fill('9999-12-31');
	await page.getByLabel('Peso entero en kg').selectOption('81');
	await page.getByLabel('Décima de peso').selectOption('0');
	await page.getByRole('button', { name: 'Guardar', exact: true }).first().click();
	await expect(page.getByRole('status')).toHaveText('No podés registrar una medición futura.');
	await expect(page.getByText('81 kg', { exact: true })).toHaveCount(0);
	expect(errores).toEqual([]);
});

test('el RIR es opcional y se registra por serie', async ({ page }) => {
	await page.goto('/ajustes');
	const modoRir = page.getByRole('button', { name: 'RIR', exact: true });
	await modoRir.click();
	// `goto` recarga el documento: sin esperar el acuse, la navegación puede tirar abajo
	// la transacción de Dexie antes de que el ajuste confirme y el test corre sin RIR.
	await expect(modoRir).toHaveAttribute('aria-pressed', 'true');

	await page.goto('/ejercicio/extension-cuadriceps?dia=dia-piernas&fecha=2026-08-24');
	await expect(page.getByRole('button', { name: '+ RIR' }).first()).toBeVisible();
	await page.getByRole('button', { name: '+ RIR' }).first().click();
	await page.getByLabel('RIR de la serie 1').selectOption('2');
	await page.getByRole('button', { name: 'Sin descanso en este ejercicio' }).click();
	await page.getByRole('textbox', { name: 'Peso de la serie 1 en kg' }).fill('50');
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();
	await expect(page.getByRole('button', { name: 'Desmarcar serie 1' })).toBeVisible();

	// El esfuerzo queda guardado con la serie, no se pierde al contraerse la fila.
	await page.getByRole('button', { name: 'Corregir serie 1' }).click();
	await expect(page.getByLabel('RIR de la serie 1')).toHaveValue('2');
});

test('el mapa corporal comparte datos con la lista y responde a borrar historial', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.setViewportSize({ width: 320, height: 740 });
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-24');
	await page.getByRole('button', { name: 'Sin descanso en este ejercicio' }).click();
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();

	await page.goto('/historial');
	await expect(
		page.getByRole('heading', { name: 'Distribución estimada de series' })
	).toBeVisible();
	await expect(page.getByText('Cuádriceps', { exact: true })).toBeVisible();
	const zona = page
		.locator('g[role="button"][aria-label^="Cuádriceps: 1 series estimadas"]')
		.first();
	await zona.focus();
	await page.keyboard.press('Enter');
	await expect(zona).toHaveAttribute('aria-pressed', 'true');
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
	await expect(page.getByText(/no mide fatiga, recuperación ni activación médica/)).toBeVisible();

	await page.goto('/historial/dia/2026-08-24');
	await page.getByRole('button', { name: /Editar serie 1/ }).click();
	await page.getByRole('button', { name: 'Borrar serie' }).click();
	await page.getByRole('button', { name: 'Borrar', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Editar serie histórica' })).toBeHidden();
	await page.goto('/historial');
	await expect(page.getByText('No hay series completadas para este período.')).toBeVisible();
});

test('el shell y las rutas nuevas siguen disponibles sin conexión', async ({ page, context }) => {
	await page.goto('/');
	const controlada = await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		return Boolean(navigator.serviceWorker.controller);
	});
	if (!controlada) await page.reload();
	await expect
		.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true);

	await context.setOffline(true);
	try {
		await page.goto('/peso');
		await expect(page.getByRole('heading', { name: 'Peso corporal' })).toBeVisible();
		await page.goto('/historial');
		await expect(
			page.getByRole('heading', { name: 'Distribución estimada de series' })
		).toBeVisible();
	} finally {
		await context.setOffline(false);
	}
});
