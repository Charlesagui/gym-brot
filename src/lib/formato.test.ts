import { describe, expect, it } from 'vitest';
import { fechaCorta, formatoAnterior, formatoNumero, formatoSet } from './formato';

describe('formato', () => {
	it('formatea numeros sin arrastre decimal', () => {
		expect(formatoNumero(10)).toBe('10');
		expect(formatoNumero(10.25)).toBe('10.3');
	});

	it('formatea sets completos y anteriores', () => {
		expect(
			formatoSet(
				{
					peso: 100,
					reps: 8,
					esMax: true,
					extraKg: 2.5,
					fecha: '2026-01-01',
					valor: 102.5
				},
				'kg'
			)
		).toBe('100 +2.5 kg × 8 · MAX');
		expect(formatoAnterior({ peso: 40, reps: 12, hecha: false }, 'kg')).toBe('40 kg × 12');
		expect(formatoAnterior({ reps: 10, hecha: false }, 'kg')).toBe('— × 10');
		expect(formatoAnterior(undefined, 'kg')).toBeNull();
	});

	it('formatea fechas cortas', () => {
		expect(fechaCorta(null)).toBe('');
		expect(fechaCorta('2026-06-10')).toContain('jun');
	});
});
