import { describe, expect, it } from 'vitest';
import { leerPeso, leerPesoConCero, leerReps, redondear, sumarPeso, sumarReps } from './numeros';

describe('redondear', () => {
	it('deja un decimal y no arrastra flotantes', () => {
		expect(redondear(2.5 * 3)).toBe(7.5);
		expect(redondear(0.1 + 0.2)).toBe(0.3);
		expect(redondear(82.46)).toBe(82.5);
	});
});

describe('sumarPeso', () => {
	it('suma y resta desde un valor existente', () => {
		expect(sumarPeso(80, 5)).toBe(85);
		expect(sumarPeso(80, -2.5)).toBe(77.5);
	});

	it('arranca de 0 cuando no habia peso', () => {
		expect(sumarPeso(undefined, 5)).toBe(5);
	});

	it('nunca baja de 0 y el 0 se guarda como sin peso', () => {
		expect(sumarPeso(2.5, -5)).toBeUndefined();
		expect(sumarPeso(undefined, -5)).toBeUndefined();
		expect(sumarPeso(5, -5)).toBeUndefined();
	});

	it('no arrastra flotantes con pasos de 2.5', () => {
		let peso = sumarPeso(undefined, 2.5);
		for (let i = 0; i < 10; i++) peso = sumarPeso(peso, 2.5);
		expect(peso).toBe(27.5);
	});
});

describe('sumarReps', () => {
	it('suma enteros y trata el 0 como sin reps', () => {
		expect(sumarReps(10, 1)).toBe(11);
		expect(sumarReps(undefined, 1)).toBe(1);
		expect(sumarReps(1, -1)).toBeUndefined();
		expect(sumarReps(undefined, -3)).toBeUndefined();
	});
});

describe('leerPeso', () => {
	it('acepta punto y coma decimal', () => {
		expect(leerPeso('82.5')).toBe(82.5);
		expect(leerPeso('82,5')).toBe(82.5);
	});

	it('redondea a un decimal', () => {
		expect(leerPeso('82,46')).toBe(82.5);
	});

	it('descarta vacio, basura, cero y negativos', () => {
		expect(leerPeso('')).toBeUndefined();
		expect(leerPeso('   ')).toBeUndefined();
		expect(leerPeso('abc')).toBeUndefined();
		expect(leerPeso('0')).toBeUndefined();
		expect(leerPeso('-10')).toBeUndefined();
	});
});

describe('leerPesoConCero', () => {
	it('toma el 0 como peso y no como campo vacio', () => {
		expect(leerPesoConCero('0')).toBe(0);
		expect(leerPesoConCero('0,0')).toBe(0);
		// `-0` se formatea como "-0": la barra tiene que quedar en 0 pelado.
		expect(Object.is(leerPesoConCero('-0'), 0)).toBe(true);
	});

	it('por lo demas lee igual que leerPeso', () => {
		expect(leerPesoConCero('82,5')).toBe(82.5);
		expect(leerPesoConCero('82,46')).toBe(82.5);
		expect(leerPesoConCero('')).toBeUndefined();
		expect(leerPesoConCero('abc')).toBeUndefined();
		expect(leerPesoConCero('-10')).toBeUndefined();
	});
});

describe('leerReps', () => {
	it('toma el entero y descarta lo invalido', () => {
		expect(leerReps('12')).toBe(12);
		expect(leerReps('12.9')).toBeUndefined();
		expect(leerReps('')).toBeUndefined();
		expect(leerReps('abc')).toBeUndefined();
		expect(leerReps('0')).toBeUndefined();
		expect(leerReps('-5')).toBeUndefined();
	});
});
