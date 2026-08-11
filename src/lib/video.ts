const CACHE_VIDEOS = 'gb-videos';

/**
 * Acción para <video> de demostración: asigna el `src` y reproduce solo cuando
 * el elemento entra en viewport, y pausa al salir. Con cientos de ejercicios en
 * el catálogo, montar y cargar la metadata de todos a la vez es pesado en mobile;
 * la carga diferida del src evita esos cientos de requests al abrir la pantalla.
 */
export async function cachearVideoCompleto(src: string, signal?: AbortSignal): Promise<void> {
	if (typeof caches === 'undefined') throw new Error('Este navegador no permite guardar videos.');
	const cache = await caches.open(CACHE_VIDEOS);
	if (await cache.match(src)) return;

	// `video` suele pedir rangos 206. Para servir esos rangos offline Workbox necesita
	// una respuesta completa 200 ya guardada; por eso esta descarga no reutiliza el
	// streaming parcial del elemento <video>.
	const response = await fetch(src, { signal, cache: 'no-store' });
	if (!response.ok) throw new Error(`El video respondió ${response.status}.`);
	await cache.put(src, response);
	if (!(await cache.match(src))) throw new Error('No se pudo verificar el video descargado.');
}

export function reproducirEnVista(node: HTMLVideoElement, src: string) {
	let cargado = false;
	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					if (!cargado) {
						node.src = src;
						cargado = true;
						void cachearVideoCompleto(src).catch(() => {});
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
