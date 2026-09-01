import { expect, test, type Page } from '@playwright/test';
import { apagarDescanso, interruptorDescanso, ruedaDescanso, valorDescanso } from './descanso';

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

test('el nav se esconde entrenando, pero vuelve al consultar el progreso', async ({ page }) => {
	const rutinas = page.getByRole('link', { name: 'Rutinas' });

	// Con `?dia=` estás en la serie: esa franja es de la barra de descanso y del cierre.
	await page.goto('/ejercicio/extension-cuadriceps?dia=dia-piernas&fecha=2026-08-24');
	await expect(page.getByRole('link', { name: 'Volver', exact: true })).toBeVisible();
	await expect(rutinas).toHaveCount(0);

	// Sin `?dia=` es la vista de progreso que abre el historial: pantalla de lectura,
	// nada ocupa el piso, y sin nav la única salida quedaba lejos del pulgar.
	await page.goto('/ejercicio/extension-cuadriceps');
	await expect(rutinas).toBeVisible();
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

/** El orden visible de los ejercicios en el modo de reordenar, de arriba hacia abajo. */
async function ordenVisible(page: Page): Promise<string[]> {
	return page
		.locator('[data-orden-id]')
		.evaluateAll((nodos) => nodos.map((n) => n.getAttribute('data-orden-id') ?? ''));
}

test('terminar el orden vuelve a los ejercicios y no a otra pantalla', async ({ page }) => {
	await page.goto('/dia/dia-piernas');
	await page.getByRole('button', { name: 'Editar' }).click();
	await page.getByRole('button', { name: /Reordenar ejercicios/ }).click();

	// Mientras se ordena, la barra inferior no puede seguir ofreciendo otras secciones.
	await expect(page.getByRole('navigation')).toBeHidden();

	// La salida está a la vista sin scrollear, aunque la lista siga abajo.
	const terminar = page.getByRole('button', { name: 'Terminar orden' });
	await expect(terminar).toBeInViewport();
	await terminar.click();

	await expect(page).toHaveURL(/\/dia\/dia-piernas/);
	await expect(page.getByRole('button', { name: 'Terminar orden' })).toBeHidden();
	await expect(page.getByText('Prensa de pierna 45°', { exact: true })).toBeVisible();
	await expect(page.getByRole('navigation')).toBeVisible();
});

test('el gesto de volver cierra el orden en vez de salir del día', async ({ page }) => {
	await page.goto('/dia/dia-piernas');
	await page.getByRole('button', { name: 'Editar' }).click();
	await page.getByRole('button', { name: /Reordenar ejercicios/ }).click();
	await expect(page.getByRole('button', { name: 'Terminar orden' })).toBeVisible();

	await page.goBack();

	await expect(page.getByRole('button', { name: 'Terminar orden' })).toBeHidden();
	await expect(page).toHaveURL(/\/dia\/dia-piernas/);
});

test('la flecha de bajar sigue abajo del dedo: dos toques bajan dos posiciones', async ({
	page
}) => {
	await page.goto('/dia/dia-piernas');
	await page.getByRole('button', { name: 'Editar' }).click();
	await page.getByRole('button', { name: /Reordenar ejercicios/ }).click();
	await expect(page.getByRole('button', { name: 'Terminar orden' })).toBeVisible();

	expect((await ordenVisible(page))[0]).toBe('prensa-pierna-45');

	// A propósito por coordenadas y no por locator: el dedo se queda en el mismo lugar
	// de la pantalla mientras la tarjeta se mueve. Antes, el segundo toque caía sobre el
	// ejercicio que había ocupado esa ranura y lo devolvía todo al orden inicial.
	const caja = await page.getByRole('button', { name: /^Bajar Prensa de pierna/ }).boundingBox();
	expect(caja).not.toBeNull();
	const x = caja!.x + caja!.width / 2;
	const y = caja!.y + caja!.height / 2;
	await page.mouse.click(x, y);
	await page.mouse.click(x, y);

	await expect.poll(async () => (await ordenVisible(page)).indexOf('prensa-pierna-45')).toBe(2);
});

test('el primer toque después de abrir el orden con long-press no se pierde', async ({ page }) => {
	await page.goto('/dia/dia-piernas');
	const ejercicio = page.getByRole('link', { name: /Curl femoral sentado/ });
	const caja = await ejercicio.boundingBox();
	await page.mouse.move(caja!.x + caja!.width / 2, caja!.y + caja!.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(450);
	await page.mouse.up();
	await expect(page.getByRole('button', { name: 'Terminar orden' })).toBeVisible();

	// `mantener` bloquea el click de compatibilidad de su propia pulsación para no
	// navegar al ejercicio. Ese bloqueo se medía con un reloj de 750 ms y se comía
	// también el toque siguiente: abrías el modo, tocabas una flecha y no pasaba nada.
	await page.getByRole('button', { name: 'Subir Curl femoral sentado' }).click();
	await expect.poll(async () => (await ordenVisible(page)).indexOf('curl-femoral')).toBe(1);
	// Y lo que el bloqueo protege sigue en pie: mantener no navega al ejercicio.
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
	await apagarDescanso(page);
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
		const saltar = page.getByRole('button', { name: `Saltar ${nombre} hoy`, exact: true });
		// Al centro antes de tocar: la barra inferior es fija y tapa el final de la
		// pantalla, y el último ejercicio de la lista cae justo ahí. `force` clickea las
		// coordenadas igual, así que sin este scroll el toque se lo lleva la navegación
		// y el ejercicio nunca se salta. El `force` se conserva por el arrastre de
		// reordenar, que intercepta el puntero sobre las tarjetas.
		await saltar.evaluate((el) => el.scrollIntoView({ block: 'center' }));
		await saltar.click({ force: true });
		await expect(
			page.getByRole('button', { name: `Reanudar ${nombre} hoy`, exact: true })
		).toBeVisible();
	}
	const terminar = page.getByRole('button', { name: /Terminar día/ });
	await expect(terminar).toBeEnabled();
	// Sin `force`: la barra inferior es fija y tapa el final de la página, así que el
	// botón tiene que quedar destapado como le queda a una persona que scrollea. Con
	// `force` el click iba a las coordenadas igual y se lo comía la navegación.
	await terminar.scrollIntoViewIfNeeded();
	await terminar.click();
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

test('cruzar la medianoche avisa en el ejercicio y el día nuevo dice dónde quedó lo hecho', async ({
	page
}) => {
	await page.clock.install({ time: new Date('2026-08-13T23:55:00-03:00') });
	await page.goto('/dia/dia-piernas');
	await page.getByRole('link', { name: /Prensa de pierna 45/ }).click();
	await expect(page).toHaveURL(/fecha=2026-08-13/);
	await page.getByRole('textbox', { name: 'Peso de la serie 1 en kg' }).fill('100');
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await apagarDescanso(page);
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();
	await expect(page.getByText('1/4', { exact: true })).toBeVisible();
	// Antes de medianoche no hay nada que avisar.
	await expect(page.getByText(/no el de hoy/)).toHaveCount(0);

	// Pasa la medianoche con la pantalla abierta: el teléfono está encendido por el wake
	// lock, así que lo único que llega es el foco al volver a mirarlo.
	await page.clock.setFixedTime(new Date('2026-08-14T00:05:00-03:00'));
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	// Seguís escribiendo donde empezaste —eso está bien—, pero ahora la app lo dice.
	await expect(
		page.getByText('Estás editando el entrenamiento del 13 ago, no el de hoy.')
	).toBeVisible();
	await expect(page.getByText('1/4', { exact: true })).toBeVisible();

	// Volvés por Inicio, que no lleva ?fecha: esta es la pantalla que se leía como
	// "se me borró todo". Ahora explica dónde está el entrenamiento y cómo volver.
	await page.goto('/dia/dia-piernas');
	await expect(page).not.toHaveURL(/fecha=/);
	await expect(page.getByText('1/4', { exact: true })).toHaveCount(0);
	const aviso = page
		.getByRole('status')
		.filter({ hasText: 'Tu entrenamiento del 13 ago sigue ahí' });
	await expect(aviso).toBeVisible();
	await expect(aviso).toContainText('Marcaste 1 serie');

	await aviso.getByRole('link', { name: 'Seguir ese entrenamiento' }).click();
	await expect(page).toHaveURL(/\/dia\/dia-piernas\?fecha=2026-08-13/);
	await expect(page.getByText('1/4', { exact: true })).toBeVisible();
	// Y en el día recuperado el aviso no se repite: ese día no está vacío.
	await expect(page.getByText('Tu entrenamiento del 13 ago sigue ahí')).toHaveCount(0);
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

	// Una fecha que todavía no llegó tampoco puede crear trabajo, ni en el día ni en el
	// ejercicio: antes `?fecha=2030-01-01` escribía una sesión real que después ninguna
	// pantalla mostraba.
	await page.goto('/dia/dia-piernas?fecha=2030-01-01');
	await expect(page.getByText('La fecha de esta sesión no es válida')).toBeVisible();
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2030-01-01');
	await expect(page.getByText('La fecha de esta sesión no es válida')).toBeVisible();
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
	await apagarDescanso(page);
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
	// El descanso quedó en dos controles; los dos siguen siendo apretables con el pulgar.
	for (const control of [interruptorDescanso(page), valorDescanso(page)]) {
		const caja = await control.boundingBox();
		expect(caja?.width).toBeGreaterThanOrEqual(44);
		expect(caja?.height).toBeGreaterThanOrEqual(44);
	}
	await apagarDescanso(page);
	await page.getByRole('textbox', { name: 'Peso de la serie 1 en kg' }).fill('100');
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();
	await page.getByRole('link', { name: 'Progreso completo →' }).click();

	for (const rango of ['3 meses', '1 año', 'Todo']) {
		await page.getByRole('button', { name: rango }).click();
		await expect(page.getByRole('img', { name: /Progreso de peso máximo: 1 día/ })).toBeVisible();
	}
	await expect(page.getByText('Sin sesiones pasadas en este rango.')).toHaveCount(0);

	await page.setViewportSize({ width: 320, height: 740 });
	await page.goto('/historial');
	// El día entrenado dice cuántas series entraron, no sólo que entrenaste: esa
	// intensidad vivía en un mapa anual aparte que se retiró por redundante.
	const entrenado = page
		.getByRole('link', { name: /completadas?( de \d+ planeadas)? · .*ver detalle$/ })
		.first();
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
	const resumen = page.getByRole('dialog', { name: 'Resumen del día' });
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

	// Descanso propio de este ejercicio: 1 minuto, para que el test no dependa del valor
	// general ni de esperas largas. Ya no hay chip: se baja con la rueda, que además de
	// girarse se opera con teclado.
	await valorDescanso(page).click();
	const duracion = ruedaDescanso(page);
	await duracion.focus();
	for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
	await expect(duracion).toHaveAttribute('aria-valuenow', '60');
	await page.getByRole('button', { name: 'Listo', exact: true }).click();
	await expect(valorDescanso(page)).toContainText('1:00');

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
	await page.clock.runFor('01:01');
	await expect(page.getByText('¡A la serie!')).toBeVisible();
	await page.getByRole('button', { name: 'Listo', exact: true }).click();
	await expect(page.getByText('¡A la serie!')).toBeHidden();

	// Resto de las series de la rutina sembrada (4 objetivo), sin descanso en el medio.
	await apagarDescanso(page);
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
/**
 * La lista de series tiene una sola fila desplegada además de la que estás haciendo.
 * Abrir una pendiente para dejar la carga preparada no puede ser un viaje de ida, y
 * marcar tiene que devolver el foco a la serie siguiente.
 */
test('abrir y cerrar series deja una sola desplegada y siempre con salida', async ({ page }) => {
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-27');
	await apagarDescanso(page);

	// La que estás haciendo no se cierra: es el trabajo en curso.
	await expect(page.getByRole('button', { name: 'Cerrar serie 1' })).toBeHidden();

	// Una que falta se abre y vuelve a su renglón.
	await page.getByRole('button', { name: 'Abrir serie 3' }).click();
	await expect(page.getByRole('textbox', { name: 'Peso de la serie 3 en kg' })).toBeVisible();
	await page.getByRole('button', { name: 'Cerrar serie 3' }).click();
	await expect(page.getByRole('button', { name: 'Abrir serie 3' })).toBeVisible();

	// Abrir otra cierra la anterior.
	await page.getByRole('button', { name: 'Abrir serie 3' }).click();
	await page.getByRole('button', { name: 'Abrir serie 4' }).click();
	await expect(page.getByRole('button', { name: 'Abrir serie 3' })).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Peso de la serie 4 en kg' })).toBeVisible();

	// Marcar cierra lo que hubiera abierto a mano y el foco pasa a la serie siguiente.
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();
	await expect(page.getByRole('button', { name: 'Abrir serie 4' })).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Reps de la serie 2' })).toBeVisible();

	// Desmarcar es lo contrario: la serie que vas a rehacer queda desplegada.
	// La hecha se fue al renglón de hechas, así que primero se abre ese renglón.
	await page.getByRole('button', { name: /^Ver todas:/ }).click();

	// El renglón contraído es una tarjeta entera, no las cifras a secas: antes el botón
	// medía lo que medían los números y las insignias y el delta —media fila— eran `span`
	// muertos. Se mide contra el ancho de la lista, no contra un número fijo.
	const fila = page.getByRole('button', { name: /^Corregir serie 1/ });
	const cajaFila = await fila.boundingBox();
	const cajaLista = await page.getByRole('button', { name: /^Ocultar/ }).boundingBox();
	expect(cajaFila?.height).toBeGreaterThanOrEqual(44);
	expect(cajaFila!.width).toBeGreaterThan(cajaLista!.width * 0.7);

	await page.getByRole('button', { name: 'Desmarcar serie 1' }).click();
	await expect(page.getByRole('textbox', { name: 'Reps de la serie 1' })).toBeVisible();
});

test('la rueda alcanza cualquier descanso y el interruptor conserva el elegido', async ({
	page
}) => {
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-16');

	await valorDescanso(page).click();

	// Se opera con teclado además del giro: es un slider, no solo un gesto.
	const rueda = ruedaDescanso(page);
	await expect(rueda).toBeVisible();
	await rueda.focus();
	// Hasta el piso (15 s) desde cualquier valor inicial, y de ahí a 45 s.
	for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowDown');
	await expect(rueda).toHaveAttribute('aria-valuenow', '15');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ArrowUp');

	await expect(rueda).toHaveAttribute('aria-valuenow', '45');
	await expect(rueda).toHaveAttribute('aria-valuetext', '45 segundos');
	await page.getByRole('button', { name: 'Listo', exact: true }).click();
	// La fila muestra el valor elegido con el mismo reloj que el cronómetro.
	await expect(valorDescanso(page)).toContainText('0:45');

	// Apagar y volver a encender no se lleva puesto el valor: apagar se guarda como un 0
	// que pisa lo elegido, y sin memoria el ejercicio volvía al general de 2 minutos.
	const interruptor = interruptorDescanso(page);
	await interruptor.click();
	await expect(page.getByText('Sin descanso')).toBeVisible();
	await interruptor.click();
	await expect(valorDescanso(page)).toContainText('0:45');
});

test('la rueda no guarda hasta que soltás', async ({ page }) => {
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-16');

	// La fila es el acuse de lo guardado. Se lee por CSS y no por rol porque la hoja deja
	// inerte todo lo de atrás: para el árbol de accesibilidad, mientras gira no existe.
	const fila = page.locator('.gb-rest-presets');
	const antesFila = (await fila.innerText()).trim();

	await valorDescanso(page).click();
	const rueda = ruedaDescanso(page);
	await expect(rueda).toBeVisible();
	const antes = await rueda.getAttribute('aria-valuenow');

	// Con la tecla apretada el número de la rueda ya se movió...
	await rueda.focus();
	await page.keyboard.down('ArrowUp');
	await expect(rueda).not.toHaveAttribute('aria-valuenow', antes!);
	// ...y el ejercicio sigue con lo que tenía. Girar es explorar, y explorar no se
	// guarda: antes cada detent escribía en la base y re-cargaba media pantalla debajo
	// del dedo.
	expect((await fila.innerText()).trim()).toBe(antesFila);

	// Recién al soltar se guarda, una sola vez.
	await page.keyboard.up('ArrowUp');
	await expect(fila).not.toHaveText(antesFila);
});

/**
 * El descanso se elige donde se ve correr, y esa decisión sobrevive.
 *
 * Antes la rueda del descanso a pantalla completa cambiaba lo que faltaba y no guardaba
 * nada: era el único lugar donde se podía tocar el descanso mientras descansabas, pero
 * al día siguiente arrancabas de cero. Ahora fija la duración del ejercicio y queda.
 */
test('la duración elegida durante el descanso queda guardada en el ejercicio', async ({ page }) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-15');
	await expect(valorDescanso(page)).toContainText('2:00');

	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();

	const dialogo = page.getByRole('dialog', { name: 'Descanso' });
	await expect(dialogo).toBeVisible();

	// "+30 s" estira ESTE descanso y no toca la duración elegida: la rueda tiene que
	// seguir abriéndose en 2:00 y no en 2:30.
	await dialogo.getByRole('button', { name: /Sumar 30 segundos/ }).click();
	await dialogo.getByRole('button', { name: /Elegir cuánto dura el descanso/ }).click();
	const rueda = ruedaDescanso(page);
	await expect(rueda).toHaveAttribute('aria-valuenow', '120');

	// Bajarla a 1:30 vale para este descanso y para las próximas veces.
	await rueda.focus();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await expect(rueda).toHaveAttribute('aria-valuenow', '90');
	await dialogo.getByRole('button', { name: 'Listo', exact: true }).click();
	await dialogo.getByRole('button', { name: 'Saltar descanso' }).click();
	await expect(dialogo).toBeHidden();

	await expect(valorDescanso(page)).toContainText('1:30');

	// Y sigue ahí después de recargar: es una preferencia del ejercicio, no del rato.
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-15');
	await expect(valorDescanso(page)).toContainText('1:30');
});

test('las salidas del descanso a pantalla completa responden al toque', async ({ page }) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-15');
	// Arranca encendido siguiendo el descanso general (2 minutos): no hay nada que elegir.
	await expect(valorDescanso(page)).toContainText('2:00');
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

/**
 * Un cronómetro no es un anuncio.
 *
 * La cifra del descanso vivía adentro de un `aria-live="polite"`, y cambia sesenta veces
 * por minuto: con lector de pantalla el descanso se volvía una locutora que dice «un
 * minuto cincuenta y nueve… un minuto cincuenta y ocho…» hasta el final. La región viva
 * tiene que ser el rótulo, que cambia UNA vez en todo el descanso, y la cifra tiene que
 * poder leerse cuando la buscás, no sola: para eso está `role="timer"`, que trae
 * `aria-live: off` por definición.
 */
test('el cronómetro del descanso no se anuncia cada segundo', async ({ page }) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-15');
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();
	await expect(page.getByRole('dialog', { name: 'Descanso' })).toBeVisible();

	const lectura = await page.evaluate(() => {
		const dialogo = document.querySelector('[role="dialog"][aria-label="Descanso"]')!;
		const reloj = dialogo.querySelector('.rest-focus-time')!;
		/** El ancestro vivo más cercano, si es que hay alguno. */
		const regionViva = (desde: Element | null) => {
			for (let el = desde; el; el = el.parentElement) {
				const valor = el.getAttribute('aria-live');
				if (valor && valor !== 'off') return valor;
			}
			return null;
		};
		const rotulo = [...dialogo.querySelectorAll('p')].find(
			(p) => p.textContent?.trim() === 'Descanso'
		)!;
		return {
			relojEnRegionViva: regionViva(reloj),
			rolDelReloj: reloj.getAttribute('role'),
			rotuloVivo: rotulo.getAttribute('aria-live')
		};
	});

	expect(lectura.relojEnRegionViva, 'la cifra volvió a quedar dentro de un aria-live').toBeNull();
	expect(lectura.rolDelReloj).toBe('timer');
	expect(lectura.rotuloVivo, 'el aviso de fin necesita una región viva estable').toBe('polite');
});

/**
 * Cero emoji en la interfaz operativa (`CLAUDE.md`).
 *
 * La barra del descanso decía «⏱️ Descanso» mientras el resto de la app ya dibujaba sus
 * íconos con `Icono.svelte` — que documenta ese mismo emoji entre los que se sacaron
 * porque cada teléfono lo dibuja distinto, no toma el color del acento y no alinea con
 * el texto de al lado.
 */
test('la barra del descanso dibuja su ícono, no un emoji', async ({ page }) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-15');
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();
	const dialogo = page.getByRole('dialog', { name: 'Descanso' });
	await dialogo.getByRole('button', { name: 'Minimizar' }).click();

	const barra = page.locator('.rest-bar');
	await expect(barra).toBeVisible();
	const contenido = await barra.evaluate((el) => ({
		emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(
			el.textContent ?? ''
		),
		trazos: el.querySelectorAll('svg').length
	}));
	expect(contenido.emoji, 'volvió un emoji a la interfaz operativa').toBe(false);
	expect(contenido.trazos).toBeGreaterThan(0);
});

/**
 * El fondo cierra, como en toda otra hoja de la app.
 *
 * El descanso era la única donde tocar afuera no hacía nada: `HojaDescanso` y
 * `EditarSerieSheet` ya tenían su botón de fondo. En un teléfono el panel ocupa todo el
 * ancho y ese fondo no existe —por eso la segunda mitad del test, que verifica que no le
 * robe el toque al panel—, pero acostado y en pantallas anchas queda fondo a la vista y
 * el gesto se intenta solo.
 */
test('tocar el fondo del descanso lo minimiza sin cortarlo', async ({ page }) => {
	await page.clock.install({ time: new Date('2026-08-15T10:00:00-03:00') });
	await page.goto('/ejercicio/prensa-pierna-45?dia=dia-piernas&fecha=2026-08-15');
	await page.getByRole('textbox', { name: 'Reps de la serie 1' }).fill('10');
	await page.getByRole('button', { name: 'Marcar serie 1' }).click();
	const dialogo = page.getByRole('dialog', { name: 'Descanso' });
	await expect(dialogo).toBeVisible();

	// En el teléfono el panel llega a los dos bordes: el toque del borde es del panel.
	const anchoPanel = (await dialogo.boundingBox())!.width;
	expect(Math.round(anchoPanel)).toBe(page.viewportSize()!.width);
	await page.mouse.click(4, 300);
	await expect(dialogo, 'el fondo le robó el toque al panel').toBeVisible();

	// Con lugar para el fondo, tocarlo minimiza y el descanso sigue corriendo.
	await page.setViewportSize({ width: 720, height: 900 });
	await expect(dialogo).toBeVisible();
	await page.mouse.click(40, 450);
	await expect(dialogo).toBeHidden();
	await expect(
		page.getByRole('button', { name: 'Abrir descanso en pantalla completa' })
	).toBeVisible();
});
