import { describe, expect, it } from 'vitest';
import { fechaCalendarioValida, fechaDentroDeRango, fechaSesionDesdeUrl } from './fechas';

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
});

describe('fechaDentroDeRango', () => {
	it('incluye hoy y excluye fechas futuras usando días YYYY-MM-DD', () => {
		expect(fechaDentroDeRango('2026-08-13', '2026-05-13', '2026-08-13')).toBe(true);
		expect(fechaDentroDeRango('2026-08-14', null, '2026-08-13')).toBe(false);
		expect(fechaDentroDeRango('2026-05-12', '2026-05-13', '2026-08-13')).toBe(false);
	});
});
