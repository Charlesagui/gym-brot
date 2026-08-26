<script lang="ts">
	import { colorDisco } from '$lib/discos-color';
	import type { CargaBarra } from '$lib/discos';
	import type { UnidadPeso } from '$lib/unidades';

	/**
	 * La barra cargada, entera.
	 *
	 * La pregunta que contesta esta herramienta es física —qué cuelgo— y hasta acá la
	 * respuesta se entregaba como una cadena ("2×20 + 10 + 2,5") que había que leer y
	 * traducir. Acá se ve la pila de placas: se sabe qué agarrar sin leer.
	 *
	 * Se dibujan los dos lados aunque el cálculo sea simétrico y el derecho no diga
	 * nada que no diga el izquierdo. El error clásico de matemática de discos es cargar
	 * un solo lado y creer que ya está; con media barra y un rótulo que aclara "por
	 * lado", esquivar ese error depende de que leas el rótulo. Con el objeto entero, no.
	 *
	 * Es puro: consume el `CargaBarra` que ya devuelve `calcularDiscos` y no calcula
	 * nada propio. La lista de texto sigue existiendo debajo, para el lector de pantalla
	 * y para las combinaciones donde el dibujo se achica.
	 */
	let {
		carga,
		pesoMaxDisco,
		formato,
		unidad
	}: {
		carga: CargaBarra;
		/** El disco más grande disponible: es lo que fija la escala de alturas. */
		pesoMaxDisco: number;
		formato: (n: number) => string;
		unidad: UnidadPeso;
	} = $props();

	const H = 100;
	const CENTRO = H / 2;
	/** La manga, donde entran los discos. Más gruesa que el eje, como en una barra real. */
	const ALTO_MANGA = 8;
	/** El eje agarrable: más fino, que es lo que da a leer que la barra es una sola. */
	const ALTO_EJE = 5;
	const ANCHO_COLLAR = 10;
	const ALTO_COLLAR = 24;
	const ANCHO_DISCO = 13;
	const SEPARACION = 2.5;
	const COLA = 16;
	const PASO = ANCHO_DISCO + SEPARACION;

	/**
	 * Ancho mínimo del `viewBox`, en la misma escala que el alto.
	 *
	 * Sin esto el dibujo se ve chico y perdido justo en el caso más común. `meet` escala
	 * para entrar entero, y con pocos discos el recuadro queda casi cuadrado: con un
	 * disco por lado ocupaba el 34% del ancho de la tarjeta en un teléfono de 375, y el
	 * 29% en uno de 430. Fijando la proporción en 3,2:1 la barra cruza la tarjeta de
	 * lado a lado —que es como se ve una barra de verdad, con la manga sobrando— y el
	 * número de la placa además queda más grande, no más chico.
	 */
	const ANCHO_MIN = 320;
	/** Lo mínimo de eje agarrable, cuando hay tantos discos que el ancho ya no alcanza. */
	const EJE_MIN = 70;

	/** Alto de placa según su peso, con piso para que 1,25 siga siendo visible. */
	const ALTO_MIN = 36;
	const ALTO_MAX = 92;

	/**
	 * Los discos reales no crecen en proporción a su peso: un 25 kg mide 450 mm y un
	 * 1,25 kg mide 160 mm, no 22. La raíz cuadrada se acerca a esa relación y, sobre
	 * todo, deja que el disco chico se siga viendo sin mentir el orden.
	 */
	function alto(peso: number): number {
		const proporcion = pesoMaxDisco > 0 ? Math.min(peso / pesoMaxDisco, 1) : 1;
		return ALTO_MIN + (ALTO_MAX - ALTO_MIN) * Math.sqrt(proporcion);
	}

	/** `2×20 + 10` se despliega en tres pesos: el dibujo cuenta unidades, no grupos. */
	const pesos = $derived(
		carga.discos.flatMap((disco) => Array.from({ length: disco.cantidad }, () => disco.peso))
	);

	interface Placa {
		peso: number;
		x: number;
		alto: number;
		color: string;
		/** Distancia al centro de la barra, en discos. Ordena la animación de entrada. */
		orden: number;
	}

	function armar(pesosLado: number[], desde: number, desdeElCentro: boolean): Placa[] {
		return pesosLado.map((peso, i) => ({
			peso,
			x: desde + i * PASO,
			alto: alto(peso),
			color: colorDisco(peso, unidad),
			orden: desdeElCentro ? i : pesosLado.length - 1 - i
		}));
	}

	/**
	 * Cada lado ocupa lo suyo y el sobrante se lo lleva el eje, no las puntas.
	 *
	 * Al revés —eje fijo y corto, puntas largas— los discos quedaban amontonados contra
	 * el centro con media barra vacía por fuera, que es exactamente lo que no hace una
	 * barra cargada. En una barra olímpica el eje agarrable es como el 60% del largo y
	 * cada manga el 19%: el disco va contra el collar, cerca de la punta, y lo que sobra
	 * queda en el medio para las manos.
	 */
	const lado = $derived(COLA + pesos.length * PASO + ANCHO_COLLAR);
	const ancho = $derived(Math.max(ANCHO_MIN, 2 * lado + EJE_MIN));

	/** Dónde arranca cada pieza fija, de izquierda a derecha. */
	const collarIzq = $derived(COLA + pesos.length * PASO);
	const ejeDesde = $derived(collarIzq + ANCHO_COLLAR);
	const largoEje = $derived(ancho - 2 * lado);
	const collarDer = $derived(ejeDesde + largoEje);

	/**
	 * En una barra real el disco pesado va contra el collar y el liviano queda afuera.
	 * El lado izquierdo se dibuja invertido para que el espejo sea de verdad un espejo.
	 */
	const placas = $derived([
		...armar([...pesos].reverse(), COLA, false),
		...armar(pesos, collarDer + ANCHO_COLLAR, true)
	]);
</script>

<!--
	Oculto para el lector de pantalla a propósito: la lista de discos vive como texto
	justo debajo y dice lo mismo mejor dicho. Como el bloque entero es un `aria-live`,
	etiquetar el dibujo haría que cada toque del ± anunciara la carga dos veces.
-->
<svg
	viewBox="0 0 {ancho} {H}"
	preserveAspectRatio="xMidYMid meet"
	class="gb-barra block h-24 w-full"
	aria-hidden="true"
>
	<defs>
		<!--
			El canto de la placa: claro arriba y oscuro abajo, que es como se ve un borde
			mecanizado cuando le pega la luz de arriba. Es el único canto que hay — la marca
			naranja del tope de la pila se sacó: era una señal débil (se prendía en casi toda
			carga) y ensuciaba el disco a cambio de poco.
		-->
		<linearGradient id="gb-canto-metal" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="rgb(255 255 255 / .75)" />
			<stop offset="0.45" stop-color="rgb(255 255 255 / .3)" />
			<stop offset="1" stop-color="rgb(0 0 0 / .45)" />
		</linearGradient>
	</defs>

	<!--
		La barra, de punta a punta. Va en tres tramos y no en un rectángulo sólo: las dos
		mangas gruesas donde entran los discos y, entre los collares, el eje más fino. Esa
		diferencia de grosor es casi todo lo que hace que se lea como una barra.
	-->
	{#each [[0, ejeDesde], [collarDer, ancho - collarDer]] as [x, w] (x)}
		<rect
			{x}
			y={CENTRO - ALTO_MANGA / 2}
			width={w}
			height={ALTO_MANGA}
			rx={ALTO_MANGA / 2}
			fill="rgba(255,255,255,.18)"
		/>
		<rect
			{x}
			y={CENTRO - ALTO_MANGA / 2}
			width={w}
			height="1.5"
			rx="0.75"
			fill="rgba(255,255,255,.22)"
		/>
	{/each}
	<rect
		x={ejeDesde}
		y={CENTRO - ALTO_EJE / 2}
		width={largoEje}
		height={ALTO_EJE}
		fill="rgba(255,255,255,.14)"
	/>
	<!-- Los collares: donde apoyan los discos, y el límite del tramo agarrable. -->
	{#each [collarIzq, collarDer] as x (x)}
		<rect
			{x}
			y={CENTRO - ALTO_COLLAR / 2}
			width={ANCHO_COLLAR}
			height={ALTO_COLLAR}
			rx="2"
			fill="rgba(255,255,255,.26)"
		/>
	{/each}

	{#each placas as placa, i (i)}
		<!--
			El translate va en un grupo aparte del animado: una `transform` de CSS pisa
			entera la del atributo, y la placa terminaria dibujandose sobre el collar.
		-->
		<g transform="translate({placa.x} {CENTRO - placa.alto / 2})">
			<g class="gb-placa" style="--gb-placa-orden: {placa.orden}">
				<!--
					Placa llena y no teñida: acá el color ES el dato, y a media opacidad los
					siete se acercan entre sí hasta dejar de distinguirse. La tinta va oscura,
					que es exactamente para lo que existe `--on-bright`.
				-->
				<rect
					width={ANCHO_DISCO}
					height={placa.alto}
					rx="3"
					fill="rgb({placa.color})"
					stroke="url(#gb-canto-metal)"
					stroke-width="1.5"
				/>
				<text
					x={ANCHO_DISCO / 2}
					y={placa.alto / 2}
					transform="rotate(-90 {ANCHO_DISCO / 2} {placa.alto / 2})"
					text-anchor="middle"
					dominant-baseline="central"
					font-size="8.5"
					font-family="var(--fuente-cifra)"
					font-weight="700"
					fill="var(--on-bright)">{formato(placa.peso)}</text
				>
			</g>
		</g>
	{/each}
</svg>

<style>
	/*
	 * Las placas entran de a una, de la más pesada a la más liviana: el orden en que
	 * las vas a colgar. Los dos lados comparten el orden, así que la barra se arma
	 * simétrica, del centro hacia afuera. Es corto a propósito — la recompensa no puede
	 * demorar la lectura. `prefers-reduced-motion` la apaga desde app.css, que anula
	 * toda `animation-duration`, así que no hace falta repetir la media query acá.
	 */
	.gb-placa {
		animation: gb-placa-entra var(--dur-base) var(--ease-spring) backwards;
		animation-delay: calc(var(--gb-placa-orden) * 45ms);
		transform-box: fill-box;
	}

	@keyframes gb-placa-entra {
		from {
			opacity: 0;
			transform: scaleY(0.55);
		}
	}
</style>
