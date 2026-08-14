import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dia, Sesion } from './db';
import { compararConAnterior, crearHistorialResumen, resumenDiaSesion } from './historial';

const dia: Dia = {
	id: 'piernas',
	nombre: 'Piernas',
	orden: 1,
	ejercicios: []
};

function sesion(fecha: string, hecha = true): Sesion {
	return {
		id: `${fecha}__piernas`,
		fecha,
		diaId: 'piernas',
		ejercicios: [
			{
				exerciseId: 'sentadilla',
				sets: [{ peso: 100, reps: 5, hecha }]
			}
		]
	};
}

function sesionConVolumen(fecha: string, diaId: string, peso: number, sets = 1): Sesion {
	return {
		id: `${fecha}__${diaId}`,
		fecha,
		diaId,
		ejercicios: [
			{
				exerciseId: 'sentadilla',
				sets: Array.from({ length: sets }, () => ({ peso, reps: 5, hecha: true }))
			}
		]
	};
}

describe('crearHistorialResumen', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('cuenta racha semanal cruzando de anio y descarta sesiones sin series hechas', () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		const resumen = crearHistorialResumen(
			[
				sesion('2025-12-23'),
				sesion('2025-12-31'),
				sesion('2026-01-06'),
				sesion('2026-01-07', false)
			],
			[dia]
		);

		expect(resumen.rachaSemanal).toBe(3);
		expect(resumen.diasEstaSemana).toBe(1);
		expect(resumen.totalDias).toBe(3);
		expect(resumen.dias.map((d) => d.fecha)).toEqual(['2026-01-06', '2025-12-31', '2025-12-23']);
		expect(resumen.semanas[0]).toMatchObject({
			inicio: '2026-01-05',
			entrenada: true
		});
	});

	it('la semana actual sin entrenar no corta la racha (gracia hasta que termine)', () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		const resumen = crearHistorialResumen([sesion('2025-12-23'), sesion('2025-12-31')], [dia]);

		expect(resumen.rachaSemanal).toBe(2);
		expect(resumen.diasEstaSemana).toBe(0);
		expect(resumen.semanas[0]).toMatchObject({
			inicio: '2026-01-05',
			entrenada: false
		});
	});

	it('una semana completa sin entrenar si corta la racha', () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		// Entrenada la semana del 22/12, vacia la del 29/12, vacia la actual → racha 0.
		const resumen = crearHistorialResumen([sesion('2025-12-23')], [dia]);

		expect(resumen.rachaSemanal).toBe(0);
	});

	it('no cuenta sesiones futuras como entrenamiento realizado', () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		const resumen = crearHistorialResumen([sesion('2026-01-06'), sesion('2026-01-08')], [dia]);
		expect(resumen.totalDias).toBe(1);
		expect(resumen.dias.map((d) => d.fecha)).toEqual(['2026-01-06']);
	});

	it('conserva el nombre histórico aunque la rutina actual haya sido renombrada', () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		const historica = { ...sesion('2026-01-06'), diaNombre: 'Piernas original' };
		const resumen = crearHistorialResumen([historica], [{ ...dia, nombre: 'Piernas nueva' }]);
		expect(resumen.dias[0]?.dias).toEqual(['Piernas original']);
	});
});

describe('resumenDiaSesion', () => {
	it('suma sets, volumen y PR celebrado sin inventar series no hechas', () => {
		const resumen = resumenDiaSesion({
			id: '2026-01-07__piernas',
			fecha: '2026-01-07',
			diaId: 'piernas',
			ejercicios: [
				{
					exerciseId: 'sentadilla',
					prCelebrado: { peso: 100, reps: 5 },
					sets: [
						{ peso: 100, reps: 5, hecha: true },
						{ peso: 110, reps: 5, hecha: false }
					]
				}
			]
		});

		expect(resumen.setsHechos).toBe(1);
		expect(resumen.volumen).toBe(500);
		expect(resumen.setsSinVolumen).toBe(0);
		expect(resumen.prs).toHaveLength(1);
	});

	it('ignora checks inválidos sin reps y cuenta bodyweight fuera del volumen', () => {
		const resumen = resumenDiaSesion({
			id: '2026-01-07__piernas',
			fecha: '2026-01-07',
			diaId: 'piernas',
			ejercicios: [
				{
					exerciseId: 'sentadilla',
					sets: [
						{ peso: 100, reps: 5, hecha: true },
						{ peso: 100, hecha: true },
						{ reps: 12, hecha: true }
					]
				}
			]
		});

		expect(resumen.setsHechos).toBe(2);
		expect(resumen.volumen).toBe(500);
		expect(resumen.setsSinVolumen).toBe(1);
	});

	it('usa el snapshot del ejercicio en un PR histórico', () => {
		const actual = sesion('2026-01-07');
		actual.ejercicios[0]!.nombreSnapshot = 'Sentadilla histórica';
		actual.ejercicios[0]!.prCelebrado = { peso: 100, reps: 5 };
		expect(resumenDiaSesion(actual).prs[0]?.nombre).toBe('Sentadilla histórica');
	});
});

describe('compararConAnterior', () => {
	it('primera sesión de este día: sin base para comparar, no inventa un delta', () => {
		const actual = sesionConVolumen('2026-01-14', 'piernas', 100);
		expect(compararConAnterior(actual, [])).toBeNull();
	});

	it('mayor volumen que la vez anterior: delta positivo', () => {
		const previa = sesionConVolumen('2026-01-07', 'piernas', 100);
		const actual = sesionConVolumen('2026-01-14', 'piernas', 120);
		const cmp = compararConAnterior(actual, [previa]);
		expect(cmp).toEqual({ fechaAnterior: '2026-01-07', deltaVolumen: 100, deltaSets: 0 });
	});

	it('menor volumen que la vez anterior: delta negativo, sin lenguaje de culpa', () => {
		const previa = sesionConVolumen('2026-01-07', 'piernas', 100, 3);
		const actual = sesionConVolumen('2026-01-14', 'piernas', 100, 1);
		const cmp = compararConAnterior(actual, [previa]);
		expect(cmp).toEqual({ fechaAnterior: '2026-01-07', deltaVolumen: -1000, deltaSets: -2 });
	});

	it('usa la sesión comparable más reciente cuando hay varias anteriores', () => {
		const vieja = sesionConVolumen('2025-12-01', 'piernas', 50);
		const reciente = sesionConVolumen('2026-01-07', 'piernas', 100);
		const actual = sesionConVolumen('2026-01-14', 'piernas', 110);
		const cmp = compararConAnterior(actual, [vieja, reciente]);
		expect(cmp?.fechaAnterior).toBe('2026-01-07');
		expect(cmp?.deltaVolumen).toBe(50); // (110-100) kg × 5 reps
	});

	it('ignora sesiones de otro día de rutina y sesiones futuras', () => {
		const otroDia = sesionConVolumen('2026-01-07', 'espalda', 100);
		const futura = sesionConVolumen('2026-01-20', 'piernas', 100);
		const actual = sesionConVolumen('2026-01-14', 'piernas', 100);
		expect(compararConAnterior(actual, [otroDia, futura])).toBeNull();
	});

	it('ignora una sesión anterior sin series realmente hechas (parcial vacía o saltada)', () => {
		const previaSinTrabajo = sesion('2026-01-07', false);
		const actual = sesionConVolumen('2026-01-14', 'piernas', 100);
		expect(compararConAnterior(actual, [previaSinTrabajo])).toBeNull();
	});
});
