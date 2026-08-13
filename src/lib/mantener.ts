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
	let longPressActivo = false;
	// El `click` se emite al soltar el puntero, después de que ya entramos al modo
	// reordenar. Si la acción vive sobre una tarjeta que contiene un enlace, sin
	// bloquearlo se navega al ejercicio inmediatamente y parece que el long-press
	// no funcionó.
	let suprimirSiguienteClick = false;
	const DEMORA = 420; // ms apretado para activar
	const TOLERANCIA = 10; // px de movimiento antes de cancelar (es scroll, no long-press)

	function cancelar() {
		if (timer) clearTimeout(timer);
		timer = null;
	}

	function alApretar(evento: Event) {
		const e = evento as PointerEvent;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		suprimirSiguienteClick = false;
		longPressActivo = false;
		inicioX = e.clientX;
		inicioY = e.clientY;
		cancelar();
		timer = setTimeout(() => {
			timer = null;
			// Esperamos a soltar para que el listener de click siga montado cuando el
			// navegador intente activar el enlace de la tarjeta.
			longPressActivo = true;
		}, DEMORA);
	}

	function alSoltar(evento: Event) {
		cancelar();
		if (!longPressActivo) return;
		longPressActivo = false;
		suprimirSiguienteClick = true;
		// También ayuda a que el navegador no genere el click de compatibilidad.
		evento.preventDefault();
		actual();
	}

	function alCancelar() {
		cancelar();
		longPressActivo = false;
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

	function alClick(e: Event) {
		if (!suprimirSiguienteClick) return;
		suprimirSiguienteClick = false;
		e.preventDefault();
		e.stopPropagation();
	}

	node.addEventListener('pointerdown', alApretar);
	node.addEventListener('pointermove', alMover);
	node.addEventListener('pointerup', alSoltar);
	node.addEventListener('pointercancel', alCancelar);
	node.addEventListener('pointerleave', alCancelar);
	node.addEventListener('contextmenu', alMenu);
	// Captura el click que nace en un enlace hijo antes de que llegue a su handler.
	node.addEventListener('click', alClick, true);

	return {
		update(nuevo: () => void) {
			actual = nuevo;
		},
		destroy() {
			alCancelar();
			suprimirSiguienteClick = false;
			node.removeEventListener('pointerdown', alApretar);
			node.removeEventListener('pointermove', alMover);
			node.removeEventListener('pointerup', alSoltar);
			node.removeEventListener('pointercancel', alCancelar);
			node.removeEventListener('pointerleave', alCancelar);
			node.removeEventListener('contextmenu', alMenu);
			node.removeEventListener('click', alClick, true);
		}
	};
}
