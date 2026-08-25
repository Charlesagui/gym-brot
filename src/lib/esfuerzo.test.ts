import { describe, expect, it } from 'vitest';
import { etiquetaEsfuerzo, rirARpe, rirValido, rpeARir } from './esfuerzo';

describe('esfuerzo RIR/RPE', () => {
	it('valida el rango canónico y pasos de 0,5', () => {
		expect([0, 0.5, 2, 5].every(rirValido)).toBe(true);
		expect([-0.5, 2.25, 5.5, Number.NaN].some(rirValido)).toBe(false);
	});

	it('convierte sin crear dos fuentes de verdad', () => {
		expect(rirARpe(0)).toBe(10);
		expect(rirARpe(2.5)).toBe(7.5);
		expect(rpeARir(8)).toBe(2);
		expect(etiquetaEsfuerzo(2, 'rir')).toBe('RIR 2');
		expect(etiquetaEsfuerzo(2, 'rpe')).toBe('RPE 8');
	});
});
