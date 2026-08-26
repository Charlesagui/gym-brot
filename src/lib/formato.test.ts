import { describe, expect, it } from 'vitest';
import {
	cargaCorta,
	fechaCorta,
	formatoAnterior,
	formatoNumero,
	formatoSet,
	formatoVolumen
} from './formato';

describe('formato', () => {
	it('formatea numeros sin arrastre decimal', () => {
		expect(formatoNumero(10)).toBe('10');
		expect(formatoNumero(10.25)).toBe('10.3');
	});

	it('formatea volumen con separador de miles es-AR', () => {
		expect(formatoVolumen(12450)).toBe('12.450');
		expect(formatoVolumen(980)).toBe('980');
		expect(formatoVolumen(3450.5)).toBe('3.450,5');
	});

	it('formatea sets de modo reps (sin peso) por repeticiones', () => {
		expect(formatoSet({ reps: 14, esMax: false }, 'kg')).toBe('14 reps');
	});

	it('formatea sets completos y anteriores', () => {
		expect(formatoSet({ peso: 100, reps: 8, esMax: true, extraKg: 2.5 }, 'kg')).toBe(
			'100 +2.5 kg × 8 · MAX'
		);
		expect(formatoAnterior({ peso: 40, reps: 12, hecha: false }, 'kg')).toBe('40 kg × 12');
		// La referencia tiene que decir la carga entera: la placa base sola miente por omision.
		expect(
			formatoAnterior({ peso: 100, reps: 8, esMax: true, extraKg: 2.5, hecha: false }, 'kg')
		).toBe('100 +2.5 kg × 8 · MAX');
		expect(formatoAnterior({ reps: 10, hecha: false }, 'kg')).toBe('— × 10');
		expect(formatoAnterior(undefined, 'kg')).toBeNull();
	});

	it('resume la carga de un set para el renglon de series anteriores', () => {
		expect(cargaCorta({ peso: 62.5, reps: 10 })).toBe('62.5×10');
		// El MAX suma su extra: sin eso el renglon miente por omision, igual que "Anterior".
		expect(cargaCorta({ peso: 100, reps: 8, esMax: true, extraKg: 2.5 })).toBe('100+2.5×8');
		// Ejercicio sin peso: el set son solo repeticiones, no "— × 12".
		expect(cargaCorta({ reps: 12 })).toBe('×12');
		expect(cargaCorta({})).toBe('—');
		expect(cargaCorta({ peso: 60 })).toBe('60×—');
	});

	it('formatea fechas cortas', () => {
		expect(fechaCorta(null)).toBe('');
		expect(fechaCorta('2026-06-10')).toContain('jun');
	});
});
