import { expect, test, type Page } from '@playwright/test';

async function contarDias(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			new Promise<number>((resolve, reject) => {
				const apertura = indexedDB.open('gym-brot');
				apertura.onerror = () => reject(apertura.error);
				apertura.onsuccess = () => {
					const db = apertura.result;
					const pedido = db.transaction('dias').objectStore('dias').count();
					pedido.onerror = () => reject(pedido.error);
					pedido.onsuccess = () => {
						db.close();
						resolve(pedido.result);
					};
				};
			})
	);
}

async function leerSesiones(
	page: Page
): Promise<{ id: string; fecha: string; diaTerminado?: boolean; hechas: number }[]> {
	return page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const apertura = indexedDB.open('gym-brot');
				apertura.onerror = () => reject(apertura.error);
				apertura.onsuccess = () => {
					const db = apertura.result;
					const pedido = db.transaction('sesiones').objectStore('sesiones').getAll();
					pedido.onerror = () => reject(pedido.error);
					pedido.onsuccess = () => {
						const resultado = pedido.result.map(
							(sesion: {
								id: string;
								fecha: string;
								diaTerminado?: boolean;
								ejercicios: { sets: { hecha: boolean }[] }[];
							}) => ({
								id: sesion.id,
								fecha: sesion.fecha,
								diaTerminado: sesion.diaTerminado,
								hechas: sesion.ejercicios.flatMap((e) => e.sets).filter((s) => s.hecha).length
							})
						);
						db.close();
						resolve(resultado);
					};
				};
			})
	);
}

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
	await expect(page.getByText('Mantené una tarjeta y movela, o usá las flechas')).toBeVisible();

	const subir = page.getByRole('button', { name: /^Subir / }).first();
	const bajar = page.getByRole('button', { name: /^Bajar / }).first();
	await expect(subir).toBeDisabled();
	await expect(bajar).toBeEnabled();

	const caja = await bajar.boundingBox();
	expect(caja?.width).toBeGreaterThanOrEqual(44);
	expect(caja?.height).toBeGreaterThanOrEqual(44);
});

test('mantener una tarjeta de ejercicio abre el ordenamiento sin navegar al ejercicio', async ({
	page
}) => {
	await page.goto('/dia/dia-piernas');
	const ejercicio = page.getByRole('link', { name: /Prensa de pierna 45/ });
	const caja = await ejercicio.boundingBox();
	expect(caja).not.toBeNull();
	await page.mouse.move(caja!.x + caja!.width / 2, caja!.y + caja!.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(450);
	// El modo aparece apenas se cumple la pulsación sostenida; no espera a soltar.
	await expect(page.getByRole('button', { name: 'Terminar orden' })).toBeVisible();
	await page.mouse.up();

	await expect(page).toHaveURL(/\/dia\/dia-piernas/);
});

test('dos toques rápidos crean una sola rutina y navegan una vez', async ({ page }) => {
	await page.goto('/');
	const crear = page.getByRole('button', { name: '+ Nuevo día' });
	await expect(crear).toBeVisible();
	const antes = await contarDias(page);

	await crear.evaluate((boton: HTMLButtonElement) => {
		boton.click();
		boton.click();
	});
	await expect(page).toHaveURL(/\/dia\//);
	await expect.poll(() => contarDias(page)).toBe(antes + 1);
});

test('la fecha de sesión sobrevive medianoche, regreso, cierre y una sesión nueva', async ({
	page
}) => {
	await page.clock.install({ time: new Date('2026-08-13T23:59:00-03:00') });
	await page.goto('/dia/dia-piernas');
	await page.getByRole('link', { name: /Prensa de pierna 45/ }).click();
	await expect(page).toHaveURL(/fecha=2026-08-13/);

	await page.clock.setFixedTime(new Date('2026-08-14T00:01:00-03:00'));
	await page.getByRole('textbox', { name: 'Peso de la serie 1 en kg' }).fill('100');
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Sin descanso en este ejercicio' }).click();
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();
	await page.getByRole('link', { name: 'Volver' }).click();
	await expect(page).toHaveURL(/\/dia\/dia-piernas\?fecha=2026-08-13/);
	await expect(page.getByText('1/4', { exact: true })).toBeVisible();

	await page.getByRole('button', { name: /Saltar Prensa de pierna 45/ }).click();
	await expect(page.getByText('resto saltado')).toBeVisible();
	for (const nombre of [
		'Extensión de cuádriceps',
		'Curl femoral sentado',
		'Abductores (apertura)',
		'Aductores (cierre)',
		'Elevación de gemelos sentado'
	]) {
		await page.getByRole('button', { name: `Saltar ${nombre} hoy`, exact: true }).click({
			force: true
		});
		await expect(
			page.getByRole('button', { name: `Reanudar ${nombre} hoy`, exact: true })
		).toBeVisible();
	}
	await expect(page.getByRole('button', { name: /Terminar día/ })).toBeEnabled();
	await page.getByRole('button', { name: /Terminar día/ }).click({ force: true });
	await expect
		.poll(async () => (await leerSesiones(page)).find((s) => s.id === '2026-08-13__dia-piernas'))
		.toMatchObject({ fecha: '2026-08-13', diaTerminado: true, hechas: 1 });

	await page.goto('/dia/dia-piernas');
	await expect(page).not.toHaveURL(/fecha=/);
	await expect(page.getByText('1/4', { exact: true })).toHaveCount(0);
	await page.getByRole('link', { name: /Prensa de pierna 45/ }).click();
	await expect(page).toHaveURL(/fecha=2026-08-14/);
	await expect
		.poll(async () => (await leerSesiones(page)).map((s) => s.id).sort())
		.toEqual(['2026-08-13__dia-piernas', '2026-08-14__dia-piernas']);
});

test('las rutas obsoletas o con fecha imposible ofrecen salida sin crear sesiones', async ({
	page
}) => {
	await page.goto('/historial/dia/2026-99-99');
	await expect(page.getByText('La fecha del historial no es válida')).toBeVisible();
	await expect(page.getByText('Invalid Date')).toHaveCount(0);

	await page.goto('/ejercicio/no-existe?dia=dia-piernas&fecha=2026-08-13');
	await expect(page.getByText('Ejercicio no encontrado', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Volver al día' })).toBeVisible();
	await expect(leerSesiones(page)).resolves.toEqual([]);
});

test('el modal de técnica aísla el fondo, confina foco y restaura el disparador', async ({
	page
}) => {
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-13');
	const abrir = page.getByRole('button', { name: /Ver video de técnica/ });
	const cajaTecnica = await abrir.boundingBox();
	expect(cajaTecnica?.height).toBeGreaterThanOrEqual(44);
	await abrir.click();

	const dialogo = page.getByRole('dialog', { name: /Prensa de pierna 45/ });
	const cerrar = dialogo.locator('[data-tecnica-cerrar]');
	await expect(dialogo).toBeVisible();
	await expect(cerrar).toBeFocused();
	await expect(page.locator('main')).toHaveAttribute('inert', '');
	await expect(page.locator('main')).toHaveAttribute('aria-hidden', 'true');
	await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');

	await page.keyboard.press('Shift+Tab');
	await expect(dialogo.getByRole('link', { name: 'Abrir en YouTube' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialogo).toBeHidden();
	await expect(abrir).toBeFocused();
	await expect(page.locator('main')).not.toHaveAttribute('inert', '');
});

test('el editor histórico comparte el aislamiento modal y devuelve el foco', async ({ page }) => {
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-13');
	await page.getByRole('textbox', { name: 'Peso de la serie 1 en kg' }).fill('100');
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Sin descanso en este ejercicio' }).click();
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();
	await page.goto('/historial/dia/2026-08-13');

	const abrir = page.getByRole('button', { name: /Editar serie 1/ });
	await abrir.click();
	const dialogo = page.getByRole('dialog', { name: 'Editar serie histórica' });
	await expect(dialogo.getByRole('textbox', { name: 'Peso de la serie en kg' })).toBeFocused();
	await expect(page.locator('main')).toHaveAttribute('inert', '');
	await expect
		.poll(() => page.evaluate(() => document.documentElement.style.overflow))
		.toBe('hidden');

	await page.keyboard.press('Escape');
	await expect(dialogo).toBeHidden();
	await expect(abrir).toBeFocused();
	await expect(page.locator('main')).not.toHaveAttribute('aria-hidden', 'true');
});

test('el editor a 320 px conserva nombres, controles inequívocos y targets de 44 px', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 740 });
	await page.goto('/dia/dia-piernas');
	await page.getByRole('button', { name: 'Editar' }).click();
	await expect(page.getByRole('button', { name: 'Guardar nombre' })).toBeVisible();
	const menosSeries = page.getByRole('button', { name: /Menos series de Prensa de pierna/ });
	await menosSeries.click();
	await menosSeries.click();
	await menosSeries.click();
	await expect(page.getByText('1 serie objetivo')).toBeVisible();

	for (const selector of await page.getByRole('button', { name: /^Entrenar los días / }).all()) {
		const caja = await selector.boundingBox();
		expect(caja?.width).toBeGreaterThanOrEqual(44);
		expect(caja?.height).toBeGreaterThanOrEqual(44);
	}

	await page.getByRole('button', { name: /Reordenar ejercicios/ }).click();
	await expect(page.getByRole('button', { name: 'Terminar orden' })).toBeVisible();
	await expect(page.getByText('Prensa de pierna 45°', { exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('el progreso completo incluye hoy en todos sus rangos y el calendario conserva 44 px', async ({
	page
}) => {
	await page.goto('/');
	const hoy = await page.evaluate(() => new Date().toLocaleDateString('sv'));
	await page.goto(`/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=${hoy}`);
	for (const nombre of [
		'Usar el descanso general en este ejercicio',
		'Sin descanso en este ejercicio',
		'Descanso de 45 segundos en este ejercicio',
		'Descanso de 90 segundos en este ejercicio',
		'Descanso de 2 minutos en este ejercicio'
	]) {
		const caja = await page.getByRole('button', { name: nombre }).boundingBox();
		expect(caja?.width).toBeGreaterThanOrEqual(44);
		expect(caja?.height).toBeGreaterThanOrEqual(44);
	}
	await page.getByRole('button', { name: 'Sin descanso en este ejercicio' }).click();
	await page.getByRole('textbox', { name: 'Peso de la serie 1 en kg' }).fill('100');
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();
	await page.getByRole('link', { name: 'Ver progreso completo →' }).click();

	for (const rango of ['3 meses', '1 año', 'Todo']) {
		await page.getByRole('button', { name: rango }).click();
		await expect(page.getByRole('img', { name: /Progreso de peso máximo: 1 día/ })).toBeVisible();
	}
	await expect(page.getByText('Sin sesiones pasadas en este rango.')).toHaveCount(0);

	await page.setViewportSize({ width: 320, height: 740 });
	await page.goto('/historial');
	const entrenado = page.getByRole('link', { name: /entrenado · ver detalle/ }).first();
	const cajaDia = await entrenado.boundingBox();
	expect(cajaDia?.width).toBeGreaterThanOrEqual(44);
	expect(cajaDia?.height).toBeGreaterThanOrEqual(44);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('cerrar un día sin series usa un mensaje sobrio y no declara progreso', async ({ page }) => {
	await page.goto('/dia/dia-piernas');
	for (const nombre of [
		'Prensa de pierna 45°',
		'Extensión de cuádriceps',
		'Curl femoral sentado',
		'Abductores (apertura)',
		'Aductores (cierre)',
		'Elevación de gemelos sentado'
	]) {
		await page.getByRole('button', { name: `Saltar ${nombre} hoy`, exact: true }).click();
		await expect(
			page.getByRole('button', { name: `Reanudar ${nombre} hoy`, exact: true })
		).toBeVisible();
	}
	await page.getByRole('button', { name: 'Terminar día' }).click();
	const resumen = page.getByRole('button', { name: 'Cerrar resumen del día' });
	await expect(resumen.getByText('Día cerrado · 6 saltados')).toBeVisible();
	await expect(resumen.getByText('Sin series registradas')).toBeVisible();
	await expect(resumen.getByText('Día terminado')).toHaveCount(0);
});

test('393 px, horizontal y texto ampliado no generan scroll lateral', async ({ page }) => {
	await page.setViewportSize({ width: 393, height: 852 });
	await page.goto('/dia/dia-piernas');
	await page.getByRole('button', { name: 'Editar' }).click();
	await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);

	await page.setViewportSize({ width: 852, height: 393 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(852);
});

/**
 * El camino que se recorre todos los días y el único que no estaba cubierto de punta
 * a punta: marcar una serie, ganar el PR, descansar, verificar lo cargado sin desarmar
 * el descanso, encadenar con el siguiente ejercicio y cerrar el día.
 *
 * El reloj va instalado: sin eso habría que esperar 45 segundos reales de descanso.
 */
test('el loop de entrenamiento encadena serie, PR, descanso y siguiente ejercicio', async ({
	page
}) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-15');

	// Descanso propio de este ejercicio: el más corto, para que el test no dependa
	// del valor general ni de esperas largas.
	await page.getByRole('button', { name: 'Descanso de 45 segundos en este ejercicio' }).click();
	await expect(page.getByText('Propio de este ejercicio: 45 segundos')).toBeVisible();

	await page.getByRole('textbox', { name: 'Peso de la serie 1 en kg' }).fill('100');
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();

	// Primera serie registrada de este ejercicio: es récord, y se celebra sin bloquear.
	await expect(page.getByLabel('Nuevo PR')).toBeVisible();

	// El descanso tapa la lista: tiene que dejar verificar lo que se acaba de guardar.
	const descanso = page.getByRole('dialog', { name: 'Descanso' });
	await expect(descanso).toBeVisible();
	await expect(descanso.getByText('Serie 1 · 100 kg × 10')).toBeVisible();
	await descanso.getByRole('button', { name: /Tocá para corregir/ }).click();
	await expect(descanso).toBeHidden();
	await expect(page.getByRole('textbox', { name: 'Reps de la serie 1' })).toBeFocused();

	// El descanso sigue corriendo detrás y vence solo.
	await page.clock.runFor('00:46');
	await expect(page.getByText('¡A la serie!')).toBeVisible();
	await page.getByRole('button', { name: 'Listo', exact: true }).click();
	await expect(page.getByText('¡A la serie!')).toBeHidden();

	// Resto de las series de la rutina sembrada (4 objetivo), sin descanso en el medio.
	await page.getByRole('button', { name: 'Sin descanso en este ejercicio' }).click();
	for (const serie of [2, 3, 4]) {
		await page.getByRole('textbox', { name: `Peso de la serie ${serie} en kg` }).fill('100');
		await page.getByRole('textbox', { name: `Reps de la serie ${serie}` }).fill('10');
		await page.getByRole('button', { name: `Marcar serie ${serie}` }).click();
	}
	await expect(page.getByLabel('4 de 4 series hechas')).toBeVisible();

	// Con el ejercicio completo, el cierre encadena con lo que sigue en la rutina.
	const siguiente = page.getByRole('button', { name: /Siguiente: Extensión de cuádriceps/ });
	await expect(siguiente).toBeVisible();
	await siguiente.click();

	// La celebración no encierra: un toque sigue de largo.
	const celebracion = page.getByRole('button', { name: 'Continuar' });
	await expect(celebracion).toBeVisible();
	await celebracion.click();
	await expect(page).toHaveURL(/\/ejercicio\/extension-cuadriceps\?dia=dia-piernas/);

	await expect
		.poll(async () => (await leerSesiones(page)).find((s) => s.id === '2026-08-15__dia-piernas'))
		.toMatchObject({ fecha: '2026-08-15', hechas: 4 });
});

/**
 * El descanso a pantalla completa tapa todo mientras corre: sus salidas por botón son
 * la vía principal para volver a la lista. El arrastre del panel llegó a robarles el
 * click (la captura de puntero retargetea el `pointerup`), lo que dejaba el overlay
 * sin más salida que el gesto de arrastrar hacia abajo.
 */
test('las salidas del descanso a pantalla completa responden al toque', async ({ page }) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-15');
	await page.getByRole('button', { name: 'Descanso de 90 segundos en este ejercicio' }).click();
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();

	const dialogo = page.getByRole('dialog', { name: 'Descanso' });
	await expect(dialogo).toBeVisible();
	await dialogo.getByRole('button', { name: 'Minimizar' }).click();
	await expect(dialogo).toBeHidden();

	// Minimizar no corta el descanso: la barra sigue abajo y puede volver a abrirlo.
	const barra = page.getByRole('button', { name: 'Abrir descanso en pantalla completa' });
	await expect(barra).toBeVisible();
	await barra.click();
	await expect(dialogo).toBeVisible();

	await dialogo.getByRole('button', { name: 'Saltar descanso' }).click();
	await expect(dialogo).toBeHidden();
	await expect(barra).toBeHidden();
});
