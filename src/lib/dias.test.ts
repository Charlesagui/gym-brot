import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
	agregarEjercicio,
	ajustarSeries,
	crearDia,
	decidirRecomendacionDoble,
	quitarEjercicio,
	reordenarDias,
	reordenarEjercicios,
	setProgresionDoble,
	toggleDiaSemana
} from './dias';
import type { RecomendacionDoble } from './progresion';

async function limpiarDb() {
	await db.open();
	await Promise.all([db.dias.clear(), db.sesiones.clear()]);
}

async function diaCon(ejercicios: string[]) {
	await db.dias.add({
		id: 'd1',
		nombre: 'Día',
		orden: 0,
		ejercicios: ejercicios.map((exerciseId, orden) => ({ exerciseId, seriesObjetivo: 3, orden }))
	});
}

/**
 * Todo este bloque existe por un bug real: las escrituras leían el día, lo mutaban y
 * lo volvían a guardar sin transacción, y la pantalla mandaba valores absolutos
 * calculados sobre lo que tenía renderizado. Dos toques rápidos (antes de que el
 * liveQuery emitiera) perdían una escritura. Los tests corren las operaciones en
 * paralelo justamente para reproducir esa carrera.
 */
const recomendacionBase: RecomendacionDoble = {
	sesionId: 'sesion-anterior',
	seriesEvaluadas: 3,
	repsMax: 12,
	incrementoGramos: 2_500,
	pesoActualGramos: 80_000,
	pesoObjetivoGramos: 82_500,
	esMax: false,
	extraActualGramos: 0,
	extraObjetivoGramos: 0,
	explicacion: 'Tres series en el techo.'
};

describe('dias: escrituras concurrentes', () => {
	beforeEach(limpiarDb);

	it('dos toques de + suman dos series', async () => {
		await diaCon(['press']);
		await Promise.all([ajustarSeries('d1', 'press', 1), ajustarSeries('d1', 'press', 1)]);
		expect((await db.dias.get('d1'))?.ejercicios[0]?.seriesObjetivo).toBe(5);
	});

	it('las series quedan acotadas entre 1 y 12', async () => {
		await diaCon(['press']);
		await Promise.all(Array.from({ length: 20 }, () => ajustarSeries('d1', 'press', 1)));
		expect((await db.dias.get('d1'))?.ejercicios[0]?.seriesObjetivo).toBe(12);
		await Promise.all(Array.from({ length: 20 }, () => ajustarSeries('d1', 'press', -1)));
		expect((await db.dias.get('d1'))?.ejercicios[0]?.seriesObjetivo).toBe(1);
	});

	it('agregar dos ejercicios en paralelo conserva los dos', async () => {
		await diaCon([]);
		await Promise.all([agregarEjercicio('d1', 'press'), agregarEjercicio('d1', 'remo')]);
		const ejercicios = (await db.dias.get('d1'))?.ejercicios ?? [];
		expect(ejercicios.map((e) => e.exerciseId).sort()).toEqual(['press', 'remo']);
		// Sin órdenes repetidos: el segundo se calcula sobre el día ya actualizado.
		expect(new Set(ejercicios.map((e) => e.orden)).size).toBe(2);
	});

	it('agregar el mismo ejercicio dos veces no lo duplica', async () => {
		await diaCon([]);
		await Promise.all([agregarEjercicio('d1', 'press'), agregarEjercicio('d1', 'press')]);
		expect((await db.dias.get('d1'))?.ejercicios).toHaveLength(1);
	});

	it('agregar un ejercicio reabre la sesión terminada del día actual', async () => {
		await diaCon(['press']);
		const fecha = new Date().toLocaleDateString('sv');
		await db.sesiones.add({
			id: `${fecha}__d1`,
			fecha,
			diaId: 'd1',
			diaTerminado: true,
			diaTerminadoAt: '2026-01-01T20:00:00.000Z',
			ejercicios: []
		});

		await agregarEjercicio('d1', 'remo');

		expect(await db.sesiones.get(`${fecha}__d1`)).toMatchObject({
			diaTerminado: false,
			diaTerminadoAt: undefined
		});
	});

	it('dos chips de día de la semana seguidos suman los dos', async () => {
		await diaCon([]);
		await Promise.all([toggleDiaSemana('d1', 1), toggleDiaSemana('d1', 3)]);
		expect((await db.dias.get('d1'))?.diasSemana).toEqual([1, 3]);
	});

	it('destildar el último día de la semana deja la agenda vacía', async () => {
		await diaCon([]);
		await toggleDiaSemana('d1', 2);
		await toggleDiaSemana('d1', 2);
		expect((await db.dias.get('d1'))?.diasSemana).toBeUndefined();
	});

	it('dos días nuevos en paralelo no comparten orden', async () => {
		const [a, b] = await Promise.all([crearDia(), crearDia()]);
		expect(a).not.toBe(b);
		const ordenes = (await db.dias.toArray()).map((d) => d.orden).sort();
		expect(ordenes).toEqual([0, 1]);
	});
});

describe('dias: reordenar', () => {
	beforeEach(limpiarDb);

	it('reordena ejercicios y normaliza el orden a 0..n-1', async () => {
		await diaCon(['a', 'b', 'c']);
		await reordenarEjercicios('d1', ['c', 'a', 'b']);
		expect((await db.dias.get('d1'))?.ejercicios).toEqual([
			{ exerciseId: 'c', seriesObjetivo: 3, orden: 0 },
			{ exerciseId: 'a', seriesObjetivo: 3, orden: 1 },
			{ exerciseId: 'b', seriesObjetivo: 3, orden: 2 }
		]);
	});

	it('un id faltante en la lista no borra el ejercicio', async () => {
		await diaCon(['a', 'b', 'c']);
		await reordenarEjercicios('d1', ['c', 'a']);
		expect((await db.dias.get('d1'))?.ejercicios.map((e) => e.exerciseId)).toEqual(['c', 'a', 'b']);
	});

	it('quitar un ejercicio deja el resto intacto', async () => {
		await diaCon(['a', 'b']);
		await quitarEjercicio('d1', 'a');
		expect((await db.dias.get('d1'))?.ejercicios.map((e) => e.exerciseId)).toEqual(['b']);
	});

	it('reordenar días normaliza el orden', async () => {
		await db.dias.bulkAdd([
			{ id: 'x', nombre: 'X', orden: 0, ejercicios: [] },
			{ id: 'y', nombre: 'Y', orden: 1, ejercicios: [] },
			{ id: 'z', nombre: 'Z', orden: 2, ejercicios: [] }
		]);
		await reordenarDias(['z', 'x', 'y']);
		const dias = await db.dias.orderBy('orden').toArray();
		expect(dias.map((d) => d.id)).toEqual(['z', 'x', 'y']);
		expect(dias.map((d) => d.orden)).toEqual([0, 1, 2]);
	});
});

describe('dias: doble progresión', () => {
	beforeEach(limpiarDb);

	it('la configuración queda aislada por aparición en la rutina', async () => {
		await db.dias.bulkAdd([
			{
				id: 'a',
				nombre: 'A',
				orden: 0,
				ejercicios: [{ exerciseId: 'press', seriesObjetivo: 3, orden: 0 }]
			},
			{
				id: 'b',
				nombre: 'B',
				orden: 1,
				ejercicios: [{ exerciseId: 'press', seriesObjetivo: 4, orden: 0 }]
			}
		]);

		await setProgresionDoble('a', 'press', { activa: true, repsMin: 8, repsMax: 12 });

		expect((await db.dias.get('a'))?.ejercicios[0]?.progresion).toMatchObject({
			activa: true,
			tipo: 'doble',
			repsMin: 8,
			repsMax: 12
		});
		expect((await db.dias.get('b'))?.ejercicios[0]?.progresion).toBeUndefined();
	});

	it('aceptar, posponer o descartar persiste una decisión explícita', async () => {
		await diaCon(['press']);
		await setProgresionDoble('d1', 'press', { activa: true, repsMin: 8, repsMax: 12 });
		const recomendacion = {
			sesionId: '2026-01-05__d1',
			seriesEvaluadas: 3,
			repsMax: 12,
			incrementoGramos: 2_500,
			pesoActualGramos: 80_000,
			pesoObjetivoGramos: 82_500,
			esMax: false,
			extraActualGramos: 0,
			extraObjetivoGramos: 0,
			explicacion: 'Tres series en el techo.'
		};

		await decidirRecomendacionDoble('d1', 'press', recomendacion, 'aceptada');
		expect((await db.dias.get('d1'))?.ejercicios[0]?.progresion).toMatchObject({
			decision: 'aceptada',
			decisionSesionId: recomendacion.sesionId,
			proximoPesoGramos: 82_500,
			desdeSesionId: recomendacion.sesionId
		});

		await decidirRecomendacionDoble('d1', 'press', recomendacion, 'pospuesta');
		expect((await db.dias.get('d1'))?.ejercicios[0]?.progresion).toMatchObject({
			decision: 'pospuesta',
			decisionSesionId: recomendacion.sesionId,
			proximoPesoGramos: undefined,
			desdeSesionId: undefined
		});

		await decidirRecomendacionDoble('d1', 'press', recomendacion, 'descartada');
		expect((await db.dias.get('d1'))?.ejercicios[0]?.progresion?.decision).toBe('descartada');
	});

	it('retocar el rango conserva la carga que el usuario ya aceptó', async () => {
		await diaCon(['press']);
		await setProgresionDoble('d1', 'press', { activa: true, repsMin: 8, repsMax: 12 });
		await decidirRecomendacionDoble('d1', 'press', recomendacionBase, 'aceptada');

		// El toque de + en el máximo de reps no puede tirar la decisión ya tomada.
		await setProgresionDoble('d1', 'press', { activa: true, repsMin: 8, repsMax: 13 });
		expect((await db.dias.get('d1'))?.ejercicios[0]?.progresion).toMatchObject({
			repsMax: 13,
			proximoPesoGramos: 82_500,
			desdeSesionId: recomendacionBase.sesionId,
			decision: 'aceptada'
		});
	});

	it('apagar la progresión sí descarta la carga aceptada', async () => {
		await diaCon(['press']);
		await setProgresionDoble('d1', 'press', { activa: true, repsMin: 8, repsMax: 12 });
		await decidirRecomendacionDoble('d1', 'press', recomendacionBase, 'aceptada');

		await setProgresionDoble('d1', 'press', { activa: false, repsMin: 8, repsMax: 12 });
		const progresion = (await db.dias.get('d1'))?.ejercicios[0]?.progresion;
		expect(progresion?.activa).toBe(false);
		expect(progresion?.proximoPesoGramos).toBeUndefined();
		expect(progresion?.desdeSesionId).toBeUndefined();
	});
});
