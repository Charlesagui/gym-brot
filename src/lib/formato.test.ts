import { describe, expect, it } from 'vitest';
import {
	fechaCorta,
	formatoAnterior,
	formatoNumero,
	formatoSet,
	formatoVolumen,
	marcasEjeFecha,
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

describe('marcasEjeFecha', () => {
	const dia = (iso: string) => new Date(`${iso}T00:00:00`);
	const semanal = [
		'2026-10-07',
		'2026-10-14',
		'2026-10-21',
		'2026-10-28',
		'2026-11-04',
		'2026-11-11',
		'2026-11-17'
	].map(dia);

	it('no pasa de cuatro marcas aunque haya una sesión por semana', () => {
		// d3 toma `ticks={4}` como sugerencia y con seis semanas ponía siete: no entraban.
		const { valores } = marcasEjeFecha(semanal);
		expect(valores).toHaveLength(4);
		expect(valores[0]).toEqual(semanal[0]);
		expect(valores.at(-1)).toEqual(semanal.at(-1));
	});

	it('usa etiquetas cortas, sin año cuando todo cae en el mismo año', () => {
		const { valores, formato } = marcasEjeFecha(semanal);
		expect(valores.map(formato)).toEqual(['7 oct', '21 oct', '3 nov', '17 nov']);
	});

	it('agrega el año sólo si el rango cruza de año', () => {
		const { valores, formato } = marcasEjeFecha([dia('2025-12-20'), dia('2026-01-10')]);
		expect(valores.map(formato)).toEqual(['20 dic 25', '10 ene 26']);
	});

	it('con un solo día pone una sola marca', () => {
		const { valores } = marcasEjeFecha([dia('2026-11-17'), dia('2026-11-17')]);
		expect(valores).toEqual([dia('2026-11-17')]);
	});

	it('con pocos días no inventa marcas entre ellos', () => {
		expect(marcasEjeFecha([dia('2026-11-10'), dia('2026-11-17')]).valores).toHaveLength(2);
		expect(marcasEjeFecha([]).valores).toEqual([]);
	});
});
