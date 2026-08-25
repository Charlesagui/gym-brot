import { describe, expect, it, vi } from 'vitest';
import { WakeLockSeguro, type WakeLockSentinelLike } from './wake-lock';

function sentinel(): WakeLockSentinelLike & { release: ReturnType<typeof vi.fn> } {
	return { released: false, release: vi.fn(async () => {}) };
}

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
});
