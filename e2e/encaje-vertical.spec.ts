import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Que un control exista y sea visible no significa que se pueda tocar.
 *
 * El descanso a pantalla completa ya tenía un test de sus salidas
 * (`accesibilidad.spec.ts`), y pasaba en verde mientras en un iPhone SE «Minimizar»
 * caía 66 px abajo del borde y «Saltar descanso» 126 px, sin scroll que los
 * alcanzara: el panel era `min-h-dvh` —un piso, no un techo— dentro de un
 * `fixed inset-0`, con el `body` en `overflow: hidden`. Dos cosas lo tapaban:
 *
 *  - `toBeVisible()` mira el CSS, no el viewport: da verde con el botón fuera de
 *    la pantalla.
 *  - `click()` hace `scrollIntoViewIfNeeded` por CDP, que mueve el scroll donde un
 *    dedo no puede. Pasaba incluso en pantallas donde el usuario estaba encerrado.
 *
 * Por eso acá no se toca nada: se mide contra `innerHeight`, que es lo único que un
 * dedo tiene. Y se mide en varios altos, porque el bug no era de una pantalla sino
 * de todas las que están por debajo de la del proyecto por defecto.
 */

const RUTA = '/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-15';

/** Los altos que el proyecto por defecto (Pixel 5, 851 px) nunca ejercitó. */
const ALTOS = [
	[375, 553, 'iPhone SE con las barras de Safari'],
	[360, 640, 'Android de gama baja'],
	[390, 664, 'iPhone 13 con las barras de Safari'],
	[412, 740, 'Pixel 7 en el navegador']
] as const;

/** El área segura de un iPhone instalado, que se come 93 px de alto. */
const AREA_SEGURA = ':root { --safe-top: 59px !important; --safe-bottom: 34px !important; }';

async function abrirDescanso(page: Page) {
	await page.goto(RUTA);
	await expect(page.getByRole('link', { name: 'Volver', exact: true })).toBeVisible();
	await page.getByRole('textbox', { name: 'Peso de la serie 1 en kg' }).fill('120');
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Marcar serie 1', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Descanso' })).toBeVisible();
}

/** Dónde cae el control respecto de los dos bordes que el dedo no puede cruzar. */
async function encaje(control: Locator) {
	return control.evaluate((el) => {
		const c = el.getBoundingClientRect();
		return {
			sobra: Math.round(-c.top),
			falta: Math.round(c.bottom - window.innerHeight),
			ventana: window.innerHeight
		};
	});
}

async function esperarLayout(page: Page) {
	await page.evaluate(
		() => new Promise((listo) => requestAnimationFrame(() => requestAnimationFrame(listo)))
	);
}

for (const [ancho, alto, nombre] of ALTOS) {
	test(`las salidas del descanso entran en la pantalla de un ${nombre}`, async ({ page }) => {
		await page.setViewportSize({ width: ancho, height: alto });
		await abrirDescanso(page);
		await esperarLayout(page);

		const dialogo = page.getByRole('dialog', { name: 'Descanso' });
		for (const etiqueta of ['Minimizar', 'Saltar descanso']) {
			const boton = dialogo.getByRole('button', { name: etiqueta, exact: true });
			const { sobra, falta, ventana } = await encaje(boton);
			expect(
				falta,
				`«${etiqueta}» cae ${falta} px abajo del borde en ${ancho}×${ventana}`
			).toBeLessThanOrEqual(0);
			expect(
				sobra,
				`«${etiqueta}» cae ${sobra} px arriba del borde en ${ancho}×${ventana}`
			).toBeLessThanOrEqual(0);
		}
	});
}

test('las salidas del descanso entran con el área segura de un iPhone instalado', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 664 });
	await abrirDescanso(page);
	await page.addStyleTag({ content: AREA_SEGURA });
	await esperarLayout(page);

	const dialogo = page.getByRole('dialog', { name: 'Descanso' });
	for (const etiqueta of ['Minimizar', 'Saltar descanso']) {
		const { falta } = await encaje(dialogo.getByRole('button', { name: etiqueta, exact: true }));
		expect(falta, `«${etiqueta}» cae ${falta} px abajo del borde`).toBeLessThanOrEqual(0);
	}
});

/**
 * El seguro de último recurso. Cuando ni comprimiendo entra —tipografía del sistema
 * agrandada, área segura y pantalla baja a la vez— el panel no puede volver a crecer
 * hacia afuera: tiene que aparecer scroll adentro y las salidas quedarse ancladas.
 */
test('con la tipografía del sistema agrandada el panel no se desborda', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 553 });
	await abrirDescanso(page);
	await page.addStyleTag({ content: AREA_SEGURA });
	await page.addStyleTag({ content: 'html { font-size: 20px !important; }' });
	await esperarLayout(page);

	const dialogo = page.getByRole('dialog', { name: 'Descanso' });
	const panel = await dialogo.evaluate((el) => ({
		alto: Math.round(el.getBoundingClientRect().height),
		ventana: window.innerHeight,
		centroScrollea: (() => {
			const c = el.querySelector('.rest-focus-main')!;
			return c.scrollHeight > c.clientHeight;
		})()
	}));
	expect(panel.alto, 'el panel volvió a crecer más que la pantalla').toBeLessThanOrEqual(
		panel.ventana
	);
	expect(panel.centroScrollea, 'lo que no entra tiene que poder scrollearse').toBe(true);

	for (const etiqueta of ['Minimizar', 'Saltar descanso']) {
		const { falta } = await encaje(dialogo.getByRole('button', { name: etiqueta, exact: true }));
		expect(falta, `«${etiqueta}» cae ${falta} px abajo del borde`).toBeLessThanOrEqual(0);
	}
});
