/**
 * Saber si hay una versión nueva publicada, y aplicarla, desde cualquier pantalla.
 *
 * Vive fuera del layout porque Ajustes también necesita pedirlo, y a mano. El piso de
 * 60 s entre chequeos existe para que volver al frente varias veces seguidas no dispare
 * una request cada vez, pero es justo lo que confunde cuando acabás de deployar: mirás,
 * no pasa nada, y parece que el deploy no salió. El botón de Ajustes salta ese piso;
 * los chequeos de fondo lo respetan.
 *
 * Este módulo es la ÚNICA fuente de verdad sobre si hay versión esperando. Antes el
 * cartel del layout se apoyaba en el evento `waiting` de workbox-window, que no es una
 * fuente de verdad: workbox se da de baja del `updatefound` del registro en cuanto
 * clasifica una actualización como "externa" —cosa que hace pasados 60 s del registro,
 * o sea siempre para el botón de Ajustes y para el chequeo de fondo— y a partir de ahí
 * la versión siguiente queda esperando sin que nadie avise. La app instalada, que no se
 * cierra nunca, llegaba a ese estado en el segundo deploy: Ajustes decía "hay versión
 * nueva, tocá Actualizar" y el botón ya no podía existir. Acá el `updatefound` lo
 * escuchamos nosotros y no lo soltamos jamás.
 */

/** Lo que este módulo mira de un service worker, para poder testearlo sin navegador. */
export interface TrabajadorObservable {
	readonly state: string;
	addEventListener(tipo: 'statechange', escucha: () => void): void;
	removeEventListener(tipo: 'statechange', escucha: () => void): void;
	postMessage(mensaje: unknown): void;
}

/** Lo único que este módulo mira del registro, por el mismo motivo. */
export interface RegistroActualizable {
	update(): Promise<unknown>;
	readonly installing: TrabajadorObservable | null;
	readonly waiting: TrabajadorObservable | null;
	addEventListener(tipo: 'updatefound', escucha: () => void): void;
}

export type ResultadoChequeo =
	/** Todavía no se registró el service worker en esta pestaña. */
	| 'sin-registro'
	/** El navegador se declara sin conexión: `update()` iba a rechazar igual. */
	| 'sin-red'
	/** Hubo un chequeo hace menos de `ESPERA_MIN_CHEQUEO_MS` y este no forzaba. */
	| 'demasiado-pronto'
	/** Hay una versión nueva bajándose: todavía no se puede aplicar. */
	| 'bajando'
	/** Hay una versión nueva instalada y esperando: se puede aplicar ya. */
	| 'hay-version'
	/** Se consultó y esta es la última. */
	| 'al-dia'
	/** La consulta falló: sin red real, `sw.js` caído o el host devolviendo error. */
	| 'error';

export const ESPERA_MIN_CHEQUEO_MS = 60_000;

/** El mensaje que `sw.js` escucha para dejar de esperar y tomar el control. */
const SKIP_WAITING = { type: 'SKIP_WAITING' };

/**
 * Actualizar termina en una recarga, y una recarga se lleva puesto cualquier estado en
 * memoria: sin dejar una marca del otro lado, el logro se pierde justo cuando pasa. Va en
 * `sessionStorage` y no en `localStorage` a propósito — muere con la pestaña, así que una
 * app que se actualizó sola estando cerrada no saluda con un cartel viejo al abrirse.
 */
const CLAVE_ACTUALIZADA = 'gb-version-anterior';

/** Anota qué versión estamos dejando, justo antes de que la recarga se lleve todo. */
export function marcarActualizacion(versionQueDejamos: string) {
	try {
		sessionStorage.setItem(CLAVE_ACTUALIZADA, versionQueDejamos);
	} catch {
		// Modo privado o storage bloqueado: se pierde el acuse, no la actualización.
	}
}

/**
 * Del otro lado de la recarga: devuelve la versión que dejamos, una sola vez. Compararla
 * con la actual es lo que separa "se actualizó" de "se recargó" — decir que actualizaste
 * cuando el commit es el mismo sería el mismo tipo de mentira que este módulo vino a
 * sacar de Ajustes.
 */
export function consumirActualizacion(): string | null {
	try {
		const anterior = sessionStorage.getItem(CLAVE_ACTUALIZADA);
		sessionStorage.removeItem(CLAVE_ACTUALIZADA);
		return anterior;
	} catch {
		return null;
	}
}

export class BuscadorDeVersion {
	#registro: RegistroActualizable | undefined;
	#ultimoChequeo = 0;
	#lista = false;
	/** Instalaciones que ya estamos siguiendo, para no enganchar dos veces la misma. */
	#seguidas = new WeakSet<TrabajadorObservable>();
	#avisos = new Set<() => void>();
	#pedidos = new Set<() => void>();

	constructor(private readonly ahora: () => number = Date.now) {}

	/** Hay una versión instalada esperando. Es lo que habilita el botón "Actualizar". */
	get hayVersionLista() {
		return this.#lista;
	}

	/** Avisa cuando una versión queda lista. Devuelve cómo dejar de escuchar. */
	alQuedarLista(escucha: () => void): () => void {
		if (this.#lista) escucha();
		this.#avisos.add(escucha);
		return () => this.#avisos.delete(escucha);
	}

	/**
	 * Escucha los pedidos de actualizar que llegan desde otras pantallas. Quien decide
	 * CUÁNDO se aplica es el layout, que es el único que sabe si estás entrenando; acá
	 * sólo se transporta el pedido. Devuelve cómo dejar de escuchar.
	 */
	alPedirAplicar(escucha: () => void): () => void {
		this.#pedidos.add(escucha);
		return () => this.#pedidos.delete(escucha);
	}

	/** "Actualizá ahora." Lo usa el botón de Ajustes; el layout resuelve el momento. */
	pedirAplicar() {
		for (const atender of this.#pedidos) atender();
	}

	registrar(registro: RegistroActualizable | undefined) {
		this.#registro = registro;
		if (!registro) return;
		// Nuestro propio listener, que no se desengancha nunca. Es toda la diferencia
		// con el de workbox-window (ver el comentario de arriba).
		registro.addEventListener('updatefound', () => this.#seguirInstalacion());
		this.#revisar();
	}

	/** Mira el registro ahora mismo: puede haber quedado algo esperando de antes. */
	#revisar() {
		const registro = this.#registro;
		if (!registro) return;
		if (registro.waiting) this.#marcarLista();
		else this.#seguirInstalacion();
	}

	/**
	 * La que se está bajando todavía no sirve: recién cuando termina de instalarse pasa
	 * a `waiting` y se puede aplicar. Si la instalación falla —la conexión del gym, la
	 * cuota del teléfono— queda `redundant` y no habilita nada, que es lo correcto:
	 * prometer un botón por una descarga que nunca terminó es exactamente el bug viejo.
	 */
	#seguirInstalacion() {
		const registro = this.#registro;
		const bajando = registro?.installing;
		if (!registro || !bajando || this.#seguidas.has(bajando)) return;
		this.#seguidas.add(bajando);
		const alCambiar = () => {
			if (bajando.state === 'installing') return;
			bajando.removeEventListener('statechange', alCambiar);
			if (registro.waiting === bajando) this.#marcarLista();
		};
		bajando.addEventListener('statechange', alCambiar);
	}

	#marcarLista() {
		if (this.#lista) return;
		this.#lista = true;
		for (const avisar of this.#avisos) avisar();
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
		// `update()` ya disparó `updatefound` si había algo nuevo; esto engancha el
		// seguimiento igual por si el registro llegó con una instalación ya empezada.
		this.#revisar();
		if (registro.waiting) return 'hay-version';
		return registro.installing ? 'bajando' : 'al-dia';
	}

	/**
	 * Espera a que la que se está bajando quede lista. Devuelve `false` si no llegó a
	 * tiempo: sin tope, el botón de Ajustes se quedaría girando para siempre cuando la
	 * instalación se corta.
	 */
	esperarLista(topeMs: number): Promise<boolean> {
		if (this.#lista) return Promise.resolve(true);
		return new Promise((resolver) => {
			let cerrado = false;
			let dejar: (() => void) | undefined;
			let id: ReturnType<typeof setTimeout> | undefined;
			const cerrar = (listo: boolean) => {
				if (cerrado) return;
				cerrado = true;
				clearTimeout(id);
				dejar?.();
				resolver(listo);
			};
			id = setTimeout(() => cerrar(false), topeMs);
			dejar = this.alQuedarLista(() => cerrar(true));
			// Si avisó en el acto, `dejar` todavía no existía adentro de `cerrar`.
			if (cerrado) dejar();
		});
	}

	/**
	 * Le pide al service worker que espera que tome el control ahora. No recarga ni
	 * espera: la recarga la dispara `controllerchange`, que el layout escucha para
	 * todos los casos —este botón, otra pestaña, la app instalada— y no sólo para este.
	 */
	aplicar(): boolean {
		const esperando = this.#registro?.waiting;
		if (!esperando) return false;
		esperando.postMessage(SKIP_WAITING);
		return true;
	}
}

export const buscadorDeVersion = new BuscadorDeVersion();
