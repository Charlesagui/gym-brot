/**
 * Reordenar es un MODO, no una pantalla. La ruta no cambia, pero para la persona
 * cambió todo, y eso obliga a dos cosas que la pantalla no puede resolver sola.
 *
 * 1. El gesto de volver del sistema tiene que CERRAR el modo, no sacarte del día.
 *    En Android es la forma natural de salir de cualquier cosa que se abrió encima,
 *    y sin esto te llevaba a la pantalla anterior con el orden a medio acomodar.
 *    Se empuja una entrada de historial al abrir —el mismo patrón que ya usa el
 *    modal de técnica en /ejercicio/[id]— y se saca al cerrar por el botón, para no
 *    dejar un "atrás" que no hace nada.
 *
 * 2. Mientras está abierto, la barra inferior no puede seguir ofreciendo cuatro
 *    salidas a otras secciones. Con la salida del modo al final de la lista y cinco
 *    salidas equivocadas siempre a la vista, irse por error era más fácil que
 *    terminar. El layout lee `abierto` y esconde la barra; el espacio queda
 *    reservado igual, y ahí va la salida del modo.
 */

let abierto = $state(false);
/** Si la entrada de historial que empujamos sigue arriba en la pila. */
let enHistoria = false;

function alVolverAtras() {
	// El navegador ya sacó nuestra entrada: sólo queda cerrar.
	enHistoria = false;
	cerrarEstado();
}

function cerrarEstado() {
	abierto = false;
	if (typeof window !== 'undefined') window.removeEventListener('popstate', alVolverAtras);
}

export const modoOrden = {
	get abierto() {
		return abierto;
	},

	abrir() {
		if (abierto || typeof window === 'undefined') return;
		abierto = true;
		// Se conserva el estado que ya tenía SvelteKit (su índice de historia): pisarlo
		// le rompe la navegación posterior.
		const estado = history.state && typeof history.state === 'object' ? history.state : {};
		history.pushState({ ...estado, gbOrden: true }, '', window.location.href);
		enHistoria = true;
		window.addEventListener('popstate', alVolverAtras);
	},

	/** Salida por el botón del modo: cierra y descarta la entrada de historial. */
	cerrar() {
		if (!abierto) return;
		const sacar = enHistoria;
		enHistoria = false;
		cerrarEstado();
		// Sin esto queda una entrada con la misma URL y el próximo "atrás" no haría nada.
		if (sacar) history.back();
	},

	/**
	 * La pantalla se va (navegó, se recargó, se borró el día): soltar el listener sin
	 * tocar el historial, que ya lo está manejando quien nos sacó de acá.
	 */
	descartar() {
		enHistoria = false;
		cerrarEstado();
	}
};
