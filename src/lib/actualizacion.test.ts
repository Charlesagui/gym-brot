import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	BuscadorDeVersion,
	ESPERA_MIN_CHEQUEO_MS,
	type RegistroActualizable,
	type TrabajadorObservable
} from './actualizacion';

/** Service worker de mentira: lo mínimo que el buscador le mira y le manda. */
class SwFalso implements TrabajadorObservable {
	state = 'installing';
	mensajes: unknown[] = [];
	#escuchas = new Set<() => void>();
	addEventListener(_t: 'statechange', escucha: () => void) {
		this.#escuchas.add(escucha);
	}
	removeEventListener(_t: 'statechange', escucha: () => void) {
		this.#escuchas.delete(escucha);
	}
	postMessage(mensaje: unknown) {
		this.mensajes.push(mensaje);
	}
	pasarA(estado: string) {
		this.state = estado;
		for (const escucha of [...this.#escuchas]) escucha();
	}
}

/**
 * Registro de mentira que se comporta como el del navegador en lo único que importa:
 * dispara `updatefound` cada vez que empieza a bajar una versión, para siempre.
 */
class RegistroFalso implements RegistroActualizable {
	installing: SwFalso | null = null;
	waiting: SwFalso | null = null;
	update = vi.fn(async () => {
		if (this.falla) throw new Error('sw.js caído');
	});
	falla = false;
	#escuchas = new Set<() => void>();
	addEventListener(_t: 'updatefound', escucha: () => void) {
		this.#escuchas.add(escucha);
	}
	/** El navegador encontró un sw.js distinto y arrancó a instalarlo. */
	empezarInstalacion() {
		const sw = new SwFalso();
		this.waiting = null;
		this.installing = sw;
		for (const escucha of [...this.#escuchas]) escucha();
		return sw;
	}
	/** La instalación terminó bien: el nuevo queda esperando su turno. */
	terminarInstalacion() {
		const sw = this.installing!;
		this.installing = null;
		this.waiting = sw;
		sw.pasarA('installed');
		return sw;
	}
	/** La instalación se cortó (red, cuota): no queda nada esperando. */
	fallarInstalacion() {
		const sw = this.installing!;
		this.installing = null;
		sw.pasarA('redundant');
	}
	/** Un deploy completo, de punta a punta. */
	deployar() {
		this.empezarInstalacion();
		return this.terminarInstalacion();
	}
}

/** Reloj a mano: el piso entre chequeos se mide, no se espera. */
function reloj(inicio = 1_000_000) {
	let t = inicio;
	return { ahora: () => t, avanzar: (ms: number) => (t += ms) };
}

afterEach(() => vi.unstubAllGlobals());

describe('BuscadorDeVersion', () => {
	it('sin registro no consulta nada', async () => {
		expect(await new BuscadorDeVersion().buscar()).toBe('sin-registro');
	});

	it('declarado sin conexión no sale a la red', async () => {
		vi.stubGlobal('navigator', { onLine: false });
		const reg = new RegistroFalso();
		const buscador = new BuscadorDeVersion();
		buscador.registrar(reg);
		expect(await buscador.buscar({ forzar: true })).toBe('sin-red');
		expect(reg.update).not.toHaveBeenCalled();
	});

	it('sin novedad responde al-dia', async () => {
		const buscador = new BuscadorDeVersion();
		buscador.registrar(new RegistroFalso());
		expect(await buscador.buscar()).toBe('al-dia');
	});

	it('separa la que se está bajando de la que ya espera', async () => {
		const reg = new RegistroFalso();
		const buscador = new BuscadorDeVersion();
		buscador.registrar(reg);

		reg.empezarInstalacion();
		expect(await buscador.buscar({ forzar: true })).toBe('bajando');
		expect(buscador.hayVersionLista).toBe(false);

		reg.terminarInstalacion();
		expect(await buscador.buscar({ forzar: true })).toBe('hay-version');
		expect(buscador.hayVersionLista).toBe(true);
	});

	it('si update() rechaza no rompe: devuelve error', async () => {
		const reg = new RegistroFalso();
		reg.falla = true;
		const buscador = new BuscadorDeVersion();
		buscador.registrar(reg);
		expect(await buscador.buscar()).toBe('error');
	});

	it('dos chequeos de fondo seguidos: el segundo no sale a la red', async () => {
		const t = reloj();
		const reg = new RegistroFalso();
		const buscador = new BuscadorDeVersion(t.ahora);
		buscador.registrar(reg);

		expect(await buscador.buscar()).toBe('al-dia');
		t.avanzar(ESPERA_MIN_CHEQUEO_MS - 1);
		expect(await buscador.buscar()).toBe('demasiado-pronto');
		expect(reg.update).toHaveBeenCalledTimes(1);

		t.avanzar(1);
		expect(await buscador.buscar()).toBe('al-dia');
		expect(reg.update).toHaveBeenCalledTimes(2);
	});

	it('forzar salta el piso: es para lo que existe el botón de Ajustes', async () => {
		const t = reloj();
		const reg = new RegistroFalso();
		const buscador = new BuscadorDeVersion(t.ahora);
		buscador.registrar(reg);

		await buscador.buscar();
		expect(await buscador.buscar({ forzar: true })).toBe('al-dia');
		expect(reg.update).toHaveBeenCalledTimes(2);
	});

	it('forzar también corre el piso, para que el fondo no consulte de nuevo enseguida', async () => {
		const t = reloj();
		const reg = new RegistroFalso();
		const buscador = new BuscadorDeVersion(t.ahora);
		buscador.registrar(reg);

		t.avanzar(ESPERA_MIN_CHEQUEO_MS * 2);
		await buscador.buscar({ forzar: true });
		expect(await buscador.buscar()).toBe('demasiado-pronto');
		expect(reg.update).toHaveBeenCalledTimes(1);
	});
});

describe('avisar que hay versión lista', () => {
	it('la que ya estaba esperando al registrar cuenta desde el arranque', () => {
		const reg = new RegistroFalso();
		reg.waiting = new SwFalso();
		const buscador = new BuscadorDeVersion();
		buscador.registrar(reg);
		expect(buscador.hayVersionLista).toBe(true);
	});

	it('avisa sin que nadie pregunte: el deploy llega solo', () => {
		const reg = new RegistroFalso();
		const buscador = new BuscadorDeVersion();
		const avisos = vi.fn();
		buscador.registrar(reg);
		buscador.alQuedarLista(avisos);

		reg.deployar();
		expect(avisos).toHaveBeenCalledTimes(1);
		expect(buscador.hayVersionLista).toBe(true);
	});

	it('quien se suscribe tarde igual se entera', () => {
		const reg = new RegistroFalso();
		const buscador = new BuscadorDeVersion();
		buscador.registrar(reg);
		reg.deployar();

		const avisos = vi.fn();
		buscador.alQuedarLista(avisos);
		expect(avisos).toHaveBeenCalledTimes(1);
	});

	it('una instalación que se corta no habilita nada', () => {
		const reg = new RegistroFalso();
		const buscador = new BuscadorDeVersion();
		const avisos = vi.fn();
		buscador.registrar(reg);
		buscador.alQuedarLista(avisos);

		reg.empezarInstalacion();
		reg.fallarInstalacion();
		expect(buscador.hayVersionLista).toBe(false);
		expect(avisos).not.toHaveBeenCalled();
	});

	/**
	 * EL BUG. workbox-window se da de baja del `updatefound` en cuanto clasifica una
	 * actualización como "externa" (pasados 60 s del registro, o sea siempre para el
	 * botón de Ajustes), así que su evento `waiting` dejaba de llegar a partir del
	 * segundo deploy en la misma página: Ajustes decía "hay versión nueva" y el cartel
	 * con el botón "Actualizar" no aparecía nunca. Acá el listener es nuestro.
	 */
	it('el tercer deploy en la misma página avisa igual que el primero', async () => {
		const reg = new RegistroFalso();
		const buscador = new BuscadorDeVersion();
		buscador.registrar(reg);

		for (let n = 1; n <= 3; n++) {
			reg.deployar();
			expect(await buscador.buscar({ forzar: true })).toBe('hay-version');
			expect(buscador.hayVersionLista).toBe(true);
		}
	});

	it('esperarLista corta con el tope si la descarga no termina', async () => {
		vi.useFakeTimers();
		try {
			const reg = new RegistroFalso();
			const buscador = new BuscadorDeVersion();
			buscador.registrar(reg);
			reg.empezarInstalacion();

			const espera = buscador.esperarLista(1000);
			await vi.advanceTimersByTimeAsync(1000);
			expect(await espera).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('esperarLista resuelve cuando la instalación termina', async () => {
		vi.useFakeTimers();
		try {
			const reg = new RegistroFalso();
			const buscador = new BuscadorDeVersion();
			buscador.registrar(reg);
			reg.empezarInstalacion();

			const espera = buscador.esperarLista(1000);
			reg.terminarInstalacion();
			await vi.advanceTimersByTimeAsync(0);
			expect(await espera).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('pedidos de aplicar', () => {
	it('el pedido llega a quien decide el momento', () => {
		const buscador = new BuscadorDeVersion();
		const atender = vi.fn();
		buscador.alPedirAplicar(atender);
		buscador.pedirAplicar();
		expect(atender).toHaveBeenCalledTimes(1);
	});

	it('quien se dio de baja no lo recibe', () => {
		const buscador = new BuscadorDeVersion();
		const atender = vi.fn();
		buscador.alPedirAplicar(atender)();
		buscador.pedirAplicar();
		expect(atender).not.toHaveBeenCalled();
	});
});

describe('aplicar', () => {
	it('sin nada esperando no manda nada y lo dice', () => {
		const buscador = new BuscadorDeVersion();
		buscador.registrar(new RegistroFalso());
		expect(buscador.aplicar()).toBe(false);
	});

	it('le manda SKIP_WAITING al que espera', () => {
		const reg = new RegistroFalso();
		const buscador = new BuscadorDeVersion();
		buscador.registrar(reg);
		const nuevo = reg.deployar();

		expect(buscador.aplicar()).toBe(true);
		expect(nuevo.mensajes).toEqual([{ type: 'SKIP_WAITING' }]);
	});
});
