import { writable } from 'svelte/store';

/**
 * Si el navegador se comprometió a NO borrar los datos de la app por su cuenta.
 *
 * - `persistente`: el origen tiene almacenamiento persistente concedido.
 * - `efimero`: el navegador puede liberar el espacio solo. En iOS sin instalar es el
 *   caso normal, y ahí ITP borra todo el almacenamiento a los 7 días sin uso.
 * - `desconocido`: el navegador no implementa la API. No afirmamos nada.
 */
export type EstadoPersistencia = 'persistente' | 'efimero' | 'desconocido';

/**
 * Se pedía `navigator.storage.persist()` y se tiraba el resultado.
 *
 * El pedido está bien; descartar la respuesta no: es la única señal de que la app está
 * parada sobre almacenamiento que el navegador puede vaciar, y el usuario no tenía forma
 * de enterarse hasta que ya no estaban los datos. Ahora el veredicto se publica y las
 * pantallas de backup lo dicen.
 */
export const persistencia = writable<EstadoPersistencia>('desconocido');

export async function consultarPersistencia(): Promise<EstadoPersistencia> {
	const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
	if (!storage?.persist || !storage.persisted) return 'desconocido';
	try {
		// Preguntar primero evita volver a pedir permiso en los navegadores donde
		// `persist()` es un prompt: si ya está concedido, no hay nada que pedir.
		if (await storage.persisted()) return 'persistente';
		return (await storage.persist()) ? 'persistente' : 'efimero';
	} catch (error) {
		console.error('storage.persist', error);
		return 'desconocido';
	}
}

/** Pide persistencia al arrancar y publica el veredicto. */
export async function asegurarPersistencia(): Promise<EstadoPersistencia> {
	const estado = await consultarPersistencia();
	persistencia.set(estado);
	return estado;
}

/**
 * Vuelve a mirar el veredicto SIN pedirlo de nuevo.
 *
 * Instalar la app en la pantalla de inicio suele convertir un origen efímero en
 * persistente, y esa buena noticia hay que poder verla sin recargar. Pero repetir el
 * pedido tampoco es gratis: en algunos navegadores `persist()` es un prompt, y volver a
 * abrirlo cada vez que alguien entra a Ajustes sería castigar al que ya dijo que no.
 */
export async function refrescarPersistencia(): Promise<EstadoPersistencia> {
	const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
	if (!storage?.persisted) return 'desconocido';
	try {
		const estado: EstadoPersistencia = (await storage.persisted()) ? 'persistente' : 'efimero';
		persistencia.set(estado);
		return estado;
	} catch (error) {
		console.error('storage.persisted', error);
		return 'desconocido';
	}
}
