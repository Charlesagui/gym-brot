import { describe, expect, it } from 'vitest';
import { mejorSet, pesoEfectivo, valorMetrica, type MejorSet } from './sesion';

describe('pesoEfectivo', () => {
	it('devuelve null si el peso no esta cargado', () => {
		expect(pesoEfectivo({})).toBeNull();
		expect(pesoEfectivo({ peso: undefined, esMax: true, extraKg: 10 })).toBeNull();
	});

	it('suma extraKg solo cuando el set es MAX', () => {
		expect(pesoEfectivo({ peso: 80, esMax: true })).toBe(80);
		expect(pesoEfectivo({ peso: 80, esMax: true, extraKg: 5 })).toBe(85);
		expect(pesoEfectivo({ peso: 80, esMax: false, extraKg: 5 })).toBe(80);
	});
});

describe('valorMetrica', () => {
	it('usa el peso directo para la metrica peso', () => {
		expect(valorMetrica(100, 12, 'peso')).toBe(100);
	});

	it('calcula Epley tratando reps undefined o 0 como al menos 1', () => {
		expect(valorMetrica(100, undefined, 'e1rm')).toBeCloseTo(103.333, 3);
		expect(valorMetrica(100, 0, 'e1rm')).toBeCloseTo(103.333, 3);
		expect(valorMetrica(100, 12, 'e1rm')).toBe(140);
	});
});

describe('mejorSet', () => {
	const base: MejorSet = {
		peso: 100,
		reps: 6,
		esMax: false,
		fecha: '2026-01-01',
		valor: 100
	};

	it('elige el mayor valor', () => {
		expect(mejorSet(base, { ...base, peso: 105, valor: 105 })).toMatchObject({ peso: 105 });
	});

	it('desempata por reps', () => {
		expect(mejorSet(base, { ...base, peso: 100, reps: 8, valor: 100 })).toMatchObject({
			reps: 8
		});
	});

	it('conserva el anterior si no mejora', () => {
		expect(mejorSet(base, { ...base, peso: 95, reps: 20, valor: 95 })).toBe(base);
	});
});
