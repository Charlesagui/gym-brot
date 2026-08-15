/**
 * Háptica de la app, en un solo lugar.
 *
 * El motivo de que esto exista y no sea un `navigator.vibrate(20)` suelto: iOS **no
 * expone la Vibration API**. Las llamadas quedaban bien guardadas y no rompían nada,
 * pero degradaban en silencio — y la app seguía ofreciendo un interruptor "Vibración"
 * que en un iPhone no hace absolutamente nada. Peor: varios comentarios del código
 * daban la vibración por red de seguridad del audio ("si el switch de silencio mutea,
 * la vibra queda"), red que en ese dispositivo no está tendida.
 *
 * Acá se centraliza para que la interfaz pueda preguntar si la capacidad existe antes
 * de prometerla.
 */

/** true si este navegador expone la Vibration API (Android sí, iOS no). */
export function vibracionSoportada(): boolean {
	return (
		typeof navigator !== 'undefined' &&
		'vibrate' in navigator &&
		typeof navigator.vibrate === 'function'
	);
}

/**
 * Vibra si el usuario lo tiene activado y el navegador puede. `activada` se pasa desde
 * los ajustes en vez de leerse acá: este módulo no conoce la base de datos.
 */
export function vibrar(patron: number | number[], activada: boolean): void {
	if (!activada || !vibracionSoportada()) return;
	try {
		navigator.vibrate(patron);
	} catch {
		// Algún navegador la expone y la rechaza igual (política de gesto, ahorro de
		// batería): que no se lleve puesto el registro de la serie.
	}
}
