/**
 * Acción de "mantener apretado" (long-press): dispara `fn` si el dedo/cursor sigue
 * presionado tras una demora corta sin moverse demasiado. Sirve para entrar al modo
 * reordenar desde la lista del día sin chocar con el tap (navegar) ni el scroll.
 */
export function mantener(node: HTMLElement | SVGElement, fn: () => void) {
	let actual = fn;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let inicioX = 0;
	let inicioY = 0;
	const DEMORA = 420; // ms apretado para activar
	const TOLERANCIA = 10; // px de movimiento antes de cancelar (es scroll, no long-press)

	function cancelar() {
		if (timer) clearTimeout(timer);
		timer = null;
	}

	function alApretar(evento: Event) {
		const e = evento as PointerEvent;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		inicioX = e.clientX;
		inicioY = e.clientY;
		cancelar();
		timer = setTimeout(() => {
			timer = null;
			actual();
		}, DEMORA);
	}

	function alMover(evento: Event) {
		const e = evento as PointerEvent;
		if (!timer) return;
		if (Math.abs(e.clientX - inicioX) > TOLERANCIA || Math.abs(e.clientY - inicioY) > TOLERANCIA) {
			cancelar();
		}
	}

	function alMenu(e: Event) {
		e.preventDefault(); // long-press en mobile abre el menú contextual: acá molesta
	}

	node.addEventListener('pointerdown', alApretar);
	node.addEventListener('pointermove', alMover);
	node.addEventListener('pointerup', cancelar);
	node.addEventListener('pointercancel', cancelar);
	node.addEventListener('pointerleave', cancelar);
	node.addEventListener('contextmenu', alMenu);

	return {
		update(nuevo: () => void) {
			actual = nuevo;
		},
		destroy() {
			cancelar();
			node.removeEventListener('pointerdown', alApretar);
			node.removeEventListener('pointermove', alMover);
			node.removeEventListener('pointerup', cancelar);
			node.removeEventListener('pointercancel', cancelar);
			node.removeEventListener('pointerleave', cancelar);
			node.removeEventListener('contextmenu', alMenu);
		}
	};
}
