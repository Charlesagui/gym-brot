<script lang="ts">
	import { vibrar } from '$lib/vibracion';

	/**
	 * Cinta métrica para elegir un peso.
	 *
	 * Por qué acá y no en el peso de una serie: el manifiesto dice que un solo toque le
	 * gana a cualquier gesto, y tiene razón *ahí*, donde el peso que buscás ya viene
	 * prellenado de la vez anterior y está a un toque de distancia. El objetivo de la
	 * calculadora no tiene nada de eso: se explora. Ir de 60 a 100 kg con un ± son
	 * dieciséis toques, y ninguno de los dieciséis te muestra lo que hay en el medio.
	 *
	 * La cinta se mueve con el dedo, como una cinta de verdad: la arrastrás a la derecha
	 * y aparecen los números más chicos, porque lo que corre es la cinta y no la aguja.
	 * La aguja se queda fija en el centro y es la que dice dónde estás parado.
	 *
	 * El teclado no se pierde: es un `slider` con flechas, y el peso exacto se sigue
	 * pudiendo escribir tocando la cifra, que vive afuera de este componente.
	 */
	let {
		valor,
		min,
		max,
		paso,
		formato,
		unidad,
		onCambio,
		vibracion = true,
		etiqueta,
		cadaMayor = 4
	}: {
		valor: number;
		min: number;
		max: number;
		paso: number;
		formato: (n: number) => string;
		unidad: string;
		onCambio: (nuevo: number) => void;
		vibracion?: boolean;
		etiqueta: string;
		/**
		 * Cada cuántos pasos va una marca numerada. El peso corporal avanza de a 0,1 y
		 * con el valor por defecto rotularía 80,0 · 80,4 · 80,8: los números tienen que
		 * caer donde la cabeza los espera, y para el cuerpo eso es cada medio kilo.
		 */
		cadaMayor?: number;
	} = $props();

	/** Cuánto hay que arrastrar para correr un paso. Con 14 px la pantalla entera son ~25. */
	const PIXELES_POR_PASO = 14;
	/** Una marca alta con su número cada cuatro pasos: con paso de 2,5 kg, cada 10. */
	/** Cuántos pasos se dibujan a cada lado del centro. Lo que sobra lo recorta el overflow. */
	const ALCANCE = 26;

	let nodo: HTMLDivElement | undefined;
	/**
	 * Posición continua mientras arrastrás, sin redondear; `null` cuando no hay dedo.
	 *
	 * La cifra salta de a pasos pero la cinta corre pegada al dedo: si se redondeara
	 * también la cinta, el gesto se sentiría trabado. Y en reposo la posición se deriva
	 * del valor, así que la cinta queda sobre la marca aunque el peso venga de afuera
	 * —escrito a mano, o recalculado al cambiar de unidad— sin ningún efecto que
	 * sincronice nada.
	 */
	let arrastre = $state<number | null>(null);
	const arrastrando = $derived(arrastre !== null);
	const posicion = $derived(arrastre ?? valor);
	let origenX: number | null = null;
	let posicionInicial = 0;

	function acotar(n: number): number {
		return Math.min(max, Math.max(min, n));
	}

	function enPaso(n: number): number {
		return acotar(Math.round(n / paso) * paso);
	}

	function mover(nuevo: number) {
		const limpio = enPaso(nuevo);
		if (limpio === valor) return;
		onCambio(limpio);
		vibrar(6, vibracion);
	}

	function alApretar(evento: PointerEvent) {
		if (evento.pointerType === 'mouse' && evento.button !== 0) return;
		nodo?.setPointerCapture(evento.pointerId);
		origenX = evento.clientX;
		posicionInicial = valor;
		arrastre = valor;
	}

	function alMover(evento: PointerEvent) {
		if (origenX === null) return;
		evento.preventDefault();
		const corrido = evento.clientX - origenX;
		// La cinta sigue al dedo: llevarla a la derecha trae los números de abajo.
		arrastre = acotar(posicionInicial - (corrido / PIXELES_POR_PASO) * paso);
		mover(arrastre);
	}

	function alSoltar(evento: PointerEvent) {
		if (origenX === null) return;
		origenX = null;
		arrastre = null;
		if (nodo?.hasPointerCapture(evento.pointerId)) nodo.releasePointerCapture(evento.pointerId);
	}

	function alTeclado(evento: KeyboardEvent) {
		const finos: Record<string, number> = {
			ArrowRight: 1,
			ArrowUp: 1,
			ArrowLeft: -1,
			ArrowDown: -1
		};
		const gruesos: Record<string, number> = { PageUp: cadaMayor, PageDown: -cadaMayor };
		const saltos: Record<string, number> = {
			Home: (min - valor) / paso,
			End: (max - valor) / paso
		};
		const pasos = finos[evento.key] ?? gruesos[evento.key] ?? saltos[evento.key];
		if (pasos === undefined) return;
		evento.preventDefault();
		mover(valor + pasos * paso);
	}

	interface Marca {
		valor: number;
		x: number;
		mayor: boolean;
	}

	/**
	 * Las marcas se dibujan alrededor de la posición continua, así que el dibujo entero
	 * se desliza. Una marca es mayor por su valor y no por su lugar en la lista: la que
	 * dice 100 lleva número esté donde esté.
	 */
	const marcas = $derived.by<Marca[]>(() => {
		const centro = Math.round(posicion / paso);
		const salida: Marca[] = [];
		for (let i = centro - ALCANCE; i <= centro + ALCANCE; i++) {
			const v = i * paso;
			if (v < min || v > max) continue;
			salida.push({
				valor: v,
				x: ((v - posicion) / paso) * PIXELES_POR_PASO,
				mayor: i % cadaMayor === 0
			});
		}
		return salida;
	});
</script>

<div
	bind:this={nodo}
	class="gb-cinta"
	class:gb-cinta-activa={arrastrando}
	role="slider"
	tabindex="0"
	aria-label={etiqueta}
	aria-valuemin={min}
	aria-valuemax={max}
	aria-valuenow={valor}
	aria-valuetext={`${formato(valor)} ${unidad}`}
	onpointerdown={alApretar}
	onpointermove={alMover}
	onpointerup={alSoltar}
	onpointercancel={alSoltar}
	onkeydown={alTeclado}
>
	<div class="gb-cinta-riel" aria-hidden="true">
		{#each marcas as marca (marca.valor)}
			<span
				class="gb-cinta-marca"
				class:gb-cinta-mayor={marca.mayor}
				style="left: calc(50% + {marca.x}px)"
			></span>
			{#if marca.mayor}
				<span class="gb-cinta-numero cifra" style="left: calc(50% + {marca.x}px)"
					>{formato(marca.valor)}</span
				>
			{/if}
		{/each}
	</div>
	<span class="gb-cinta-aguja" aria-hidden="true"></span>
</div>

<style>
	/*
	 * `pan-y` y no `none`: el navegador se queda con el scroll vertical, así que la
	 * página sigue scrolleando aunque el dedo caiga sobre la cinta. Nos cede el
	 * horizontal, que es el único eje que la cinta usa.
	 */
	.gb-cinta {
		position: relative;
		height: 3.25rem;
		overflow: hidden;
		border-radius: 0.75rem;
		background: rgb(255 255 255 / 0.035);
		touch-action: pan-y;
		cursor: ew-resize;
		user-select: none;
		-webkit-user-select: none;
	}

	.gb-cinta-activa {
		background: rgb(255 255 255 / 0.06);
	}

	/* Los extremos se desvanecen: la cinta sigue más allá del recuadro, no se corta. */
	.gb-cinta-riel {
		position: absolute;
		inset: 0;
		mask-image: linear-gradient(to right, transparent, #000 14%, #000 86%, transparent);
	}

	.gb-cinta-marca {
		position: absolute;
		bottom: 1.3rem;
		width: 1px;
		height: 0.5rem;
		background: rgb(255 255 255 / 0.3);
	}

	.gb-cinta-mayor {
		height: 0.85rem;
		width: 2px;
		background: rgb(255 255 255 / 0.5);
	}

	.gb-cinta-numero {
		position: absolute;
		bottom: 0.25rem;
		transform: translateX(-50%);
		font-size: 0.85rem;
		color: var(--muted);
		white-space: nowrap;
	}

	/* La aguja: lo único que no se mueve, y por eso es la que marca el valor. */
	.gb-cinta-aguja {
		position: absolute;
		left: 50%;
		top: 0.3rem;
		bottom: 1.15rem;
		width: 2px;
		margin-left: -1px;
		border-radius: 1px;
		background: var(--accent-text);
		box-shadow: 0 0 10px rgb(var(--accent-rgb) / 0.7);
	}

	.gb-cinta:focus-visible {
		outline: 3px solid var(--accent-text);
		outline-offset: 3px;
	}
</style>
