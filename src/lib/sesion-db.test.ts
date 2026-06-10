import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import {
	addSet,
	ensureEjercicio,
	historialObs,
	hoyStr,
	marcarDiaTerminado,
	marcarPrCelebrado,
	reabrirDia,
	reanudarEjercicio,
	removeSet,
	saltarEjercicio,
	sesionHoyObs,
	sesionId,
	setExtra,
	setPeso,
	setReps,
	toggleMax,
	toggleSet,
	ultimaSesion
} from './sesion';

async function limpiarDb() {
	await db.open();
	await Promise.all([db.dias.clear(), db.sesiones.clear(), db.notas.clear(), db.ajustes.clear()]);
}

function primerValor<T>(obs: { subscribe: (next: (value: T) => void) => { unsubscribe(): void } }) {
	return new Promise<T>((resolve) => {
		const sub = obs.subscribe((value) => {
			sub.unsubscribe();
			resolve(value);
		});
	});
}

describe('sesion con IndexedDB', () => {
	beforeEach(async () => {
		vi.useRealTimers();
		await limpiarDb();
	});

	it('usa fecha local y arma ids de sesion', () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		expect(hoyStr()).toBe('2026-01-07');
		expect(sesionId('push', '2026-01-07')).toBe('2026-01-07__push');
	});

	it('inicializa, observa y muta series de forma atomica', async () => {
		await ensureEjercicio('push', 'press', 2, '2026-01-05');
		await setPeso('push', 'press', 0, 80, '2026-01-05');
		await setReps('push', 'press', 0, 10, '2026-01-05');
		await toggleMax('push', 'press', 0, '2026-01-05');
		await setExtra('push', 'press', 0, 2.5, '2026-01-05');
		await toggleSet('push', 'press', 0, '2026-01-05');
		await addSet('push', 'press', '2026-01-05');
		await removeSet('push', 'press', 2, '2026-01-05');

		const sesion = await primerValor(sesionHoyObs('push', '2026-01-05'));
		const sets = sesion?.ejercicios[0]?.sets;
		expect(sets).toEqual([
			{ peso: 80, reps: 10, hecha: true, esMax: true, extraKg: 2.5 },
			{ peso: undefined, reps: undefined, hecha: false }
		]);
	});

	it('prefill de ensureEjercicio viene de la ultima sesion distinta de la actual', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 90, '2026-01-01');
		await setReps('push', 'press', 0, 8, '2026-01-01');

		await ensureEjercicio('push', 'press', 2, '2026-01-02');

		expect(await ultimaSesion('push', 'press', '2026-01-02')).toMatchObject({
			fecha: '2026-01-01',
			sets: [{ peso: 90, reps: 8, hecha: false }]
		});
		expect((await db.sesiones.get('2026-01-02__push'))?.ejercicios[0]?.sets[0]).toEqual({
			peso: 90,
			reps: 8,
			hecha: false
		});
	});

	it('destildar una serie reabre el dia terminado', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-05');
		await toggleSet('push', 'press', 0, '2026-01-05');
		await db.sesiones.update('2026-01-05__push', {
			diaTerminado: true,
			diaTerminadoAt: '2026-01-05T20:00:00.000Z'
		});

		await toggleSet('push', 'press', 0, '2026-01-05');

		expect(await db.sesiones.get('2026-01-05__push')).toMatchObject({
			diaTerminado: false,
			diaTerminadoAt: undefined
		});
	});

	it('marca, conserva y reemplaza PR celebrado segun la metrica', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-05');
		await marcarPrCelebrado('push', 'press', { peso: 100, reps: 1 }, 'peso', '2026-01-05');
		await marcarPrCelebrado('push', 'press', { peso: 95, reps: 20 }, 'peso', '2026-01-05');
		expect((await db.sesiones.get('2026-01-05__push'))?.ejercicios[0]?.prCelebrado).toEqual({
			peso: 100,
			reps: 1,
			esMax: undefined,
			extraKg: undefined
		});

		await marcarPrCelebrado('push', 'press', { peso: 95, reps: 20 }, 'e1rm', '2026-01-05');
		expect((await db.sesiones.get('2026-01-05__push'))?.ejercicios[0]?.prCelebrado).toEqual({
			peso: 95,
			reps: 20,
			esMax: undefined,
			extraKg: undefined
		});
	});

	it('historialObs devuelve el mejor set hecho por fecha', async () => {
		await ensureEjercicio('push', 'press', 2, '2026-01-01');
		await setPeso('push', 'press', 0, 80, '2026-01-01');
		await setPeso('push', 'press', 1, 90, '2026-01-01');
		await setReps('push', 'press', 0, 12, '2026-01-01');
		await setReps('push', 'press', 1, 5, '2026-01-01');
		await toggleSet('push', 'press', 0, '2026-01-01');
		await toggleSet('push', 'press', 1, '2026-01-01');

		const puntos = await primerValor(historialObs('press', 'peso'));
		expect(puntos).toEqual([
			{ peso: 90, reps: 5, esMax: false, extraKg: undefined, fecha: '2026-01-01', valor: 90 }
		]);
	});

	it('saltar, reanudar, terminar y reabrir dia actual', async () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));

		await saltarEjercicio('push', 'press', 2);
		expect((await db.sesiones.get('2026-01-07__push'))?.ejercicios[0]?.saltado).toBe(true);

		await reanudarEjercicio('push', 'press');
		expect((await db.sesiones.get('2026-01-07__push'))?.ejercicios[0]?.saltado).toBe(false);

		await marcarDiaTerminado('push');
		expect((await db.sesiones.get('2026-01-07__push'))?.diaTerminado).toBe(true);

		await reabrirDia('push');
		expect(await db.sesiones.get('2026-01-07__push')).toMatchObject({
			diaTerminado: false,
			diaTerminadoAt: undefined
		});
	});
});
