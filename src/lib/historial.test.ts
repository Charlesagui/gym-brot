import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dia, Sesion } from './db';
import { crearHistorialResumen, resumenDiaSesion } from './historial';

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

describe('crearHistorialResumen', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('cuenta racha semanal cruzando de anio y descarta sesiones sin series hechas', () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		const resumen = crearHistorialResumen(
			[sesion('2025-12-23'), sesion('2025-12-31'), sesion('2026-01-06'), sesion('2026-01-07', false)],
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

	it('la semana actual sin entrenar corta la racha', () => {
		vi.setSystemTime(new Date('2026-01-07T12:00:00'));
		const resumen = crearHistorialResumen([sesion('2025-12-23'), sesion('2025-12-31')], [dia]);

		expect(resumen.rachaSemanal).toBe(0);
		expect(resumen.diasEstaSemana).toBe(0);
		expect(resumen.semanas[0]).toMatchObject({
			inicio: '2026-01-05',
			entrenada: false
		});
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
		expect(resumen.prs).toHaveLength(1);
	});
});
