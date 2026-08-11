/**
 * Entrada numérica de pesos y repeticiones. Vivía duplicada entre la pantalla de
 * ejercicio y el sheet de edición del historial (mismo redondeo, mismo parseo, mismas
 * reglas del 0): dos copias de la regla "cuánto vale lo que el usuario escribió" es
 * justo lo que termina divergiendo.
 *
 * Convención compartida: **0 se guarda como `undefined`**. Para el usuario "sin cargar"
 * y "0 kg" son lo mismo, y guardando `undefined` el campo queda vacío en vez de con un 0
 * que después puntúa como serie sin peso.
 */

/** Redondea a 1 decimal: evita el arrastre de flotantes con pasos de 2,5. */
export function redondear(n: number): number {
	return Math.round(n * 10) / 10;
}

/** Suma `delta` a un peso sin bajar de 0 (los −/+ del stepper). */
export function sumarPeso(actual: number | undefined, delta: number): number | undefined {
	const siguiente = redondear(Math.max(0, (actual ?? 0) + delta));
	return siguiente === 0 ? undefined : siguiente;
}

/** Igual que `sumarPeso`, pero entero: las repeticiones no llevan decimales. */
export function sumarReps(actual: number | undefined, delta: number): number | undefined {
	const siguiente = Math.max(0, (actual ?? 0) + delta);
	return siguiente === 0 ? undefined : siguiente;
}

/**
 * Interpreta un peso tipeado. Acepta coma decimal porque el teclado numérico del
 * teléfono escribe "," en español, y descarta basura o negativos.
 */
export function leerPeso(texto: string): number | undefined {
	const n = Number.parseFloat(texto.replace(',', '.'));
	return Number.isFinite(n) && n > 0 ? redondear(n) : undefined;
}

/** Interpreta repeticiones tipeadas: entero positivo, o nada. */
export function leerReps(texto: string): number | undefined {
	const n = Number.parseInt(texto, 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}
