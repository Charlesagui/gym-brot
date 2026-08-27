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

	// La diferencia contra el mantenimiento va como cifra. Reemplazó a un riel de banda de
	// 5 px con leyenda de tres ítems: lo único que ese gráfico decía y nadie más decía era
	// cuánto te corrés, y eso se lee mejor en números. De paso desmiente lo único que el
	// riel de arriba no puede mostrar: los cinco pasos no son iguales.
	await expect(page.getByText('−450kcal')).toBeVisible();
	await expect(page.getByText(/2 de cada\s+3\s+personas/)).toBeVisible();

	// El descargo está siempre a la vista, no detrás de un desplegable.
	await expect(page.getByText(/no una indicación\s+médica/)).toBeVisible();
});

test('el riel del resultado cambia el objetivo entero con un toque', async ({ page }) => {
	await completarPerfilA(page);
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();
	await expect(page.getByText('2.440kcal')).toBeVisible();

	// Cada muesca dice su nombre. Antes decían "−− − = + ++": ocupaban nada y se leían como
	// escala, pero había que tocarlas para saber qué eran.
	await page.getByRole('button', { name: 'Volumen agresivo' }).click();

	// No cambia la cifra sola: cambian los macros, el ritmo y el rótulo de arriba. Eso es
	// lo que el riel vino a mostrar y lo que los cinco botones del paso 4 no pueden.
	await expect(page.getByText('3.340kcal')).toBeVisible();
	// La muesca queda marcada, y el nombre entero se repite arriba de la cifra.
	await expect(page.getByRole('button', { name: 'Volumen agresivo' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.getByText('Volumen agresivo', { exact: true }).first()).toBeVisible();
	await expect(page.getByText('+0,41kg/sem')).toBeVisible();
	await expect(page.getByText('131g')).toBeVisible(); // proteína, ya sin el 1,8 del déficit
	await expect(page.getByText('495g')).toBeVisible(); // carbos

	// Y viaja con su advertencia. Antes del riel este texto vivía sólo en el paso 4,
	// porque al agresivo se llegaba tocándolo ahí; ahora se puede entrar en moderado y
	// salir en agresivo sin pasar por esa pantalla.
	await expect(page.getByText(/no te va a hacer ganar más músculo/)).toBeVisible();

	// El mantenimiento no se mueve: es el mismo cuerpo mirando otro objetivo. Lo que sí se
	// mueve es la diferencia, y ahí se ve la asimetría: bajar moderado saca 450 y subir
	// agresivo agrega 450, pero son muescas distintas del riel.
	await expect(page.getByText('2.890kcal')).toBeVisible();
	await expect(page.getByText('+450kcal')).toBeVisible();
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

test('bajo IMC 18,5 el riel no ofrece déficit, ni apagado', async ({ page }) => {
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
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();

	// El riel hereda el recorte del motor: la muesca no queda gris, no está.
	await expect(page.getByRole('group', { name: 'Cambiar de objetivo' })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Déficit/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Volumen agresivo' })).toBeVisible();
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

test('la app no pregunta por condiciones: el único recorte sale del peso', async ({ page }) => {
	await completarPerfilA(page);

	// Hubo un desplegable que preguntaba por embarazo, lactancia y antecedente de trastorno
	// alimentario, y con eso retiraba metas. Se sacó por decisión de producto. Lo que quedó
	// no depende de que nadie declare nada: sale del peso que ya está cargado.
	await expect(page.getByText('¿Algo de esto aplica?')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Estoy embarazada o amamantando' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Tuve un trastorno alimentario' })).toHaveCount(0);

	// Y las cinco están, porque este perfil no dispara el único recorte que queda.
	await expect(page.getByRole('button', { name: /Déficit agresivo/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Volumen agresivo/ })).toBeVisible();

	// El descargo médico no se fue con la pregunta: sigue a la vista en el resultado.
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();
	await expect(page.getByText(/no una indicación\s+médica/)).toBeVisible();
	await expect(page.getByText(/hablarlo antes con un\s+profesional/)).toHaveCount(0);
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
	await expect(page.getByText('Déficit moderado').first()).toBeVisible();
	await expect(page.getByText('2.440kcal')).toBeVisible();
	// Los tres macros mandan la fila: es el nombre de la sección.
	await expect(page.getByText('148g')).toBeVisible();
	await expect(page.getByText('68g')).toBeVisible();
	await expect(page.getByText('309g')).toBeVisible();
	await expect(page.getByText('2.890kcal')).toBeVisible();
	await expect(page.getByText('−0,41kg/sem')).toBeVisible();
	// El botón dejó de decir "Cambiar objetivo": eso ahora lo hace el riel de arriba, y lo
	// que queda atrás del botón son los datos con los que se calculó todo.
	await expect(page.getByRole('link', { name: 'Cambiar mis datos' })).toBeVisible();

	// La banda sigue estando, plegada con el resto de la explicación.
	await expect(page.getByText(/2 de cada 3 personas/)).toBeHidden();
	await page.getByRole('group').filter({ hasText: '¿De dónde sale este número?' }).click();
	await expect(page.getByText(/2 de cada 3 personas/)).toBeVisible();
});

/** Deja el perfil A guardado con déficit moderado y termina parado en Macros. */
async function guardarYAbrirMacros(page: import('@playwright/test').Page) {
	await completarPerfilA(page);
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();
	await page.getByRole('button', { name: 'Guardar como objetivo' }).click();
	await expect(page.getByText('Guardado como tu objetivo')).toBeVisible();
	await page.getByRole('link', { name: 'Macros' }).click();
	await expect(page.getByText('2.440kcal')).toBeVisible();
}

test('la sección deja recorrer el objetivo, y recorrer no guarda', async ({ page }) => {
	await guardarYAbrirMacros(page);

	// Recorrer muestra el objetivo entero de la otra muesca, no sólo su cifra.
	await page.getByRole('button', { name: 'Déficit agresivo' }).click();
	await expect(page.getByText('2.210kcal')).toBeVisible();
	await expect(page.getByText('61g')).toBeVisible(); // grasa, era 68
	await expect(page.getByText('267g')).toBeVisible(); // carbos, eran 309
	await expect(page.getByText('−0,62kg/sem')).toBeVisible();

	// Pero no escribió nada: la base sigue teniendo el que estaba. Es la razón por la que
	// el riel no guarda solo — cada guardado reinicia la ventana de calibración.
	await page.reload();
	await expect(page.getByText('2.440kcal')).toBeVisible();

	// Y volver con el dedo a la muesca guardada cancela, sin pasar por el botón.
	await page.getByRole('button', { name: 'Déficit agresivo' }).click();
	await expect(page.getByRole('button', { name: 'Cambiar a Déficit agresivo' })).toBeVisible();
	await page.getByRole('button', { name: 'Déficit moderado' }).click();
	await expect(page.getByRole('button', { name: /^Cambiar a/ })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Cambiar mis datos' })).toBeVisible();
});

test('confirmar el cambio guarda el objetivo nuevo y avisa qué cuesta', async ({ page }) => {
	await guardarYAbrirMacros(page);

	await page.getByRole('button', { name: 'Déficit agresivo' }).click();
	// Guardar es un acto aparte y dice lo que cuesta antes de tocarlo.
	await expect(page.getByText(/reinicia la cuenta para revisarlo con tu peso/)).toBeVisible();
	await page.getByRole('button', { name: 'Cambiar a Déficit agresivo' }).click();

	// El acuse es lo único que se mueve al confirmar: la cifra y los macros ya venían
	// mostrando esta posición desde que el dedo la tocó. Sin él, tocar "Cambiar a…" se
	// siente igual que no tocarlo — y esperar acá es esperar a la escritura de verdad,
	// no a un texto que ya estaba en pantalla antes de guardar.
	await expect(page.getByText('Guardado como tu objetivo')).toBeVisible();
	await expect(page.getByText('Déficit agresivo', { exact: true }).first()).toBeVisible();
	await expect(page.getByText('2.210kcal')).toBeVisible();

	// Y ahora sí quedó escrito.
	await page.reload();
	await expect(page.getByText('2.210kcal')).toBeVisible();
	await expect(page.getByText('2.440kcal')).toHaveCount(0);
});

test('la sección ofrece las cinco, igual que el asistente', async ({ page }) => {
	await guardarYAbrirMacros(page);

	// Hubo una versión que ofrecía sólo la dirección guardada más mantenimiento, porque la
	// pregunta que retiraba metas no se persistía y la sección no podía saber si acá
	// correspondía ofrecer déficit. Esa pregunta ya no existe, y la asimetría se fue con ella.
	for (const nombre of [
		'Déficit agresivo',
		'Déficit moderado',
		'Mantener',
		'Volumen moderado',
		'Volumen agresivo'
	]) {
		await expect(page.getByRole('button', { name: nombre })).toBeVisible();
	}

	// Y cruzar de dirección funciona igual que cualquier otro cambio: se previsualiza acá.
	await page.getByRole('button', { name: 'Volumen agresivo' }).click();
	await expect(page.getByText('3.340kcal')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Cambiar a Volumen agresivo' })).toBeVisible();
});

test('cambiar mis datos entra directo donde se elige el objetivo', async ({ page }) => {
	await guardarYAbrirMacros(page);

	// Cae en el paso 4 y no en el 1: desde ahí los datos están contraídos a un toque, y es
	// donde vive la pregunta que puede devolver una dirección que el riel no ofrece.
	await page.getByRole('link', { name: 'Cambiar mis datos' }).click();
	await expect(page.getByText('4 de 4')).toBeVisible();
	await expect(page.getByRole('button', { name: /Volumen agresivo/ })).toBeVisible();

	// Y los pasos de datos se abren de un toque desde ahí.
	await page.getByRole('button', { name: /32 a · 178 cm/ }).click();
	await expect(page.getByText('1 de 4')).toBeVisible();
});

test('las tres cifras de la fila entran sin desbordar, ni a 320 px', async ({ page }) => {
	await guardarYAbrirMacros(page);

	// Mantenimiento, diferencia y ritmo pasaron de dos celdas a tres, así que cada una tiene
	// ~98 px en un teléfono chico y "−0,41kg/sem" es la más ancha. Si no entra, la página
	// scrollea de costado — que es el defecto que ninguna cifra justifica.
	for (const ancho of [320, 375, 393]) {
		await page.setViewportSize({ width: ancho, height: 800 });
		await expect(page.getByText('−450kcal')).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			ancho
		);
	}

	// Y en el resultado del asistente, que muestra la misma fila.
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto('/herramientas/calorias?paso=4');
	await page.getByRole('button', { name: 'Ver mi objetivo' }).click();
	await expect(page.getByText('−450kcal')).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
