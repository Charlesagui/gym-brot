import { readable, type Readable } from 'svelte/store';

/** Lo mínimo que necesitamos de un observable de Dexie (liveQuery / *Obs()). */
interface Subscribable<T> {
	subscribe(next: (value: T) => void): { unsubscribe(): void };
}

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
