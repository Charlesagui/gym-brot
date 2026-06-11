import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Ajustes, type Dia, type Nota, type Sesion } from './db';
import {
	AJUSTES_DEFAULT,
	exportarJSON,
	importarBackup,
	necesitaBackup,
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
		expect(
			normalizarAjustes({
				id: 'app',
				darkMode: false,
				unidad: 'kg',
				timer: { activo: false, minutos: 1 }
			} as Ajustes)
		).toEqual({
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

describe('necesitaBackup', () => {
	const ahora = new Date('2026-06-10T12:00:00');

	it('sin entrenamientos nunca recuerda', () => {
		expect(necesitaBackup(undefined, [], ahora)).toBe(false);
	});

	it('sin backup previo recuerda recien con >30 dias de historial', () => {
		expect(necesitaBackup(undefined, ['2026-06-01'], ahora)).toBe(false);
		expect(necesitaBackup(undefined, ['2026-04-01', '2026-06-01'], ahora)).toBe(true);
	});

	it('con backup reciente no recuerda aunque haya sesiones nuevas', () => {
		expect(necesitaBackup('2026-06-01T10:00:00.000Z', ['2026-06-05'], ahora)).toBe(false);
	});

	it('con backup viejo recuerda solo si hay sesiones posteriores al backup', () => {
		expect(necesitaBackup('2026-01-01T10:00:00.000Z', ['2026-03-01'], ahora)).toBe(true);
		expect(necesitaBackup('2026-01-01T10:00:00.000Z', ['2025-12-20'], ahora)).toBe(false);
	});
});
