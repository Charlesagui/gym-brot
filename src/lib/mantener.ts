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
	let suprimirSiguienteClick = false;
	let bloqueoClickId: ReturnType<typeof setTimeout> | null = null;
	const DEMORA = 420; // ms apretado para activar
	const TOLERANCIA = 10; // px de movimiento antes de cancelar (es scroll, no long-press)

	function cancelar() {
		if (timer) clearTimeout(timer);
		timer = null;
		node.classList.remove('gb-long-press-pending');
	}

	function limpiarBloqueoClick() {
		if (bloqueoClickId) clearTimeout(bloqueoClickId);
		bloqueoClickId = null;
		suprimirSiguienteClick = false;
		window.removeEventListener('click', alClick, true);
	}

	function bloquearSiguienteClick() {
		limpiarBloqueoClick();
		suprimirSiguienteClick = true;
		// El modo reordenar reemplaza la tarjeta y desmonta esta acción antes de
		// soltar el dedo. Por eso el bloqueo vive brevemente en window: captura el
		// click de compatibilidad aunque el enlace original ya no esté en el DOM.
		window.addEventListener('click', alClick, true);
		bloqueoClickId = setTimeout(limpiarBloqueoClick, 750);
	}

	function alApretar(evento: Event) {
		const e = evento as PointerEvent;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		limpiarBloqueoClick();
		longPressActivo = false;
		inicioX = e.clientX;
		inicioY = e.clientY;
		cancelar();
		// Confirma visualmente desde el primer instante que mantener esta tarjeta
		// tiene una acción, antes de que se cumpla la demora del long-press.
		node.classList.add('gb-long-press-pending');
		timer = setTimeout(() => {
			timer = null;
			node.classList.remove('gb-long-press-pending');
			longPressActivo = true;
			bloquearSiguienteClick();
			actual();
		}, DEMORA);
	}

	function alSoltar(evento: Event) {
		cancelar();
		if (!longPressActivo) return;
		longPressActivo = false;
		// También ayuda a que el navegador no genere el click de compatibilidad.
		evento.preventDefault();
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
		limpiarBloqueoClick();
		e.preventDefault();
		e.stopImmediatePropagation();
		e.stopPropagation();
	}

	node.addEventListener('pointerdown', alApretar);
	node.addEventListener('pointermove', alMover);
	node.addEventListener('pointerup', alSoltar);
	node.addEventListener('pointercancel', alCancelar);
	node.addEventListener('pointerleave', alCancelar);
	node.addEventListener('contextmenu', alMenu);

	return {
		update(nuevo: () => void) {
			actual = nuevo;
		},
		destroy() {
			alCancelar();
			node.removeEventListener('pointerdown', alApretar);
			node.removeEventListener('pointermove', alMover);
			node.removeEventListener('pointerup', alSoltar);
			node.removeEventListener('pointercancel', alCancelar);
			node.removeEventListener('pointerleave', alCancelar);
			node.removeEventListener('contextmenu', alMenu);
		}
	};
}
