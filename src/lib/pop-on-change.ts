import { DUR_BASE } from './motion';

/**
 * Acción: dispara un pop breve (.gb-pop, ver app.css) cada vez que `valor` cambia
 * después del montaje. El primer valor (al montar) no anima — solo un cambio real
 * merece el acuse, no la carga inicial de un número que puede venir de cualquier lado.
 */
export function popOnChange(node: HTMLElement, valor: unknown) {
	let anterior = valor;
	let visto = false;
	let id: ReturnType<typeof setTimeout> | null = null;

	return {
		update(nuevo: unknown) {
			if (!visto) {
				visto = true;
				anterior = nuevo;
				return;
			}
			if (nuevo === anterior) return;
			anterior = nuevo;
			node.classList.remove('gb-pop');
			void node.offsetWidth; // reflow: permite re-disparar la animación en toques seguidos
			node.classList.add('gb-pop');
			if (id) clearTimeout(id);
			id = setTimeout(() => node.classList.remove('gb-pop'), DUR_BASE);
		},
		destroy() {
			if (id) clearTimeout(id);
		}
	};
}
