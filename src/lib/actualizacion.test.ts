import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	BuscadorDeVersion,
	ESPERA_MIN_CHEQUEO_MS,
	type RegistroActualizable
} from './actualizacion';

/** Registro mínimo: lo que Workbox deja visible y este módulo mira. */
function registro(
	estado: { installing?: unknown; waiting?: unknown; falla?: boolean } = {}
): RegistroActualizable & { update: ReturnType<typeof vi.fn> } {
	return {
		update: vi.fn(async () => {
			if (estado.falla) throw new Error('sw.js caído');
		}),
		get installing() {
			return estado.installing ?? null;
		},
		get waiting() {
			return estado.waiting ?? null;
		}
	};
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
		const reg = registro();
		const buscador = new BuscadorDeVersion();
		buscador.registrar(reg);
		expect(await buscador.buscar({ forzar: true })).toBe('sin-red');
		expect(reg.update).not.toHaveBeenCalled();
	});

	it('sin novedad responde al-dia', async () => {
		const buscador = new BuscadorDeVersion();
		buscador.registrar(registro());
		expect(await buscador.buscar()).toBe('al-dia');
	});

	it('detecta la que se está instalando y la que ya espera', async () => {
		const bajando = new BuscadorDeVersion();
		bajando.registrar(registro({ installing: {} }));
		expect(await bajando.buscar()).toBe('hay-version');

		const esperando = new BuscadorDeVersion();
		esperando.registrar(registro({ waiting: {} }));
		expect(await esperando.buscar()).toBe('hay-version');
	});

	it('si update() rechaza no rompe: devuelve error', async () => {
		const buscador = new BuscadorDeVersion();
		buscador.registrar(registro({ falla: true }));
		expect(await buscador.buscar()).toBe('error');
	});

	it('dos chequeos de fondo seguidos: el segundo no sale a la red', async () => {
		const t = reloj();
		const reg = registro();
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
		const reg = registro();
		const buscador = new BuscadorDeVersion(t.ahora);
		buscador.registrar(reg);

		await buscador.buscar();
		expect(await buscador.buscar({ forzar: true })).toBe('al-dia');
		expect(reg.update).toHaveBeenCalledTimes(2);
	});

	it('forzar también corre el piso, para que el fondo no consulte de nuevo enseguida', async () => {
		const t = reloj();
		const reg = registro();
		const buscador = new BuscadorDeVersion(t.ahora);
		buscador.registrar(reg);

		t.avanzar(ESPERA_MIN_CHEQUEO_MS * 2);
		await buscador.buscar({ forzar: true });
		expect(await buscador.buscar()).toBe('demasiado-pronto');
		expect(reg.update).toHaveBeenCalledTimes(1);
	});
});
