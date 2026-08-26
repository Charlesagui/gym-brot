import { describe, expect, it } from 'vitest';
import { BUCKETS_HEATMAP, ETIQUETAS_NIVEL, nivelActividad } from './heatmap';

describe('intensidad de actividad', () => {
	it('usa buckets fijos en los bordes', () => {
		expect([0, 1, 4, 5, 8, 9, 12, 13, 40].map(nivelActividad)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
	});

	it('no premia números imposibles', () => {
		expect(nivelActividad(-3)).toBe(0);
	});

	it('deriva la leyenda de los mismos topes, sin huecos ni solapamientos', () => {
		expect(ETIQUETAS_NIVEL).toEqual(['sin series', '1 a 4', '5 a 8', '9 a 12', '13 o más']);
		expect(ETIQUETAS_NIVEL).toHaveLength(BUCKETS_HEATMAP.length + 1);
	});
});
