import { ajustesObs } from './extras';
import { vibrar } from './vibracion';

/**
 * Estado de presión global.
 *
 * `:active` solo no alcanza en el teléfono: iOS lo retiene mientras decide si el
 * gesto es un scroll, así que un tap corto sobre una página scrolleable casi no
 * lo muestra — justo la sensación de "aprieto y no pasa nada". Acá marcamos el
 * elemento con `data-gb-press` en `pointerdown`, que llega siempre y al instante
 * (ver la regla de .gb-pressable en app.css, que escucha los dos estados).
 *
 * Un solo listener delegado en el documento cubre toda la app: no hay que
 * acordarse de enganchar nada en cada botón nuevo.
 */

/** Elementos que reciben acuse de presión (espejo del selector de app.css). */
const TOCABLES = 'button, a[href], summary, [role="button"], .gb-pressable';

/** Movimiento que convierte el toque en scroll y cancela la presión. */
const TOLERANCIA_PX = 12;

/**
 * Tic háptico de toque: corto de más para "sentirse", no para notarse. Se dispara
 * al soltar y no al apretar, porque medio app es una lista de tarjetas-enlace: con
 * el tic en `pointerdown`, cada scroll que arranca sobre una tarjeta vibraría.
 */
const TIC_MS = 8;

let vibracion = false;

function esPresionable(el: Element): boolean {
	if (el.classList.contains('gb-no-press')) return false;
	return !(el instanceof HTMLButtonElement && el.disabled);
}

export function iniciarPresion(): () => void {
	if (typeof document === 'undefined') return () => {};

	let apretado: Element | null = null;
	let idPuntero: number | null = null;
	let conDedo = false;
	let inicioX = 0;
	let inicioY = 0;

	function soltar() {
		if (!apretado) return;
		apretado.removeAttribute('data-gb-press');
		apretado = null;
		idPuntero = null;
		conDedo = false;
	}

	function alApretar(evento: PointerEvent) {
		soltar(); // un puntero nuevo siempre gana al anterior
		if (evento.pointerType === 'mouse' && evento.button !== 0) return;
		const objetivo = evento.target;
		if (!(objetivo instanceof Element)) return;
		const el = objetivo.closest(TOCABLES);
		if (!el || !esPresionable(el)) return;
		apretado = el;
		idPuntero = evento.pointerId;
		conDedo = evento.pointerType !== 'mouse';
		inicioX = evento.clientX;
		inicioY = evento.clientY;
		el.setAttribute('data-gb-press', '');
	}

	function alMover(evento: PointerEvent) {
		if (!apretado || evento.pointerId !== idPuntero) return;
		if (
			Math.abs(evento.clientX - inicioX) > TOLERANCIA_PX ||
			Math.abs(evento.clientY - inicioY) > TOLERANCIA_PX
		)
			soltar();
	}

	/** Soltar sin haberse ido de scroll: recién acá el toque cuenta como toque. */
	function alSoltarDedo(evento: PointerEvent) {
		const confirmado = apretado !== null && evento.pointerId === idPuntero && conDedo;
		soltar();
		if (confirmado) vibrar(TIC_MS, vibracion);
	}

	// Captura: el acuse tiene que soltarse aunque el handler del elemento frene
	// la propagación (los steppers y el arrastre de reordenar lo hacen).
	const opciones = { capture: true, passive: true } as const;
	document.addEventListener('pointerdown', alApretar, opciones);
	document.addEventListener('pointermove', alMover, opciones);
	document.addEventListener('pointerup', alSoltarDedo, opciones);
	document.addEventListener('pointercancel', soltar, opciones);
	// Un scroll con el dedo apoyado no siempre emite pointercancel.
	document.addEventListener('scroll', soltar, opciones);
	window.addEventListener('blur', soltar);

	const suscripcion = ajustesObs().subscribe({
		next: (a) => (vibracion = a.vibracion ?? true),
		error: () => (vibracion = false)
	});

	return () => {
		soltar();
		suscripcion.unsubscribe();
		document.removeEventListener('pointerdown', alApretar, opciones);
		document.removeEventListener('pointermove', alMover, opciones);
		document.removeEventListener('pointerup', alSoltarDedo, opciones);
		document.removeEventListener('pointercancel', soltar, opciones);
		document.removeEventListener('scroll', soltar, opciones);
		window.removeEventListener('blur', soltar);
	};
}
