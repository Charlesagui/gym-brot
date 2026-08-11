import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
	agregarEjercicio,
	ajustarSeries,
	crearDia,
	quitarEjercicio,
	reordenarDias,
	reordenarEjercicios,
	toggleDiaSemana
} from './dias';

async function limpiarDb() {
	await db.open();
	await db.dias.clear();
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
