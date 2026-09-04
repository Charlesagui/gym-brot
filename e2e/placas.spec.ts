import { expect, test } from '@playwright/test';
import { apagarDescanso } from './descanso';

/**
 * La sección de placas se deriva del historial de verdad, a través de la interfaz.
 *
 * Con una sola serie marcada hoy el día queda PARCIAL: sostiene la racha (una semana
 * seguida) pero no cuenta como día completo. Que las dos escaleras digan cosas distintas
 * a partir del mismo toque es justamente la asimetría que las placas tienen que respetar.
 */
test('una serie marcada mueve la racha, no los días completos, y la lista lo dice', async ({
	page
}) => {
	await page.goto('/historial');
	await expect(page.getByText('Placas', { exact: true })).toBeVisible();
	await expect(page.getByText('0 de 7 ganadas')).toBeVisible();
	await expect(page.getByText('Vas 0 de 4 semanas seguidas')).toBeVisible();

	await page.goto('/dia/dia-piernas');
	await page.getByRole('link', { name: /Prensa de pierna 45/ }).click();
	await page.getByRole('textbox', { name: 'Peso de la serie 1 en kg' }).fill('100');
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await apagarDescanso(page);
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();
	await expect(page.getByText('1/4', { exact: true })).toBeVisible();

	await page.goto('/historial');
	const lista = page.getByRole('list', { name: 'Placas de constancia' });
	await expect(lista.getByRole('listitem')).toHaveCount(7);
	await expect(page.getByText('Vas 1 de 4 semanas seguidas')).toBeVisible();
	await expect(page.getByText('Vas 0 de 10 días completos')).toBeVisible();
	await expect(page.getByText('0 de 7 ganadas')).toBeVisible();
	// Lo que falta se insinúa con su objetivo, sin progreso inventado.
	await expect(page.getByText('13 semanas seguidas', { exact: true })).toBeVisible();
});
