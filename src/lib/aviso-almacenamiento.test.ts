import { describe, it, expect } from 'vitest';
import {
	avisoAlmacenamiento,
	instruccionesInstalar,
	plataformaDe,
	REAPARICION_AVISO_MS,
	type EntradaAviso
} from './aviso-almacenamiento';

const AHORA = new Date('2026-11-25T12:00:00Z');

function entrada(parcial: Partial<EntradaAviso> = {}): EntradaAviso {
	return {
		instalada: false,
		tactil: true,
		plataforma: 'samsung',
		persistencia: 'persistente',
		cerradoAt: null,
		ahora: AHORA,
		...parcial
	};
}

describe('avisoAlmacenamiento', () => {
	it('avisa en el navegador del teléfono aunque haya persistencia', () => {
		// Los contenedores separados no dependen de que el navegador conserve los datos.
		expect(avisoAlmacenamiento(entrada())).toEqual({ tipo: 'navegador', plataforma: 'samsung' });
	});

	it('no avisa en una pestaña de la compu', () => {
		expect(avisoAlmacenamiento(entrada({ tactil: false }))).toBeNull();
	});

	it('instalada y persistente: no hay nada que decir', () => {
		expect(avisoAlmacenamiento(entrada({ instalada: true }))).toBeNull();
	});

	it('instalada pero efímera: pide copia', () => {
		expect(avisoAlmacenamiento(entrada({ instalada: true, persistencia: 'efimero' }))).toEqual({
			tipo: 'efimero'
		});
	});

	it('instalada con persistencia desconocida: no afirma nada', () => {
		expect(
			avisoAlmacenamiento(entrada({ instalada: true, persistencia: 'desconocido' }))
		).toBeNull();
	});

	it('cerrado hace menos de una semana: se calla', () => {
		const cerradoAt = new Date(AHORA.getTime() - REAPARICION_AVISO_MS + 60_000).toISOString();
		expect(avisoAlmacenamiento(entrada({ cerradoAt }))).toBeNull();
	});

	it('cerrado hace una semana: vuelve, porque el riesgo no se fue', () => {
		const cerradoAt = new Date(AHORA.getTime() - REAPARICION_AVISO_MS).toISOString();
		expect(avisoAlmacenamiento(entrada({ cerradoAt }))?.tipo).toBe('navegador');
	});

	it('una marca de cierre corrupta no lo silencia para siempre', () => {
		expect(avisoAlmacenamiento(entrada({ cerradoAt: 'basura' }))?.tipo).toBe('navegador');
	});
});

describe('plataformaDe', () => {
	it('reconoce Samsung Internet antes que Android genérico', () => {
		const ua =
			'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36';
		expect(plataformaDe(ua)).toBe('samsung');
	});

	it('Chrome en Android', () => {
		const ua =
			'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
		expect(plataformaDe(ua)).toBe('android');
	});

	it('iPhone, y iPad que se hace pasar por Mac', () => {
		expect(plataformaDe('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
		expect(plataformaDe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios');
		expect(plataformaDe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('otra');
	});
});

describe('instruccionesInstalar', () => {
	it('da el camino del menú de cada navegador', () => {
		expect(instruccionesInstalar('samsung')).toContain('Pantalla de inicio');
		expect(instruccionesInstalar('ios')).toContain('Agregar a inicio');
		expect(instruccionesInstalar('android')).toContain('Instalar app');
	});
});
