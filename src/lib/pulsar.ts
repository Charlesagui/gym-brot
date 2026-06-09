/**
 * Acción para steppers: un tap dispara una vez; mantener apretado repite
 * (tras una demora corta) hasta soltar. Suprime el click fantasma que el
 * navegador emite al soltar después de una repetición.
 */
export function pulsar(node: HTMLElement, fn: () => void) {
	let actual = fn;
	let demoraId: ReturnType<typeof setTimeout> | null = null;
	let repetirId: ReturnType<typeof setInterval> | null = null;
	let repitio = false;

	function frenar() {
		if (demoraId) clearTimeout(demoraId);
		if (repetirId) clearInterval(repetirId);
		demoraId = null;
		repetirId = null;
	}

	function alApretar() {
		repitio = false;
		demoraId = setTimeout(() => {
			repetirId = setInterval(() => {
				repitio = true;
				actual();
			}, 130);
		}, 450);
	}

	function alClick(e: MouseEvent) {
		if (repitio) {
			repitio = false;
			e.preventDefault();
			e.stopImmediatePropagation();
			return;
		}
		actual();
	}

	function alMenu(e: Event) {
		e.preventDefault(); // long-press en mobile abre el menú contextual: acá molesta
	}

	node.addEventListener('pointerdown', alApretar);
	node.addEventListener('pointerup', frenar);
	node.addEventListener('pointercancel', frenar);
	node.addEventListener('pointerleave', frenar);
	node.addEventListener('click', alClick);
	node.addEventListener('contextmenu', alMenu);

	return {
		update(nuevo: () => void) {
			actual = nuevo;
		},
		destroy() {
			frenar();
			node.removeEventListener('pointerdown', alApretar);
			node.removeEventListener('pointerup', frenar);
			node.removeEventListener('pointercancel', frenar);
			node.removeEventListener('pointerleave', frenar);
			node.removeEventListener('click', alClick);
			node.removeEventListener('contextmenu', alMenu);
		}
	};
}
