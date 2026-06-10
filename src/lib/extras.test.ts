import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Ajustes, type Dia, type Nota, type Sesion } from './db';
import {
	AJUSTES_DEFAULT,
	exportarJSON,
	importarBackup,
	normalizarAjustes,
	parseBackup,
	setUnidad
} from './extras';

const dia: Dia = {
	id: 'push',
	nombre: 'Push',
	color: '255 122 92',
	diaSemana: 1,
	orden: 1,
	ejercicios: [{ exerciseId: 'press', seriesObjetivo: 3, orden: 1 }]
};

const sesion: Sesion = {
	id: '2026-01-05__push',
	fecha: '2026-01-05',
	diaId: 'push',
	diaTerminado: true,
	diaTerminadoAt: '2026-01-05T20:00:00.000Z',
	ejercicios: [
		{
			exerciseId: 'press',
			prCelebrado: { peso: 100, reps: 6, esMax: true, extraKg: 5 },
			sets: [
				{ peso: 80, reps: 10, hecha: true },
				{ peso: 100, reps: 6, hecha: true, esMax: true, extraKg: 5 }
			]
		}
	]
};

const nota: Nota = { exerciseId: 'press', texto: 'Banco en 4' };

const ajustes: Ajustes = {
	...AJUSTES_DEFAULT,
	unidad: 'kg',
	pasoPeso: 2.5
};

async function limpiarDb() {
	await db.open();
	await Promise.all([db.dias.clear(), db.sesiones.clear(), db.notas.clear(), db.ajustes.clear()]);
}

describe('normalizarAjustes', () => {
	it('rellena defaults de campos faltantes', () => {
		expect(normalizarAjustes({ id: 'app', darkMode: false, unidad: 'kg', timer: { activo: false, minutos: 1 } } as Ajustes)).toEqual({
			...AJUSTES_DEFAULT,
			darkMode: false,
			unidad: 'kg',
			timer: { activo: false, minutos: 1 }
		});
	});
});

describe('backup', () => {
	beforeEach(async () => {
		await limpiarDb();
	});

	it('exportarJSON -> parseBackup -> importarBackup reproduce los datos', async () => {
		await db.dias.put(dia);
		await db.sesiones.put(sesion);
		await db.notas.put(nota);
		await db.ajustes.put(ajustes);

		const backup = parseBackup(await exportarJSON());
		await limpiarDb();
		await importarBackup(backup);

		expect(await db.dias.toArray()).toEqual([dia]);
		expect(await db.sesiones.toArray()).toEqual([sesion]);
		expect(await db.notas.toArray()).toEqual([nota]);
		expect(await db.ajustes.toArray()).toEqual([ajustes]);
	});

	it('setUnidad lb -> kg conserva pesos con redondeo a 1 decimal', async () => {
		await db.sesiones.put(structuredClone(sesion));
		await db.ajustes.put(ajustes);

		await setUnidad('lb');
		await setUnidad('kg');

		const vuelta = await db.sesiones.get(sesion.id);
		expect(vuelta?.ejercicios[0]?.sets[0]?.peso).toBeCloseTo(80, 1);
		expect(vuelta?.ejercicios[0]?.sets[1]?.peso).toBeCloseTo(100, 1);
		expect(vuelta?.ejercicios[0]?.sets[1]?.extraKg).toBeCloseTo(5, 1);
		expect(vuelta?.ejercicios[0]?.prCelebrado?.peso).toBeCloseTo(100, 1);
		expect(vuelta?.ejercicios[0]?.prCelebrado?.extraKg).toBeCloseTo(5, 1);
	});

	it('parseBackup rechaza JSON malformado o ajeno y tolera prPesoCelebrado legacy', () => {
		expect(() => parseBackup('{')).toThrow();
		expect(() => parseBackup(JSON.stringify({ app: 'otra-app' }))).toThrow();
		expect(() =>
			parseBackup(
				JSON.stringify({
					app: 'gym-brot',
					dias: [dia],
					sesiones: [
						{
							...sesion,
							ejercicios: [{ ...sesion.ejercicios[0], prPesoCelebrado: 100 }]
						}
					],
					notas: [nota],
					ajustes: [ajustes]
				})
			)
		).not.toThrow();
	});
});
