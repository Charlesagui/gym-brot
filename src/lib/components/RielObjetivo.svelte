<script module lang="ts">
	/**
	 * Cuánto empuja una posición, que es lo único que el color tiene permitido decir.
	 * No es una escala de cinco tonos a propósito: déficit agresivo y volumen agresivo
	 * comparten el naranja porque comparten la advertencia, no porque sean lo mismo.
	 */
	export type TonoObjetivo = 'calmo' | 'normal' | 'fuerte';

	export interface ParadaObjetivo {
		id: string;
		/** El nombre entero. No entra en la muesca: va al lector de pantalla. */
		rotulo: string;
		/** Lo que sí entra: dos caracteres que se leen como escala. */
		marca: string;
		tono: TonoObjetivo;
		/** Una posición que el motor no pudo calcular queda muerta, no desaparece. */
		disponible: boolean;
	}
</script>

<script lang="ts">
	import { vibrar } from '$lib/vibracion';

	/**
	 * Riel de objetivo: cinco posiciones, una elegida.
	 *
	 * **Por qué no es un slider.** Un riel fino con una perilla es un control pintado, y
	 * el manifiesto pide lo contrario: un control grande tiene que verse apretable. Así
	 * que esto es una canaleta hundida con cinco teclas, de las cuales una está levantada
	 * y encendida — el selector de un tablero, no el control de un sistema operativo. El
	 * relieve sale de `.gb-opcion-elegida`, las mismas dos caras que usan las opciones del
	 * cuestionario.
	 *
	 * **Se toca y se desliza, y el toque manda.** La regla de la app es que un solo toque
	 * le gana a cualquier gesto, y acá se cumple literal: tocar una muesca salta a ella.
	 * El arrastre existe para lo que el toque no puede hacer —recorrer las cinco viendo
	 * cómo se mueven los macros, el ritmo y la banda— que es explorar, no elegir.
	 *
	 * **Nada de esto persiste.** Igual que en `RuedaTiempo`, moverse por el riel es
	 * explorar: `onElegir` sólo cambia lo que se está mirando. Guardar sigue siendo un
	 * botón aparte, y tiene que seguir siéndolo: cada objetivo guardado es una fila nueva
	 * y la ventana de revisión arranca en su fecha, así que escribir por cada muesca
	 * reiniciaría el reloj de la calibración en cada deslizada.
	 */
	let {
		paradas,
		valor,
		vibracion = true,
		etiqueta = 'Objetivo',
		onElegir
	}: {
		paradas: ParadaObjetivo[];
		valor: string;
		vibracion?: boolean;
		etiqueta?: string;
		onElegir: (id: string) => void;
	} = $props();

	/**
	 * El tono viaja por `--opcion-color`, el mismo gancho que ya usa la pantalla para
	 * teñir de naranja lo que trae advertencia.
	 *
	 * `calmo` va con el triple rgb de `--muted` escrito a mano porque el token es un hex
	 * (`#9aa0b4`) y acá hace falta con opacidad variable. Es la única cifra suelta del
	 * archivo y vive acá, y no como token nuevo en app.css, porque el gris apagado no
	 * significa nada fuera de este riel: es la ausencia de empuje, no un color de marca.
	 */
	const COLOR_TONO: Record<TonoObjetivo, string> = {
		calmo: '154 160 180',
		normal: 'var(--accent-rgb)',
		fuerte: 'var(--max)'
	};

	let nodo = $state<HTMLDivElement | undefined>(undefined);
	/** Hay un dedo apoyado sobre el riel. Sólo entonces el movimiento cambia algo. */
	let arrastrando = false;

	function paradaEn(clientX: number): ParadaObjetivo | null {
		if (!nodo || paradas.length === 0) return null;
		const caja = nodo.getBoundingClientRect();
		if (caja.width <= 0) return null;
		const proporcion = (clientX - caja.left) / caja.width;
		const indice = Math.floor(proporcion * paradas.length);
		return paradas[Math.min(paradas.length - 1, Math.max(0, indice))] ?? null;
	}

	/**
	 * El tic va acá y no en el llamador: una muesca que se cruza es una muesca que se
	 * sintió, y da igual si se llegó tocando o arrastrando.
	 */
	function elegir(parada: ParadaObjetivo | null) {
		if (!parada || !parada.disponible || parada.id === valor) return;
		vibrar(8, vibracion);
		onElegir(parada.id);
	}

	function alApretar(evento: PointerEvent) {
		if (evento.pointerType === 'mouse' && evento.button !== 0) return;
		arrastrando = true;
		nodo?.setPointerCapture(evento.pointerId);
		elegir(paradaEn(evento.clientX));
	}

	function alMover(evento: PointerEvent) {
		if (!arrastrando) return;
		elegir(paradaEn(evento.clientX));
	}

	function alSoltar(evento: PointerEvent) {
		arrastrando = false;
		if (nodo?.hasPointerCapture(evento.pointerId)) nodo.releasePointerCapture(evento.pointerId);
	}

	/**
	 * El puntero ya eligió en `pointerdown`, así que el click que viene después sería el
	 * segundo — y peor: después de arrastrar de la primera muesca a la última, el click
	 * aterriza en la primera y desharía el gesto entero. Un click de teclado (Enter o
	 * espacio sobre la tecla enfocada) llega con `detail === 0`, y ése es el único que
	 * este handler tiene que atender.
	 */
	function alClickear(evento: MouseEvent, parada: ParadaObjetivo) {
		if (evento.detail !== 0) return;
		elegir(parada);
	}
</script>

<!-- La canaleta. `pan-y` deja que la página siga scrolleando en vertical: el gesto de
     este control es horizontal y no tiene por qué secuestrar el otro. -->
<div
	bind:this={nodo}
	role="group"
	aria-label={etiqueta}
	class="flex touch-pan-y select-none gap-1 rounded-2xl p-1"
	style="background: var(--surface-2)"
	onpointerdown={alApretar}
	onpointermove={alMover}
	onpointerup={alSoltar}
	onpointercancel={alSoltar}
>
	{#each paradas as parada (parada.id)}
		<button
			type="button"
			aria-label={parada.rotulo}
			aria-pressed={parada.id === valor}
			disabled={!parada.disponible}
			onclick={(evento) => alClickear(evento, parada)}
			class="min-h-14 flex-1 rounded-xl text-sm font-bold disabled:opacity-30 {parada.id === valor
				? 'gb-opcion-elegida'
				: ''}"
			style="--opcion-color: {COLOR_TONO[parada.tono]}; color: {parada.id === valor
				? 'var(--text)'
				: 'var(--muted)'}"
		>
			<span class="cifra text-base">{parada.marca}</span>
		</button>
	{/each}
</div>

<style>
	/*
	 * El dedo arrastra el valor, no la página ni una selección de texto. `pan-y` vive en
	 * la clase de Tailwind; esto cubre al puntero de mouse, que sí seleccionaría.
	 */
	button {
		-webkit-user-select: none;
		user-select: none;
		/*
		 * La transición va acá y no en una clase de Tailwind por dos razones. Una: lo que
		 * más se mueve al encenderse una tecla es el relieve, y `transition-colors` no
		 * cubre `box-shadow`, así que el bisel aparecía de golpe mientras el fondo se
		 * fundía. Dos: la duración tenía que viajar inline para leer el token, y una
		 * declaración inline le gana a la regla de menor movimiento de más abajo.
		 */
		transition:
			background-color var(--dur-fast) var(--ease-out),
			box-shadow var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	/*
	 * Menos movimiento: acá lo único que se mueve es el tinte y el relieve de la tecla al
	 * encenderse. Con la preferencia activada el cambio es instantáneo, no inexistente —
	 * la tecla sigue diciendo cuál está elegida, sin el fundido.
	 */
	@media (prefers-reduced-motion: reduce) {
		button {
			transition: none;
		}
	}
</style>
