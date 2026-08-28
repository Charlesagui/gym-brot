import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	asegurarPersistencia,
	consultarPersistencia,
	persistencia,
	refrescarPersistencia
} from './persistencia';

const navegadorReal = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

/** `navigator.storage` no existe en Node: se pone el mínimo que toca este módulo. */
function montarNavigator(storage: unknown) {
	Object.defineProperty(globalThis, 'navigator', {
		value: { storage },
		configurable: true,
		writable: true
	});
}

afterEach(() => {
	if (navegadorReal) Object.defineProperty(globalThis, 'navigator', navegadorReal);
	else delete (globalThis as Record<string, unknown>).navigator;
	persistencia.set('desconocido');
	vi.restoreAllMocks();
});

describe('consultarPersistencia', () => {
	it('no vuelve a pedir lo que ya está concedido', async () => {
		const persist = vi.fn();
		montarNavigator({ persisted: async () => true, persist });
		expect(await consultarPersistencia()).toBe('persistente');
		expect(persist).not.toHaveBeenCalled();
	});

	it('pide, y un "no" del navegador se registra como efímero', async () => {
		montarNavigator({ persisted: async () => false, persist: async () => false });
		expect(await consultarPersistencia()).toBe('efimero');
	});

	it('un "sí" al pedirlo queda como persistente', async () => {
		montarNavigator({ persisted: async () => false, persist: async () => true });
		expect(await consultarPersistencia()).toBe('persistente');
	});

	it('sin la API no afirma nada: desconocido, no efímero', async () => {
		montarNavigator(undefined);
		expect(await consultarPersistencia()).toBe('desconocido');
	});

	it('un error del navegador tampoco alarma de más', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		montarNavigator({
			persisted: async () => {
				throw new Error('bloqueado');
			},
			persist: async () => false
		});
		expect(await consultarPersistencia()).toBe('desconocido');
	});
});

describe('el veredicto se publica', () => {
	it('asegurarPersistencia deja el estado a la vista de las pantallas', async () => {
		montarNavigator({ persisted: async () => false, persist: async () => false });
		await asegurarPersistencia();
		expect(get(persistencia)).toBe('efimero');
	});

	it('refrescar no vuelve a pedir: instalar la app se nota sin re-preguntar', async () => {
		const persist = vi.fn(async () => false);
		montarNavigator({ persisted: async () => false, persist });
		await asegurarPersistencia();
		expect(get(persistencia)).toBe('efimero');

		// La persona instala la app: ahora el origen sí es persistente.
		montarNavigator({ persisted: async () => true, persist });
		expect(await refrescarPersistencia()).toBe('persistente');
		expect(get(persistencia)).toBe('persistente');
		expect(persist).toHaveBeenCalledTimes(1);
	});
});
