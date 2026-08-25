import { describe, expect, it } from 'vitest';
import { crearHeatmapAnual, nivelActividad } from './heatmap';

describe('heatmap anual', () => {
	it('usa 53 semanas de lunes a domingo y buckets fijos', () => {
		const resultado = crearHeatmapAnual([], new Date(2026, 0, 1, 0, 5));
		expect(resultado.semanas).toHaveLength(53);
		expect(resultado.semanas.every((semana) => semana.celdas.length === 7)).toBe(true);
		expect(resultado.semanas.at(-1)?.inicio).toBe('2025-12-29');
		expect([0, 1, 4, 5, 8, 9, 12, 13].map(nivelActividad)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
	});

	it('atraviesa el cambio de año sin contar futuro ni días vacíos', () => {
		const resultado = crearHeatmapAnual(
			[
				{ fecha: '2025-12-31', sets: 4, volumen: 1200, prs: 0, dias: ['Push'] },
				{ fecha: '2026-01-01', sets: 9, volumen: 3000, prs: 1, dias: ['Pull'] },
				{ fecha: '2026-01-02', sets: 0, volumen: 0, prs: 0, dias: ['Vacía'] },
				{ fecha: '2026-01-03', sets: 20, volumen: 5000, prs: 0, dias: ['Futura'] }
			],
			new Date(2026, 0, 2, 23, 59)
		);
		expect(resultado.diasEntrenados).toBe(2);
		expect(resultado.totalSets).toBe(13);
		expect(resultado.mejorRacha).toBe(2);
		const celdas = resultado.semanas.flatMap((semana) => semana.celdas);
		expect(celdas.find((celda) => celda.fecha === '2026-01-03')).toMatchObject({
			futura: true,
			sets: 0
		});
	});
});
