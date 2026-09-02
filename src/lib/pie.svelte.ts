/**
 * El hueco del pie: una tarjeta a la vez.
 *
 * Encima de la barra de navegación hay lugar para UN aviso, y ahí compiten tres cosas:
 * el acuse de lo que acabás de hacer (`ToastAccion`), el cartel de "hay una versión
 * nueva" y la barra del descanso. Sin coordinación se apilan por z-index y el de
 * arriba se come los toques del de abajo — medido con Playwright: con una
 * actualización pendiente, el botón de cerrar el acuse de Ajustes dejaba de responder
 * porque el cartel de versión (z-85) tapaba el aviso (z-70).
 *
 * Manda el acuse. Es la respuesta a algo que el usuario disparó recién y dura unos
 * segundos; el cartel de versión es persistente y puede esperar su turno, que es
 * exactamente lo que ya hacía con el acuse de "está actualizado".
 */
/**
 * El contador es una variable común y sólo el veredicto es reactivo, a propósito:
 * `tomar()` corre dentro del `$effect` del aviso, y un `avisos++` sobre un `$state`
 * lo lee y lo escribe en el mismo paso — el efecto pasa a depender de lo que él mismo
 * cambia y Svelte corta con `effect_update_depth_exceeded`, que además deja muerta la
 * reactividad del componente. Acá adentro sólo se escribe.
 */
let montados = 0;
let ocupado = $state(false);

export const pie = {
	/** true mientras haya un aviso montado en el pie. */
	get ocupado() {
		return ocupado;
	},
	/** Toma el hueco y devuelve cómo soltarlo. Pensado para la limpieza de un `$effect`. */
	tomar(): () => void {
		montados++;
		ocupado = true;
		let soltado = false;
		return () => {
			if (soltado) return;
			soltado = true;
			montados--;
			ocupado = montados > 0;
		};
	}
};
