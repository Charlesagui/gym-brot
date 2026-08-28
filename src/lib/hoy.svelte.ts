import { hoyCalendarioLocal } from './fechas';

/**
 * Qué día es HOY, como dato vivo y único para toda la app.
 *
 * Existía repetido y congelado: cada pantalla hacía `const fechaApertura = hoyStr()` al
 * montarse y no lo volvía a mirar nunca. Eso mezclaba dos cosas distintas en una sola
 * constante —"a qué sesión escribo" y "qué día es hoy"— y hacía que las dos únicas
 * pantallas que escriben fueran las únicas que no se enteraban de que había cambiado el
 * día. Cruzando la medianoche entrenando (o volviendo a una PWA suspendida desde otro
 * día) la app seguía escribiendo en la sesión vieja sin avisar, y al primer paso por
 * Inicio abría una sesión nueva y vacía: se leía como "se me borró el entrenamiento".
 *
 * Acá vive solo el segundo significado. La fecha de la sesión se sigue congelando en la
 * pantalla, que es lo correcto: la sesión que empezaste es la que seguís editando.
 */
class Hoy {
	/** Fecha local YYYY-MM-DD, la misma forma que usan las claves de sesión. */
	valor = $state(hoyCalendarioLocal());

	#iniciado = false;
	#medianoche: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Engancha los listeners globales una sola vez (lo llama el layout).
	 *
	 * Volver al frente no alcanza: entrenando, el wake lock deja la pantalla encendida y
	 * la app en primer plano durante horas, así que la medianoche puede pasar sin un solo
	 * `visibilitychange`. Por eso además se arma un temporizador hasta el próximo cambio
	 * de día, que se vuelve a armar solo.
	 */
	init() {
		if (this.#iniciado || typeof window === 'undefined') return;
		this.#iniciado = true;
		const refrescar = () => this.refrescar();
		document.addEventListener('visibilitychange', refrescar);
		window.addEventListener('focus', refrescar);
		// El teléfono puede haber estado dormido: al volver de bfcache el reloj saltó.
		window.addEventListener('pageshow', refrescar);
		this.#armarMedianoche();
	}

	/** Vuelve a leer el reloj. Sin cambio de día no toca el estado (no invalida nada). */
	refrescar() {
		const ahora = hoyCalendarioLocal();
		if (ahora !== this.valor) this.valor = ahora;
	}

	#armarMedianoche() {
		if (this.#medianoche) clearTimeout(this.#medianoche);
		const ahora = new Date();
		const proxima = new Date(ahora);
		proxima.setHours(24, 0, 0, 0);
		// Un segundo de margen: despertar en el borde exacto puede leer todavía el día
		// anterior por el redondeo del temporizador.
		const espera = Math.max(1000, proxima.getTime() - ahora.getTime() + 1000);
		this.#medianoche = setTimeout(() => {
			this.refrescar();
			this.#armarMedianoche();
		}, espera);
	}
}

export const hoy = new Hoy();
