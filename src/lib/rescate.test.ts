import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, guardarSesion } from './db';
import { rescatarDatosCrudos, RescateVacioError, resumenRescate } from './rescate';
import { parseBackup } from './extras';

async function limpiarDb() {
	await db.open();
	await Promise.all([
		db.dias.clear(),
		db.sesiones.clear(),
		db.notas.clear(),
		db.ajustes.clear(),
		db.pesosCorporales.clear(),
		db.objetivosEnergia.clear()
	]);
}

describe('rescate de datos crudos', () => {
	beforeEach(async () => {
		await limpiarDb();
	});

	it('lee el historial sin pasar por Dexie y devuelve un backup restaurable', async () => {
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 2, orden: 0 }]
		});
		await guardarSesion({
			id: '2026-08-27__push',
			fecha: '2026-08-27',
			diaId: 'push',
			ejercicios: [{ exerciseId: 'press', sets: [{ hecha: true, reps: 10, peso: 80 }] }]
		});
		await db.notas.add({ exerciseId: 'press', texto: 'codos adentro' });
		// La app tiene que soltar la conexión: el rescate abre por su cuenta.
		db.close();

		const rescate = await rescatarDatosCrudos();

		expect(rescate.total).toBe(3);
		expect(rescate.filas).toMatchObject({ dias: 1, sesiones: 1, notas: 1 });
		const backup = parseBackup(rescate.json);
		expect(backup.sesiones?.[0]?.ejercicios[0]?.sets[0]).toEqual({
			hecha: true,
			reps: 10,
			peso: 80
		});
		expect(backup.dias?.[0]?.nombre).toBe('Push');
		// `exerciseIds` es índice derivado: no viaja, igual que en el backup normal.
		expect(backup.sesiones?.[0]).not.toHaveProperty('exerciseIds');
	});

	it('una base vacía se reporta como vacía, no como rescate', async () => {
		db.close();
		const rescate = await rescatarDatosCrudos();
		expect(rescate.total).toBe(0);
	});

	it('no crea una base de regalo cuando no existe ninguna', async () => {
		db.close();
		await expect(rescatarDatosCrudos('gym-brot-que-no-existe')).rejects.toBeInstanceOf(
			RescateVacioError
		);
		// Abortar el upgrade tiene que dejar el navegador como estaba.
		const bases = await indexedDB.databases();
		expect(bases.map((b) => b.name)).not.toContain('gym-brot-que-no-existe');
	});

	it('un esquema viejo sin todas las tablas se rescata igual', async () => {
		db.close();
		// Base cruda al estilo v1: sólo dos tablas, y una que el backup ni conoce.
		await new Promise<void>((listo, falla) => {
			const pedido = indexedDB.open('gym-brot-viejo', 1);
			pedido.onupgradeneeded = () => {
				const cruda = pedido.result;
				cruda.createObjectStore('dias', { keyPath: 'id' });
				cruda.createObjectStore('registros', { keyPath: 'id' });
			};
			pedido.onerror = () => falla(pedido.error);
			pedido.onsuccess = () => {
				const tx = pedido.result.transaction('dias', 'readwrite');
				tx.objectStore('dias').add({ id: 'push', nombre: 'Push', orden: 0, ejercicios: [] });
				tx.oncomplete = () => {
					pedido.result.close();
					listo();
				};
				tx.onerror = () => falla(tx.error);
			};
		});

		const rescate = await rescatarDatosCrudos('gym-brot-viejo');
		expect(rescate.filas).toEqual({ dias: 1 });
		// `registros` salió del esquema en la v2: no viaja, pero tampoco rompe el rescate.
		const backup = parseBackup(rescate.json);
		expect(backup.dias).toHaveLength(1);
		expect(backup.sesiones).toEqual([]);
	});
});

describe('resumenRescate', () => {
	it('nombra solo lo que hay, en singular o plural', () => {
		expect(resumenRescate({ dias: 1, sesiones: 12, notas: 0 })).toBe(
			'1 rutina · 12 entrenamientos'
		);
		expect(resumenRescate({})).toBe('');
	});
});
