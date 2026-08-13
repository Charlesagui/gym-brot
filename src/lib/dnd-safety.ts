/**
 * svelte-dnd-action clona el elemento arrastrado y lo agrega directamente a
 * `document.body` (fuera del árbol de Svelte) mientras dura el arrastre, y solo lo
 * saca en el `touchend`/`mouseup` normal. La librería no escucha `touchcancel` ni
 * navegación: si el gesto de "volver" del sistema (swipe desde el borde) se roba la
 * secuencia de touch a mitad de un arrastre, ese clon queda huérfano — Svelte ni se
 * entera, porque nunca formó parte de la página que se desmonta. Sin esto, la
 * tarjeta que se estaba reordenando quedaba flotando sobre la pantalla siguiente.
 */
const ID_ELEMENTO_ARRASTRADO = 'dnd-action-dragged-el';

export function limpiarArrastreHuerfano(): void {
	document.getElementById(ID_ELEMENTO_ARRASTRADO)?.remove();
}
