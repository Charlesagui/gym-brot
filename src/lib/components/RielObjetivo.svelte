<script module lang="ts">
	import type { TonoObjetivo } from '$lib/energia';

	export interface ParadaObjetivo {
		id: string;
		/**
		 * El nombre que se ve en la muesca, partido en dos renglones si hace falta. Es
		 * también el nombre accesible: no hay `aria-label` encima justamente para que no
		 * puedan divergir. Cuando las muescas decían "−−" hacía falta uno —un símbolo no le
		 * sirve a nadie que no vea la pantalla— y con él llegó el problema de siempre: la
		 * etiqueta decía "Mantenimiento" y la muesca "Mantener", así que quien maneja la app
		 * por voz decía lo que leía y no pasaba nada.
		 */
		corto: string;
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
	 * cuestionario — y las **dos**: la muesca sin elegir lleva `.gb-opcion`, no nada.
	 *
	 * Que las cuatro sin elegir fueran texto suelto sobre la canaleta parecía más limpio y
	 * no lo era: medidas, las cinco teclas miden lo mismo (56 px, mismo borde de arriba y
	 * de abajo), pero sólo una tenía caja, así que la elegida se leía como un bulto que
	 * sobresale de una fila de palabras en vez de como la tecla apretada de cinco iguales.
	 * Con las dos caras puestas, lo que distingue a la elegida es el relieve y el tinte, que
	 * es de lo que se trata.
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
	 * La escala, en triples rgb.
	 *
	 * Un color por posición y no tres compartidos. Agrupar por "cuánto empuja" hacía que
	 * déficit agresivo y volumen agresivo salieran del mismo naranja, y dos muescas del
	 * mismo color en las dos puntas de una escala se leen como la misma cosa, siendo
	 * opuestas.
	 *
	 *     rojo   dorado   verde   cian   violeta
	 *     ◄── comer menos   ·   comer más ──►
	 *
	 * Es un recorrido por el espectro, no un divergente: el color no dice cuánto empuja
	 * cada opción, dice **cuál es** y en qué orden va. Dos muescas nunca se confunden, que
	 * es lo que se le pide acá — la magnitud ya la dicen las kcal y la fila de diferencia.
	 *
	 * Un solo mapa y no dos: antes había uno de relleno y otro de tinta, porque el violeta
	 * de fondo de la app no llega al contraste como letra y existe un `--accent-text`
	 * aparte para eso. Estos cinco están elegidos para servir a las dos cosas, así que el
	 * mismo valor pinta la letra y —al 18 %, vía `--opcion-color`— el relleno de la elegida.
	 *
	 * Los cinco pasan AA sobre `--surface` como texto: el más justo es el violeta con 4,7:1
	 * y el resto va de 6,6 a 12. Si alguno se toca, se comprueba de nuevo — son letras de
	 * 10 px, que es donde el contraste se cobra primero.
	 *
	 * El verde es más claro que `--exito` a propósito: ese token significa "terminado" en
	 * toda la app —día cerrado, revisión lista— y acá sólo marca una posición de la escala.
	 *
	 * Y el déficit moderado **no** lleva el naranja de `--max`, que es lo que llevaba antes.
	 * En esta app el naranja significa advertencia: lo usan el aviso de tope por IMC, el
	 * canto del paso con reparos y la primera frase cuando pide una acción. Ponérselo al
	 * moderado contradecía al motor, que es el que decide — `ritmosDisponibles` le da
	 * `aviso: null` al moderado y sí se lo pone al agresivo. El dorado queda en la misma
	 * franja cálida, así que el orden del espectro no se rompe, pero desaturado: es lo que
	 * le saca la alarma sin sacarle el lugar.
	 */
	const COLOR_TONO: Record<TonoObjetivo, string> = {
		'deficit-fuerte': '255 107 92',
		'deficit-suave': '224 203 150',
		neutro: '134 230 172',
		'volumen-suave': '56 199 236',
		'volumen-fuerte': '130 104 255'
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
			aria-pressed={parada.id === valor}
			disabled={!parada.disponible}
			onclick={(evento) => alClickear(evento, parada)}
			class="flex min-h-14 min-w-0 flex-1 items-center justify-center rounded-xl px-0.5 py-1.5 disabled:opacity-30 {parada.id ===
			valor
				? 'gb-opcion-elegida'
				: 'gb-opcion'}"
			style="--opcion-color: {COLOR_TONO[parada.tono]}"
		>
			<!--
				El color va en el nombre, y en los cinco siempre.

				Hubo una versión con un canto de 3 px arriba de cada muesca. Cumplía —el tono se
				veía en las cinco— pero convertía el riel en cinco cuadrados con una raya
				encima: dos elementos por muesca para decir una sola cosa, y el conjunto se leía
				como una fila de cajas en vez de como un control.

				Teñir la palabra dice lo mismo sin agregar nada: el nombre ya está ahí, y el
				color deja de ser un adorno pegado al lado para ser una propiedad de lo que
				nombra. La elegida pasa a tinta plena porque su tono ya lo lleva el anillo de
				`.gb-opcion-elegida`, y sobre ese fondo lo que hace falta es que se lea.

				El cuerpo es fluido y no fijo porque una palabra no se achica: cinco muescas con
				"agresivo" adentro tienen un ancho mínimo que no baja, y a 320 px ese mínimo
				empujaba la página entera 12 px para la derecha —con la barra de abajo incluida,
				que es de ancho completo—. El `clamp` la deja encoger hasta 0,55 rem y ahí entra.
			-->
			<span
				class="text-center font-bold leading-[1.15]"
				style="font-size: clamp(0.55rem, 2.6vw, 0.62rem); color: {parada.id === valor
					? 'var(--text)'
					: `rgb(${COLOR_TONO[parada.tono]})`}">{parada.corto}</span
			>
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
