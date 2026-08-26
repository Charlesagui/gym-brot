import { afterEach, describe, expect, it, vi } from 'vitest';
import { WakeLockSeguro, type WakeLockSentinelLike } from './wake-lock';

function sentinel(): WakeLockSentinelLike & { release: ReturnType<typeof vi.fn> } {
	return { released: false, release: vi.fn(async () => {}) };
}

type Handler = () => void;

/** `document` mínimo: solo la visibilidad y los listeners que mira el wake lock. */
function montarDocumento() {
	let listeners: Handler[] = [];
	const doc = {
		visibilityState: 'visible' as DocumentVisibilityState,
		addEventListener: (_tipo: string, fn: Handler) => listeners.push(fn),
		removeEventListener: (_tipo: string, fn: Handler) => {
			listeners = listeners.filter((otro) => otro !== fn);
		}
	};
	vi.stubGlobal('document', doc);
	return {
		ocultar() {
			doc.visibilityState = 'hidden';
			for (const fn of [...listeners]) fn();
		},
		mostrar() {
			doc.visibilityState = 'visible';
			for (const fn of [...listeners]) fn();
		},
		suscriptos: () => listeners.length
	};
}

afterEach(() => vi.unstubAllGlobals());

describe('WakeLockSeguro', () => {
	it('no duplica pedidos, libera al terminar y vuelve a pedir al reanudar', async () => {
		const primero = sentinel();
		const segundo = sentinel();
		const solicitar = vi.fn().mockResolvedValueOnce(primero).mockResolvedValueOnce(segundo);
		const wakeLock = new WakeLockSeguro(solicitar);
		await wakeLock.activar();
		await wakeLock.activar();
		expect(solicitar).toHaveBeenCalledTimes(1);
		wakeLock.desactivar();
		expect(primero.release).toHaveBeenCalledTimes(1);
		await wakeLock.activar();
		expect(solicitar).toHaveBeenCalledTimes(2);
	});

	it('libera una respuesta tardía si el descanso ya terminó', async () => {
		const tarde = sentinel();
		let resolver!: (valor: WakeLockSentinelLike) => void;
		const pedir = new Promise<WakeLockSentinelLike>((resolve) => (resolver = resolve));
		const wakeLock = new WakeLockSeguro(() => pedir);
		const activacion = wakeLock.activar();
		wakeLock.desactivar();
		resolver(tarde);
		await activacion;
		expect(tarde.release).toHaveBeenCalledTimes(1);
	});

	it('un rechazo no rompe el flujo', async () => {
		const wakeLock = new WakeLockSeguro(() => Promise.reject(new Error('denegado')));
		await expect(wakeLock.activar()).resolves.toBeUndefined();
		wakeLock.desactivar();
	});

	it('vuelve a tomar la pantalla al volver a la pestaña, y no mientras está oculta', async () => {
		const doc = montarDocumento();
		const primero = sentinel();
		const segundo = sentinel();
		const solicitar = vi.fn().mockResolvedValueOnce(primero).mockResolvedValueOnce(segundo);
		const wakeLock = new WakeLockSeguro(solicitar);
		await wakeLock.activar();

		// El sistema suelta el lock al ocultarse la pestaña y no lo devuelve al volver.
		primero.released = true;
		doc.ocultar();
		expect(solicitar).toHaveBeenCalledTimes(1);

		doc.mostrar();
		await Promise.resolve();
		expect(solicitar).toHaveBeenCalledTimes(2);

		wakeLock.desactivar();
		expect(doc.suscriptos()).toBe(0);
		doc.mostrar();
		expect(solicitar).toHaveBeenCalledTimes(2);
	});
});
