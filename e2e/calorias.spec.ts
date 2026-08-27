import { expect, test } from '@playwright/test';

/**
 * El asistente completo, con un perfil conocido: hombre de 32 años, 178 cm, 82 kg,
 * trabajo sentado, 4.000–7.000 pasos, 4 entrenos de 45–75 min a ritmo normal.
 *
 * Los números son los mismos que fija `energia.test.ts` para el perfil A. Si acá cambian
 * y allá no, lo que se rompió es la pantalla, no el cálculo.
 */
async function completarPerfilA(page: import('@playwright/test').Page) {
	await page.goto('/herramientas/calorias');

	// --- 1. Vos ---
	await expect(page.getByText('1 de 4')).toBeVisible();
	await page.getByRole('textbox', { name: 'Edad en años' }).fill('32');
	await page.getByRole('textbox', { name: 'Edad en años' }).press('Enter');
	await page.getByRole('textbox', { name: 'Altura en centímetros' }).fill('178');
	await page.getByRole('textbox', { name: 'Altura en centímetros' }).press('Enter');
	await page.getByRole('textbox', { name: 'Peso corporal en kg' }).fill('82');
	await page.getByRole('textbox', { name: 'Peso corporal en kg' }).press('Enter');
	await page.getByRole('button', { name: 'Masculina', exact: true }).click();
	await page.getByRole('button', { name: 'Continuar' }).click();

	// --- 2. Tu día ---
	await expect(page.getByText('2 de 4')).toBeVisible();
	await page.getByRole('button', { name: 'Sentado casi todo el día' }).click();
	await page.getByRole('button', { name: '4.000 a 7.000' }).click();
	await page.getByRole('button', { name: 'Continuar' }).click();

	// --- 3. Tu entrenamiento ---
	await expect(page.getByText('3 de 4')).toBeVisible();
	await page.getByRole('textbox', { name: 'Entrenamientos por semana' }).fill('4');
	await page.getByRole('textbox', { name: 'Entrenamientos por semana' }).press('Enter');
	await page.getByRole('button', { name: '45–75 min' }).click();
	await page.getByRole('button', { name: 'Ritmo normal' }).click();
	await page.getByRole('button', { name: 'Continuar' }).click();

	await expect(page.getByText('4 de 4')).toBeVisible();
}

test('los cinco objetivos muestran su número antes de elegirlos', async ({ page }) => {
	await completarPerfilA(page);

	// Cada botón sabe cuánto da: la decisión se toma con el número a la vista.
	await expect(page.getByRole('button', { name: /Déficit moderado/ })).toContainText('2.440');
	await expect(page.getByRole('button', { name: /Déficit agresivo/ })).toContainText('2.210');
	await expect(page.getByRole('button', { name: /Mantenimiento/ })).toContainText('2.890');
	await expect(page.getByRole('button', { name: /Volumen moderado/ })).toContainText('3.120');
	await expect(page.getByRole('button', { name: /Volumen agresivo/ })).toContainText('3.340');

	// El moderado viene elegido y no arrastra advertencia.
	await expect(page.getByRole('button', { name: /Déficit moderado/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('el agresivo se puede elegir y llega con su advertencia', async ({ page }) => {
	await completarPerfilA(page);

	await page.getByRole('button', { name: /Déficit agresivo/ }).click();
	await expect(page.getByText(/cuesta algo de masa magra/)).toBeVisible();

	await page.getByRole('button', { name: /Volumen agresivo/ }).click();
	await expect(page.getByText(/no te va a hacer ganar más músculo/)).toBeVisible();
});

test('el resultado manda una sola cifra y dice de dónde sale', async ({ page }) => {
	await completarPerfilA(page);
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();

	// Una sola cifra manda, y va con separador de miles para leerse de un vistazo.
	await expect(page.getByText('2.440kcal')).toBeVisible();

	// La banda va con su cobertura escrita en palabras, nunca un ± suelto. Los saltos de
	// línea del código fuente llegan al DOM, así que el patrón tolera espacios.
	const explicacion = page.getByText(/2 de cada\s+3\s+personas con tu perfil/);
	await expect(explicacion).toBeVisible();
	await expect(explicacion).toContainText('2.890');
	await expect(explicacion).toContainText('2.550');
	await expect(explicacion).toContainText('3.230');

	// Los tres macros, y los tres siempre: es lo que la persona vino a ver.
	await expect(page.getByText('148g')).toBeVisible(); // proteína
	await expect(page.getByText('68g')).toBeVisible(); // grasa
	await expect(page.getByText('309g')).toBeVisible(); // carbos
	// Mantenimiento y ritmo acompañan, no compiten.
	await expect(page.getByText('2.890kcal')).toBeVisible();
	await expect(page.getByText('−0,41kg/sem')).toBeVisible();

	// El riel nombra sus tres marcas: sin leyenda son tres rayas sin significado.
	await expect(page.getByText('Objetivo', { exact: true })).toBeVisible();
	await expect(page.getByText('Mantenimiento', { exact: true }).first()).toBeVisible();

	// El descargo está siempre a la vista, no detrás de un desplegable.
	await expect(page.getByText(/no una indicación\s+médica/)).toBeVisible();
});

test('el riel del resultado cambia el objetivo entero con un toque', async ({ page }) => {
	await completarPerfilA(page);
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();
	await expect(page.getByText('2.440kcal')).toBeVisible();

	// Las muescas llevan el nombre entero en su etiqueta accesible: adentro no entra, y
	// "++" solo no le sirve a nadie que no vea la pantalla.
	await page.getByRole('button', { name: 'Volumen agresivo' }).click();

	// No cambia la cifra sola: cambian los macros, el ritmo y el rótulo de arriba. Eso es
	// lo que el riel vino a mostrar y lo que los cinco botones del paso 4 no pueden.
	await expect(page.getByText('3.340kcal')).toBeVisible();
	// El nombre entero vive arriba de la cifra: en la muesca sólo entra la marca.
	await expect(page.getByText('Volumen agresivo', { exact: true })).toBeVisible();
	await expect(page.getByText('+0,41kg/sem')).toBeVisible();
	await expect(page.getByText('131g')).toBeVisible(); // proteína, ya sin el 1,8 del déficit
	await expect(page.getByText('495g')).toBeVisible(); // carbos

	// Y viaja con su advertencia. Antes del riel este texto vivía sólo en el paso 4,
	// porque al agresivo se llegaba tocándolo ahí; ahora se puede entrar en moderado y
	// salir en agresivo sin pasar por esa pantalla.
	await expect(page.getByText(/no te va a hacer ganar más músculo/)).toBeVisible();

	// El mantenimiento no se mueve: es el mismo cuerpo mirando otro objetivo.
	await expect(page.getByText('2.890kcal')).toBeVisible();
});

test('el riel se recorre arrastrando, y cada muesca es una parada', async ({ page }) => {
	await completarPerfilA(page);
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();

	const agresivoBajar = await page.getByRole('button', { name: 'Déficit agresivo' }).boundingBox();
	const agresivoSubir = await page.getByRole('button', { name: 'Volumen agresivo' }).boundingBox();
	if (!agresivoBajar || !agresivoSubir) throw new Error('El riel no está en pantalla.');

	// Un solo gesto de punta a punta: arrastrar es explorar, y tiene que aterrizar en la
	// muesca de abajo del dedo, no en la que lo vio empezar.
	await page.mouse.move(agresivoBajar.x + 10, agresivoBajar.y + agresivoBajar.height / 2);
	await page.mouse.down();
	await expect(page.getByText('2.210kcal')).toBeVisible();
	await page.mouse.move(agresivoSubir.x + agresivoSubir.width / 2, agresivoSubir.y + 10, {
		steps: 12
	});
	await page.mouse.up();

	await expect(page.getByText('3.340kcal')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Volumen agresivo' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('moverse por el riel apaga el acuse de guardado', async ({ page }) => {
	await completarPerfilA(page);
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();
	await page.getByRole('button', { name: 'Guardar como objetivo' }).click();
	await expect(page.getByText('Guardado como tu objetivo')).toBeVisible();

	// El cartel habla de lo que hay en la base; el riel cambia lo que hay en pantalla. Si
	// el cartel sobrevive al movimiento, dice la verdad sobre una y miente sobre la otra.
	await page.getByRole('button', { name: 'Déficit agresivo' }).click();
	await expect(page.getByText('Guardado como tu objetivo')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Guardar como objetivo' })).toBeVisible();

	// Y lo guardado sigue siendo lo guardado hasta que se vuelva a tocar el botón.
	await page.goto('/cuerpo');
	await expect(page.getByText('2.440kcal')).toBeVisible();
});

test('con una sola posición no hay riel que recorrer', async ({ page }) => {
	await completarPerfilA(page);
	await page.getByText('¿Algo de esto aplica?').click();
	await page.getByRole('button', { name: 'Estoy embarazada o amamantando' }).click();
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();

	// Queda mantenimiento solo: un selector de una tecla es un adorno que promete opciones
	// que no existen. Y el riel tampoco puede devolver lo que lo declarado retiró.
	await expect(page.getByRole('group', { name: 'Cambiar de objetivo' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Déficit agresivo' })).toHaveCount(0);
	await expect(page.getByText('2.890kcal')).toBeVisible();
});

test('guarda el objetivo y lo recuerda al volver a entrar', async ({ page }) => {
	await completarPerfilA(page);
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();
	await page.getByRole('button', { name: 'Guardar como objetivo' }).click();
	await expect(page.getByText('Guardado como tu objetivo')).toBeVisible();

	// Al volver, el perfil viene prellenado desde el objetivo guardado.
	await page.goto('/herramientas/calorias');
	await expect(page.getByRole('textbox', { name: 'Edad en años' })).toHaveValue('32');
	await expect(page.getByRole('textbox', { name: 'Altura en centímetros' })).toHaveValue('178');
});

test('un paso contestado se contrae a su respuesta y se puede reabrir', async ({ page }) => {
	await completarPerfilA(page);

	// Los tres anteriores quedaron resumidos, como una serie ya hecha.
	await expect(page.getByRole('button', { name: /32 a · 178 cm/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Sentado · 4\.000 a 7\.000 pasos/ })).toBeVisible();

	await page.getByRole('button', { name: /32 a · 178 cm/ }).click();
	await expect(page.getByText('1 de 4')).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Edad en años' })).toHaveValue('32');
});

test('no ofrece déficit a quien está por debajo de IMC 18,5', async ({ page }) => {
	await page.goto('/herramientas/calorias');
	await page.getByRole('textbox', { name: 'Edad en años' }).fill('24');
	await page.getByRole('textbox', { name: 'Edad en años' }).press('Enter');
	await page.getByRole('textbox', { name: 'Altura en centímetros' }).fill('178');
	await page.getByRole('textbox', { name: 'Altura en centímetros' }).press('Enter');
	await page.getByRole('textbox', { name: 'Peso corporal en kg' }).fill('55');
	await page.getByRole('textbox', { name: 'Peso corporal en kg' }).press('Enter');
	await page.getByRole('button', { name: 'Continuar' }).click();
	await page.getByRole('button', { name: 'Continuar' }).click();
	await page.getByRole('button', { name: 'Continuar' }).click();

	// IMC 17,4: los déficits no aparecen. Un botón gris que no se puede tocar sigue
	// diciendo "esto existe y vos no llegás", y con calorías eso empuja para el lado malo.
	await expect(page.getByRole('button', { name: /Déficit/ })).toHaveCount(0);
	await expect(page.getByText('Con tu peso actual la app no propone déficit')).toBeVisible();
	await expect(page.getByRole('button', { name: /Mantenimiento/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('lo declarado cambia qué se ofrece, y no se guarda', async ({ page }) => {
	await completarPerfilA(page);
	await expect(page.getByRole('button', { name: /Déficit moderado/ })).toBeVisible();

	await page.getByText('¿Algo de esto aplica?').click();
	await page.getByRole('button', { name: 'Tuve un trastorno alimentario' }).click();

	// El déficit no queda gris: no está.
	await expect(page.getByRole('button', { name: /Déficit moderado/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Déficit agresivo/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Mantenimiento/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Volumen moderado/ })).toBeVisible();
	await expect(page.getByText(/no propone objetivos de déficit/)).toBeVisible();

	// Y en el resultado aparece la derivación.
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();
	await expect(page.getByText(/hablarlo antes con un\s+profesional/)).toBeVisible();

	// Al volver a entrar no queda rastro: la respuesta no se persiste en ningún lado.
	await completarPerfilA(page);
	await expect(page.getByRole('button', { name: /Déficit moderado/ })).toBeVisible();
	await expect(page.getByText(/no propone objetivos de déficit/)).toHaveCount(0);
});

test('en embarazo o lactancia solo queda mantenimiento', async ({ page }) => {
	await completarPerfilA(page);
	await page.getByText('¿Algo de esto aplica?').click();
	await page.getByRole('button', { name: 'Estoy embarazada o amamantando' }).click();

	await expect(page.getByRole('button', { name: /Mantenimiento/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Déficit/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Volumen/ })).toHaveCount(0);
	await expect(page.getByText(/las necesidades se calculan distinto/)).toBeVisible();
});

test('bloquea la herramienta a menores de edad', async ({ page }) => {
	await page.goto('/herramientas/calorias');
	await page.getByRole('textbox', { name: 'Edad en años' }).fill('16');
	await page.getByRole('textbox', { name: 'Edad en años' }).press('Enter');
	// El stepper recorta a 18: el mínimo es del control, no una validación tardía.
	await expect(page.getByRole('textbox', { name: 'Edad en años' })).toHaveValue('18');
});

test('cambiar de unidad no reinterpreta el peso guardado', async ({ page }) => {
	await completarPerfilA(page);
	await expect(page.getByRole('button', { name: /Déficit moderado/ })).toContainText('2.440');
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();
	await page.getByRole('button', { name: 'Guardar como objetivo' }).click();
	await expect(page.getByText('Guardado como tu objetivo')).toBeVisible();

	await page.goto('/ajustes');
	const unidadLb = page.getByRole('button', { name: 'Seleccionar unidad lb' });
	await unidadLb.click();
	await expect(unidadLb).toHaveAttribute('aria-pressed', 'true');

	// El peso vive en gramos: al pasar a libras cambia cómo se muestra, no cuánto pesa.
	await page.goto('/herramientas/calorias');
	await expect(page.getByRole('textbox', { name: 'Peso corporal en lb' })).toHaveValue('180,8');
	await page.getByRole('button', { name: 'Continuar' }).click();
	await page.getByRole('button', { name: 'Continuar' }).click();
	await page.getByRole('button', { name: 'Continuar' }).click();

	// Y las calorías no dependen de la unidad: son las mismas 2.440.
	await expect(page.getByRole('button', { name: /Déficit moderado/ })).toContainText('2.440');
	await page.goto('/cuerpo');
	await expect(page.getByText('2.440kcal')).toBeVisible();
});

test('la sección dice qué esperar, y por qué esa proteína', async ({ page }) => {
	await completarPerfilA(page);
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();
	await page.getByRole('button', { name: 'Guardar como objetivo' }).click();
	await page.getByRole('link', { name: 'Macros' }).click();

	// Sin ninguna medición, lo más útil que se puede decir es justamente eso, y es la
	// única frase que queda a la vista: es la única que puede pedir una acción.
	await expect(page.getByText(/Todavía no registraste ningún peso/)).toBeVisible();

	// Las que explican viven plegadas. No desaparecieron: cuestan 200 px de prosa de
	// 12 px abajo de la cifra, y abiertas empujaban la pantalla a un scroll entero.
	await expect(page.getByText(/la fuerza se sostiene/)).toBeHidden();
	await page.getByRole('group').filter({ hasText: '¿De dónde sale este número?' }).click();
	await expect(page.getByText(/la fuerza se sostiene/)).toBeVisible();
	// La proteína explica su número, y ahora también lo hacen la grasa y los carbos.
	await expect(page.getByText(/grasa y no músculo/)).toBeVisible();
	await expect(page.getByText(/los carbos son lo que queda/)).toBeVisible();

	// Sigue habiendo un techo: la lista corta en tres, no vuelca el panfleto entero.
	await expect(page.getByText(/La banda es ancha a propósito/)).toHaveCount(0);
});

test('el objetivo se puede borrar, y hace falta confirmarlo', async ({ page }) => {
	await completarPerfilA(page);
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();
	await page.getByRole('button', { name: 'Guardar como objetivo' }).click();
	await page.getByRole('link', { name: 'Macros' }).click();
	await expect(page.getByText('2.440kcal')).toBeVisible();

	// Acción secundaria y discreta: vive dentro del desplegable, no compitiendo con la cifra.
	await page.getByRole('group').filter({ hasText: '¿De dónde sale este número?' }).click();
	// Un solo toque no borra nada: pide confirmación en el mismo botón.
	await page.getByRole('button', { name: 'Borrar objetivo' }).click();
	await expect(page.getByText('2.440kcal')).toBeVisible();
	await page.getByRole('button', { name: 'Tocá otra vez para borrarlo' }).click();

	await expect(page.getByRole('link', { name: 'Calcular mi objetivo' })).toBeVisible();
	await expect(page.getByText('2.440kcal')).toHaveCount(0);
});

test('la sección Macros tiene su lugar en la barra y arranca vacía', async ({ page }) => {
	await page.goto('/');

	// La portada ya no lleva la tarjeta de peso: esa pantalla ahora vive en Macros.
	await expect(page.getByRole('link', { name: /Peso corporal/ })).toHaveCount(0);

	const abrir = page.getByRole('link', { name: 'Macros' });
	await expect(abrir).toBeVisible();
	await abrir.click();

	await expect(page).toHaveURL(/\/cuerpo$/);
	await expect(page.getByRole('link', { name: 'Macros' })).toHaveAttribute('aria-current', 'page');
	await expect(page.getByRole('heading', { name: 'Macros' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Calcular mi objetivo' })).toBeVisible();
	// El peso dejó de ser tarjeta y es una franja: acá no es el tema, es la puerta a /peso.
	await expect(page.getByRole('link', { name: /Registrar mi primer peso/ })).toBeVisible();
});

test('/peso queda adentro de Macros y deja de estar huérfano en la barra', async ({ page }) => {
	await page.goto('/peso');
	await expect(page.getByRole('link', { name: 'Macros' })).toHaveAttribute('aria-current', 'page');
});

test('el objetivo guardado manda en la sección', async ({ page }) => {
	await completarPerfilA(page);
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();
	await page.getByRole('button', { name: 'Guardar como objetivo' }).click();
	await expect(page.getByText('Guardado como tu objetivo')).toBeVisible();

	await page.getByRole('link', { name: 'Macros' }).click();
	await expect(page.getByText('Déficit moderado')).toBeVisible();
	await expect(page.getByText('2.440kcal')).toBeVisible();
	// Los tres macros mandan la fila: es el nombre de la sección.
	await expect(page.getByText('148g')).toBeVisible();
	await expect(page.getByText('68g')).toBeVisible();
	await expect(page.getByText('309g')).toBeVisible();
	await expect(page.getByText('2.890kcal')).toBeVisible();
	await expect(page.getByText('−0,41kg/sem')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Cambiar objetivo' })).toBeVisible();

	// La banda sigue estando, plegada con el resto de la explicación.
	await expect(page.getByText(/2 de cada 3 personas/)).toBeHidden();
	await page.getByRole('group').filter({ hasText: '¿De dónde sale este número?' }).click();
	await expect(page.getByText(/2 de cada 3 personas/)).toBeVisible();
});
