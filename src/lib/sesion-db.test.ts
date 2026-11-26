import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conIndice, db, guardarSesion } from './db';
import {
	addSet,
	actualizarSetHistorial,
	borrarSetHistorial,
	cerrarEjercicioConLoHecho,
	descartarReapertura,
	ensureEjercicio,
	ejercicioSesionObs,
	historialObs,
	historialPorModo,
	hoyStr,
	marcarDiaTerminado,
	prepararEjercicioSesion,
	registrarPrSiSupera,
	reiniciarDia,
	reiniciarEjercicio,
	restaurarInstantanea,
	reabrirDia,
	reanudarEjercicio,
	recordsGlobalesObs,
	removeSet,
	setSerieHecha,
	saltarEjercicio,
	sesionHoyObs,
	sesionRecienteDe,
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
import { exportarJSON, normalizarAjustes, parseBackup, prepararImport } from './extras';
import { estadoSesion, pesoEfectivo, prRespaldado, serieCompleta } from './sesion-reglas';
import { gramosAPeso } from './unidades';
import { agregarEjercicio, ajustarSeries, quitarEjercicio } from './dias';

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

	it('no crea una sesión si la rutina o el ejercicio ya no existen', async () => {
		expect(await prepararEjercicioSesion('push', 'press', '2026-01-05')).toEqual({
			disponible: false,
			motivo: 'rutina-no-disponible'
		});
		expect(await db.sesiones.count()).toBe(0);

		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'fondos', seriesObjetivo: 3, orden: 0 }]
		});
		expect(await prepararEjercicioSesion('push', 'press', '2026-01-05')).toEqual({
			disponible: false,
			motivo: 'rutina-no-disponible'
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
		expect(await saltarEjercicio('push', 'press', '2026-01-05')).toEqual({
			saltado: false,
			razon: 'rutina-no-disponible'
		});
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

	it('guarda y devuelve el récord que el PR rompió, y no lo inventa en el primero', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');

		// El primero no tiene de dónde venir: `previo` ausente es "no había marca", y la
		// pantalla calla en vez de inventar un número.
		const primero = await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-01');
		expect(primero).toMatchObject({ valor: 100 });
		expect(primero?.previo).toBeUndefined();
		expect(
			(await db.sesiones.get('2026-01-01__push'))?.ejercicios[0]?.prCelebrado?.previo
		).toBeUndefined();

		await ensureEjercicio('push', 'press', 1, '2026-01-08');
		await setPeso('push', 'press', 0, 105, '2026-01-08');
		await setReps('push', 'press', 0, 5, '2026-01-08');
		await setSerieHecha('push', 'press', 0, true, '2026-01-08');

		expect(await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-08')).toMatchObject({
			valor: 105,
			previo: { peso: 100, reps: 5, valor: 100 }
		});
		expect(
			(await db.sesiones.get('2026-01-08__push'))?.ejercicios[0]?.prCelebrado?.previo
		).toMatchObject({ peso: 100, pesoGramos: 100_000, reps: 5, esMax: false });
	});

	it('dos récords el mismo día dicen los dos el número con el que arrancó el día', async () => {
		await ensureEjercicio('push', 'press', 2, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-01');

		await ensureEjercicio('push', 'press', 2, '2026-01-08');
		await setPeso('push', 'press', 0, 105, '2026-01-08');
		await setReps('push', 'press', 0, 5, '2026-01-08');
		await setSerieHecha('push', 'press', 0, true, '2026-01-08');
		expect(await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-08')).toMatchObject({
			previo: { peso: 100 }
		});

		// Segunda marca del mismo día: "venías de" sigue siendo el 100 con el que entró al
		// gimnasio, no el 105 de hace cinco minutos. Es lo que el usuario tiene en la cabeza,
		// y además es lo único que `recalcularPrCelebrado` puede reconstruir después.
		await setPeso('push', 'press', 1, 110, '2026-01-08');
		await setReps('push', 'press', 1, 5, '2026-01-08');
		await setSerieHecha('push', 'press', 1, true, '2026-01-08');
		expect(await registrarPrSiSupera('push', 'press', 1, 'peso', '2026-01-08')).toMatchObject({
			valor: 110,
			previo: { peso: 100 }
		});
	});

	it('ir y venir sobre la misma serie no mueve el récord anterior guardado', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-01');

		await ensureEjercicio('push', 'press', 1, '2026-01-08');
		await setPeso('push', 'press', 0, 105, '2026-01-08');
		await setReps('push', 'press', 0, 5, '2026-01-08');
		await setSerieHecha('push', 'press', 0, true, '2026-01-08');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-08');

		for (let vuelta = 0; vuelta < 3; vuelta++) {
			await setSerieHecha('push', 'press', 0, false, '2026-01-08');
			await setSerieHecha('push', 'press', 0, true, '2026-01-08');
			await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-08');
		}

		expect(
			(await db.sesiones.get('2026-01-08__push'))?.ejercicios[0]?.prCelebrado?.previo
		).toMatchObject({ peso: 100, reps: 5 });
	});

	it('corregir el pasado reescribe el "venías de" en vez de dejarlo mintiendo', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01');
		await setPeso('push', 'press', 0, 100, '2026-01-01');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-01');

		await ensureEjercicio('push', 'press', 1, '2026-01-08');
		await setPeso('push', 'press', 0, 110, '2026-01-08');
		await setReps('push', 'press', 0, 5, '2026-01-08');
		await setSerieHecha('push', 'press', 0, true, '2026-01-08');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-08');

		// Se corrige el día viejo: aquel 100 en realidad habían sido 105.
		expect(
			await actualizarSetHistorial('2026-01-01__push', 'press', 0, { peso: 105, reps: 5 })
		).toBe(true);

		expect(
			(await db.sesiones.get('2026-01-08__push'))?.ejercicios[0]?.prCelebrado?.previo
		).toMatchObject({ peso: 105, pesoGramos: 105_000 });
	});

	it('el récord anterior se guarda canónico y vuelve en la unidad que se está mirando', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-01', 'lb');
		await setPeso('push', 'press', 0, 200, '2026-01-01', 'lb');
		await setReps('push', 'press', 0, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-01', 'lb');

		await ensureEjercicio('push', 'press', 1, '2026-01-08', 'lb');
		await setPeso('push', 'press', 0, 210, '2026-01-08', 'lb');
		await setReps('push', 'press', 0, 5, '2026-01-08');
		await setSerieHecha('push', 'press', 0, true, '2026-01-08');
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-01-08', 'lb');

		// En disco, gramos. Sin esto el `previo` viajaría con un número en libras que la
		// pantalla en kg mostraría tal cual, y nadie se enteraría.
		const guardado = (await db.sesiones.get('2026-01-08__push'))?.ejercicios[0]?.prCelebrado;
		expect(guardado?.previo?.pesoGramos).toBe(90_718);

		const enLb = await primerValor(ejercicioSesionObs('push', 'press', '2026-01-08', 'lb'));
		expect(enLb.prCelebrado?.previo?.peso).toBeCloseTo(200, 1);
		expect(enLb.prCelebrado?.previo?.pesoGramos).toBeUndefined();

		const enKg = await primerValor(ejercicioSesionObs('push', 'press', '2026-01-08', 'kg'));
		expect(enKg.prCelebrado?.previo?.peso).toBeCloseTo(90.7, 1);
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
				pesoGramos: 90000,
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
				pesoGramos: 70000,
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
				pesoGramos: 80000,
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

		await actualizarSetHistorial('2026-01-01__push', 'press', 0, { peso: 100, reps: 10 });
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
				pesoGramos: 10000,
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

		await actualizarSetHistorial('2026-01-01__push', 'press', 0, {
			peso: 90,
			reps: 6,
			esMax: false
		});

		expect((await primerValor(historialObs('press', 'peso')))[0]).toMatchObject({
			peso: 90,
			reps: 6,
			valor: 90
		});
		expect((await db.sesiones.get('2026-01-01__push'))?.ejercicios[0]?.prCelebrado).toMatchObject({
			peso: 90,
			reps: 6
		});

		await borrarSetHistorial('2026-01-01__push', 'press', 0);

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

		await actualizarSetHistorial('2026-01-01__push', 'press', 0, {
			peso: 105,
			reps: 5,
			esMax: false
		});

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
		await actualizarSetHistorial('2026-01-01__push', 'press', 0, {
			peso: 120,
			reps: 5,
			esMax: false
		});

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

		await actualizarSetHistorial('2026-01-01__push', 'press', 0, {
			peso: 105,
			reps: 5,
			esMax: false
		});

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

		await actualizarSetHistorial('2026-01-01__push', 'press', 0, {
			peso: 80,
			reps: 5,
			esMax: false
		});

		// Retroactivamente los 90 pasan a ser el mayor, pero la app no fabrica una
		// celebración que el usuario nunca vio: solo degrada, nunca promueve.
		expect((await db.sesiones.get('2026-01-02__push'))?.ejercicios[0]?.prCelebrado).toBeUndefined();
		expect(await primerValor(recordsGlobalesObs('peso'))).toMatchObject([{ valor: 90 }]);
	});

	it('historialPantallaObs sirve resumen, records y ajustes de una sola lectura', async () => {
		await ensureEjercicio('push', 'press', 2, '2026-01-01');
		await setPeso('push', 'press', 0, 80, '2026-01-01');
		await setReps('push', 'press', 0, 10, '2026-01-01');
		await setSerieHecha('push', 'press', 0, true, '2026-01-01', 'peso');
		await setPeso('push', 'press', 1, 100, '2026-01-01');
		await setReps('push', 'press', 1, 5, '2026-01-01');
		await setSerieHecha('push', 'press', 1, true, '2026-01-01', 'peso');

		await ensureEjercicio('pull', 'remo', 1, '2026-01-02');
		await setPeso('pull', 'remo', 0, 70, '2026-01-02');
		await setReps('pull', 'remo', 0, 8, '2026-01-02');
		await setSerieHecha('pull', 'remo', 0, true, '2026-01-02', 'peso');

		const { historialPantallaObs } = await import('./historial');
		const pantalla = await primerValor(historialPantallaObs());

		// Las dos mitades tienen que hablar de los mismos días: antes salían de dos
		// consultas independientes y nada garantizaba que vieran la misma tabla.
		expect(pantalla.resumen.totalDias).toBe(2);
		expect(pantalla.resumen.dias.map((dia) => dia.fecha)).toEqual(['2026-01-02', '2026-01-01']);
		expect(pantalla.records.map((record) => record.exerciseId)).toEqual(['remo', 'press']);
		expect(pantalla.records.find((record) => record.exerciseId === 'press')?.valor).toBe(100);
		// Y la unidad con la que se calculó el volumen es la que la pantalla va a rotular.
		expect(pantalla.ajustes.unidad).toBe('kg');
		expect(pantalla.resumen.dias.at(-1)?.volumen).toBe(80 * 10 + 100 * 5);
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

		await setPeso('push', 'press', 0, 95, '2026-01-02');

		const actual = await db.sesiones.get('2026-01-02__push');
		expect(actual?.ejercicios[0]?.prCelebrado).toBeUndefined();
		expect(resumenDiaSesion(actual).prs).toHaveLength(0);
		expect(await primerValor(historialObs('press', 'peso'))).toEqual([
			{
				peso: 100,
				pesoGramos: 100000,
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
				pesoGramos: 95000,
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

		await actualizarSetHistorial('2026-01-01__push', 'press', 0, { reps: 8, rir: 1 });
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

		await actualizarSetHistorial('2026-01-01__push', 'press', 0, {
			peso: 100,
			reps: undefined,
			esMax: false
		});

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
				pesoGramos: 100000,
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

	it('saltar un ejercicio prellena en la unidad activa y con gramos canonicos', async () => {
		await db.dias.put({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 1, orden: 0 }]
		});
		await guardarSesion({
			id: '2026-01-01__push',
			fecha: '2026-01-01',
			diaId: 'push',
			ejercicios: [
				{
					exerciseId: 'press',
					// 100 kg = 220,5 lb: el numero visible depende de la unidad, los gramos no.
					sets: [
						{
							peso: 220.5,
							pesoGramos: 100_000,
							reps: 8,
							hecha: true,
							esMax: true,
							extraKg: 11,
							extraGramos: 5000
						}
					]
				}
			]
		});

		expect(await saltarEjercicio('push', 'press', '2026-01-02', 'lb')).toEqual({ saltado: true });

		const set = (await db.sesiones.get('2026-01-02__push'))?.ejercicios[0]?.sets[0];
		// Prellena en la unidad activa: antes copiaba el numero en kg y lo rotulaba lb.
		expect(set).toMatchObject({ peso: 220.5, reps: 8, hecha: false });
		// Y con gramos: sin ellos el set deja de significar lo mismo en las dos unidades.
		// El prellenado parte del valor visible, asi que la igualdad es a la precision que
		// el producto muestra (una decima), no al gramo.
		expect(gramosAPeso(set?.pesoGramos, 'lb')).toBe(220.5);
		expect(gramosAPeso(set?.pesoGramos, 'kg')).toBe(100);
		// El MAX y su extra son parte de la carga que se esta repitiendo.
		expect(set).toMatchObject({ esMax: true, extraKg: 11 });
		expect(gramosAPeso(set?.extraGramos, 'lb')).toBe(11);
	});

	it('la serie agregada conserva el MAX y su extra', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-01-05');
		await setPeso('push', 'press', 0, 100, '2026-01-05');
		await setReps('push', 'press', 0, 8, '2026-01-05');
		await toggleMax('push', 'press', 0, '2026-01-05');
		await setExtra('push', 'press', 0, 5, '2026-01-05');

		await addSet('push', 'press', '2026-01-05');

		const sets = (await db.sesiones.get('2026-01-05__push'))?.ejercicios[0]?.sets;
		// Copiar solo la placa base registraba 100 donde se levantaron 105.
		expect(pesoEfectivo(sets![0]!)).toBe(105);
		expect(pesoEfectivo(sets![1]!)).toBe(105);
		expect(sets![1]).toMatchObject({ esMax: true, extraKg: 5, extraGramos: 5000, hecha: false });
	});
});

/**
 * El usuario real no va en línea recta: termina, se arrepiente, vuelve, borra, agrega.
 * Estas pruebas cubren la vuelta atrás, que es donde el flujo se trababa.
 */
describe('flujo no lineal: arrepentirse y volver', () => {
	beforeEach(async () => {
		vi.useRealTimers();
		await limpiarDb();
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 4, orden: 0 }]
		});
	});

	async function hacerSerie(i: number, peso: number, reps: number, fecha = '2026-01-08') {
		await setPeso('push', 'press', i, peso, fecha);
		await setReps('push', 'press', i, reps, fecha);
		await setSerieHecha('push', 'press', i, true, fecha);
	}

	it('quita la serie que se pide, no siempre la última', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		for (const i of [0, 1, 2, 3]) await hacerSerie(i, 70 + i, 10);

		await removeSet('push', 'press', 1, '2026-01-08');

		const sets = (await db.sesiones.get('2026-01-08__push'))?.ejercicios[0]?.sets;
		expect(sets?.map((s) => s.peso)).toEqual([70, 72, 73]);
	});

	it('cerrar con lo hecho deja el ejercicio completo y permite terminar el día', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		for (const i of [0, 1, 2]) await hacerSerie(i, 80, 10);
		// La cuarta nunca se hizo: antes bloqueaba el día para siempre.
		expect(await marcarDiaTerminado('push', '2026-01-08')).toEqual({
			terminado: false,
			razon: 'ejercicios-pendientes'
		});

		const cierre = await cerrarEjercicioConLoHecho('push', 'press', '2026-01-08');
		expect(cierre).toMatchObject({ cerrado: true, quitadas: 1 });
		expect(cierre.instantanea).toBeDefined();

		const sets = (await db.sesiones.get('2026-01-08__push'))?.ejercicios[0]?.sets;
		expect(sets).toHaveLength(3);
		expect(sets?.every(serieCompleta)).toBe(true);
		expect(await marcarDiaTerminado('push', '2026-01-08')).toEqual({
			terminado: true,
			conPendientes: false
		});
	});

	it('cerrar con lo hecho no borra nada si no hay ninguna serie marcada', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		await setPeso('push', 'press', 0, 80, '2026-01-08');

		expect(await cerrarEjercicioConLoHecho('push', 'press', '2026-01-08')).toEqual({
			cerrado: false,
			quitadas: 0
		});
		expect((await db.sesiones.get('2026-01-08__push'))?.ejercicios[0]?.sets).toHaveLength(4);
	});

	it('la reapertura del día explica su motivo y se apaga al volver a terminarlo', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		for (const i of [0, 1, 2, 3]) await hacerSerie(i, 80, 10);
		await marcarDiaTerminado('push', '2026-01-08');

		await setSerieHecha('push', 'press', 1, false, '2026-01-08');
		const reabierta = await db.sesiones.get('2026-01-08__push');
		expect(reabierta?.diaTerminado).toBe(false);
		expect(reabierta?.reaperturaMotivo).toBe('Desmarcaste la serie 2 de un ejercicio');
		expect(reabierta?.reaperturaAt).toEqual(expect.any(String));

		await setSerieHecha('push', 'press', 1, true, '2026-01-08');
		await marcarDiaTerminado('push', '2026-01-08');
		const cerrada = await db.sesiones.get('2026-01-08__push');
		expect(cerrada?.diaTerminado).toBe(true);
		expect(cerrada?.reaperturaMotivo).toBeUndefined();
	});

	it('descartar el aviso no vuelve a cerrar el día', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		for (const i of [0, 1, 2, 3]) await hacerSerie(i, 80, 10);
		await marcarDiaTerminado('push', '2026-01-08');
		await addSet('push', 'press', '2026-01-08');
		expect((await db.sesiones.get('2026-01-08__push'))?.reaperturaMotivo).toBe(
			'Agregaste la serie 5 a un ejercicio'
		);

		await descartarReapertura('push', '2026-01-08');
		const s = await db.sesiones.get('2026-01-08__push');
		expect(s?.reaperturaMotivo).toBeUndefined();
		expect(s?.diaTerminado).toBe(false);
	});

	it('un día que ya estaba abierto no inventa un cartel de reapertura', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		await hacerSerie(0, 80, 10);
		await setSerieHecha('push', 'press', 0, false, '2026-01-08');
		expect((await db.sesiones.get('2026-01-08__push'))?.reaperturaMotivo).toBeUndefined();
	});

	it('no se puede saltar un ejercicio que ya está completo', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		for (const i of [0, 1, 2, 3]) await hacerSerie(i, 80, 10);
		await marcarDiaTerminado('push', '2026-01-08');

		expect(await saltarEjercicio('push', 'press', '2026-01-08')).toEqual({
			saltado: false,
			razon: 'ya-completado'
		});
		const s = await db.sesiones.get('2026-01-08__push');
		expect(s?.ejercicios[0]?.saltado).toBeUndefined();
		// Y de paso: un salto rechazado no puede llevarse el día terminado.
		expect(s?.diaTerminado).toBe(true);
	});

	it('ir y venir sobre el mismo ejercicio no acumula recompensas', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		for (const i of [0, 1, 2, 3]) await hacerSerie(i, 100, 8);
		await registrarPrSiSupera('push', 'press', 3, 'peso', '2026-01-08');
		const base = resumenDiaSesion(await db.sesiones.get('2026-01-08__push'));
		expect(base.prs).toHaveLength(1);

		// Tres arrepentimientos seguidos sobre la misma serie del PR.
		for (let vuelta = 0; vuelta < 3; vuelta++) {
			await setSerieHecha('push', 'press', 3, false, '2026-01-08');
			await setSerieHecha('push', 'press', 3, true, '2026-01-08');
			await registrarPrSiSupera('push', 'press', 3, 'peso', '2026-01-08');
		}

		// La celebración puede volver a verse —eso es problema de quien va y viene—, pero
		// nada de lo que se acumula puede crecer: ni PRs del día, ni sets, ni volumen.
		const despues = resumenDiaSesion(await db.sesiones.get('2026-01-08__push'));
		expect(despues).toEqual(base);
		expect(despues.prs).toHaveLength(1);
		expect(despues.setsHechos).toBe(4);
	});

	it('reiniciar un ejercicio desmarca todo y conserva la carga como referencia', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		for (const i of [0, 1, 2, 3]) await hacerSerie(i, 100, 8);
		await registrarPrSiSupera('push', 'press', 3, 'peso', '2026-01-08');
		await marcarDiaTerminado('push', '2026-01-08');

		const foto = await reiniciarEjercicio('push', 'press', '2026-01-08');
		expect(foto).not.toBeNull();

		const s = await db.sesiones.get('2026-01-08__push');
		const e = s!.ejercicios[0]!;
		expect(e.sets.every((set) => !set.hecha)).toBe(true);
		// El peso y las reps son justamente lo que se quiere para repetir la serie.
		expect(e.sets.map((set) => set.peso)).toEqual([100, 100, 100, 100]);
		expect(e.sets.map((set) => set.reps)).toEqual([8, 8, 8, 8]);
		expect(e.prCelebrado).toBeUndefined();
		expect(s?.diaTerminado).toBe(false);
		expect(s?.reaperturaMotivo).toBe('Reiniciaste un ejercicio');
	});

	it('deshacer un reinicio devuelve series, PR y estado del día tal cual estaban', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		for (const i of [0, 1, 2, 3]) await hacerSerie(i, 100, 8);
		await registrarPrSiSupera('push', 'press', 3, 'peso', '2026-01-08');
		await marcarDiaTerminado('push', '2026-01-08');
		const antes = await db.sesiones.get('2026-01-08__push');

		const foto = await reiniciarEjercicio('push', 'press', '2026-01-08');
		expect(await restaurarInstantanea('push', foto!, '2026-01-08')).toBe(true);

		const despues = await db.sesiones.get('2026-01-08__push');
		expect(despues?.ejercicios).toEqual(antes?.ejercicios);
		expect(despues?.diaTerminado).toBe(true);
		expect(despues?.reaperturaMotivo).toBeUndefined();
		expect(resumenDiaSesion(despues)).toEqual(resumenDiaSesion(antes));
	});

	it('reiniciar sin nada hecho no toca la sesión ni ofrece deshacer', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		expect(await reiniciarEjercicio('push', 'press', '2026-01-08')).toBeNull();
		expect(await reiniciarDia('push', '2026-01-08')).toBeNull();
	});

	it('reiniciar el día limpia series y saltos de todos los ejercicios', async () => {
		await db.dias.update('push', {
			ejercicios: [
				{ exerciseId: 'press', seriesObjetivo: 2, orden: 0 },
				{ exerciseId: 'remo', seriesObjetivo: 2, orden: 1 }
			]
		});
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		for (const i of [0, 1]) await hacerSerie(i, 100, 8);
		await saltarEjercicio('push', 'remo', '2026-01-08');
		await marcarDiaTerminado('push', '2026-01-08');
		const antes = await db.sesiones.get('2026-01-08__push');

		const foto = await reiniciarDia('push', '2026-01-08');
		const s = await db.sesiones.get('2026-01-08__push');
		expect(s?.ejercicios.every((e) => e.sets.every((set) => !set.hecha))).toBe(true);
		expect(s?.ejercicios.every((e) => !e.saltado)).toBe(true);
		expect(s?.diaTerminado).toBe(false);
		expect(s?.reaperturaMotivo).toBe('Reiniciaste el día');
		expect(resumenDiaSesion(s).setsHechos).toBe(0);

		// Y vuelve entero: el reinicio del día también se deshace.
		await restaurarInstantanea('push', foto!, '2026-01-08');
		const despues = await db.sesiones.get('2026-01-08__push');
		expect(despues?.ejercicios).toEqual(antes?.ejercicios);
		expect(despues?.diaTerminado).toBe(true);
	});

	it('reiniciar y deshacer en redondo no acumula recompensas', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		for (const i of [0, 1, 2, 3]) await hacerSerie(i, 100, 8);
		await registrarPrSiSupera('push', 'press', 3, 'peso', '2026-01-08');
		const base = resumenDiaSesion(await db.sesiones.get('2026-01-08__push'));

		for (let vuelta = 0; vuelta < 3; vuelta++) {
			const foto = await reiniciarEjercicio('push', 'press', '2026-01-08');
			await restaurarInstantanea('push', foto!, '2026-01-08');
		}

		expect(resumenDiaSesion(await db.sesiones.get('2026-01-08__push'))).toEqual(base);
	});

	it('agregar y quitar series en redondo no infla el volumen del día', async () => {
		await prepararEjercicioSesion('push', 'press', '2026-01-08');
		for (const i of [0, 1, 2, 3]) await hacerSerie(i, 100, 8);
		const base = resumenDiaSesion(await db.sesiones.get('2026-01-08__push'));

		for (let vuelta = 0; vuelta < 3; vuelta++) {
			await addSet('push', 'press', '2026-01-08');
			await hacerSerie(4, 100, 8);
			await removeSet('push', 'press', 4, '2026-01-08');
		}

		expect(resumenDiaSesion(await db.sesiones.get('2026-01-08__push'))).toEqual(base);
	});
});

describe('plan congelado del día', () => {
	beforeEach(async () => {
		vi.useRealTimers();
		await limpiarDb();
	});
	afterEach(() => vi.useRealTimers());

	const RUTINA = {
		id: 'push',
		nombre: 'Push',
		orden: 0,
		ejercicios: [
			{ exerciseId: 'press', seriesObjetivo: 4, orden: 0 },
			{ exerciseId: 'fondos', seriesObjetivo: 4, orden: 1 },
			{ exerciseId: 'elevaciones', seriesObjetivo: 4, orden: 2 }
		]
	};

	it('congela ejercicios y series al crear la sesión de hoy', async () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		await db.dias.add(RUTINA);
		await prepararEjercicioSesion('push', 'press', '2026-01-07');
		expect((await db.sesiones.get('2026-01-07__push'))?.plan).toEqual({
			ejercicios: 3,
			series: 12
		});
	});

	it('sigue a la rutina mientras el día sea hoy', async () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		await db.dias.add(RUTINA);
		await prepararEjercicioSesion('push', 'press', '2026-01-07');

		await ajustarSeries('push', 'press', 1);
		expect((await db.sesiones.get('2026-01-07__push'))?.plan).toEqual({
			ejercicios: 3,
			series: 13
		});

		await quitarEjercicio('push', 'elevaciones');
		expect((await db.sesiones.get('2026-01-07__push'))?.plan).toEqual({
			ejercicios: 2,
			series: 9
		});

		await agregarEjercicio('push', 'remo');
		expect((await db.sesiones.get('2026-01-07__push'))?.plan).toEqual({
			ejercicios: 3,
			series: 12
		});
	});

	it('NO reescribe el plan de una fecha pasada: eso es historia', async () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		await db.dias.add(RUTINA);
		await prepararEjercicioSesion('push', 'press', '2026-01-07');

		// Al día siguiente, editar la rutina no puede tocar lo de ayer.
		vi.setSystemTime(new Date('2026-01-08T12:00:00'));
		await ajustarSeries('push', 'press', 1);
		await quitarEjercicio('push', 'fondos');
		expect((await db.sesiones.get('2026-01-07__push'))?.plan).toEqual({
			ejercicios: 3,
			series: 12
		});
	});

	it('no le inventa un plan a una sesión que nació sin él', async () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		await db.dias.add(RUTINA);
		// Sesión anterior al congelado, escrita a mano como la dejaría una base vieja.
		await guardarSesion({
			id: '2026-01-07__push',
			fecha: '2026-01-07',
			diaId: 'push',
			ejercicios: [{ exerciseId: 'press', sets: [{ peso: 60, reps: 8, hecha: true }] }]
		});
		await ajustarSeries('push', 'press', 1);
		expect((await db.sesiones.get('2026-01-07__push'))?.plan).toBeUndefined();
	});
});

describe('cerrar el día con trabajo pendiente', () => {
	beforeEach(async () => {
		vi.useRealTimers();
		await limpiarDb();
	});
	afterEach(() => vi.useRealTimers());

	async function conUnaSerieDeDoce() {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [
				{ exerciseId: 'press', seriesObjetivo: 4, orden: 0 },
				{ exerciseId: 'fondos', seriesObjetivo: 4, orden: 1 },
				{ exerciseId: 'elevaciones', seriesObjetivo: 4, orden: 2 }
			]
		});
		await prepararEjercicioSesion('push', 'press', '2026-01-07');
		await setReps('push', 'press', 0, 8, '2026-01-07');
		await setSerieHecha('push', 'press', 0, true, '2026-01-07');
	}

	it('sin pedirlo explícitamente sigue sin poder cerrarse', async () => {
		await conUnaSerieDeDoce();
		expect(await marcarDiaTerminado('push', '2026-01-07')).toEqual({
			terminado: false,
			razon: 'ejercicios-pendientes'
		});
	});

	it('cierra a pedido y deja registrado que quedó trabajo afuera', async () => {
		await conUnaSerieDeDoce();
		expect(await marcarDiaTerminado('push', '2026-01-07', { conPendientes: true })).toEqual({
			terminado: true,
			conPendientes: true
		});

		const s = await db.sesiones.get('2026-01-07__push');
		expect(s?.diaTerminado).toBe(true);
		expect(s?.diaTerminadoConPendientes).toBe(true);
		// Y sigue siendo un día parcial: cerrar a mano no compra el veredicto.
		expect(estadoSesion(s!).calidad).toBe('parcial');
	});

	it('un día sin una sola serie ni un salto no se puede cerrar', async () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 4, orden: 0 }]
		});
		await prepararEjercicioSesion('push', 'press', '2026-01-07');
		expect(await marcarDiaTerminado('push', '2026-01-07', { conPendientes: true })).toEqual({
			terminado: false,
			razon: 'sin-trabajo'
		});
	});

	it('reabrir limpia la marca de cierre con pendientes', async () => {
		await conUnaSerieDeDoce();
		await marcarDiaTerminado('push', '2026-01-07', { conPendientes: true });
		await reabrirDia('push', '2026-01-07');
		const s = await db.sesiones.get('2026-01-07__push');
		expect(s?.diaTerminado).toBe(false);
		expect(s?.diaTerminadoConPendientes).toBeUndefined();
	});
});

describe('la sesion no puede cambiar de identidad en silencio (R1)', () => {
	beforeEach(async () => {
		vi.useRealTimers();
		await limpiarDb();
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 3, orden: 0 }]
		});
	});

	it('el trabajo de antes de medianoche queda ofrecido desde la pantalla vacia de hoy', async () => {
		// 23:40 — la persona entrena la sesión del 27.
		vi.setSystemTime(new Date('2026-08-27T23:40:00'));
		await prepararEjercicioSesion('push', 'press', '2026-08-27');
		await setPeso('push', 'press', 0, 80, '2026-08-27');
		await setReps('push', 'press', 0, 10, '2026-08-27');
		await setSerieHecha('push', 'press', 0, true, '2026-08-27');

		// 00:05 — vuelve por Inicio, que no lleva ?fecha: la pantalla es la del 28 y está
		// vacía, con los pesos prellenados y ningún tilde. Eso es lo que se leía como
		// "se me borró el entrenamiento".
		vi.setSystemTime(new Date('2026-08-28T00:05:00'));
		await prepararEjercicioSesion('push', 'press', '2026-08-28');
		const hoy = await db.sesiones.get('2026-08-28__push');
		expect(hoy?.ejercicios[0]?.sets.some((set) => set.hecha)).toBe(false);

		// Lo que arregla R1: desde esa pantalla vacía hay cómo enterarse y volver.
		expect(await sesionRecienteDe('push', 'press', '2026-08-28')).toEqual({
			fecha: '2026-08-27',
			seriesHechas: 1,
			tieneEjercicio: true
		});
		vi.useRealTimers();
	});

	it('no ofrece nada cuando el dia anterior quedo abierto hace mucho', async () => {
		vi.setSystemTime(new Date('2026-08-21T20:00:00'));
		await prepararEjercicioSesion('push', 'press', '2026-08-21');
		await setReps('push', 'press', 0, 10, '2026-08-21');
		await setSerieHecha('push', 'press', 0, true, '2026-08-21');

		vi.setSystemTime(new Date('2026-08-28T10:00:00'));
		expect(await sesionRecienteDe('push', 'press', '2026-08-28')).toBeNull();
		vi.useRealTimers();
	});

	it('solo mira las fechas vecinas: una sesion de hoy no se ofrece a si misma', async () => {
		vi.setSystemTime(new Date('2026-08-28T10:00:00'));
		await prepararEjercicioSesion('push', 'press', '2026-08-28');
		await setReps('push', 'press', 0, 10, '2026-08-28');
		await setSerieHecha('push', 'press', 0, true, '2026-08-28');
		expect(await sesionRecienteDe('push', 'press', '2026-08-28')).toBeNull();
		vi.useRealTimers();
	});

	it('guardarSesion sella cuando se toco la sesion por ultima vez', async () => {
		vi.setSystemTime(new Date('2026-08-27T23:40:00'));
		await prepararEjercicioSesion('push', 'press', '2026-08-27');
		await setReps('push', 'press', 0, 10, '2026-08-27');
		const sellada = await db.sesiones.get('2026-08-27__push');
		expect(sellada?.tocadaAt).toBe(new Date('2026-08-27T23:40:00').toISOString());
		vi.useRealTimers();
	});

	it('editar o borrar una serie desde el historial no sella tocadaAt', async () => {
		// Ayer se entrenó: ese es el único sello legítimo de la sesión.
		vi.setSystemTime(new Date('2026-08-27T20:00:00'));
		await prepararEjercicioSesion('push', 'press', '2026-08-27');
		await setPeso('push', 'press', 0, 80, '2026-08-27');
		await setReps('push', 'press', 0, 10, '2026-08-27');
		await setSerieHecha('push', 'press', 0, true, '2026-08-27');
		const selloEntrenamiento = new Date('2026-08-27T20:00:00').toISOString();

		// Hoy a la mañana se corrige el peso desde el historial: eso no es entrenar, y
		// sellarlo hacía que la rutina vacía de hoy ofreciera "retomar" la sesión de ayer.
		vi.setSystemTime(new Date('2026-08-28T09:00:00'));
		expect(
			await actualizarSetHistorial('2026-08-27__push', 'press', 0, { peso: 82, reps: 10 })
		).toBe(true);
		expect((await db.sesiones.get('2026-08-27__push'))?.tocadaAt).toBe(selloEntrenamiento);

		expect(await borrarSetHistorial('2026-08-27__push', 'press', 0)).toBe(true);
		expect((await db.sesiones.get('2026-08-27__push'))?.tocadaAt).toBe(selloEntrenamiento);
		vi.useRealTimers();
	});

	it('la degradacion de un PR posterior tampoco sella esa sesion', async () => {
		// Lunes: 100 kg. Martes: 105 kg, que se celebra como PR.
		vi.setSystemTime(new Date('2026-08-24T20:00:00'));
		await prepararEjercicioSesion('push', 'press', '2026-08-24');
		await setPeso('push', 'press', 0, 100, '2026-08-24');
		await setReps('push', 'press', 0, 10, '2026-08-24');
		await setSerieHecha('push', 'press', 0, true, '2026-08-24');

		vi.setSystemTime(new Date('2026-08-25T20:00:00'));
		await prepararEjercicioSesion('push', 'press', '2026-08-25');
		await setPeso('push', 'press', 0, 105, '2026-08-25');
		await setReps('push', 'press', 0, 10, '2026-08-25');
		await setSerieHecha('push', 'press', 0, true, '2026-08-25');
		expect(await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-08-25')).not.toBeNull();
		const selloMartes = (await db.sesiones.get('2026-08-25__push'))?.tocadaAt;

		// Días después, corregir el lunes a 120 kg tapa retroactivamente el PR del martes.
		// El martes pierde su celebración, pero nadie lo estuvo entrenando: sigue con su sello.
		vi.setSystemTime(new Date('2026-08-28T09:00:00'));
		expect(
			await actualizarSetHistorial('2026-08-24__push', 'press', 0, { peso: 120, reps: 10 })
		).toBe(true);
		const martes = await db.sesiones.get('2026-08-25__push');
		expect(martes?.ejercicios[0]?.prCelebrado).toBeUndefined();
		expect(martes?.tocadaAt).toBe(selloMartes);
		vi.useRealTimers();
	});

	it('retomar un ejercicio saltado sella; descartar el cartel de reapertura no', async () => {
		vi.setSystemTime(new Date('2026-08-27T20:00:00'));
		await saltarEjercicio('push', 'press', '2026-08-27');
		await marcarDiaTerminado('push', '2026-08-27');

		// Retomar es entrenar: antes iba por `.modify()` directo y no dejaba sello.
		vi.setSystemTime(new Date('2026-08-27T20:30:00'));
		await reanudarEjercicio('push', 'press', '2026-08-27');
		const retomada = await db.sesiones.get('2026-08-27__push');
		expect(retomada?.tocadaAt).toBe(new Date('2026-08-27T20:30:00').toISOString());
		expect(retomada?.reaperturaMotivo).toBeTruthy();

		// Leer el cartel al otro día no es entrenar.
		vi.setSystemTime(new Date('2026-08-28T09:00:00'));
		await descartarReapertura('push', '2026-08-27');
		const descartada = await db.sesiones.get('2026-08-27__push');
		expect(descartada?.reaperturaMotivo).toBeUndefined();
		expect(descartada?.tocadaAt).toBe(retomada?.tocadaAt);
		vi.useRealTimers();
	});
});

describe('ninguna escritura de serie resuelve sin haber escrito (R2)', () => {
	beforeEach(async () => {
		vi.useRealTimers();
		await limpiarDb();
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 2, orden: 0 }]
		});
	});

	it('avisa que no encontro destino cuando no existe la sesion', async () => {
		const f = '2026-08-27';
		expect(await setPeso('push', 'press', 0, 80, f)).toEqual({ encontrada: false });
		expect(await setReps('push', 'press', 0, 10, f)).toEqual({ encontrada: false });
		expect(await setExtra('push', 'press', 0, 5, f)).toEqual({ encontrada: false });
		expect(await setRir('push', 'press', 0, 2, f)).toEqual({ encontrada: false });
		expect(await toggleMax('push', 'press', 0, f)).toEqual({ encontrada: false });
		expect(await addSet('push', 'press', f)).toEqual({ encontrada: false });
		expect(await db.sesiones.get(sesionId('push', f))).toBeUndefined();
	});

	it('avisa cuando el ejercicio ya no esta en la sesion', async () => {
		const f = '2026-08-27';
		await prepararEjercicioSesion('push', 'press', f);
		const sesion = (await db.sesiones.get(sesionId('push', f)))!;
		sesion.ejercicios = [];
		await guardarSesion(sesion);

		expect(await setPeso('push', 'press', 0, 100, f)).toEqual({ encontrada: false });
	});

	it('avisa cuando la serie que se toca ya no existe', async () => {
		const f = '2026-08-27';
		await prepararEjercicioSesion('push', 'press', f);
		// La rutina pide 2 series: el índice 5 no existe.
		expect(await setPeso('push', 'press', 5, 100, f)).toEqual({ encontrada: false });
		expect(await setReps('push', 'press', 5, 10, f)).toEqual({ encontrada: false });
		expect(await toggleMax('push', 'press', 5, f)).toEqual({ encontrada: false });
		expect(await setRir('push', 'press', 5, 2, f)).toEqual({ encontrada: false });
		expect(await setExtra('push', 'press', 5, 1, f)).toEqual({ encontrada: false });
	});

	it('confirma la escritura cuando si hay destino', async () => {
		const f = '2026-08-27';
		await prepararEjercicioSesion('push', 'press', f);
		expect(await setPeso('push', 'press', 0, 80, f)).toEqual({ encontrada: true });
		expect(await addSet('push', 'press', f)).toEqual({ encontrada: true });
		const sesion = await db.sesiones.get(sesionId('push', f));
		expect(sesion?.ejercicios[0]?.sets[0]?.peso).toBe(80);
		expect(sesion?.ejercicios[0]?.sets).toHaveLength(3);
	});
});

describe('una fecha futura no puede crear trabajo', () => {
	beforeEach(async () => {
		vi.useRealTimers();
		await limpiarDb();
		vi.setSystemTime(new Date('2026-08-28T10:00:00'));
		await db.dias.add({
			id: 'push',
			nombre: 'Push',
			orden: 0,
			ejercicios: [{ exerciseId: 'press', seriesObjetivo: 2, orden: 0 }]
		});
	});

	it('prepararEjercicioSesion lo dice en vez de inventar una sesión', async () => {
		expect(await prepararEjercicioSesion('push', 'press', '2030-01-01')).toEqual({
			disponible: false,
			motivo: 'fecha-futura'
		});
		expect(await db.sesiones.count()).toBe(0);
		vi.useRealTimers();
	});

	it('saltar un ejercicio en el futuro tampoco crea la sesión', async () => {
		expect(await saltarEjercicio('push', 'press', '2030-01-01')).toEqual({
			saltado: false,
			razon: 'fecha-futura'
		});
		expect(await db.sesiones.count()).toBe(0);
		vi.useRealTimers();
	});

	it('el dominio también corta por lo bajo, sin pasar por la pantalla', async () => {
		await expect(ensureEjercicio('push', 'press', 2, '2030-01-01')).rejects.toThrow('fecha futura');
		expect(await db.sesiones.count()).toBe(0);
		vi.useRealTimers();
	});

	it('hoy y el pasado siguen funcionando igual', async () => {
		expect(await prepararEjercicioSesion('push', 'press', '2026-08-28')).toMatchObject({
			disponible: true
		});
		expect(await prepararEjercicioSesion('push', 'press', '2026-08-01')).toMatchObject({
			disponible: true
		});
		expect(await db.sesiones.count()).toBe(2);
		vi.useRealTimers();
	});

	it('una sesión futura que ya existe se sigue pudiendo abrir y arreglar', async () => {
		// Datos viejos pueden traerla (o un backup con el reloj corrido): la barrera es
		// contra CREARLA, no contra poder entrar a corregir lo que ya está guardado.
		await guardarSesion({
			id: '2030-01-01__push',
			fecha: '2030-01-01',
			diaId: 'push',
			ejercicios: []
		});
		expect(await prepararEjercicioSesion('push', 'press', '2030-01-01')).toMatchObject({
			disponible: true
		});
		vi.useRealTimers();
	});
});

/**
 * El snapshot de un PR y la serie que lo ganó tienen que guardar EXACTAMENTE los mismos
 * gramos. Es lo único que sostiene `coincideConPr`, y de ahí cuelgan el trofeo de la
 * pantalla, los "PRs del día" y el resumen del historial.
 *
 * Se rompía porque el snapshot no copiaba el canónico: lo recalculaba desde el peso
 * visible, que está redondeado a la décima de la unidad con la que se lee. 220,5 lb son
 * 100.017 g; leídos como kg dan 100,0 y vueltos a canonizar, 100.000. El PR seguía
 * guardado y ninguna pantalla lo reconocía. En kg nativo no se veía nunca, y por eso
 * estos casos van en lb: es la unidad donde el redondeo del visible pierde información.
 */
describe('el snapshot del PR conserva los gramos de su serie', () => {
	beforeEach(async () => {
		vi.useRealTimers();
		await limpiarDb();
	});

	async function serieEnLb(fecha: string, i: number, lb: number, reps: number) {
		await setPeso('push', 'press', i, lb, fecha, 'lb');
		await setReps('push', 'press', i, reps, fecha);
		await setSerieHecha('push', 'press', i, true, fecha);
	}

	async function ejercicioDe(fecha: string) {
		const sesion = await db.sesiones.get(sesionId('push', fecha));
		return sesion!.ejercicios[0]!;
	}

	it('al celebrarlo en lb', async () => {
		const f = '2026-02-01';
		await ensureEjercicio('push', 'press', 2, f, 'lb');
		await serieEnLb(f, 0, 220.5, 8);

		expect(await registrarPrSiSupera('push', 'press', 0, 'peso', f, 'lb')).not.toBeNull();
		const e = await ejercicioDe(f);
		expect(e.prCelebrado?.pesoGramos).toBe(e.sets[0]!.pesoGramos);
		expect(prRespaldado(e.sets, e.prCelebrado)).toBe(true);
	});

	it('después de tocar otra serie del mismo ejercicio', async () => {
		const f = '2026-02-01';
		await ensureEjercicio('push', 'press', 2, f, 'lb');
		await serieEnLb(f, 0, 220.5, 8);
		await registrarPrSiSupera('push', 'press', 0, 'peso', f, 'lb');

		// Cargar las reps de la serie 2 revalida el PR: acá se re-sellaba en kg.
		await setReps('push', 'press', 1, 8, f);
		const e = await ejercicioDe(f);
		expect(e.prCelebrado?.pesoGramos).toBe(e.sets[0]!.pesoGramos);
		expect(prRespaldado(e.sets, e.prCelebrado)).toBe(true);
		const sesion = await db.sesiones.get(sesionId('push', f));
		expect(resumenDiaSesion(sesion, 'lb').prs).toHaveLength(1);
	});

	it('con la serie cargada en kg y el PR celebrado con la app en lb', async () => {
		const f = '2026-02-01';
		await ensureEjercicio('push', 'press', 1, f);
		await setPeso('push', 'press', 0, 100, f);
		await setReps('push', 'press', 0, 8, f);
		await setSerieHecha('push', 'press', 0, true, f);

		// Cambiar de unidad no puede reescribir lo que ya está guardado en gramos.
		expect(await registrarPrSiSupera('push', 'press', 0, 'peso', f, 'lb')).not.toBeNull();
		const e = await ejercicioDe(f);
		expect(e.sets[0]!.pesoGramos).toBe(100_000);
		expect(e.prCelebrado?.pesoGramos).toBe(100_000);
		expect(prRespaldado(e.sets, e.prCelebrado)).toBe(true);
	});

	it('al corregir otra serie de esa sesión desde el historial, en lb', async () => {
		const f = '2026-02-01';
		await ensureEjercicio('push', 'press', 2, f, 'lb');
		await serieEnLb(f, 0, 220.5, 8);
		await serieEnLb(f, 1, 200, 10);
		await registrarPrSiSupera('push', 'press', 0, 'peso', f, 'lb');

		expect(
			await actualizarSetHistorial(sesionId('push', f), 'press', 1, { peso: 200, reps: 9 }, 'lb')
		).toBe(true);
		const e = await ejercicioDe(f);
		expect(e.prCelebrado?.pesoGramos).toBe(e.sets[0]!.pesoGramos);
		expect(prRespaldado(e.sets, e.prCelebrado)).toBe(true);
	});

	it('sobrevive al ida y vuelta por un backup en lb', async () => {
		// El import descarta los PR que no coinciden con ninguna serie hecha. Con el
		// snapshot desalineado, restaurar un backup se llevaba puesto el récord del día.
		const f = '2026-02-01';
		await db.ajustes.put(normalizarAjustes({ id: 'app', unidad: 'lb' } as never));
		await ensureEjercicio('push', 'press', 2, f, 'lb');
		await serieEnLb(f, 0, 220.5, 8);
		await registrarPrSiSupera('push', 'press', 0, 'peso', f, 'lb');
		// Seguir entrenando revalida el PR, que es donde el snapshot se desalineaba.
		await setReps('push', 'press', 1, 8, f);

		const { datos, avisos } = prepararImport(parseBackup(await exportarJSON()));
		expect(avisos.filter((a) => a.includes('PR'))).toEqual([]);
		const ejercicio = datos.sesiones.find((x) => x.id === sesionId('push', f))!.ejercicios[0]!;
		expect(ejercicio.prCelebrado?.pesoGramos).toBe(ejercicio.sets[0]!.pesoGramos);
	});

	it('el récord anterior que viaja adentro del PR también conserva sus gramos', async () => {
		await ensureEjercicio('push', 'press', 1, '2026-02-01', 'lb');
		await serieEnLb('2026-02-01', 0, 220.5, 8);
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-02-01', 'lb');

		await ensureEjercicio('push', 'press', 1, '2026-02-08', 'lb');
		await serieEnLb('2026-02-08', 0, 231, 8);
		await registrarPrSiSupera('push', 'press', 0, 'peso', '2026-02-08', 'lb');

		const anterior = await ejercicioDe('2026-02-01');
		const nuevo = await ejercicioDe('2026-02-08');
		expect(nuevo.prCelebrado?.previo?.pesoGramos).toBe(anterior.sets[0]!.pesoGramos);
	});
});
