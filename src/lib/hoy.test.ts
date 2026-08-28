import { afterEach, describe, expect, it, vi } from 'vitest';
import { hoy as singleton } from './hoy.svelte';

type Handler = () => void;

/**
 * DOM mínimo: `hoy` sólo engancha listeners de visibilidad/foco y un temporizador.
 * Mismo criterio que `descanso.test.ts` — superficie chica y explícita, sin jsdom, y
 * permite disparar el evento a mano, que es justo lo que hay que poder probar.
 */
const GLOBALES = ['window', 'document'] as const;

function montarDom() {
	const listeners = new Map<string, Handler[]>();
	const registrar = (tipo: string, fn: Handler) => {
		listeners.set(tipo, [...(listeners.get(tipo) ?? []), fn]);
	};
	const previos = GLOBALES.map(
		(nombre) => [nombre, Object.getOwnPropertyDescriptor(globalThis, nombre)] as const
	);
	Object.defineProperty(globalThis, 'window', {
		value: { addEventListener: registrar },
		configurable: true,
		writable: true
	});
	Object.defineProperty(globalThis, 'document', {
		value: { addEventListener: registrar },
		configurable: true,
		writable: true
	});
	return {
		disparar: (tipo: string) => listeners.get(tipo)?.forEach((fn) => fn()),
		cuentaDe: (tipo: string) => listeners.get(tipo)?.length ?? 0,
		desmontar: () => {
			for (const [nombre, descriptor] of previos) {
				if (descriptor) Object.defineProperty(globalThis, nombre, descriptor);
				else delete (globalThis as Record<string, unknown>)[nombre];
			}
		}
	};
}

/** `hoy` es singleton de módulo: cada test necesita una instancia limpia. */
async function fresco() {
	vi.resetModules();
	return (await import('./hoy.svelte')).hoy;
}

let dom: ReturnType<typeof montarDom> | null = null;

afterEach(() => {
	dom?.desmontar();
	dom = null;
	vi.useRealTimers();
});

describe('hoy', () => {
	it('sigue al reloj: es lo que las pantallas que escriben no hacían', () => {
		vi.setSystemTime(new Date('2026-08-27T23:59:00'));
		singleton.refrescar();
		expect(singleton.valor).toBe('2026-08-27');

		vi.setSystemTime(new Date('2026-08-28T00:01:00'));
		singleton.refrescar();
		expect(singleton.valor).toBe('2026-08-28');
	});

	it('sin cambio de día no toca el estado: no invalida nada que dependa de él', () => {
		vi.setSystemTime(new Date('2026-08-28T09:00:00'));
		singleton.refrescar();
		vi.setSystemTime(new Date('2026-08-28T21:00:00'));
		singleton.refrescar();
		expect(singleton.valor).toBe('2026-08-28');
	});

	it('cambia de día solo, sin ningún evento: entrenando la app nunca pasa a segundo plano', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-27T23:59:00'));
		dom = montarDom();
		const hoy = await fresco();
		hoy.init();
		expect(hoy.valor).toBe('2026-08-27');

		// El wake lock deja la pantalla encendida: no hay visibilitychange ni focus que
		// esperar. Lo único que llega es el temporizador de medianoche.
		await vi.advanceTimersByTimeAsync(2 * 60_000);
		expect(hoy.valor).toBe('2026-08-28');

		// Y se rearma para el día siguiente.
		await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
		expect(hoy.valor).toBe('2026-08-29');
	});

	it('volver al frente también refresca', async () => {
		vi.setSystemTime(new Date('2026-08-27T23:59:00'));
		dom = montarDom();
		const hoy = await fresco();
		hoy.init();

		vi.setSystemTime(new Date('2026-08-28T08:00:00'));
		expect(hoy.valor).toBe('2026-08-27');
		dom.disparar('focus');
		expect(hoy.valor).toBe('2026-08-28');

		vi.setSystemTime(new Date('2026-08-29T08:00:00'));
		dom.disparar('visibilitychange');
		expect(hoy.valor).toBe('2026-08-29');
	});

	it('init es idempotente: el layout puede montarse más de una vez', async () => {
		dom = montarDom();
		const hoy = await fresco();
		hoy.init();
		hoy.init();
		expect(dom.cuentaDe('focus')).toBe(1);
		expect(dom.cuentaDe('visibilitychange')).toBe(1);
		expect(dom.cuentaDe('pageshow')).toBe(1);
	});
});
