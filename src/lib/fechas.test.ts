import { describe, expect, it } from 'vitest';
import {
	fechaCalendarioValida,
	fechaDentroDeRango,
	fechaMasDias,
	fechaSesionDesdeUrl
} from './fechas';

describe('fechaCalendarioValida', () => {
	it('acepta fechas reales y rechaza desbordes de calendario', () => {
		expect(fechaCalendarioValida('2024-02-29')).toBe(true);
		expect(fechaCalendarioValida('2026-02-29')).toBe(false);
		expect(fechaCalendarioValida('2026-99-99')).toBe(false);
		expect(fechaCalendarioValida('26-08-13')).toBe(false);
	});
});

describe('fechaSesionDesdeUrl', () => {
	it('mantiene compatibilidad sin parámetro y rechaza el explícito inválido', () => {
		expect(fechaSesionDesdeUrl(null, '2026-08-13')).toBe('2026-08-13');
		expect(fechaSesionDesdeUrl('2026-08-12', '2026-08-13')).toBe('2026-08-12');
		expect(fechaSesionDesdeUrl('2026-99-99', '2026-08-13')).toBeNull();
	});

	it('rechaza el futuro: nadie entrenó todavía mañana', () => {
		expect(fechaSesionDesdeUrl('2030-01-01', '2026-08-13')).toBeNull();
		expect(fechaSesionDesdeUrl('2026-08-14', '2026-08-13')).toBeNull();
		// Hoy sí, obviamente.
		expect(fechaSesionDesdeUrl('2026-08-13', '2026-08-13')).toBe('2026-08-13');
	});

	it('el tope va aparte del fallback: cruzar medianoche no invalida lo que ya era válido', () => {
		// La pantalla se abrió el 13 (fallback congelado) y ya es 14: la sesión del 13
		// pasa a ser pasado, no futuro, y se sigue pudiendo editar.
		expect(fechaSesionDesdeUrl('2026-08-13', '2026-08-13', '2026-08-14')).toBe('2026-08-13');
		// Y el 14 ahora es hoy, así que también entra.
		expect(fechaSesionDesdeUrl('2026-08-14', '2026-08-13', '2026-08-14')).toBe('2026-08-14');
	});
});

describe('fechaDentroDeRango', () => {
	it('incluye hoy y excluye fechas futuras usando días YYYY-MM-DD', () => {
		expect(fechaDentroDeRango('2026-08-13', '2026-05-13', '2026-08-13')).toBe(true);
		expect(fechaDentroDeRango('2026-08-14', null, '2026-08-13')).toBe(false);
		expect(fechaDentroDeRango('2026-05-12', '2026-05-13', '2026-08-13')).toBe(false);
	});
});

describe('fechaMasDias', () => {
	it('cruza mes, año y bisiesto sin aritmética de texto', () => {
		expect(fechaMasDias('2026-08-28', -2)).toBe('2026-08-26');
		expect(fechaMasDias('2026-03-01', -1)).toBe('2026-02-28');
		expect(fechaMasDias('2024-03-01', -1)).toBe('2024-02-29');
		expect(fechaMasDias('2026-01-01', -1)).toBe('2025-12-31');
		expect(fechaMasDias('2026-12-31', 1)).toBe('2027-01-01');
	});
});
