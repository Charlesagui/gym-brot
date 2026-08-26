import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DESCANSO_KEY = 'gb-descanso';
const GLOW = '124 92 255';

type Handler = (evento: unknown) => void;

/**
 * DOM mínimo con lo único que toca el descanso: listeners, visibilidad y storage.
 * Se prefiere esto a jsdom porque la superficie es chica y explícita, y porque el
 * evento `storage` (la sincronización entre instancias) se dispara a mano, que es
 * justo lo que hay que poder probar. `navigator` es el de Node: no trae `vibrate`
 * ni `wakeLock`, así que esos caminos quedan inertes solos.
 */
function montarDom() {
	const listeners = new Map<string, Handler[]>();
	const almacen = new Map<string, string>();

	const escuchar = (tipo: string, fn: Handler) => {
		listeners.set(tipo, [...(listeners.get(tipo) ?? []), fn]);
	};
	// El wake lock también se suscribe a `visibilitychange` y se da de baja al soltarse.
	const dejarDeEscuchar = (tipo: string, fn: Handler) => {
		listeners.set(
			tipo,
			(listeners.get(tipo) ?? []).filter((otro) => otro !== fn)
		);
	};

	Object.assign(globalThis, {
		window: { addEventListener: escuchar, removeEventListener: () => {} },
		document: {
			addEventListener: escuchar,
			removeEventListener: dejarDeEscuchar,
			visibilityState: 'visible'
		},
		localStorage: {
			getItem: (k: string) => almacen.get(k) ?? null,
			setItem: (k: string, v: string) => {
				almacen.set(k, v);
			},
			removeItem: (k: string) => {
				almacen.delete(k);
			}
		}
	});

	return {
		guardado: () => almacen.get(DESCANSO_KEY) ?? null,
		/** Simula lo que persiste OTRA instancia y avisa por el evento `storage`. */
		otraInstanciaEscribe(persistido: { inicio: number; hasta: number } | null) {
			if (persistido == null) {
				almacen.delete(DESCANSO_KEY);
				this.disparar('storage', { key: DESCANSO_KEY, newValue: null });
				return;
			}
			const crudo = JSON.stringify(persistido);
			almacen.set(DESCANSO_KEY, crudo);
			this.disparar('storage', { key: DESCANSO_KEY, newValue: crudo });
		},
		disparar(tipo: string, evento: unknown) {
			for (const fn of listeners.get(tipo) ?? []) fn(evento);
		}
	};
}

/** Instancia limpia por test: el descanso es un singleton de módulo. */
async function nuevoDescanso() {
	vi.resetModules();
	const { descanso } = await import('./descanso.svelte');
	return descanso;
}

let dom: ReturnType<typeof montarDom>;
let descanso: Awaited<ReturnType<typeof nuevoDescanso>>;

beforeEach(async () => {
	dom = montarDom();
	descanso = await nuevoDescanso();
	descanso.init();
	vi.useFakeTimers();
});

afterEach(() => {
	descanso.saltar();
	vi.useRealTimers();
});

describe('descanso', () => {
	it('arranca contando y no está vencido', () => {
		descanso.iniciar(2, GLOW, 'Press pecho · serie 2/4');
		expect(descanso.restoSeg).toBe(120);
		expect(descanso.totalSeg).toBe(120);
		expect(descanso.vencido).toBe(false);
		expect(descanso.siguiente).toBe('Press pecho · serie 2/4');
		expect(dom.guardado()).not.toBeNull();
	});

	it('al vencer pasa a vencido con restoSeg en 0 y cuenta el excedido', () => {
		descanso.iniciar(1, GLOW);
		vi.advanceTimersByTime(61_000);
		expect(descanso.vencido).toBe(true);
		expect(descanso.restoSeg).toBe(0);
		// 1 s de excedido al vencer + 42 s más.
		vi.advanceTimersByTime(42_000);
		expect(descanso.vencidoSeg).toBe(43);
	});

	it('atender apaga el estado y borra lo persistido', () => {
		descanso.iniciar(1, GLOW);
		vi.advanceTimersByTime(61_000);
		descanso.atender();
		expect(descanso.vencido).toBe(false);
		expect(descanso.restoSeg).toBe(0);
		expect(dom.guardado()).toBeNull();
	});

	it('ajustarFin mueve el final sin reiniciar la cuenta', () => {
		descanso.iniciar(3, GLOW);
		vi.advanceTimersByTime(30_000);
		expect(descanso.restoSeg).toBe(150);
		descanso.ajustarFin(1);
		// El fin pasa a inicio + 1 min: quedan 30 s de los 60, no 60 de nuevo.
		expect(descanso.restoSeg).toBe(30);
		expect(descanso.totalSeg).toBe(60);
	});

	it('ajustarResto cambia lo que falta y estira el total, sin mover el inicio', () => {
		descanso.iniciar(3, GLOW);
		vi.advanceTimersByTime(30_000);
		expect(descanso.restoSeg).toBe(150);

		// La rueda del descanso a pantalla completa pide "un minuto más desde ahora".
		descanso.ajustarResto(60);
		expect(descanso.restoSeg).toBe(60);
		// Ya pasaron 30 s: el total es lo corrido más lo que queda, para que el anillo
		// siga contando la misma historia.
		expect(descanso.totalSeg).toBe(90);
	});

	it('ajustarResto respeta el piso y el techo de la rueda', () => {
		descanso.iniciar(3, GLOW);
		descanso.ajustarResto(1);
		expect(descanso.restoSeg).toBe(15);
		descanso.ajustarResto(60 * 60);
		expect(descanso.restoSeg).toBe(15 * 60);
	});

	it('ajustarResto no revive un descanso ya vencido', () => {
		descanso.iniciar(1, GLOW);
		vi.advanceTimersByTime(61_000);
		expect(descanso.vencido).toBe(true);
		descanso.ajustarResto(120);
		expect(descanso.vencido).toBe(true);
		expect(descanso.restoSeg).toBe(0);
	});

	it('expandir y minimizar la pantalla enfocada no cortan el timer', () => {
		descanso.iniciar(2, GLOW);
		descanso.expandirFocus();
		expect(descanso.focusAbierto).toBe(true);
		descanso.minimizarFocus();
		expect(descanso.focusAbierto).toBe(false);
		expect(descanso.restoSeg).toBe(120);
	});

	it('al volver a la vista recalcula sin esperar al proximo tick', () => {
		descanso.iniciar(2, GLOW);
		// Pantalla bloqueada: el reloj avanza pero los timers de la pestaña no corren.
		vi.setSystemTime(Date.now() + 90_000);
		expect(descanso.restoSeg).toBe(120);

		dom.disparar('visibilitychange', {});

		expect(descanso.restoSeg).toBe(30);
	});

	it('un vencido sin atender se limpia solo pasado el tope', () => {
		descanso.iniciar(1, GLOW);
		vi.advanceTimersByTime(61_000);
		expect(descanso.vencido).toBe(true);
		vi.advanceTimersByTime(10 * 60_000);
		expect(descanso.vencido).toBe(false);
		expect(descanso.restoSeg).toBe(0);
		expect(dom.guardado()).toBeNull();
	});

	describe('sincronización entre instancias', () => {
		it('si la otra instancia corta el descanso, esta lo apaga', () => {
			descanso.iniciar(2, GLOW);
			dom.otraInstanciaEscribe(null);
			expect(descanso.restoSeg).toBe(0);
			expect(descanso.vencido).toBe(false);
		});

		it('adopta el descanso que arrancó la otra instancia', () => {
			descanso.iniciar(1, GLOW);
			const inicio = Date.now();
			dom.otraInstanciaEscribe({ inicio, hasta: inicio + 180_000 });
			expect(descanso.restoSeg).toBe(180);
			expect(descanso.totalSeg).toBe(180);
		});

		/**
		 * Regresión: `vencido` solo se apagaba en `iniciar()` y `#limpiar()`, nunca al
		 * restaurar. Con dos instancias abiertas, la que ya estaba vencida adoptaba el
		 * descanso nuevo arrastrando el vencido: mostraba "¡A la serie!" mientras corría
		 * el contador y, al vencer ese descanso nuevo, `restoSeg` nunca llegaba a 0 —
		 * la barra quedaba clavada en "0:01" con la alarma sonando en loop.
		 */
		it('adoptar un descanso nuevo estando vencido apaga el vencido y vuelve a contar', () => {
			descanso.iniciar(1, GLOW);
			vi.advanceTimersByTime(61_000);
			expect(descanso.vencido).toBe(true);

			const inicio = Date.now();
			dom.otraInstanciaEscribe({ inicio, hasta: inicio + 120_000 });

			expect(descanso.vencido).toBe(false);
			expect(descanso.vencidoSeg).toBe(0);
			expect(descanso.restoSeg).toBe(120);

			// Y el descanso adoptado vence bien, sin quedarse clavado en 1 segundo.
			vi.advanceTimersByTime(121_000);
			expect(descanso.vencido).toBe(true);
			expect(descanso.restoSeg).toBe(0);
		});

		it('descarta un descanso que venció hace demasiado', () => {
			const inicio = Date.now() - 30 * 60_000;
			dom.otraInstanciaEscribe({ inicio, hasta: inicio + 60_000 });
			expect(descanso.restoSeg).toBe(0);
			expect(descanso.vencido).toBe(false);
			expect(dom.guardado()).toBeNull();
		});
	});
});
