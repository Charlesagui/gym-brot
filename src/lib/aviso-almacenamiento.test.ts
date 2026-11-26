import { describe, it, expect } from 'vitest';
import {
	antiguedadBackup,
	avisoAlmacenamiento,
	instalarSeparaDatos,
	instruccionesInstalar,
	textoAvisoNavegador,
	textoRecienInstalada,
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

describe('textos por plataforma', () => {
	it('sólo en iPhone la app instalada arranca con datos propios', () => {
		expect(instalarSeparaDatos('ios')).toBe(true);
		expect(instalarSeparaDatos('samsung')).toBe(false);
		expect(instalarSeparaDatos('android')).toBe(false);
		expect(instalarSeparaDatos('otra')).toBe(false);
	});

	it('en iPhone pide la copia antes de instalar', () => {
		expect(textoAvisoNavegador('ios')).toContain('Guardá una copia');
		expect(textoRecienInstalada('ios')).toContain('Restaurar copia');
	});

	it('en Android no afirma que la app instalada esté separada', () => {
		for (const plataforma of ['android', 'samsung'] as const) {
			expect(textoAvisoNavegador(plataforma)).not.toContain('arranca vacía');
			expect(textoAvisoNavegador(plataforma)).toContain('otro');
			expect(textoRecienInstalada(plataforma)).toContain('ya están');
		}
	});
});

describe('antiguedadBackup', () => {
	const ahora = new Date(2026, 10, 25, 9, 0);
	it('sin copia', () => {
		expect(antiguedadBackup(undefined, ahora)).toBe('Todavía no guardaste ninguna copia.');
		expect(antiguedadBackup('basura', ahora)).toBe('Todavía no guardaste ninguna copia.');
	});
	it('hoy, ayer (aunque hayan pasado menos de 24 h) y plural', () => {
		expect(antiguedadBackup(new Date(2026, 10, 25, 7, 0).toISOString(), ahora)).toBe(
			'Tu última copia es de hoy.'
		);
		expect(antiguedadBackup(new Date(2026, 10, 24, 23, 0).toISOString(), ahora)).toBe(
			'Tu última copia es de ayer.'
		);
		expect(antiguedadBackup(new Date(2026, 10, 20, 12, 0).toISOString(), ahora)).toBe(
			'Tu última copia es de hace 5 días.'
		);
	});
});
