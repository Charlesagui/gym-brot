/**
 * Buscar si hay una versión nueva publicada, desde cualquier pantalla.
 *
 * Vive fuera del layout porque Ajustes también necesita pedirlo, y a mano. El piso de
 * 60 s entre chequeos existe para que volver al frente varias veces seguidas no dispare
 * una request cada vez, pero es justo lo que confunde cuando acabás de deployar: mirás,
 * no pasa nada, y parece que el deploy no salió. El botón de Ajustes salta ese piso;
 * los chequeos de fondo lo respetan.
 *
 * Buscar NO activa nada: deja el service worker nuevo esperando y el cambio de versión
 * sigue dependiendo del botón "Actualizar" del cartel (ver `+layout.svelte`).
 */

/** Lo único que este módulo mira del registro, para poder testearlo sin navegador. */
export interface RegistroActualizable {
	update(): Promise<unknown>;
	readonly installing: unknown;
	readonly waiting: unknown;
}

export type ResultadoChequeo =
	/** Todavía no se registró el service worker en esta pestaña. */
	| 'sin-registro'
	/** El navegador se declara sin conexión: `update()` iba a rechazar igual. */
	| 'sin-red'
	/** Hubo un chequeo hace menos de `ESPERA_MIN_CHEQUEO_MS` y este no forzaba. */
	| 'demasiado-pronto'
	/** Hay una versión nueva instalándose o ya esperando. */
	| 'hay-version'
	/** Se consultó y esta es la última. */
	| 'al-dia'
	/** La consulta falló: sin red real, `sw.js` caído o el host devolviendo error. */
	| 'error';

export const ESPERA_MIN_CHEQUEO_MS = 60_000;

export class BuscadorDeVersion {
	#registro: RegistroActualizable | undefined;
	#ultimoChequeo = 0;

	constructor(private readonly ahora: () => number = Date.now) {}

	registrar(registro: RegistroActualizable | undefined) {
		this.#registro = registro;
	}

	async buscar({ forzar = false } = {}): Promise<ResultadoChequeo> {
		const registro = this.#registro;
		if (!registro) return 'sin-registro';
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'sin-red';
		const ahora = this.ahora();
		if (!forzar && ahora - this.#ultimoChequeo < ESPERA_MIN_CHEQUEO_MS) return 'demasiado-pronto';
		// Forzado o no, el chequeo salió a la red: cuenta para el piso del próximo.
		this.#ultimoChequeo = ahora;
		try {
			await registro.update();
		} catch {
			return 'error';
		}
		// `installing` es la que se está bajando ahora; `waiting`, una detectada antes que
		// sigue esperando el botón. Las dos significan lo mismo para quien pregunta.
		return registro.installing || registro.waiting ? 'hay-version' : 'al-dia';
	}
}

export const buscadorDeVersion = new BuscadorDeVersion();
