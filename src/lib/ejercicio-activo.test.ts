import { describe, expect, it } from 'vitest';
import {
	etiquetaProximaSerie,
	metricaEfectivaEjercicio,
	metricaLabelEjercicio,
	modoEjercicioActivo,
	unidadValorEjercicio
} from './ejercicio-activo';

describe('modoEjercicioActivo', () => {
	it('sin datos todavia asume peso para no rotular maquinas nuevas como reps', () => {
		expect(modoEjercicioActivo([], [{ hecha: false }])).toBe('peso');
		expect(modoEjercicioActivo([], [{ hecha: true }])).toBe('peso');
	});

	it('usa peso cuando el historial o la sesion actual tienen peso', () => {
		expect(modoEjercicioActivo([{ peso: 80 }], [{ hecha: false }])).toBe('peso');
		// Escribir lastre pendiente no debe relabelar por un instante el historial de reps como kg.
		expect(modoEjercicioActivo([], [{ peso: 40, reps: 10, hecha: false }])).toBe('reps');
		expect(modoEjercicioActivo([], [{ peso: 40, reps: 10, hecha: true }])).toBe('peso');
	});

	it('usa reps cuando la sesion activa ya muestra trabajo sin peso', () => {
		expect(modoEjercicioActivo([], [{ reps: 12, hecha: false }])).toBe('reps');
		expect(modoEjercicioActivo([], [{ reps: 12, hecha: true }])).toBe('reps');
	});
});

describe('etiquetaProximaSerie', () => {
	const press = (sets: { hecha: boolean }[], reciente: number) =>
		etiquetaProximaSerie(sets, reciente, 'Press pecho');

	it('apunta a la siguiente pendiente despues de la recien marcada', () => {
		expect(press([{ hecha: true }, { hecha: false }, { hecha: false }], 0)).toBe(
			'Press pecho · serie 2/3'
		);
	});

	it('saltea las que ya estan hechas', () => {
		expect(press([{ hecha: true }, { hecha: true }, { hecha: false }], 0)).toBe(
			'Press pecho · serie 3/3'
		);
	});

	it('si la recien marcada era la ultima, vuelve a la primera pendiente', () => {
		expect(press([{ hecha: false }, { hecha: true }, { hecha: true }], 2)).toBe(
			'Press pecho · serie 1/3'
		);
	});

	it('queda vacia cuando no falta ninguna', () => {
		expect(press([{ hecha: true }, { hecha: true }], 1)).toBe('');
		expect(press([], 0)).toBe('');
	});
});

describe('labels de ejercicio activo', () => {
	it('rotula metrica y unidad segun el modo efectivo', () => {
		expect(metricaEfectivaEjercicio('reps', 'e1rm')).toBe('reps');
		expect(metricaLabelEjercicio('peso', 'e1rm')).toBe('1RM estimado (1 Repetición Máxima)');
		expect(metricaLabelEjercicio('reps', 'peso')).toBe('reps máximas');
		expect(unidadValorEjercicio('reps', 'kg')).toBe('reps');
		expect(unidadValorEjercicio('peso', 'lb')).toBe('lb');
	});
});
