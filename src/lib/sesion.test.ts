import { describe, expect, it } from 'vitest';
import {
	mejorSet,
	modoEjercicio,
	pesoEfectivo,
	valorMetrica,
	valorSet,
	type MejorSet
} from './sesion';
import type { Sesion } from './db';

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

	it('Epley con tope: por encima de 12 reps puntua igual que 12', () => {
		expect(valorMetrica(100, 20, 'e1rm')).toBe(valorMetrica(100, 12, 'e1rm'));
		expect(valorMetrica(100, 20, 'e1rm')).toBe(140);
	});
});

describe('valorSet', () => {
	it('en modo peso usa el peso efectivo y la metrica; sin peso no puntua', () => {
		expect(valorSet({ peso: 80, reps: 10 }, 'peso')).toBe(80);
		expect(valorSet({ peso: 80, reps: 10, esMax: true, extraKg: 5 }, 'peso')).toBe(85);
		expect(valorSet({ reps: 10 }, 'peso')).toBeNull();
	});

	it('en modo reps el valor son las reps, sin importar la metrica de ajustes', () => {
		expect(valorSet({ reps: 14 }, 'peso', 'reps')).toBe(14);
		expect(valorSet({ reps: 14 }, 'e1rm', 'reps')).toBe(14);
		expect(valorSet({}, 'peso', 'reps')).toBeNull();
	});
});

describe('modoEjercicio', () => {
	function sesionCon(sets: { peso?: number; reps?: number; hecha: boolean }[]): Sesion {
		return {
			id: '2026-01-01__push',
			fecha: '2026-01-01',
			diaId: 'push',
			ejercicios: [{ exerciseId: 'dominadas', sets }]
		};
	}

	it('es reps solo si hay series hechas y ninguna registro peso', () => {
		expect(modoEjercicio([sesionCon([{ reps: 10, hecha: true }])], 'dominadas')).toBe('reps');
		expect(
			modoEjercicio(
				[
					sesionCon([
						{ reps: 10, hecha: true },
						{ peso: 5, reps: 8, hecha: true }
					])
				],
				'dominadas'
			)
		).toBe('peso');
		// Sin series hechas (o sin historial) el default es peso.
		expect(modoEjercicio([sesionCon([{ reps: 10, hecha: false }])], 'dominadas')).toBe('peso');
		expect(modoEjercicio([], 'dominadas')).toBe('peso');
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
