import { describe, expect, it } from 'vitest';
import {
	completaEjercicioAlMarcar,
	metricaEfectivaEjercicio,
	metricaLabelEjercicio,
	modoEjercicioActivo,
	unidadValorEjercicio
} from './ejercicio-activo';

describe('modoEjercicioActivo', () => {
	it('sin datos todavia asume peso para no rotular maquinas nuevas como reps', () => {
		expect(modoEjercicioActivo([], [{ hecha: false }])).toBe('peso');
	});

	it('usa peso cuando el historial o la sesion actual tienen peso', () => {
		expect(modoEjercicioActivo([{ peso: 80 }], [{ hecha: false }])).toBe('peso');
		expect(modoEjercicioActivo([], [{ peso: 40, reps: 10, hecha: false }])).toBe('peso');
	});

	it('usa reps cuando la sesion activa ya muestra trabajo sin peso', () => {
		expect(modoEjercicioActivo([], [{ reps: 12, hecha: false }])).toBe('reps');
		expect(modoEjercicioActivo([], [{ reps: 12, hecha: true }])).toBe('reps');
	});
});

describe('completaEjercicioAlMarcar', () => {
	it('detecta la ultima serie pendiente antes de marcarla', () => {
		expect(completaEjercicioAlMarcar([{ hecha: true }, { hecha: false }], 1)).toBe(true);
		expect(completaEjercicioAlMarcar([{ hecha: false }, { hecha: false }], 0)).toBe(false);
		expect(completaEjercicioAlMarcar([{ hecha: true }], 0)).toBe(false);
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
