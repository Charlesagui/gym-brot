import { writable } from 'svelte/store';

/**
 * El pedido de instalación nativo de Chrome y Samsung Internet (`beforeinstallprompt`).
 *
 * El evento llega una sola vez, poco después de cargar, y en la pantalla que esté
 * abierta: si lo escuchara la portada, quien entra directo a un ejercicio lo perdería.
 * Por eso se escucha desde el layout y se guarda acá hasta que alguien lo use.
 * Safari no lo implementa: ahí el aviso muestra los pasos a mano.
 */
export interface PedidoInstalacion extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const pedidoInstalacion = writable<PedidoInstalacion | null>(null);

/** Se instaló en esta visita (desde el aviso o desde el menú del navegador). */
export const instaladaRecien = writable(false);

export function escucharInstalacion(): () => void {
	if (typeof window === 'undefined') return () => {};
	function alOfrecer(evento: Event) {
		// Sin esto el navegador muestra su propia barra, fuera de contexto.
		evento.preventDefault();
		pedidoInstalacion.set(evento as PedidoInstalacion);
	}
	function alInstalar() {
		pedidoInstalacion.set(null);
		instaladaRecien.set(true);
	}
	window.addEventListener('beforeinstallprompt', alOfrecer);
	window.addEventListener('appinstalled', alInstalar);
	return () => {
		window.removeEventListener('beforeinstallprompt', alOfrecer);
		window.removeEventListener('appinstalled', alInstalar);
	};
}

/** Abierta desde el ícono, no desde una pestaña del navegador. */
export function abiertaInstalada(): boolean {
	if (typeof window === 'undefined') return false;
	const modos = ['standalone', 'fullscreen', 'minimal-ui'];
	if (modos.some((modo) => window.matchMedia?.(`(display-mode: ${modo})`).matches)) return true;
	return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
