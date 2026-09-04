import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dia, Sesion } from './db';
import { crearHistorialResumen } from './historial';
import { pieDePlaca, placasConstancia, placasGanadasEl } from './placas';

const dia: Dia = { id: 'piernas', nombre: 'Piernas', orden: 1, ejercicios: [] };

/** Un día entrenado completo (sin plan, una serie hecha: el trato de siempre). */
function sesion(fecha: string, hecha = true): Sesion {
	return {
		id: `${fecha}__piernas`,
		fecha,
		diaId: 'piernas',
		ejercicios: [{ exerciseId: 'sentadilla', sets: [{ peso: 100, reps: 5, hecha }] }]
	};
}

/** Un día parcial: plan de doce series y una sola hecha. */
function parcial(fecha: string): Sesion {
	return { ...sesion(fecha), plan: { ejercicios: 1, series: 12 } };
}

const porId = (placas: ReturnType<typeof placasConstancia>, id: string) =>
	placas.find((p) => p.id === id)!;

describe('placas de Constancia', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('sin historial: la primera de cada escalera está en curso desde cero y el resto falta', () => {
		vi.setSystemTime(new Date('2026-02-04T12:00:00'));
		const placas = placasConstancia(crearHistorialResumen([], [dia]));

		expect(placas.map((p) => [p.id, p.estado, p.progreso])).toEqual([
			['racha-4', 'en-curso', 0],
			['racha-13', 'falta', 0],
			['racha-26', 'falta', 0],
			['racha-52', 'falta', 0],
			['dias-10', 'en-curso', 0],
			['dias-50', 'falta', 0],
			['dias-100', 'falta', 0]
		]);
		expect(placas.every((p) => p.ganadaEl === undefined)).toBe(true);
	});

	it('cinco semanas seguidas: gana el mes, y la fecha es el primer día de la cuarta semana', () => {
		// Lunes 5 de enero de 2026 en adelante, una sesión por semana; hoy es miércoles 4/2.
		vi.setSystemTime(new Date('2026-02-04T12:00:00'));
		const sesiones = ['2026-01-05', '2026-01-14', '2026-01-19', '2026-01-30', '2026-02-02'].map(
			(f) => sesion(f)
		);
		const placas = placasConstancia(crearHistorialResumen(sesiones, [dia]));

		expect(porId(placas, 'racha-4')).toMatchObject({
			estado: 'ganada',
			progreso: 4,
			ganadaEl: '2026-01-30'
		});
		// Sólo UNA en curso por escalera: la siguiente que falta.
		expect(porId(placas, 'racha-13')).toMatchObject({ estado: 'en-curso', progreso: 5 });
		expect(porId(placas, 'racha-26')).toMatchObject({ estado: 'falta', progreso: 5 });
		expect(placas.filter((p) => p.estado === 'en-curso').map((p) => p.id)).toEqual([
			'racha-13',
			'dias-10'
		]);
	});

	it('una racha rota sigue contando como ganada: los logros son historia, no estado', () => {
		// Cuatro semanas seguidas, una semana sin ir, y una semana nueva. Hoy: miércoles 11/2.
		vi.setSystemTime(new Date('2026-02-11T12:00:00'));
		const sesiones = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-09'].map(
			(f) => sesion(f)
		);
		const resumen = crearHistorialResumen(sesiones, [dia]);
		expect(resumen.rachaSemanal).toBe(1);

		const placas = placasConstancia(resumen);
		expect(porId(placas, 'racha-4')).toMatchObject({ estado: 'ganada', ganadaEl: '2026-01-26' });
		// El progreso hacia la próxima es la racha de HOY, no la mejor que tuviste.
		expect(porId(placas, 'racha-13')).toMatchObject({ estado: 'en-curso', progreso: 1 });
	});

	it('la semana en gracia no baja el progreso: hereda la racha con gracia del historial', () => {
		// Cuatro semanas entrenadas y la actual todavía sin entrenar.
		vi.setSystemTime(new Date('2026-02-04T12:00:00'));
		const sesiones = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map((f) => sesion(f));
		const placas = placasConstancia(crearHistorialResumen(sesiones, [dia]));

		expect(porId(placas, 'racha-4')).toMatchObject({ estado: 'ganada', ganadaEl: '2026-01-26' });
		expect(porId(placas, 'racha-13')).toMatchObject({ estado: 'en-curso', progreso: 4 });
	});

	it('los días completos cuentan los parciales aparte: el décimo es el décimo COMPLETO', () => {
		// Hoy es miércoles 28/1: la semana en curso está en gracia y las tres anteriores cuentan.
		vi.setSystemTime(new Date('2026-01-28T12:00:00'));
		const completos = [
			'2026-01-05',
			'2026-01-06',
			'2026-01-07',
			'2026-01-08',
			'2026-01-12',
			'2026-01-13',
			'2026-01-14',
			'2026-01-15',
			'2026-01-19',
			'2026-01-20',
			'2026-01-21'
		];
		const sesiones = [
			...completos.map((f) => sesion(f)),
			parcial('2026-01-09'),
			parcial('2026-01-16')
		];
		const resumen = crearHistorialResumen(sesiones, [dia]);
		expect(resumen.totalDias).toBe(11);
		expect(resumen.totalParciales).toBe(2);

		const placas = placasConstancia(resumen);
		// Con los parciales en el medio, el décimo día ENTRENADO habría sido el 15/1; el
		// décimo COMPLETO es el 20/1, y ese es el que vale.
		expect(porId(placas, 'dias-10')).toMatchObject({ estado: 'ganada', ganadaEl: '2026-01-20' });
		expect(porId(placas, 'dias-50')).toMatchObject({ estado: 'en-curso', progreso: 11 });
		// Los parciales sí sostienen la racha, como en el resto de la app.
		expect(porId(placas, 'racha-4')).toMatchObject({ estado: 'en-curso', progreso: 3 });
	});

	it('una sesión sin series marcadas no mueve nada: sin ✓ no hay logro', () => {
		vi.setSystemTime(new Date('2026-02-04T12:00:00'));
		const sesiones = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map((f) =>
			sesion(f, false)
		);
		const placas = placasConstancia(crearHistorialResumen(sesiones, [dia]));
		expect(porId(placas, 'racha-4')).toMatchObject({ estado: 'en-curso', progreso: 0 });
		expect(porId(placas, 'dias-10')).toMatchObject({ estado: 'en-curso', progreso: 0 });
	});

	it('la derivación es pura: el mismo resumen da las mismas placas, sin memoria entre llamadas', () => {
		vi.setSystemTime(new Date('2026-02-04T12:00:00'));
		const resumen = crearHistorialResumen(
			['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map((f) => sesion(f)),
			[dia]
		);
		expect(placasConstancia(resumen)).toEqual(placasConstancia(resumen));
	});

	it('placasGanadasEl devuelve sólo las de esa fecha: lo que el cierre del día puede celebrar', () => {
		vi.setSystemTime(new Date('2026-02-04T12:00:00'));
		const sesiones = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02'].map(
			(f) => sesion(f)
		);
		const placas = placasConstancia(crearHistorialResumen(sesiones, [dia]));

		expect(placasGanadasEl(placas, '2026-01-26').map((p) => p.id)).toEqual(['racha-4']);
		expect(placasGanadasEl(placas, '2026-02-02')).toEqual([]);
	});

	it('el pie dice lo mismo en la lista y en el cierre, por estado', () => {
		vi.setSystemTime(new Date('2026-02-04T12:00:00'));
		const placas = placasConstancia(
			crearHistorialResumen(
				['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02'].map((f) =>
					sesion(f)
				),
				[dia]
			)
		);
		const fecha = (f: string) => `[${f}]`;
		expect(pieDePlaca(porId(placas, 'racha-4'), fecha)).toBe('Ganada el [2026-01-26]');
		expect(pieDePlaca(porId(placas, 'racha-13'), fecha)).toBe('Vas 5 de 13 semanas seguidas');
		expect(pieDePlaca(porId(placas, 'racha-26'), fecha)).toBe('26 semanas seguidas');
	});
});
