/**
 * Acción para <video> de demostración: asigna el `src` y reproduce solo cuando
 * el elemento entra en viewport, y pausa al salir. Con cientos de ejercicios en
 * el catálogo, montar y cargar la metadata de todos a la vez es pesado en mobile;
 * la carga diferida del src evita esos cientos de requests al abrir la pantalla.
 */
export function reproducirEnVista(node: HTMLVideoElement, src: string) {
	let cargado = false;
	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					if (!cargado) {
						node.src = src;
						cargado = true;
					}
					void node.play().catch(() => {});
				} else {
					node.pause();
				}
			}
		},
		// rootMargin adelanta la carga un poco antes de entrar a la vista → scroll fluido.
		{ threshold: 0.15, rootMargin: '200px' }
	);
	io.observe(node);
	return {
		destroy() {
			io.disconnect();
		}
	};
}
