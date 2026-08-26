<script lang="ts">
	import type { CargaBarra } from '$lib/discos';

	/**
	 * Un lado de la barra, dibujado.
	 *
	 * La pregunta que contesta esta herramienta es física —qué cuelgo de cada lado— y
	 * hasta acá la respuesta se entregaba como una cadena ("2×20 + 10 + 2,5") que había
	 * que leer y traducir. Acá se ve la pila de placas: se sabe qué agarrar sin leer.
	 *
	 * Es puro: consume el `CargaBarra` que ya devuelve `calcularDiscos` y no calcula
	 * nada propio. La lista de texto sigue existiendo debajo, para el lector de pantalla
	 * y para las combinaciones donde el dibujo se achica.
	 */
	let {
		carga,
		pesoMaxDisco,
		formato
	}: {
		carga: CargaBarra;
		/** El disco más grande disponible: fija la escala y marca el tope de la pila. */
		pesoMaxDisco: number;
		formato: (n: number) => string;
	} = $props();

	const H = 100;
	const CENTRO = H / 2;
	const ALTO_BARRA = 8;
	const ANCHO_COLLAR = 10;
	const ALTO_COLLAR = 24;
	const ANCHO_DISCO = 13;
	const SEPARACION = 2.5;
	const COLA = 16;
	const ANCHO_MIN = 72;

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

	interface Placa {
		peso: number;
		x: number;
		alto: number;
		tope: boolean;
	}

	/** `2×20 + 10` se despliega en tres placas: el dibujo cuenta unidades, no grupos. */
	const placas = $derived.by<Placa[]>(() => {
		const salida: Placa[] = [];
		let x = ANCHO_COLLAR;
		for (const disco of carga.discos) {
			for (let i = 0; i < disco.cantidad; i++) {
				salida.push({
					peso: disco.peso,
					x,
					alto: alto(disco.peso),
					tope: disco.peso === pesoMaxDisco
				});
				x += ANCHO_DISCO + SEPARACION;
			}
		}
		return salida;
	});

	const ancho = $derived(
		Math.max(ANCHO_MIN, ANCHO_COLLAR + placas.length * (ANCHO_DISCO + SEPARACION) + COLA)
	);

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
	<!-- La manga: sale del centro de la barra hacia afuera y sigue después del último disco. -->
	<rect
		x="0"
		y={CENTRO - ALTO_BARRA / 2}
		width={ancho}
		height={ALTO_BARRA}
		rx={ALTO_BARRA / 2}
		fill="rgba(255,255,255,.18)"
	/>
	<rect
		x="0"
		y={CENTRO - ALTO_BARRA / 2}
		width={ancho}
		height="1.5"
		rx="0.75"
		fill="rgba(255,255,255,.22)"
	/>
	<!-- El collar: donde apoyan los discos, y el borde interno de la barra. -->
	<rect
		x="0"
		y={CENTRO - ALTO_COLLAR / 2}
		width={ANCHO_COLLAR}
		height={ALTO_COLLAR}
		rx="2"
		fill="rgba(255,255,255,.26)"
	/>

	{#each placas as placa, i (i)}
		{@const color = placa.tope ? 'var(--max)' : 'var(--accent-rgb)'}
		<!--
			El translate va en un grupo aparte del animado: una `transform` de CSS pisa
			entera la del atributo, y la placa terminaria dibujandose sobre el collar.
		-->
		<g transform="translate({placa.x} {CENTRO - placa.alto / 2})">
			<g class="gb-placa" style="--gb-placa-orden: {i}">
				<rect
					width={ANCHO_DISCO}
					height={placa.alto}
					rx="3"
					fill="rgb({color} / .24)"
					stroke="rgb({color} / .8)"
					stroke-width="1.5"
				/>
				<!-- Bisel: la placa se lee como volumen y no como un rectángulo pintado. -->
				<rect
					x="1.5"
					y="1.5"
					width={ANCHO_DISCO - 3}
					height="1.5"
					rx="0.75"
					fill="rgba(255,255,255,.28)"
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
					fill="rgb({color})">{formato(placa.peso)}</text
				>
			</g>
		</g>
	{/each}
</svg>

<style>
	/*
	 * Las placas entran de a una, de la más pesada a la más liviana: el orden en que
	 * las vas a colgar. Es corto a propósito — la recompensa no puede demorar la
	 * lectura. `prefers-reduced-motion` la apaga desde app.css, que anula toda
	 * `animation-duration`, así que no hace falta repetir la media query acá.
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
