const CACHE_VIDEOS = 'gb-videos';

/** La videoteca completa ocupa ~22 MB; dejamos margen para los datos de entrenamiento. */
export const RESERVA_VIDEOTECA_COMPLETA = 28 * 1024 * 1024;

export interface EstadoAlmacenamiento {
	uso: number | null;
	cuota: number | null;
	libre: number | null;
}

/** Cache Storage e IndexedDB comparten la cuota del origen. */
export async function estadoAlmacenamiento(): Promise<EstadoAlmacenamiento> {
	if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
		return { uso: null, cuota: null, libre: null };
	}
	try {
		const { usage, quota } = await navigator.storage.estimate();
		const uso = typeof usage === 'number' ? usage : null;
		const cuota = typeof quota === 'number' ? quota : null;
		return {
			uso,
			cuota,
			libre: uso != null && cuota != null ? Math.max(0, cuota - uso) : null
		};
	} catch {
		// Algunos WebViews rechazan estimate(); no impedimos la descarga explícita.
		return { uso: null, cuota: null, libre: null };
	}
}

/** Devuelve false solo cuando el navegador informó que no queda el margen pedido. */
export async function hayEspacioParaReserva(reserva: number): Promise<boolean> {
	const { libre } = await estadoAlmacenamiento();
	return libre == null || libre >= reserva;
}

export async function contarVideosGuardados(): Promise<number> {
	if (typeof caches === 'undefined') return 0;
	return (await caches.open(CACHE_VIDEOS)).keys().then((entradas) => entradas.length);
}

export async function borrarVideosGuardados(): Promise<number> {
	if (typeof caches === 'undefined')
		throw new Error('Este navegador no permite borrar videos guardados.');
	const cache = await caches.open(CACHE_VIDEOS);
	const entradas = await cache.keys();
	await Promise.all(entradas.map((entrada) => cache.delete(entrada)));
	return entradas.length;
}

/** Guarda una respuesta completa, necesaria para que Workbox responda rangos offline. */
export async function cachearVideoCompleto(src: string, signal?: AbortSignal): Promise<void> {
	if (typeof caches === 'undefined') throw new Error('Este navegador no permite guardar videos.');
	const cache = await caches.open(CACHE_VIDEOS);
	if (await cache.match(src)) return;

	const response = await fetch(src, { signal, cache: 'no-store' });
	if (!response.ok) throw new Error(`El video respondió ${response.status}.`);
	const tamanio = Number(response.headers.get('content-length')) || 0;
	if (!(await hayEspacioParaReserva(tamanio))) {
		throw new Error('No queda espacio suficiente para guardar este video.');
	}
	await cache.put(src, response);
	if (!(await cache.match(src))) throw new Error('No se pudo verificar el video descargado.');
}

function soltarVideo(node: HTMLVideoElement) {
	node.pause();
	node.removeAttribute('src');
	node.load();
}

/**
 * Demo visible en una pantalla de ejercicio. Al cambiar de ejercicio o salir de
 * la ruta libera explícitamente el decodificador y cualquier descarga en curso.
 */
export function demostracionActiva(node: HTMLVideoElement, src: string) {
	let actual = src;

	function cargar() {
		node.src = actual;
		node.load();
		void node.play().catch(() => {});
	}

	cargar();
	return {
		update(siguiente: string) {
			if (siguiente === actual) return;
			soltarVideo(node);
			actual = siguiente;
			cargar();
		},
		destroy() {
			soltarVideo(node);
		}
	};
}

/**
 * Carga una miniatura solo al entrar en pantalla. Al salir, suelta el decoder y
 * la descarga; recorrer el catálogo no debe llenar memoria ni almacenamiento.
 * La videoteca offline se descarga explícitamente desde Ajustes.
 */
export function reproducirEnVista(node: HTMLVideoElement, src: string) {
	let cargado = false;
	let enVista = false;

	function cargarSiCorresponde() {
		if (!enVista || cargado) return;
		node.src = src;
		node.load();
		cargado = true;
		void node.play().catch(() => {});
	}

	function liberar() {
		if (!cargado) return;
		soltarVideo(node);
		cargado = false;
	}

	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					enVista = true;
					cargarSiCorresponde();
				} else {
					enVista = false;
					liberar();
				}
			}
		},
		// rootMargin adelanta la carga un poco antes de entrar a la vista → scroll fluido.
		{ threshold: 0.15, rootMargin: '200px' }
	);
	io.observe(node);
	return {
		update(siguiente: string) {
			if (siguiente === src) return;
			liberar();
			src = siguiente;
			cargarSiCorresponde();
		},
		destroy() {
			io.disconnect();
			liberar();
		}
	};
}
