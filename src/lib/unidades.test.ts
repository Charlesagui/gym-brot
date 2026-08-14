import { describe, expect, it } from 'vitest';
import { conPesoCanonico, conPesoVisible, gramosAPeso, pesoAGramos } from './unidades';
import { pesoEfectivo } from './sesion-reglas';

describe('pesos canónicos', () => {
	it('acepta decimales de peso como 1,5 kg sin redondearlos a enteros', () => {
		expect(pesoAGramos(1.5, 'kg')).toBe(1_500);
		expect(gramosAPeso(1_500, 'kg')).toBe(1.5);
	});

	it('5 lb conserva su valor visible al alternar unidades repetidamente', () => {
		const canonico = conPesoCanonico({ peso: 5 }, 'lb');
		expect(canonico.pesoGramos).toBe(2_268);
		expect(conPesoVisible(canonico, 'lb').peso).toBe(5);
		expect(conPesoVisible(canonico, 'kg').peso).toBe(2.3);
		expect(conPesoVisible(canonico, 'lb').peso).toBe(5);
	});

	it('suma el extra MAX en la unidad elegida desde la misma fuente canónica', () => {
		const set = conPesoCanonico(
			{ peso: 100.5, reps: 5, hecha: true, esMax: true, extraKg: 1.5 },
			'kg'
		);
		expect(pesoEfectivo(set, 'kg')).toBe(102);
		expect(pesoEfectivo(set, 'lb')).toBe(224.9);
	});
});
