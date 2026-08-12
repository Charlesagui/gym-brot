import { readable, type Readable } from 'svelte/store';

/** Lo mínimo que necesitamos de un observable de Dexie (liveQuery / *Obs()). */
interface Subscribable<T> {
	subscribe(next: (value: T) => void, onError?: (error: unknown) => void): { unsubscribe(): void };
}

export type EstadoConsulta<T> =
	| { estado: 'cargando'; valor: T; error: null }
	| { estado: 'listo'; valor: T; error: null }
	| { estado: 'error'; valor: T; error: unknown };

/**
 * Envuelve un observable de Dexie (`liveQuery` o cualquier `*Obs()`) en un store
 * legible de Svelte, usable con `$`. Reemplaza el patrón repetido:
 *
 *   $effect(() => { const sub = obs().subscribe(v => x = v); return () => sub.unsubscribe(); });
 *
 * Para parámetros reactivos (id de ruta, métrica…) envolvé la llamada en `$derived`:
 *
 *   const store = $derived(fromLiveQuery(historialObs(exId, metrica), []));
 *
 * y leé con `$store`: el `$` se re-suscribe solo cuando cambia la referencia del store.
 */
export function fromLiveQuery<T>(obs: Subscribable<T>, initial: T): Readable<T> {
	return readable(initial, (set) => {
		const sub = obs.subscribe((value) => set(value));
		return () => sub.unsubscribe();
	});
}

/**
 * Variante para pantallas que necesitan distinguir una carga real de un resultado vacío
 * y ofrecer recuperación si IndexedDB rechaza una lectura posterior a la apertura inicial.
 */
export function estadoLiveQuery<T>(obs: Subscribable<T>, initial: T): Readable<EstadoConsulta<T>> {
	return readable<EstadoConsulta<T>>({ estado: 'cargando', valor: initial, error: null }, (set) => {
		let valor = initial;
		const sub = obs.subscribe(
			(value) => {
				valor = value;
				set({ estado: 'listo', valor, error: null });
			},
			(error) => set({ estado: 'error', valor, error })
		);
		return () => sub.unsubscribe();
	});
}
