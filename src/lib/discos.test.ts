import { describe, expect, it } from 'vitest';
import { calcularDiscos } from './discos';

describe('calculadora de discos', () => {
	it('arma una carga exacta y expresa cantidades por lado', () => {
		const resultado = calcularDiscos(87.5, 20, [20, 10, 5, 2.5, 1.25]);
		expect(resultado).toMatchObject({
			estado: 'calculado',
			exacta: {
				total: 87.5,
				porLado: 33.75,
				discos: [
					{ peso: 20, cantidad: 1 },
					{ peso: 10, cantidad: 1 },
					{ peso: 2.5, cantidad: 1 },
					{ peso: 1.25, cantidad: 1 }
				]
			}
		});
	});

	it('minimiza la cantidad y no depende de un greedy incorrecto', () => {
		const resultado = calcularDiscos(44, 20, [10, 6]);
		expect(resultado).toMatchObject({
			estado: 'calculado',
			exacta: { discos: [{ peso: 6, cantidad: 2 }] }
		});
	});

	it('propone el total inferior y superior cuando no hay combinación exacta', () => {
		const resultado = calcularDiscos(63, 20, [20, 10, 5, 2.5]);
		expect(resultado).toMatchObject({
			estado: 'calculado',
			exacta: null,
			inferior: { total: 60 },
			superior: { total: 65 }
		});
	});

	it('considera que una barra sin discos también puede ser la carga exacta', () => {
		const resultado = calcularDiscos(20, 20, [20, 10, 5]);
		expect(resultado).toMatchObject({
			estado: 'calculado',
			exacta: { total: 20, porLado: 0, discos: [] }
		});
	});

	it('rechaza un objetivo menor que la barra', () => {
		expect(calcularDiscos(15, 20, [5, 2.5])).toEqual({
			estado: 'barra-supera',
			objetivo: 15,
			barra: 20
		});
	});

	it('tolera tamaños repetidos o inválidos', () => {
		const resultado = calcularDiscos(30, 20, [5, 5, 0, -2, Number.NaN]);
		expect(resultado).toMatchObject({
			estado: 'calculado',
			exacta: { discos: [{ peso: 5, cantidad: 1 }] }
		});
	});
});
