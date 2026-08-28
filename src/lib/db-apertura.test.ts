import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { abrirBase, db } from './db';

afterEach(async () => {
	vi.restoreAllMocks();
	db.close({ disableAutoOpen: false });
	await db.open();
});

/** Los fallos de IndexedDB llegan como `Error` con `name`; el nombre es lo que decide. */
function fallo(name: string): Error {
	return Object.assign(new Error(`falla simulada: ${name}`), { name });
}

describe('abrirBase', () => {
	it('reintenta un fallo pasajero en vez de mandar a la pantalla destructiva', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const abrir = vi.spyOn(db, 'open');
		abrir.mockRejectedValueOnce(fallo('UnknownError'));

		// El segundo intento entra por la implementación real y abre bien.
		await expect(abrirBase()).resolves.toBe(2);
		expect(abrir).toHaveBeenCalledTimes(2);
	});

	it('insiste dos veces y después sí acepta que el fallo es real', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const abrir = vi.spyOn(db, 'open').mockRejectedValue(fallo('UnknownError'));

		await expect(abrirBase()).rejects.toThrow('falla simulada');
		expect(abrir).toHaveBeenCalledTimes(3);
	});

	it('no reintenta lo que no puede cambiar: una base más nueva que el código', async () => {
		const abrir = vi.spyOn(db, 'open').mockRejectedValue(fallo('VersionError'));

		await expect(abrirBase()).rejects.toThrow('falla simulada');
		// Insistir con VersionError solo demora el mensaje correcto.
		expect(abrir).toHaveBeenCalledTimes(1);
	});

	it('tampoco reintenta un navegador sin IndexedDB', async () => {
		const abrir = vi.spyOn(db, 'open').mockRejectedValue(fallo('MissingAPI'));

		await expect(abrirBase()).rejects.toThrow('falla simulada');
		expect(abrir).toHaveBeenCalledTimes(1);
	});
});
