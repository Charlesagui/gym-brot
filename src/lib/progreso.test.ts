import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Sesion, SetSesion } from './db';
import { crearProgresoEjercicio, indexSetPr } from './progreso';

function sesion(
	fecha: string,
	sets: SetSesion[],
	prCelebrado?: { peso?: number; reps?: number; esMax?: boolean; extraKg?: number }
): Sesion {
	return {
		id: `${fecha}__push`,
		fecha,
		diaId: 'push',
		ejercicios: [{ exerciseId: 'press', sets, prCelebrado }]
	};
}

describe('indexSetPr', () => {
	it('encuentra la primera serie hecha que coincide con el PR celebrado', () => {
		const sets: SetSesion[] = [
			{ peso: 100, reps: 5, hecha: false },
			{ peso: 100, reps: 5, hecha: true },
			{ peso: 100, reps: 5, hecha: true }
		];
		expect(indexSetPr(sets, { peso: 100, reps: 5 })).toBe(1);
		expect(indexSetPr(sets, { peso: 90, reps: 5 })).toBe(-1);
		expect(indexSetPr(sets, undefined)).toBe(-1);
	});

	it('distingue MAX y extraKg al ubicar el set del PR', () => {
		const sets: SetSesion[] = [
			{ peso: 100, reps: 5, hecha: true },
			{ peso: 100, reps: 5, hecha: true, esMax: true, extraKg: 5 }
		];
		expect(indexSetPr(sets, { peso: 100, reps: 5, esMax: true, extraKg: 5 })).toBe(1);
	});
});

describe('crearProgresoEjercicio', () => {
	afterEach(() => vi.useRealTimers());

	it('no presenta sesiones futuras como progreso realizado', () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		const progreso = crearProgresoEjercicio(
			[
				sesion('2026-01-06', [{ peso: 80, reps: 8, hecha: true }]),
				sesion('2026-01-08', [{ peso: 120, reps: 8, hecha: true }])
			],
			'press'
		);
		expect(progreso.mejorPeso).toMatchObject({ valor: 80 });
		expect(progreso.sesiones.map((sesion) => sesion.fecha)).toEqual(['2026-01-06']);
	});

	it('deriva records, set records por reps e historial descendente en una pasada', () => {
		const progreso = crearProgresoEjercicio(
			[
				sesion('2026-01-01', [
					{ peso: 80, reps: 10, hecha: true },
					{ peso: 90, reps: 5, hecha: true },
					{ peso: 95, reps: 5, hecha: false } // no hecha: no puntua ni aparece
				]),
				sesion('2026-01-08', [{ peso: 100, reps: 5, hecha: true, esMax: true, extraKg: 2.5 }], {
					peso: 100,
					reps: 5,
					esMax: true,
					extraKg: 2.5
				})
			],
			'press'
		);

		expect(progreso.modo).toBe('peso');
		// Peso maximo: el set MAX con extra (efectivo 102.5).
		expect(progreso.mejorPeso).toMatchObject({ peso: 100, extraKg: 2.5, valor: 102.5 });
		// e1RM: 102.5 × (1 + 5/30).
		expect(progreso.mejorE1rm?.valor).toBe(119.6);
		// Set records: mejor peso efectivo por cantidad de reps, ordenado por reps.
		expect(progreso.setRecords).toHaveLength(2);
		expect(progreso.setRecords[0]).toMatchObject({ reps: 5, fecha: '2026-01-08' });
		expect(progreso.setRecords[1]).toMatchObject({ reps: 10, fecha: '2026-01-01' });
		// Historial: descendente, solo series hechas, con el set del PR marcado.
		expect(progreso.sesiones.map((s) => s.fecha)).toEqual(['2026-01-08', '2026-01-01']);
		expect(progreso.sesiones[0]!.series[0]).toMatchObject({ esPr: true, setIndex: 0 });
		expect(progreso.sesiones[1]!.series).toHaveLength(2);
		expect(progreso.totalSeries).toBe(3);
	});

	it('en empate de peso conserva la primera fecha en que se logro', () => {
		const progreso = crearProgresoEjercicio(
			[
				sesion('2026-01-01', [{ peso: 80, reps: 8, hecha: true }]),
				sesion('2026-01-08', [{ peso: 80, reps: 8, hecha: true }])
			],
			'press'
		);
		expect(progreso.setRecords).toEqual([
			{ reps: 8, set: { peso: 80, reps: 8, hecha: true }, fecha: '2026-01-01' }
		]);
	});

	it('ejercicio sin peso: modo reps con record de reps y sin set records', () => {
		const progreso = crearProgresoEjercicio(
			[
				sesion('2026-01-01', [
					{ reps: 8, hecha: true },
					{ reps: 12, hecha: true }
				])
			],
			'press'
		);

		expect(progreso.modo).toBe('reps');
		expect(progreso.mejorReps).toMatchObject({ reps: 12, valor: 12 });
		expect(progreso.mejorPeso).toBeNull();
		expect(progreso.mejorE1rm).toBeNull();
		expect(progreso.setRecords).toEqual([]);
		expect(progreso.totalSeries).toBe(2);
	});

	it('sin sesiones del ejercicio devuelve un progreso vacio', () => {
		const progreso = crearProgresoEjercicio([sesion('2026-01-01', [])], 'otro');
		expect(progreso.sesiones).toEqual([]);
		expect(progreso.mejorPeso).toBeNull();
		expect(progreso.totalSeries).toBe(0);
	});
});
