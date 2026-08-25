import { expect, test } from '@playwright/test';

test('peso corporal conserva el valor canónico al alternar kg y lb', async ({ page }) => {
	await page.goto('/peso');
	const registro = page
		.locator('section')
		.filter({ has: page.getByRole('heading', { name: 'Registrar hoy' }) });
	await registro.getByLabel('Peso (kg)').fill('80.5');
	await registro.getByRole('button', { name: 'Guardar' }).click();
	await expect(page.getByRole('status')).toHaveText('Medición guardada.');
	await expect(page.getByText('80.5 kg', { exact: true }).first()).toBeVisible();

	const meta = page
		.locator('section')
		.filter({ has: page.getByRole('heading', { name: 'Meta opcional' }) });
	await meta.getByLabel('Meta de peso en kg').fill('78');
	await meta.getByRole('button', { name: 'Guardar' }).click();
	await expect(page.getByText('2.5 kg por encima')).toBeVisible();

	await page.goto('/ajustes');
	const unidadLb = page.getByRole('button', { name: 'Seleccionar unidad lb' });
	await unidadLb.click();
	await expect(unidadLb).toHaveAttribute('aria-pressed', 'true');
	await page.goto('/peso');
	await expect(page.getByText('177.5 lb', { exact: true }).first()).toBeVisible();
	await expect(page.getByText('5.5 lb por encima')).toBeVisible();

	await page.goto('/ajustes');
	const unidadKg = page.getByRole('button', { name: 'Seleccionar unidad kg' });
	await unidadKg.click();
	await expect(unidadKg).toHaveAttribute('aria-pressed', 'true');
	await page.goto('/peso');
	await expect(page.getByText('80.5 kg', { exact: true }).first()).toBeVisible();
});

test('RIR sigue opcional y la doble progresión requiere activación explícita', async ({ page }) => {
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

	await page.getByText('Doble progresión', { exact: true }).click();
	await expect(page.getByText('Opcional. Cuando todas las series lleguen al techo')).toBeVisible();
	await page.getByRole('button', { name: 'Activar 8–12 reps' }).click();
	await expect(page.getByText('Incremento automático:')).toBeVisible();
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
	await page.getByRole('button', { name: '🗑 Borrar serie' }).click();
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
