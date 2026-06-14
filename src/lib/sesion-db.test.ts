import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import {
	addSet,
	actualizarSetHistorial,
	borrarSetHistorial,
	ensureEjercicio,
	historialObs,
	hoyStr,
	marcarDiaTerminado,
	marcarPrCelebrado,
	reabrirDia,
	reanudarEjercicio,
	recordsGlobalesObs,
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
import { resumenDiaSesion } from './historial';

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
			{
				peso: 90,
				reps: 5,
				esMax: false,
				extraKg: undefined,
				fecha: '2026-01-01',
				valor: 90,
				sesionId: '2026-01-01__push',
				setIndex: 1
			}
		]);
	});

	it('recordsGlobalesObs devuelve el PR vigente de cada ejercicio entrenado', async () => {
		await ensureEjercicio('push', 'press', 2, '2026-01-01');
		await setPeso('push', 'press', 0, 80, '2026-01-01');
		await setReps('push', 'press', 0, 10, '2026-01-01');
		await setPeso('push', 'press', 1, 90, '2026-01-01');
		await setReps('push', 'press', 1, 3, '2026-01-01');
		await toggleSet('push', 'press', 0, '2026-01-01', 'e1rm');
		await toggleSet('push', 'press', 1, '2026-01-01', 'e1rm');

		await ensureEjercicio('pull', 'remo', 1, '2026-01-02');
		await setPeso('pull', 'remo', 0, 70, '2026-01-02');
		await setReps('pull', 'remo', 0, 8, '2026-01-02');
		await toggleSet('pull', 'remo', 0, '2026-01-02', 'e1rm');

		// Récord más reciente primero: el remo (2/1) aparece antes que el press (1/1).
		expect(await primerValor(recordsGlobalesObs('e1rm'))).toEqual([
			{
				exerciseId: 'remo',
				peso: 70,
				reps: 8,
				esMax: false,
				extraKg: undefined,
				fecha: '2026-01-02',
				valor: 88.66666666666666,
				sesionId: '2026-01-02__pull',
				setIndex: 0,
				modo: 'peso'
			},
			{
				exerciseId: 'press',
				peso: 80,
				reps: 10,
				esMax: false,
				extraKg: undefined,
				fecha: '2026-01-01',
				valor: 106.66666666666666,
				sesionId: '2026-01-01__push',
				setIndex: 0,
				modo: 'peso'
			}
		]);
	});

	it('ejercicio sin peso (bodyweight) puntua por reps: PR, historial y record en modo reps', async () => {
		await ensureEjercicio('pull', 'dominadas', 2, '2026-01-01');
		await setReps('pull', 'dominadas', 0, 8, '2026-01-01');
		await setReps('pull', 'dominadas', 1, 10, '2026-01-01');
		await toggleSet('pull', 'dominadas', 0, '2026-01-01');
		await toggleSet('pull', 'dominadas', 1, '2026-01-01');

		// La metrica de ajustes (peso/e1rm) no cambia el valor: son reps.
		for (const metrica of ['peso', 'e1rm'] as const) {
			const puntos = await primerValor(historialObs('dominadas', metrica));
			expect(puntos).toEqual([
				{
					peso: undefined,
					reps: 10,
					esMax: false,
					extraKg: undefined,
					fecha: '2026-01-01',
					valor: 10,
					sesionId: '2026-01-01__pull',
					setIndex: 1
				}
			]);
		}

		expect(await primerValor(recordsGlobalesObs('peso'))).toEqual([
			{
				exerciseId: 'dominadas',
				peso: undefined,
				reps: 10,
				esMax: false,
				extraKg: undefined,
				fecha: '2026-01-01',
				valor: 10,
				sesionId: '2026-01-01__pull',
				setIndex: 1,
				modo: 'reps'
			}
		]);
	});

	it('historial mixto: con algun set con peso, las series sin peso no puntuan', async () => {
		await ensureEjercicio('pull', 'dominadas', 1, '2026-01-01');
		await setReps('pull', 'dominadas', 0, 12, '2026-01-01');
		await toggleSet('pull', 'dominadas', 0, '2026-01-01');

		// Aparece el lastre: el ejercicio pasa a modo peso en todo su historial.
		await ensureEjercicio('pull', 'dominadas', 1, '2026-01-02');
		await setPeso('pull', 'dominadas', 0, 10, '2026-01-02');
		await setReps('pull', 'dominadas', 0, 6, '2026-01-02');
		await toggleSet('pull', 'dominadas', 0, '2026-01-02');

		const puntos = await primerValor(historialObs('dominadas', 'peso'));
		expect(puntos).toEqual([
			{
				peso: 10,
				reps: 6,
				esMax: false,
				extraKg: undefined,
				fecha: '2026-01-02',
				valor: 10,
				sesionId: '2026-01-02__pull',
				setIndex: 0
			}
		]);
	});

	it('edita y borra una serie historica recalculando el historial', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await toggleSet('push', 'press', 0, '2026-01-01', 'peso');
		await marcarPrCelebrado('push', 'press', { peso: 100, reps: 5 }, 'peso', '2026-01-01');

		await actualizarSetHistorial(
			'2026-01-01__push',
			'press',
			0,
			{ peso: 90, reps: 6, esMax: false },
			'peso'
		);

		expect((await primerValor(historialObs('press', 'peso')))[0]).toMatchObject({
			peso: 90,
			reps: 6,
			valor: 90
		});
		expect((await db.sesiones.get('2026-01-01__push'))?.ejercicios[0]?.prCelebrado).toMatchObject({
			peso: 90,
			reps: 6
		});

		await borrarSetHistorial('2026-01-01__push', 'press', 0, 'peso');

		expect(await primerValor(historialObs('press', 'peso'))).toEqual([]);
		expect((await db.sesiones.get('2026-01-01__push'))?.ejercicios[0]?.prCelebrado).toBeUndefined();
	});

	it('editar una serie activa recalcula el PR celebrado de la sesion', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await toggleSet('push', 'press', 0, '2026-01-01', 'peso');

		await ensureEjercicio('push', 'press', 1, '2026-01-02');
		await setPeso('push', 'press', 0, 110, '2026-01-02');
		await toggleSet('push', 'press', 0, '2026-01-02', 'peso');
		await marcarPrCelebrado('push', 'press', { peso: 110 }, 'peso', '2026-01-02');

		await setPeso('push', 'press', 0, 95, '2026-01-02', 'peso');

		const actual = await db.sesiones.get('2026-01-02__push');
		expect(actual?.ejercicios[0]?.prCelebrado).toBeUndefined();
		expect(resumenDiaSesion(actual).prs).toHaveLength(0);
		expect(await primerValor(historialObs('press', 'peso'))).toEqual([
			{
				peso: 100,
				reps: undefined,
				esMax: false,
				extraKg: undefined,
				fecha: '2026-01-01',
				valor: 100,
				sesionId: '2026-01-01__push',
				setIndex: 0
			},
			{
				peso: 95,
				reps: undefined,
				esMax: false,
				extraKg: undefined,
				fecha: '2026-01-02',
				valor: 95,
				sesionId: '2026-01-02__push',
				setIndex: 0
			}
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

	it('reanudar un ejercicio saltado reabre un dia terminado', async () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));

		await saltarEjercicio('push', 'press', 2);
		await marcarDiaTerminado('push');

		await reanudarEjercicio('push', 'press');

		expect(await db.sesiones.get('2026-01-07__push')).toMatchObject({
			diaTerminado: false,
			diaTerminadoAt: undefined,
			ejercicios: [{ exerciseId: 'press', saltado: false }]
		});
	});

	it('destildar el set del PR limpia el resumen y conserva el historial real', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await toggleSet('push', 'press', 0, '2026-01-01', 'peso');

		await ensureEjercicio('push', 'press', 1, '2026-01-02');
		await setPeso('push', 'press', 0, 110, '2026-01-02');
		await setReps('push', 'press', 0, 5, '2026-01-02');
		await toggleSet('push', 'press', 0, '2026-01-02', 'peso');
		await marcarPrCelebrado('push', 'press', { peso: 110, reps: 5 }, 'peso', '2026-01-02');

		await toggleSet('push', 'press', 0, '2026-01-02', 'peso');

		const actual = await db.sesiones.get('2026-01-02__push');
		expect(actual?.ejercicios[0]?.prCelebrado).toBeUndefined();
		expect(resumenDiaSesion(actual).prs).toHaveLength(0);
		expect(await primerValor(historialObs('press', 'peso'))).toEqual([
			{
				peso: 100,
				reps: 5,
				esMax: false,
				extraKg: undefined,
				fecha: '2026-01-01',
				valor: 100,
				sesionId: '2026-01-01__push',
				setIndex: 0
			}
		]);
	});

	it('destildar el set del PR recalcula el umbral con otra serie hecha que supera el historial previo', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await toggleSet('push', 'press', 0, '2026-01-01', 'peso');

		await ensureEjercicio('push', 'press', 2, '2026-01-02');
		await setPeso('push', 'press', 0, 110, '2026-01-02');
		await setPeso('push', 'press', 1, 105, '2026-01-02');
		await toggleSet('push', 'press', 0, '2026-01-02', 'peso');
		await toggleSet('push', 'press', 1, '2026-01-02', 'peso');
		await marcarPrCelebrado('push', 'press', { peso: 110 }, 'peso', '2026-01-02');

		await toggleSet('push', 'press', 0, '2026-01-02', 'peso');

		expect((await db.sesiones.get('2026-01-02__push'))?.ejercicios[0]?.prCelebrado).toEqual({
			peso: 105,
			reps: undefined,
			esMax: false,
			extraKg: undefined
		});
	});

	it('destildar un empate no borra el PR si otra serie hecha lo respalda', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await toggleSet('push', 'press', 0, '2026-01-01', 'peso');

		await ensureEjercicio('push', 'press', 2, '2026-01-02');
		await setPeso('push', 'press', 0, 110, '2026-01-02');
		await setPeso('push', 'press', 1, 110, '2026-01-02');
		await toggleSet('push', 'press', 0, '2026-01-02', 'peso');
		await toggleSet('push', 'press', 1, '2026-01-02', 'peso');
		await marcarPrCelebrado('push', 'press', { peso: 110 }, 'peso', '2026-01-02');

		await toggleSet('push', 'press', 0, '2026-01-02', 'peso');

		expect((await db.sesiones.get('2026-01-02__push'))?.ejercicios[0]?.prCelebrado).toEqual({
			peso: 110,
			reps: undefined,
			esMax: false,
			extraKg: undefined
		});
	});
});
