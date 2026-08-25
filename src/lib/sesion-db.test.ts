import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conIndice, db } from './db';
import {
	addSet,
	actualizarSetHistorial,
	borrarSetHistorial,
	ensureEjercicio,
	ejercicioSesionObs,
	historialObs,
	historialPorModo,
	hoyStr,
	marcarDiaTerminado,
	prepararEjercicioSesion,
	registrarPrSiSupera,
	reabrirDia,
	reanudarEjercicio,
	recordsGlobalesObs,
	removeSet,
	setSerieHecha,
	saltarEjercicio,
	sesionHoyObs,
	sesionesDe,
	sesionId,
	setExtra,
	setPeso,
	setReps,
	setRir,
	toggleMax,
	ultimaSesion
} from './sesion';
import { resumenDiaSesion, rachaSemanalActual } from './historial';
import { agregarEjercicio } from './dias';
import { decidirRecomendacionDoble, setProgresionDoble } from './dias';

async function limpiarDb() {
	await db.open();
	await Promise.all([
		db.dias.clear(),
		db.sesiones.clear(),
		db.notas.clear(),
		db.ajustes.clear(),
		db.pesosCorporales.clear()
	]);
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
		await setSerieHecha('push', 'press', 0, true, '2026-01-05');
		await addSet('push', 'press', '2026-01-05');
		await removeSet('push', 'press', 2, '2026-01-05');

		const sesion = await primerValor(ejercicioSesionObs('push', 'press', '2026-01-05'));
		const sets = sesion.sets;
		expect(sets).toEqual([
			{ peso: 80, reps: 10, hecha: true, esMax: true, extraKg: 2.5 },
			{ peso: undefined, reps: undefined, hecha: false }
		]);
	});

	it('rechaza pesos negativos y repeticiones fraccionarias en la frontera de datos', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-05');
		await expect(setPeso('push', 'press', 0, -1, '2026-01-05')).rejects.toThrow('no negativo');
		await expect(setReps('push', 'press', 0, 1.5, '2026-01-05')).rejects.toThrow('entero positivo');
	});

	it('prepara el ejercicio desde la rutina y expone solo el estado que consume la UI', async () => {
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 2, orden: 0 }]
		});

		const preparacion = await prepararEjercicioSesion('push', 'press', '2026-01-05');
		const estado = await primerValor(ejercicioSesionObs('push', 'press', '2026-01-05'));

		expect(preparacion).toEqual({ disponible: true, anteriores: [], anterioresFecha: null });
		expect(estado).toEqual({
			sets: [{ hecha: false }, { hecha: false }],
			prCelebrado: null
		});
	});

	it('aplica una recomendación aceptada una sola vez sin modificar el pasado', async () => {
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 2, orden: 0 }]
		});
		await setProgresionDoble('push', 'press', { activa: true, repsMin: 8, repsMax: 12 });
		await prepararEjercicioSesion('push', 'press', '2026-01-05');
		for (const indice of [0, 1]) {
			await setPeso('push', 'press', indice, 80, '2026-01-05');
			await setReps('push', 'press', indice, 12, '2026-01-05');
			await setSerieHecha('push', 'press', indice, true, '2026-01-05');
		}
		const pasada = structuredClone(await db.sesiones.get('2026-01-05__push'));

		await decidirRecomendacionDoble(
			'push',
			'press',
			{
				sesionId: '2026-01-05__push',
				seriesEvaluadas: 2,
				repsMax: 12,
				incrementoGramos: 2_500,
				pesoActualGramos: 80_000,
				pesoObjetivoGramos: 82_500,
				esMax: false,
				extraActualGramos: 0,
				extraObjetivoGramos: 0,
				explicacion: 'Dos series en el techo.'
			},
			'aceptada'
		);

		await prepararEjercicioSesion('push', 'press', '2026-01-12');
		expect((await db.sesiones.get('2026-01-12__push'))?.ejercicios[0]?.sets).toEqual([
			{ peso: 82.5, pesoGramos: 82_500, reps: 8, hecha: false },
			{ peso: 82.5, pesoGramos: 82_500, reps: 8, hecha: false }
		]);
		expect(await db.sesiones.get('2026-01-05__push')).toEqual(pasada);
		expect((await db.dias.get('push'))?.ejercicios[0]?.progresion).not.toHaveProperty(
			'proximoPesoGramos'
		);

		await prepararEjercicioSesion('push', 'press', '2026-01-19');
		expect((await db.sesiones.get('2026-01-19__push'))?.ejercicios[0]?.sets[0]).toMatchObject({
			peso: 80,
			reps: 12,
			hecha: false
		});
	});

	it('no crea una sesión si la rutina o el ejercicio ya no existen', async () => {
		expect(await prepararEjercicioSesion('push', 'press', '2026-01-05')).toEqual({
			disponible: false
		});
		expect(await db.sesiones.count()).toBe(0);

		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'fondos', seriesObjetivo: 3, orden: 0 }]
		});
		expect(await prepararEjercicioSesion('push', 'press', '2026-01-05')).toEqual({
			disponible: false
		});
		expect(await db.sesiones.count()).toBe(0);
	});

	it('no permite confirmar una serie sin repeticiones', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-05');
		expect(await setSerieHecha('push', 'press', 0, true, '2026-01-05')).toMatchObject({
			encontrada: true,
			hecha: false,
			cambio: false
		});
		expect((await db.sesiones.get('2026-01-05__push'))?.ejercicios[0]?.sets[0]?.hecha).toBe(false);
	});

	it('borrar las reps de una serie hecha la desmarca, reabre el día y limpia su PR', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-05');
		await setPeso('push', 'press', 0, 100, '2026-01-05');
		await setReps('push', 'press', 0, 5, '2026-01-05');
		await setSerieHecha('push', 'press', 0, true, '2026-01-05');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-05');
		await db.sesiones.update('2026-01-05__push', {
			diaTerminado: true,
			diaTerminadoAt: '2026-01-05T20:00:00.000Z'
		});

		await setReps('push', 'press', 0, undefined, '2026-01-05');

		expect(await db.sesiones.get('2026-01-05__push')).toMatchObject({
			diaTerminado: false,
			diaTerminadoAt: undefined,
			ejercicios: [{ sets: [{ reps: undefined, hecha: false }], prCelebrado: undefined }]
		});
	});

	it('no crea una sesión al saltar un ejercicio que ya no está en la rutina', async () => {
		expect(await saltarEjercicio('push', 'press', '2026-01-05')).toBe(false);
		expect(await db.sesiones.count()).toBe(0);
	});

	it('el indice por ejercicio se mantiene al sumar ejercicios a la sesion', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-05');
		expect((await db.sesiones.get('2026-01-05__push'))?.exerciseIds).toEqual(['press']);

		await ensureEjercicio('push', 'fondos', 1, '2026-01-05');

		expect((await db.sesiones.get('2026-01-05__push'))?.exerciseIds).toEqual(['press', 'fondos']);
		// La consulta por índice, que es lo que realmente usan historial y PR.
		expect((await sesionesDe('fondos')).map((s) => s.id)).toEqual(['2026-01-05__push']);
		expect(await sesionesDe('sentadilla')).toEqual([]);
	});

	it('asigna órdenes únicos a dos sesiones creadas concurrentemente el mismo día', async () => {
		await Promise.all([
			ensureEjercicio('rutina-a', 'press', 1, '2026-01-05'),
			ensureEjercicio('rutina-b', 'remo', 1, '2026-01-05')
		]);

		const ordenes = (await db.sesiones.where('fecha').equals('2026-01-05').toArray())
			.map((sesion) => sesion.ordenEnDia)
			.sort();
		expect(ordenes).toEqual([0, 1]);
	});

	it('una serie marcada aparece en el historial del ejercicio recien agregado', async () => {
		// Sin índice al día, este ejercicio quedaría fuera del historial y del PR.
		await ensureEjercicio('push', 'press', 1, '2026-01-05');
		await ensureEjercicio('push', 'fondos', 1, '2026-01-05');
		await setPeso('push', 'fondos', 0, 60, '2026-01-05');
		await setReps('push', 'fondos', 0, 8, '2026-01-05');
		await setSerieHecha('push', 'fondos', 0, true, '2026-01-05');

		expect(await primerValor(historialObs('fondos', 'peso'))).toMatchObject([{ valor: 60 }]);
		expect(await registrarPrSiSupera('push', 'fondos', 0, 'peso', '2026-01-05')).toMatchObject({
			valor: 60
		});
	});

	it('prefill de ensureEjercicio viene de la ultima sesion distinta de la actual', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 90, '2026-01-01');
		await setReps('push', 'press', 0, 8, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');

		await ensureEjercicio('push', 'press', 2, '2026-01-02');

		expect(await ultimaSesion('push', 'press', '2026-01-02')).toMatchObject({
			fecha: '2026-01-01',
			sets: [{ peso: 90, reps: 8, hecha: true }]
		});
		expect((await db.sesiones.get('2026-01-02__push'))?.ejercicios[0]?.sets[0]).toMatchObject({
			peso: 90,
			pesoGramos: 90_000,
			reps: 8,
			hecha: false
		});
	});

	it('ignora sesiones futuras e incompletas al buscar el anterior', async () => {
		await ensureEjercicio('push', 'press', 2, '2026-01-01');
		await setPeso('push', 'press', 0, 90, '2026-01-01');
		await setReps('push', 'press', 0, 8, '2026-01-01');
		await setPeso('push', 'press', 1, 100, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await ensureEjercicio('pull', 'press', 1, '2026-01-10');
		await setPeso('pull', 'press', 0, 120, '2026-01-10');
		await setSerieHecha('pull', 'press', 0, true, '2026-01-10');

		expect(await ultimaSesion('legs', 'press', '2026-01-05')).toEqual({
			fecha: '2026-01-01',
			sets: [{ peso: 90, reps: 8, hecha: true }, { hecha: false }]
		});
	});

	it('mantiene el historial de reps separado al empezar a usar lastre', async () => {
		await ensureEjercicio('push', 'dominadas', 1, '2026-01-01');
		await setReps('push', 'dominadas', 0, 12, '2026-01-01');
		await setSerieHecha('push', 'dominadas', 0, true, '2026-01-01');
		await ensureEjercicio('push', 'dominadas', 1, '2026-01-02');
		await setPeso('push', 'dominadas', 0, 10, '2026-01-02');
		await setReps('push', 'dominadas', 0, 8, '2026-01-02');
		await setSerieHecha('push', 'dominadas', 0, true, '2026-01-02');

		const sesiones = await sesionesDe('dominadas');
		expect(historialPorModo(sesiones, 'dominadas', 'peso', 'reps')).toMatchObject([
			{ fecha: '2026-01-01', valor: 12 }
		]);
		expect(historialPorModo(sesiones, 'dominadas', 'peso', 'peso')).toMatchObject([
			{ fecha: '2026-01-02', valor: 10 }
		]);
	});

	it('destildar una serie reabre el dia terminado', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-05');
		await setReps('push', 'press', 0, 10, '2026-01-05');
		await setSerieHecha('push', 'press', 0, true, '2026-01-05');
		await db.sesiones.update('2026-01-05__push', {
			diaTerminado: true,
			diaTerminadoAt: '2026-01-05T20:00:00.000Z'
		});

		await setSerieHecha('push', 'press', 0, false, '2026-01-05');

		expect(await db.sesiones.get('2026-01-05__push')).toMatchObject({
			diaTerminado: false,
			diaTerminadoAt: undefined
		});
	});

	it('fija una serie de forma idempotente ante dobles toques', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-05');
		await setReps('push', 'press', 0, 10, '2026-01-05');

		const resultados = await Promise.all([
			setSerieHecha('push', 'press', 0, true, '2026-01-05'),
			setSerieHecha('push', 'press', 0, true, '2026-01-05')
		]);

		expect((await db.sesiones.get('2026-01-05__push'))?.ejercicios[0]?.sets[0]?.hecha).toBe(true);
		expect(resultados.filter((resultado) => resultado.cambio)).toHaveLength(1);
		expect(resultados.every((resultado) => resultado.hecha === true)).toBe(true);
	});

	it('marcar una serie reanuda automáticamente un ejercicio saltado', async () => {
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 1, orden: 0 }]
		});
		await saltarEjercicio('push', 'press', '2026-01-05');
		await setReps('push', 'press', 0, 10, '2026-01-05');

		await setSerieHecha('push', 'press', 0, true, '2026-01-05');

		expect((await db.sesiones.get('2026-01-05__push'))?.ejercicios[0]).toMatchObject({
			saltado: false,
			sets: [{ hecha: true }]
		});
	});

	it('registra el PR solo cuando la serie supera lo previo y lo ya celebrado', async () => {
		await ensureEjercicio('push', 'press', 2, '2026-01-05');
		await setPeso('push', 'press', 0, 100, '2026-01-05');
		await setReps('push', 'press', 0, 1, '2026-01-05');
		await setSerieHecha('push', 'press', 0, true, '2026-01-05');

		expect(await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-05')).toMatchObject({
			valor: 100,
			setIndex: 0
		});
		expect((await db.sesiones.get('2026-01-05__push'))?.ejercicios[0]?.prCelebrado).toMatchObject({
			peso: 100,
			pesoGramos: 100_000,
			reps: 1,
			esMax: false,
			extraKg: undefined,
			setIndex: 0,
			metrica: 'peso'
		});

		// Una serie más liviana no vuelve a celebrar (el flash duplicado del bug viejo).
		await setPeso('push', 'press', 1, 95, '2026-01-05');
		await setReps('push', 'press', 1, 20, '2026-01-05');
		await setSerieHecha('push', 'press', 1, true, '2026-01-05');
		expect(await registrarPrSiSupera('push', 'press', 1, 'peso', '2026-01-05')).toBeNull();

		// Bajo 1RM estimado, 95 × 20 sí supera a 100 × 1.
		expect(await registrarPrSiSupera('push', 'press', 1, 'e1rm', '2026-01-05')).toMatchObject({
			setIndex: 1
		});
		expect((await db.sesiones.get('2026-01-05__push'))?.ejercicios[0]?.prCelebrado).toMatchObject({
			peso: 95,
			reps: 20,
			setIndex: 1,
			metrica: 'e1rm'
		});
	});

	it('ordena PRs del mismo día por creación y no por el UUID de la rutina', async () => {
		// `z-rutina` es lexicográficamente posterior, pero fue la primera sesión real.
		await ensureEjercicio('z-rutina', 'press', 1, '2026-01-05');
		await setPeso('z-rutina', 'press', 0, 100, '2026-01-05');
		await setReps('z-rutina', 'press', 0, 5, '2026-01-05');
		await setSerieHecha('z-rutina', 'press', 0, true, '2026-01-05');
		expect(await registrarPrSiSupera('z-rutina', 'press', 0, 'peso', '2026-01-05')).toMatchObject({
			valor: 100
		});

		await ensureEjercicio('a-rutina', 'press', 1, '2026-01-05');
		await setPeso('a-rutina', 'press', 0, 90, '2026-01-05');
		await setReps('a-rutina', 'press', 0, 5, '2026-01-05');
		await setSerieHecha('a-rutina', 'press', 0, true, '2026-01-05');
		expect(await registrarPrSiSupera('a-rutina', 'press', 0, 'peso', '2026-01-05')).toBeNull();

		expect((await sesionesDe('press')).map((sesion) => [sesion.diaId, sesion.ordenEnDia])).toEqual([
			['z-rutina', 0],
			['a-rutina', 1]
		]);
	});

	it('no registra PR de una serie sin marcar ni cuando el historial previo es mayor', async () => {
		// Por `conIndice`, como toda escritura real: sin el índice por ejercicio esta
		// sesión sería invisible para las consultas y el PR se celebraría de más.
		await db.sesiones.add(
			conIndice({
				id: '2026-01-01__push',
				fecha: '2026-01-01',
				diaId: 'push',
				ejercicios: [{ exerciseId: 'press', sets: [{ peso: 120, reps: 5, hecha: true }] }]
			})
		);
		await ensureEjercicio('push', 'press', 1, '2026-01-05');
		await setPeso('push', 'press', 0, 110, '2026-01-05');
		// Sin ✓ no hay récord posible.
		expect(await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-05')).toBeNull();
		await setSerieHecha('push', 'press', 0, true, '2026-01-05');
		// Marcada, pero 110 < 120 del historial.
		expect(await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-05')).toBeNull();
		expect((await db.sesiones.get('2026-01-05__push'))?.ejercicios[0]?.prCelebrado).toBeUndefined();
	});

	it('terminar el dia usa la fecha de la sesion, no el reloj', async () => {
		vi.setSystemTime(new Date('2026-01-07T23:59:30'));
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 1, orden: 0 }]
		});
		await ensureEjercicio('push', 'press', 1, '2026-01-07');
		await setReps('push', 'press', 0, 10, '2026-01-07');
		await setSerieHecha('push', 'press', 0, true, '2026-01-07');
		// Cruzamos la medianoche con la pantalla todavía apuntando al 07.
		vi.setSystemTime(new Date('2026-01-08T00:00:30'));
		await marcarDiaTerminado('push', '2026-01-07');

		expect((await db.sesiones.get('2026-01-07__push'))?.diaTerminado).toBe(true);
		// Sin sesión fantasma del día nuevo.
		expect(await db.sesiones.get('2026-01-08__push')).toBeUndefined();

		await reabrirDia('push', '2026-01-07');
		expect((await db.sesiones.get('2026-01-07__push'))?.diaTerminado).toBe(false);
		vi.useRealTimers();
	});

	it('rachaSemanalActual cuenta semanas seguidas entrenadas hasta hoy', async () => {
		vi.setSystemTime(new Date('2026-01-14T10:00:00')); // miércoles
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 1, orden: 0 }]
		});
		// Semana previa (lunes 5 de enero) y semana actual (martes 13): dos seguidas.
		await ensureEjercicio('push', 'press', 1, '2026-01-05');
		await setReps('push', 'press', 0, 10, '2026-01-05');
		await setSerieHecha('push', 'press', 0, true, '2026-01-05');
		await ensureEjercicio('push', 'press', 1, '2026-01-13');
		await setReps('push', 'press', 0, 10, '2026-01-13');
		await setSerieHecha('push', 'press', 0, true, '2026-01-13');

		expect(await rachaSemanalActual()).toBe(2);
		vi.useRealTimers();
	});

	it('historialObs devuelve el mejor set hecho por fecha', async () => {
		await ensureEjercicio('push', 'press', 2, '2026-01-01');
		await setPeso('push', 'press', 0, 80, '2026-01-01');
		await setPeso('push', 'press', 1, 90, '2026-01-01');
		await setReps('push', 'press', 0, 12, '2026-01-01');
		await setReps('push', 'press', 1, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await setSerieHecha('push', 'press', 1, true, '2026-01-01');

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
		await setSerieHecha('push', 'press', 0, true, '2026-01-01', 'e1rm');
		await setSerieHecha('push', 'press', 1, true, '2026-01-01', 'e1rm');

		await ensureEjercicio('pull', 'remo', 1, '2026-01-02');
		await setPeso('pull', 'remo', 0, 70, '2026-01-02');
		await setReps('pull', 'remo', 0, 8, '2026-01-02');
		await setSerieHecha('pull', 'remo', 0, true, '2026-01-02', 'e1rm');

		// Récord más reciente primero: el remo (2/1) aparece antes que el press (1/1).
		expect(await primerValor(recordsGlobalesObs('e1rm'))).toEqual([
			{
				exerciseId: 'remo',
				peso: 70,
				reps: 8,
				esMax: false,
				extraKg: undefined,
				fecha: '2026-01-02',
				valor: 88.7,
				sesionId: '2026-01-02__pull',
				setIndex: 0,
				modo: 'peso',
				metrica: 'e1rm'
			},
			{
				exerciseId: 'press',
				peso: 80,
				reps: 10,
				esMax: false,
				extraKg: undefined,
				fecha: '2026-01-01',
				valor: 106.7,
				sesionId: '2026-01-01__push',
				setIndex: 0,
				modo: 'peso',
				metrica: 'e1rm'
			}
		]);
	});

	it('recordsGlobalesObs aplica el override solamente al ejercicio elegido', async () => {
		await ensureEjercicio('push', 'press', 2, '2026-01-01');
		await setPeso('push', 'press', 0, 80, '2026-01-01');
		await setReps('push', 'press', 0, 10, '2026-01-01');
		await setPeso('push', 'press', 1, 90, '2026-01-01');
		await setReps('push', 'press', 1, 3, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await setSerieHecha('push', 'press', 1, true, '2026-01-01');

		await ensureEjercicio('pull', 'remo', 1, '2026-01-02');
		await setPeso('pull', 'remo', 0, 70, '2026-01-02');
		await setReps('pull', 'remo', 0, 8, '2026-01-02');
		await setSerieHecha('pull', 'remo', 0, true, '2026-01-02');

		const records = await primerValor(
			recordsGlobalesObs({ metricaPr: 'peso', metricasPrEjercicio: { press: 'e1rm' } })
		);
		expect(records.find((record) => record.exerciseId === 'press')).toMatchObject({
			valor: 106.7,
			metrica: 'e1rm'
		});
		expect(records.find((record) => record.exerciseId === 'remo')).toMatchObject({
			valor: 70,
			metrica: 'peso'
		});
	});

	it('no celebra un falso PR de e1RM cuando dos fórmulas dan el mismo decimal visible', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 70, '2026-01-01');
		await setReps('push', 'press', 0, 10, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		expect(await registrarPrSiSupera('push', 'press', 0, 'e1rm', '2026-01-01')).toMatchObject({
			valor: 93.3
		});

		await ensureEjercicio('push', 'press', 1, '2026-01-02');
		await setPeso('push', 'press', 0, 80, '2026-01-02');
		await setReps('push', 'press', 0, 5, '2026-01-02');
		await setSerieHecha('push', 'press', 0, true, '2026-01-02');
		expect(await registrarPrSiSupera('push', 'press', 0, 'e1rm', '2026-01-02')).toBeNull();
	});

	it('no fabrica e1RM si la serie hecha no tiene reps', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		expect(await registrarPrSiSupera('push', 'press', 0, 'e1rm', '2026-01-01')).toBeNull();
		expect((await db.sesiones.get('2026-01-01__push'))?.ejercicios[0]?.prCelebrado).toBeUndefined();
	});

	it('juzga un PR histórico sólo contra sesiones anteriores, no futuras', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-10');
		await setPeso('push', 'press', 0, 120, '2026-01-10');
		await setReps('push', 'press', 0, 5, '2026-01-10');
		await setSerieHecha('push', 'press', 0, true, '2026-01-10');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-10');

		await ensureEjercicio('push', 'press', 1, '2026-01-05');
		await setPeso('push', 'press', 0, 110, '2026-01-05');
		await setReps('push', 'press', 0, 5, '2026-01-05');
		await setSerieHecha('push', 'press', 0, true, '2026-01-05');
		expect(await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-05')).toMatchObject({
			valor: 110
		});
	});

	it('revalida PRs con su métrica histórica aunque ajustes use otra métrica', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 80, '2026-01-01');
		await setReps('push', 'press', 0, 10, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await registrarPrSiSupera('push', 'press', 0, 'e1rm', '2026-01-01');

		await ensureEjercicio('push', 'press', 1, '2026-01-02');
		await setPeso('push', 'press', 0, 85, '2026-01-02');
		await setReps('push', 'press', 0, 8, '2026-01-02');
		await setSerieHecha('push', 'press', 0, true, '2026-01-02');
		await registrarPrSiSupera('push', 'press', 0, 'e1rm', '2026-01-02');

		await actualizarSetHistorial('2026-01-01__push', 'press', 0, { peso: 100, reps: 10 }, 'peso');
		expect((await db.sesiones.get('2026-01-01__push'))?.ejercicios[0]?.prCelebrado?.metrica).toBe(
			'e1rm'
		);
		expect((await db.sesiones.get('2026-01-02__push'))?.ejercicios[0]?.prCelebrado).toBeUndefined();
	});

	it('ejercicio sin peso (bodyweight) puntua por reps: PR, historial y record en modo reps', async () => {
		await ensureEjercicio('pull', 'dominadas', 2, '2026-01-01');
		await setReps('pull', 'dominadas', 0, 8, '2026-01-01');
		await setReps('pull', 'dominadas', 1, 10, '2026-01-01');
		await setSerieHecha('pull', 'dominadas', 0, true, '2026-01-01');
		await setSerieHecha('pull', 'dominadas', 1, true, '2026-01-01');

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
				modo: 'reps',
				metrica: 'reps'
			}
		]);
	});

	it('historial mixto: con algun set con peso, las series sin peso no puntuan', async () => {
		await ensureEjercicio('pull', 'dominadas', 1, '2026-01-01');
		await setReps('pull', 'dominadas', 0, 12, '2026-01-01');
		await setSerieHecha('pull', 'dominadas', 0, true, '2026-01-01');

		// Aparece el lastre: el ejercicio pasa a modo peso en todo su historial.
		await ensureEjercicio('pull', 'dominadas', 1, '2026-01-02');
		await setPeso('pull', 'dominadas', 0, 10, '2026-01-02');
		await setReps('pull', 'dominadas', 0, 6, '2026-01-02');
		await setSerieHecha('pull', 'dominadas', 0, true, '2026-01-02');

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

	it('no celebra reps como si fueran kg cuando el ejercicio ya tiene historial con peso', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 80, '2026-01-01');
		await setReps('push', 'press', 0, 10, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');

		await ensureEjercicio('push', 'press', 1, '2026-01-02');
		await setPeso('push', 'press', 0, undefined, '2026-01-02');
		await setReps('push', 'press', 0, 12, '2026-01-02');
		await setSerieHecha('push', 'press', 0, true, '2026-01-02');

		expect(await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-02')).toBeNull();
		expect((await db.sesiones.get('2026-01-02__push'))?.ejercicios[0]?.prCelebrado).toBeUndefined();
	});

	it('edita y borra una serie historica recalculando el historial', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01', 'peso');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-01');

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

	it('borrar una serie histórica reabre un día que estaba terminado', async () => {
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 1, orden: 0 }]
		});
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setReps('push', 'press', 0, 10, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await marcarDiaTerminado('push', '2026-01-01');

		await borrarSetHistorial('2026-01-01__push', 'press', 0);

		expect(await db.sesiones.get('2026-01-01__push')).toMatchObject({
			diaTerminado: false,
			diaTerminadoAt: undefined,
			ejercicios: [{ sets: [{ hecha: false }] }]
		});
	});

	it('conserva un PR histórico aunque exista un récord mayor en el futuro', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-01');

		await ensureEjercicio('push', 'press', 1, '2026-01-02');
		await setPeso('push', 'press', 0, 110, '2026-01-02');
		await setReps('push', 'press', 0, 5, '2026-01-02');
		await setSerieHecha('push', 'press', 0, true, '2026-01-02');

		await actualizarSetHistorial(
			'2026-01-01__push',
			'press',
			0,
			{ peso: 105, reps: 5, esMax: false },
			'peso'
		);

		expect((await db.sesiones.get('2026-01-01__push'))?.ejercicios[0]?.prCelebrado).toMatchObject({
			peso: 105
		});
	});

	it('subir una serie vieja degrada el PR de la sesion posterior que tapa', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-01');

		await ensureEjercicio('push', 'press', 1, '2026-01-02');
		await setPeso('push', 'press', 0, 110, '2026-01-02');
		await setReps('push', 'press', 0, 5, '2026-01-02');
		await setSerieHecha('push', 'press', 0, true, '2026-01-02');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-02');

		// El 1 de enero en realidad habían sido 120: con 120 antes, los 110 del día 2
		// dejan de ser récord y no pueden seguir mostrándose como PR de ese día.
		await actualizarSetHistorial(
			'2026-01-01__push',
			'press',
			0,
			{ peso: 120, reps: 5, esMax: false },
			'peso'
		);

		const enero1 = await db.sesiones.get('2026-01-01__push');
		const enero2 = await db.sesiones.get('2026-01-02__push');
		expect(enero1?.ejercicios[0]?.prCelebrado).toMatchObject({ peso: 120 });
		expect(enero2?.ejercicios[0]?.prCelebrado).toBeUndefined();
		expect(resumenDiaSesion(enero2).prs).toHaveLength(0);
		// El récord vigente se deriva de los sets crudos y sigue siendo correcto.
		expect(await primerValor(recordsGlobalesObs('peso'))).toMatchObject([{ valor: 120 }]);
	});

	it('no degrada una sesion posterior que sigue siendo record', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-01');

		await ensureEjercicio('push', 'press', 1, '2026-01-02');
		await setPeso('push', 'press', 0, 110, '2026-01-02');
		await setReps('push', 'press', 0, 5, '2026-01-02');
		await setSerieHecha('push', 'press', 0, true, '2026-01-02');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-02');

		await actualizarSetHistorial(
			'2026-01-01__push',
			'press',
			0,
			{ peso: 105, reps: 5, esMax: false },
			'peso'
		);

		expect((await db.sesiones.get('2026-01-02__push'))?.ejercicios[0]?.prCelebrado).toMatchObject({
			peso: 110
		});
	});

	it('bajar una serie vieja no inventa un PR en una sesion posterior', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-01');

		// Nunca fue récord (90 < 100), así que ese día no celebró nada.
		await ensureEjercicio('push', 'press', 1, '2026-01-02');
		await setPeso('push', 'press', 0, 90, '2026-01-02');
		await setReps('push', 'press', 0, 5, '2026-01-02');
		await setSerieHecha('push', 'press', 0, true, '2026-01-02');
		expect(await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-02')).toBeNull();

		await actualizarSetHistorial(
			'2026-01-01__push',
			'press',
			0,
			{ peso: 80, reps: 5, esMax: false },
			'peso'
		);

		// Retroactivamente los 90 pasan a ser el mayor, pero la app no fabrica una
		// celebración que el usuario nunca vio: solo degrada, nunca promueve.
		expect((await db.sesiones.get('2026-01-02__push'))?.ejercicios[0]?.prCelebrado).toBeUndefined();
		expect(await primerValor(recordsGlobalesObs('peso'))).toMatchObject([{ valor: 90 }]);
	});

	it('editar una serie activa recalcula el PR celebrado de la sesion', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01', 'peso');

		await ensureEjercicio('push', 'press', 1, '2026-01-02');
		await setPeso('push', 'press', 0, 110, '2026-01-02');
		await setReps('push', 'press', 0, 5, '2026-01-02');
		await setSerieHecha('push', 'press', 0, true, '2026-01-02', 'peso');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-02');

		await setPeso('push', 'press', 0, 95, '2026-01-02', 'peso');

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
			},
			{
				peso: 95,
				reps: 5,
				esMax: false,
				extraKg: undefined,
				fecha: '2026-01-02',
				valor: 95,
				sesionId: '2026-01-02__push',
				setIndex: 0
			}
		]);
	});

	it('RIR es opcional, valida pasos y se puede editar desde historial', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setReps('push', 'press', 0, 8, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await setRir('push', 'press', 0, 2.5, '2026-01-01');
		expect((await db.sesiones.get('2026-01-01__push'))?.ejercicios[0]?.sets[0]?.rir).toBe(2.5);
		await expect(setRir('push', 'press', 0, 2.25, '2026-01-01')).rejects.toThrow();

		await actualizarSetHistorial('2026-01-01__push', 'press', 0, { reps: 8, rir: 1 }, 'peso');
		expect((await db.sesiones.get('2026-01-01__push'))?.ejercicios[0]?.sets[0]).toMatchObject({
			hecha: true,
			rir: 1
		});

		await setRir('push', 'press', 0, undefined, '2026-01-01');
		expect(
			(await db.sesiones.get('2026-01-01__push'))?.ejercicios[0]?.sets[0]?.rir
		).toBeUndefined();
	});

	it('vaciar las reps al editar una serie histórica la deja pendiente', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');

		await actualizarSetHistorial(
			'2026-01-01__push',
			'press',
			0,
			{ peso: 100, reps: undefined, esMax: false },
			'peso'
		);

		expect((await db.sesiones.get('2026-01-01__push'))?.ejercicios[0]?.sets[0]).toMatchObject({
			hecha: false,
			reps: undefined
		});
		expect(await primerValor(historialObs('press', 'peso'))).toEqual([]);
	});

	it('saltar, reanudar, terminar y reabrir dia actual', async () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 2, orden: 0 }]
		});

		await saltarEjercicio('push', 'press');
		expect((await db.sesiones.get('2026-01-07__push'))?.ejercicios[0]?.saltado).toBe(true);

		await reanudarEjercicio('push', 'press');
		expect((await db.sesiones.get('2026-01-07__push'))?.ejercicios[0]?.saltado).toBe(false);
		await setReps('push', 'press', 0, 10);
		await setReps('push', 'press', 1, 8);
		await setSerieHecha('push', 'press', 0, true);
		await setSerieHecha('push', 'press', 1, true);

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
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 2, orden: 0 }]
		});

		await saltarEjercicio('push', 'press');
		await marcarDiaTerminado('push');

		await reanudarEjercicio('push', 'press');

		expect(await db.sesiones.get('2026-01-07__push')).toMatchObject({
			diaTerminado: false,
			diaTerminadoAt: undefined,
			ejercicios: [{ exerciseId: 'press', saltado: false }]
		});
	});

	it('agregar un ejercicio al terminar no deja una sesión cerrada con trabajo pendiente', async () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 1, orden: 0 }]
		});
		await ensureEjercicio('push', 'press', 1);
		await setReps('push', 'press', 0, 10);
		await setSerieHecha('push', 'press', 0, true);

		await Promise.all([marcarDiaTerminado('push'), agregarEjercicio('push', 'remo')]);

		expect((await db.dias.get('push'))?.ejercicios.map((e) => e.exerciseId)).toEqual([
			'press',
			'remo'
		]);
		expect((await db.sesiones.get('2026-01-07__push'))?.diaTerminado).toBe(false);
	});

	it('destildar el set del PR limpia el resumen y conserva el historial real', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01', 'peso');

		await ensureEjercicio('push', 'press', 1, '2026-01-02');
		await setPeso('push', 'press', 0, 110, '2026-01-02');
		await setReps('push', 'press', 0, 5, '2026-01-02');
		await setSerieHecha('push', 'press', 0, true, '2026-01-02', 'peso');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-02');

		await setSerieHecha('push', 'press', 0, false, '2026-01-02', 'peso');

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
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01', 'peso');

		await ensureEjercicio('push', 'press', 2, '2026-01-02');
		await setPeso('push', 'press', 0, 110, '2026-01-02');
		await setPeso('push', 'press', 1, 105, '2026-01-02');
		await setReps('push', 'press', 0, 5, '2026-01-02');
		await setReps('push', 'press', 1, 5, '2026-01-02');
		await setSerieHecha('push', 'press', 0, true, '2026-01-02', 'peso');
		await setSerieHecha('push', 'press', 1, true, '2026-01-02', 'peso');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-02');

		await setSerieHecha('push', 'press', 0, false, '2026-01-02', 'peso');

		expect((await db.sesiones.get('2026-01-02__push'))?.ejercicios[0]?.prCelebrado).toMatchObject({
			peso: 105,
			pesoGramos: 105_000,
			reps: 5,
			esMax: false,
			extraKg: undefined,
			setIndex: 1,
			metrica: 'peso'
		});
	});

	it('destildar un empate no borra el PR si otra serie hecha lo respalda', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01', 'peso');

		await ensureEjercicio('push', 'press', 2, '2026-01-02');
		await setPeso('push', 'press', 0, 110, '2026-01-02');
		await setPeso('push', 'press', 1, 110, '2026-01-02');
		await setReps('push', 'press', 0, 5, '2026-01-02');
		await setReps('push', 'press', 1, 5, '2026-01-02');
		await setSerieHecha('push', 'press', 0, true, '2026-01-02', 'peso');
		await setSerieHecha('push', 'press', 1, true, '2026-01-02', 'peso');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-02');

		await setSerieHecha('push', 'press', 0, false, '2026-01-02', 'peso');

		expect((await db.sesiones.get('2026-01-02__push'))?.ejercicios[0]?.prCelebrado).toMatchObject({
			peso: 110,
			pesoGramos: 110_000,
			reps: 5,
			esMax: false,
			extraKg: undefined,
			// El recálculo reapunta el trofeo a la serie que quedó marcada.
			setIndex: 1,
			metrica: 'peso'
		});
	});
});
