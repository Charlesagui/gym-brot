import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { normalizarAjustes } from './extras';
import { seedSiVacio } from './seed';

async function limpiarDb() {
	await db.open();
	await Promise.all([db.dias.clear(), db.sesiones.clear(), db.notas.clear(), db.ajustes.clear()]);
}

describe('seedSiVacio', () => {
	beforeEach(async () => {
		await limpiarDb();
	});

	it('crea rutinas de ejemplo solo en el primer arranque', async () => {
		await seedSiVacio();

		expect(await db.dias.count()).toBeGreaterThan(0);
		expect(normalizarAjustes(await db.ajustes.get('app')).seedInicialHecho).toBe(true);
	});

	it('no recrea rutinas si el usuario ya paso por el seed y borro todo', async () => {
		await db.ajustes.put({ ...normalizarAjustes(), seedInicialHecho: true });

		await seedSiVacio();

		expect(await db.dias.count()).toBe(0);
	});

	it('marca el seed como hecho en usuarios existentes sin duplicar rutinas', async () => {
		await db.dias.put({
			id: 'custom',
			nombre: 'Custom',
			orden: 0,
			ejercicios: []
		});

		await seedSiVacio();

		expect(await db.dias.count()).toBe(1);
		expect(normalizarAjustes(await db.ajustes.get('app')).seedInicialHecho).toBe(true);
	});
});
