import { writable } from 'svelte/store';

/**
 * Último fallo de persistencia que necesita ver el usuario.
 *
 * La app es local-first: si una escritura falla no existe un servidor que la
 * recupere después. Este aviso global evita que un control parezca guardado
 * cuando IndexedDB rechazó el cambio.
 */
export const errorDatos = writable<string | null>(null);

export function reportarErrorDatos(mensaje: string, error: unknown): void {
	console.error(mensaje, error);
	errorDatos.set(mensaje);
}

/** Ejecuta una escritura no bloqueante, pero nunca silenciosa. */
export function guardarSinBloquear(operacion: Promise<unknown>, mensaje: string): void {
	void operacion.catch((error: unknown) => reportarErrorDatos(mensaje, error));
}
