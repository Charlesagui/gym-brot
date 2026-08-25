import { describe, expect, it } from 'vitest';
import type { ProgresionDoble, SetSesion } from './db';
import { evaluarDobleProgresion } from './progresion';

const activa: ProgresionDoble = {
	activa: true,
	tipo: 'doble',
	repsMin: 8,
	repsMax: 12
};

function series(peso: number, reps = 12, cantidad = 3): SetSesion[] {
	return Array.from({ length: cantidad }, () => ({ peso, reps, hecha: true }));
}

describe('doble progresión', () => {
	it('permanece opt-in y exige todas las series completas en el techo', () => {
		expect(evaluarDobleProgresion(undefined, series(80), 's1', 2_500).motivo).toBe('inactiva');
		expect(
			evaluarDobleProgresion(
				activa,
				[...series(80, 12, 2), { peso: 80, reps: 12, hecha: false }],
				's1',
				2_500
			).motivo
		).toBe('incompleta');
		expect(evaluarDobleProgresion(activa, series(80, 11), 's1', 2_500).motivo).toBe('reps');
	});

	it('recomienda el incremento canónico cuando todas las series usan la misma carga', () => {
		const evaluacion = evaluarDobleProgresion(activa, series(80), 's1', 2_500);
		expect(evaluacion.recomendacion).toMatchObject({
			seriesEvaluadas: 3,
			pesoActualGramos: 80_000,
			pesoObjetivoGramos: 82_500,
			incrementoGramos: 2_500,
			esMax: false
		});
	});

	it('la unidad visible no cambia el resultado canónico', () => {
		const kg = evaluarDobleProgresion(activa, series(80), 's1', 2_500, 'kg');
		const lb = evaluarDobleProgresion(
			activa,
			Array.from({ length: 3 }, () => ({
				peso: 176.36981,
				pesoGramos: 80_000,
				reps: 12,
				hecha: true
			})),
			's1',
			2_500,
			'lb'
		);
		expect(lb.recomendacion?.pesoObjetivoGramos).toBe(kg.recomendacion?.pesoObjetivoGramos);
	});

	it('rechaza cargas variadas, series agregadas incompletas y ejercicios sin carga', () => {
		expect(
			evaluarDobleProgresion(
				activa,
				[
					{ peso: 80, reps: 12, hecha: true },
					{ peso: 82.5, reps: 12, hecha: true }
				],
				's1',
				2_500
			).motivo
		).toBe('cargas-variadas');
		expect(
			evaluarDobleProgresion(activa, [...series(80), { hecha: false }], 's1', 2_500).motivo
		).toBe('incompleta');
		expect(
			evaluarDobleProgresion(
				activa,
				Array.from({ length: 3 }, () => ({ reps: 12, hecha: true })),
				's1',
				2_500
			).motivo
		).toBe('sin-carga');
	});

	it('en una máquina al máximo incrementa sólo la carga extra', () => {
		const evaluacion = evaluarDobleProgresion(
			activa,
			Array.from({ length: 3 }, () => ({
				peso: 100,
				pesoGramos: 100_000,
				reps: 12,
				hecha: true,
				esMax: true,
				extraKg: 5,
				extraGramos: 5_000
			})),
			's1',
			2_500
		);
		expect(evaluacion.recomendacion).toMatchObject({
			pesoObjetivoGramos: 100_000,
			extraObjetivoGramos: 7_500,
			esMax: true
		});
	});

	it('no vuelve a ofrecer una decisión ya resuelta para esa sesión', () => {
		expect(
			evaluarDobleProgresion(
				{ ...activa, decision: 'pospuesta', decisionSesionId: 's1' },
				series(80),
				's1',
				2_500
			).motivo
		).toBe('ya-resuelta');
	});
});
