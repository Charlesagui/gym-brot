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

describe('días sin marcar (la puerta del calendario)', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	function sesionSinMarcar(fecha: string, sets: Partial<{ peso: number; reps: number }>[]): Sesion {
		return {
			id: `${fecha}__piernas`,
			fecha,
			diaId: 'piernas',
			ejercicios: [
				{
					exerciseId: 'sentadilla',
					sets: sets.map((s) => ({ ...s, hecha: false }))
				}
			]
		};
	}

	it('una fecha con peso o reps cargados y nada marcado queda alcanzable', () => {
		vi.useFakeTimers().setSystemTime(new Date('2026-08-26T10:00:00'));
		const resumen = crearHistorialResumen(
			[sesionSinMarcar('2026-08-20', [{ peso: 80, reps: 8 }, { peso: 80 }])],
			[dia]
		);
		expect(resumen.sinMarcar).toEqual([{ fecha: '2026-08-20', sets: 2, dias: ['Piernas'] }]);
		// Y no se cuela en nada de lo que mide entrenamiento real.
		expect(resumen.dias).toEqual([]);
		expect(resumen.totalDias).toBe(0);
		expect(resumen.rachaSemanal).toBe(0);
	});

	it('abrir un día para mirarlo no lo marca como pendiente', () => {
		vi.useFakeTimers().setSystemTime(new Date('2026-08-26T10:00:00'));
		// Sesión creada por el solo hecho de entrar a la rutina: sets sin un número cargado.
		const resumen = crearHistorialResumen([sesionSinMarcar('2026-08-20', [{}, {}])], [dia]);
		expect(resumen.sinMarcar).toEqual([]);
	});

	it('si la fecha ya es un día entrenado, no se duplica como pendiente', () => {
		vi.useFakeTimers().setSystemTime(new Date('2026-08-26T10:00:00'));
		const marcada = sesion('2026-08-20');
		const pendiente: Sesion = {
			...sesionSinMarcar('2026-08-20', [{ peso: 60, reps: 10 }]),
			id: '2026-08-20__otra',
			diaId: 'piernas'
		};
		const resumen = crearHistorialResumen([marcada, pendiente], [dia]);
		expect(resumen.sinMarcar).toEqual([]);
		expect(resumen.dias.map((d) => d.fecha)).toEqual(['2026-08-20']);
	});

	it('no ofrece la puerta si la rutina ya no existe: el arreglo sería reabrirla', () => {
		vi.useFakeTimers().setSystemTime(new Date('2026-08-26T10:00:00'));
		const resumen = crearHistorialResumen(
			[sesionSinMarcar('2026-08-20', [{ peso: 80, reps: 8 }])],
			[]
		);
		expect(resumen.sinMarcar).toEqual([]);
	});

	it('no ofrece fechas futuras: eso es planificación, no trabajo olvidado', () => {
		vi.useFakeTimers().setSystemTime(new Date('2026-08-26T10:00:00'));
		const resumen = crearHistorialResumen(
			[sesionSinMarcar('2026-08-28', [{ peso: 80, reps: 8 }])],
			[dia]
		);
		expect(resumen.sinMarcar).toEqual([]);
	});

	it('convive con días entrenados y sale de la más reciente a la más vieja', () => {
		vi.useFakeTimers().setSystemTime(new Date('2026-08-26T10:00:00'));
		const resumen = crearHistorialResumen(
			[
				sesion('2026-08-24'),
				sesionSinMarcar('2026-08-20', [{ reps: 8 }]),
				sesionSinMarcar('2026-08-22', [{ peso: 80, reps: 8 }])
			],
			[dia]
		);
		expect(resumen.sinMarcar.map((d) => d.fecha)).toEqual(['2026-08-22', '2026-08-20']);
		expect(resumen.totalDias).toBe(1);
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

describe('días completos vs parciales en el historial', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	const diaPiernas: Dia = {
		id: 'piernas',
		nombre: 'Piernas',
		orden: 1,
		ejercicios: [
			{ exerciseId: 'sentadilla', seriesObjetivo: 4, orden: 0 },
			{ exerciseId: 'prensa', seriesObjetivo: 4, orden: 1 },
			{ exerciseId: 'curl', seriesObjetivo: 4, orden: 2 }
		]
	};

	/** Sesión con plan congelado de 3 ejercicios x 4 series; `hechas` va al primero. */
	function conPlan(fecha: string, hechas: number, extra: Partial<Sesion> = {}): Sesion {
		return {
			id: `${fecha}__piernas`,
			fecha,
			diaId: 'piernas',
			diaNombre: 'Piernas',
			plan: { ejercicios: 3, series: 12 },
			ejercicios: ['sentadilla', 'prensa', 'curl'].map((exerciseId, i) => ({
				exerciseId,
				sets: Array.from({ length: 4 }, (_, s) => ({
					peso: 100,
					reps: 5,
					hecha: s + i * 4 < hechas
				}))
			})),
			...extra
		};
	}

	it('una serie de doce cuenta como día PARCIAL y no infla "días entrenados"', () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		const resumen = crearHistorialResumen([conPlan('2026-01-06', 1)], [diaPiernas]);

		expect(resumen.totalDias).toBe(0);
		expect(resumen.totalParciales).toBe(1);
		expect(resumen.diasEstaSemana).toBe(0);
		expect(resumen.parcialesEstaSemana).toBe(1);
		// Sigue siendo visible en el calendario: pasó, y con su denominador.
		expect(resumen.dias).toHaveLength(1);
		expect(resumen.dias[0]).toMatchObject({ calidad: 'parcial', sets: 1, seriesPlan: 12 });
	});

	it('un día parcial NO corta la racha: la racha protege, el contador informa', () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		const resumen = crearHistorialResumen(
			[conPlan('2025-12-30', 12), conPlan('2026-01-06', 1)],
			[diaPiernas]
		);

		expect(resumen.rachaSemanal).toBe(2);
		expect(resumen.semanas[0]).toMatchObject({
			entrenada: true,
			diasEntrenados: 1,
			diasCompletos: 0,
			diasParciales: 1
		});
		expect(resumen.totalDias).toBe(1);
		expect(resumen.totalParciales).toBe(1);
	});

	it('entrenar completo sin cerrar el día a mano cuenta como día entrenado', () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		const resumen = crearHistorialResumen([conPlan('2026-01-06', 12)], [diaPiernas]);
		expect(resumen.totalDias).toBe(1);
		expect(resumen.dias[0]).toMatchObject({ calidad: 'completa', cerradoAMano: false });
	});

	it('las sesiones sin plan conservan el trato que ya tenían', () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		const resumen = crearHistorialResumen([sesion('2026-01-06')], [dia]);
		expect(resumen.totalDias).toBe(1);
		expect(resumen.dias[0]).toMatchObject({ calidad: 'completa', seriesPlan: null });
	});

	it('no compara un día parcial contra uno completo', () => {
		// El delta de volumen sería enormemente negativo y leería como retroceso.
		const completo = conPlan('2026-01-01', 12);
		const parcial = conPlan('2026-01-08', 1);
		expect(compararConAnterior(parcial, [completo, parcial])).toBeNull();
		expect(compararConAnterior(conPlan('2026-01-08', 12), [completo])).not.toBeNull();
	});
});
