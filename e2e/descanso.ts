import { expect, type Page } from '@playwright/test';

/**
 * Ayudas para el descanso de un ejercicio.
 *
 * La pantalla de ejercicio ya no tiene la fila de ocho botones (Auto, Off y cuatro
 * atajos): tiene un interruptor y un valor que abre la rueda. Casi todos los tests
 * apagan el descanso para no esperar, y eso ahora es alternar un `role="switch"`, que
 * sin verificar el estado previo sería un toque a ciegas.
 */
export function interruptorDescanso(page: Page) {
	return page.getByRole('switch', { name: 'Descanso en este ejercicio' });
}

/** Deja el ejercicio sin descanso, verificando que efectivamente estaba encendido. */
export async function apagarDescanso(page: Page) {
	const interruptor = interruptorDescanso(page);
	await expect(interruptor).toHaveAttribute('aria-checked', 'true');
	await interruptor.click();
	await expect(interruptor).toHaveAttribute('aria-checked', 'false');
}

/** El valor de la fila, que también es el botón que abre la rueda. */
export function valorDescanso(page: Page) {
	return page.getByRole('button', { name: /Cambiar el descanso de este ejercicio/ });
}

/** La rueda de duración, ya abierta en la hoja. */
export function ruedaDescanso(page: Page) {
	return page.getByRole('slider', { name: 'Duración del descanso de este ejercicio' });
}
