import { describe, expect, it } from 'vitest';
import {
	fechaCorta,
	formatoAnterior,
	formatoNumero,
	formatoSet,
	formatoVolumen,
	resumenSeries
} from './formato';

describe('formato', () => {
	it('formatea numeros con coma decimal, sin arrastre', () => {
		expect(formatoNumero(10)).toBe('10');
		expect(formatoNumero(10.25)).toBe('10,3');
		expect(formatoNumero(62.5)).toBe('62,5');
	});

	it('usa el mismo separador decimal que el volumen', () => {
		// El punto de `formatoVolumen` es de miles: si el decimal tambien fuera punto,
		// "12.450" y "62.5" significarian cosas distintas con el mismo signo.
		expect(formatoVolumen(3450.5)).toBe('3.450,5');
		expect(formatoNumero(3.5)).toBe('3,5');
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
			'100 +2,5 kg × 8 · MAX'
		);
		expect(formatoAnterior({ peso: 40, reps: 12, hecha: false }, 'kg')).toBe('40 kg × 12');
		// La referencia tiene que decir la carga entera: la placa base sola miente por omision.
		expect(
			formatoAnterior({ peso: 100, reps: 8, esMax: true, extraKg: 2.5, hecha: false }, 'kg')
		).toBe('100 +2,5 kg × 8 · MAX');
		expect(formatoAnterior({ reps: 10, hecha: false }, 'kg')).toBeTruthy();
		expect(formatoAnterior(undefined, 'kg')).toBeNull();
	});

	it('formatea fechas cortas', () => {
		expect(fechaCorta(null)).toBe('');
		expect(fechaCorta('2026-06-10')).toContain('jun');
	});
});

describe('resumenSeries', () => {
	it('sin series no hay nada que rotular', () => {
		expect(resumenSeries([])).toEqual({ inicio: '', resto: '', unidad: null });
	});

	it('con todo igual nombra la carga y las reps una sola vez', () => {
		// El conteo ("3 series hechas") ya lo dice el renglon de abajo: repetirlo aca
		// convertia el caso mas comun en seis cifras para decir dos.
		const r = resumenSeries([
			{ peso: 60, reps: 10 },
			{ peso: 60, reps: 10 },
			{ peso: 60, reps: 10 }
		]);
		expect(r).toEqual({ inicio: '60', resto: ' × 10', unidad: 'peso' });
	});

	it('mismo peso con reps distintas deja la carga afuera del parentesis', () => {
		const r = resumenSeries([
			{ peso: 60, reps: 10 },
			{ peso: 60, reps: 10 },
			{ peso: 60, reps: 8 }
		]);
		expect(r).toEqual({ inicio: '60', resto: ' × 10 · 10 · 8', unidad: 'peso' });
	});

	it('mismas reps con peso en escalera lista los pesos', () => {
		const r = resumenSeries([
			{ peso: 60, reps: 10 },
			{ peso: 62.5, reps: 10 },
			{ peso: 65, reps: 10 }
		]);
		expect(r).toEqual({ inicio: '60 · 62,5 · 65', resto: ' × 10', unidad: 'peso' });
	});

	it('si varian las dos conserva el apareo serie por serie', () => {
		// "60 · 65" al lado de "10 · 8" no dice cual fue con cual: aca no se factoriza.
		const r = resumenSeries([
			{ peso: 60, reps: 10 },
			{ peso: 62.5, reps: 10 },
			{ peso: 65, reps: 8 }
		]);
		expect(r).toEqual({
			inicio: '60',
			resto: '×10 · 62,5×10 · 65×8',
			unidad: 'peso'
		});
	});

	it('el MAX suma su extra a la carga', () => {
		const r = resumenSeries([{ peso: 100, reps: 8, esMax: true, extraKg: 2.5 }]);
		expect(r).toEqual({ inicio: '100+2,5', resto: ' × 8', unidad: 'peso' });
	});

	it('sin carga el resumen son las repeticiones y la unidad las cierra', () => {
		expect(resumenSeries([{ reps: 12 }, { reps: 12 }])).toEqual({
			inicio: '12',
			resto: '',
			unidad: 'reps'
		});
		expect(resumenSeries([{ reps: 12 }, { reps: 10 }])).toEqual({
			inicio: '12 · 10',
			resto: '',
			unidad: 'reps'
		});
	});

	it('de una lista larga conserva las ultimas, que son las que contestan', () => {
		const sets = [
			{ peso: 50, reps: 12 },
			{ peso: 55, reps: 11 },
			{ peso: 60, reps: 10 },
			{ peso: 62.5, reps: 9 },
			{ peso: 65, reps: 8 },
			{ peso: 67.5, reps: 6 }
		];
		const r = resumenSeries(sets, 3);
		expect(r.inicio).toBe('62,5');
		expect(r.resto).toBe('×9 · 65×8 · 67,5×6');
	});

	it('no recorta cuando el resumen ya es de una sola cifra', () => {
		// "60 kg × 10" describe ocho series igual de bien que tres: no hay nada que sacar.
		const sets = Array.from({ length: 8 }, () => ({ peso: 60, reps: 10 }));
		expect(resumenSeries(sets, 3)).toEqual({
			inicio: '60',
			resto: ' × 10',
			unidad: 'peso'
		});
	});

	it('una serie a medio cargar no rompe el resumen', () => {
		expect(resumenSeries([{ peso: 60 }])).toEqual({
			inicio: '60',
			resto: ' × —',
			unidad: 'peso'
		});
	});
});
