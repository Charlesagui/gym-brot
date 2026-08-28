import { expect, test, type Page } from '@playwright/test';

/**
 * El área segura del iPhone, medida sin un iPhone.
 *
 * En la PWA instalada (`viewport-fit=cover` + barra de estado translúcida) el layout
 * arranca en el borde físico: debajo del reloj y de la Dynamic Island. Chromium de
 * escritorio resuelve `env(safe-area-inset-*)` siempre en `0px` y Playwright no expone
 * cómo cambiarlo, así que un arreglo escrito con `env()` suelto es intesteable por
 * construcción — se rompe y nadie se entera hasta abrirlo en el teléfono.
 *
 * Por eso el inset entra por los tokens `--safe-top` / `--safe-bottom` (`src/app.css`):
 * redefinirlos acá es la única forma de simular el teléfono. Este archivo es la razón
 * por la que se eligió esa opción.
 */
const TOP = 59; // Dynamic Island de un iPhone 15 Pro instalado.
const BOTTOM = 34; // Barra del home indicator.
const SIMULAR = `:root { --safe-top: ${TOP}px !important; --safe-bottom: ${BOTTOM}px !important; }`;

/** Rutas con nav: el nav visible prueba que la base ya abrió y no estamos midiendo el esqueleto. */
const CON_NAV = [
	['/', 'portada'],
	['/historial', 'historial'],
	['/cuerpo', 'cuerpo'],
	['/peso', 'peso'],
	['/ajustes', 'ajustes'],
	['/herramientas/discos', 'discos'],
	['/herramientas/calorias', 'calorías'],
	['/dia/dia-piernas', 'un día de rutina'],
	['/ejercicio/prensa-pierna-45', 'un ejercicio fuera de la sesión']
] as const;

/** Entrenando no hay nav: la salida es el `←`, que es justo lo que quedaba bajo el reloj. */
const EN_SESION = '/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-13';

async function abrirYSimular(page: Page, ruta: string, conNav: boolean) {
	await page.goto(ruta);
	await expect(
		conNav
			? page.getByRole('link', { name: 'Rutinas' })
			: page.getByRole('link', { name: 'Volver', exact: true })
	).toBeVisible();
	await page.addStyleTag({ content: SIMULAR });
	// Dos cuadros: el primero aplica los tokens, el segundo ya mide el layout nuevo.
	await page.evaluate(
		() => new Promise((listo) => requestAnimationFrame(() => requestAnimationFrame(listo)))
	);
}

/** Dónde arranca lo primero que el usuario ve —o toca— dentro de la pantalla. */
async function topDelPrimerElemento(page: Page) {
	return page.evaluate(() => {
		const main = document.querySelector('main');
		const primero = main?.querySelector('header, h1, a, button') ?? main?.firstElementChild;
		if (!primero) throw new Error('la pantalla no tiene un primer elemento que medir');
		return {
			top: Math.round(primero.getBoundingClientRect().top),
			que: primero.tagName.toLowerCase() + ' ' + (primero.textContent ?? '').trim().slice(0, 40)
		};
	});
}

for (const [ruta, nombre] of CON_NAV) {
	test(`el área segura no tapa el encabezado de ${nombre}`, async ({ page }) => {
		await abrirYSimular(page, ruta, true);
		const { top, que } = await topDelPrimerElemento(page);
		expect(top, `«${que}» arranca dentro de la franja del reloj`).toBeGreaterThanOrEqual(TOP);
	});
}

test('el área segura no tapa la salida de la pantalla de ejercicio', async ({ page }) => {
	await abrirYSimular(page, EN_SESION, false);
	const volver = await page
		.getByRole('link', { name: 'Volver', exact: true })
		.evaluate((el) => Math.round(el.getBoundingClientRect().top));
	// Es el hallazgo original, textual: «el `←` y el nombre del ejercicio quedan debajo
	// del reloj y de la Dynamic Island».
	expect(volver).toBeGreaterThanOrEqual(TOP);
});

/**
 * El reverso del arreglo: el hueco que el shell le reserva al nav y el que cada pantalla
 * le descuenta a su alto mínimo son dos cuentas que TIENEN que dar el mismo número. Es el
 * invariante que se rompió dos veces: `/cuerpo` y `/herramientas/calorias` descontaban
 * `4rem` contra los `5rem` reservados (16 px de scroll de más, visible desde antes del
 * área segura), y con el inset abajo la pantalla descontaba `5rem` pelado contra los
 * `5rem + 34` que pasaba a reservar el shell. Hoy los dos lados leen `--gb-nav`.
 *
 * Nota de lo medido, que no es un defecto: con el inset simulado `/herramientas/discos`
 * scrollea 26 px en 393×851. La franja del reloj se come 59 px de pantalla de verdad —
 * ahí no entra, y no hay reserva que lo arregle.
 */
for (const [ruta, nombre] of CON_NAV) {
	test(`la reserva del nav y el descuento de la pantalla coinciden en ${nombre}`, async ({
		page
	}) => {
		await abrirYSimular(page, ruta, true);
		const { reservaShell, descuentoPantalla } = await page.evaluate(() => {
			const shell = document.querySelector('.gb-shell');
			const main = document.querySelector('main');
			if (!shell || !main) throw new Error('falta el shell o el main');
			return {
				reservaShell: Math.round(parseFloat(getComputedStyle(shell).paddingBottom)),
				descuentoPantalla: Math.round(
					window.innerHeight - parseFloat(getComputedStyle(main).minHeight)
				)
			};
		});
		expect(descuentoPantalla).toBe(reservaShell);
	});
}
