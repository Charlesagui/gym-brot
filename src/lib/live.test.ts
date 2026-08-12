import { describe, expect, it, vi } from 'vitest';
import { estadoLiveQuery } from './live';

describe('estadoLiveQuery', () => {
	it('expone carga, dato y error sin descartar el último dato válido', () => {
		let emitir: ((valor: string) => void) | undefined;
		let fallar: ((error: unknown) => void) | undefined;
		const unsubscribe = vi.fn();
		const observable = {
			subscribe(next: (valor: string) => void, onError?: (error: unknown) => void) {
				emitir = next;
				fallar = onError;
				return { unsubscribe };
			}
		};
		const estados: { estado: string; valor: string; error: unknown }[] = [];
		const detener = estadoLiveQuery(observable, '').subscribe((estado) => estados.push(estado));

		expect(estados.at(-1)).toEqual({ estado: 'cargando', valor: '', error: null });
		emitir?.('Piernas');
		expect(estados.at(-1)).toEqual({ estado: 'listo', valor: 'Piernas', error: null });
		fallar?.(new Error('IndexedDB cerrada'));
		expect(estados.at(-1)).toMatchObject({ estado: 'error', valor: 'Piernas' });

		detener();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
