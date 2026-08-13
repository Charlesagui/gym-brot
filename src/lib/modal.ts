export interface OpcionesModal {
	onClose: () => void;
	/** Selector dentro del diálogo. Si falta, toma el primer control disponible. */
	focoInicial?: string;
}

const SELECTOR_FOCO =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

const pila: symbol[] = [];

/**
 * Contrato común de un overlay modal: foco inicial y encerrado, Escape, fondo
 * inerte, scroll bloqueado y restauración del foco al cerrar.
 */
export function modal(node: HTMLElement, opciones: OpcionesModal) {
	const id = Symbol('modal');
	let actuales = opciones;
	let activado = false;
	let frame = 0;
	let focoPrevio: HTMLElement | null = null;
	let overflowBody = '';
	let overflowHtml = '';
	const inertes: {
		elemento: HTMLElement;
		inertePrevio: boolean;
		ariaHiddenPrevio: string | null;
	}[] = [];

	function panel(): HTMLElement {
		return node.matches('[role="dialog"]')
			? node
			: (node.querySelector<HTMLElement>('[role="dialog"]') ?? node);
	}

	function enfocables(): HTMLElement[] {
		return Array.from(panel().querySelectorAll<HTMLElement>(SELECTOR_FOCO)).filter(
			(elemento) =>
				!elemento.inert &&
				elemento.tabIndex >= 0 &&
				!elemento.hasAttribute('disabled') &&
				elemento.getClientRects().length > 0
		);
	}

	function aislarFondo() {
		let actual: HTMLElement | null = node;
		while (actual && actual !== document.body) {
			const padre: HTMLElement | null = actual.parentElement;
			if (!padre) break;
			for (const hermano of padre.children) {
				if (hermano === actual) continue;
				const elemento = hermano as HTMLElement;
				inertes.push({
					elemento,
					inertePrevio: elemento.hasAttribute('inert'),
					ariaHiddenPrevio: elemento.getAttribute('aria-hidden')
				});
				elemento.setAttribute('inert', '');
				elemento.setAttribute('aria-hidden', 'true');
			}
			actual = padre;
		}
	}

	function manejarTecla(evento: KeyboardEvent) {
		if (pila.at(-1) !== id) return;
		if (evento.key === 'Escape') {
			evento.preventDefault();
			actuales.onClose();
			return;
		}
		if (evento.key !== 'Tab') return;

		const elementos = enfocables();
		if (!elementos.length) {
			evento.preventDefault();
			panel().focus({ preventScroll: true });
			return;
		}
		const primero = elementos[0]!;
		const ultimo = elementos.at(-1)!;
		const foco = document.activeElement;
		if (evento.shiftKey && (foco === primero || !panel().contains(foco))) {
			evento.preventDefault();
			ultimo.focus({ preventScroll: true });
		} else if (!evento.shiftKey && (foco === ultimo || !panel().contains(foco))) {
			evento.preventDefault();
			primero.focus({ preventScroll: true });
		}
	}

	function activar() {
		if (activado || !node.isConnected) return;
		activado = true;
		focoPrevio = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		overflowBody = document.body.style.overflow;
		overflowHtml = document.documentElement.style.overflow;
		document.body.style.overflow = 'hidden';
		document.documentElement.style.overflow = 'hidden';
		aislarFondo();
		pila.push(id);
		document.addEventListener('keydown', manejarTecla, true);
		frame = requestAnimationFrame(() => {
			const inicial = actuales.focoInicial
				? panel().querySelector<HTMLElement>(actuales.focoInicial)
				: undefined;
			(inicial ?? enfocables()[0] ?? panel()).focus({ preventScroll: true });
		});
	}

	queueMicrotask(activar);

	return {
		update(nuevas: OpcionesModal) {
			actuales = nuevas;
		},
		destroy() {
			cancelAnimationFrame(frame);
			document.removeEventListener('keydown', manejarTecla, true);
			const indice = pila.lastIndexOf(id);
			if (indice >= 0) pila.splice(indice, 1);
			for (const { elemento, inertePrevio, ariaHiddenPrevio } of inertes) {
				if (!inertePrevio) elemento.removeAttribute('inert');
				if (ariaHiddenPrevio == null) elemento.removeAttribute('aria-hidden');
				else elemento.setAttribute('aria-hidden', ariaHiddenPrevio);
			}
			document.body.style.overflow = overflowBody;
			document.documentElement.style.overflow = overflowHtml;
			if (focoPrevio?.isConnected)
				requestAnimationFrame(() => focoPrevio?.focus({ preventScroll: true }));
		}
	};
}
