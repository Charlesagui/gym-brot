<script lang="ts" module>
	/**
	 * Los íconos de la app, en un solo lugar.
	 *
	 * Antes convivían dos sistemas: los SVG dibujados a mano del BottomNav y emoji del
	 * sistema en todo el resto (📝 ⏱️ 🏆 💡 🗑). El emoji se dibuja distinto en cada
	 * teléfono, no toma el color del acento y no se puede alinear con el texto de al
	 * lado. Acá van todos con el mismo trazo que ya usaba la navegación: 24×24,
	 * `stroke-width: 2`, `currentColor`, sin relleno.
	 *
	 * Los emoji siguen vivos donde funcionan: las celebraciones y los seis grupos
	 * musculares del catálogo, que son identidad y merecen dibujos propios, no una
	 * conversión apurada.
	 */
	export type NombreIcono =
		| 'notas'
		| 'descanso'
		| 'record'
		| 'max'
		| 'consejo'
		| 'info'
		| 'tecnica'
		| 'volver'
		| 'hecha'
		| 'cerrar'
		| 'borrar'
		| 'editar'
		| 'terminar'
		| 'backup'
		| 'favorito'
		| 'aviso'
		| 'error'
		| 'rueda';

	/** Cada ícono es su lista de trazos; el `viewBox` es siempre 0 0 24 24. */
	const TRAZOS: Record<NombreIcono, string[]> = {
		notas: ['M6 4h8l4 4v12H6z', 'M14 4v4h4', 'M9 12.5h6', 'M9 16.5h4'],
		descanso: ['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 9.5V13l2.5 1.5', 'M9 2h6', 'M12 2v3'],
		record: [
			'M7 4h10v4.5a5 5 0 0 1-10 0z',
			'M7 6H5a3 3 0 0 0 3 3',
			'M17 6h2a3 3 0 0 1-3 3',
			'M12 13.5V17',
			'M9 20h6'
		],
		max: [
			'M12 3c3 3.6 5 6 5 8.8A5 5 0 0 1 7 12c0-1.4.5-2.6 1.4-3.6.3 1 .9 1.7 1.6 2C10.2 7.9 10 5.6 12 3z'
		],
		consejo: ['M9 17h6', 'M10 20h4', 'M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3z'],
		info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11.5V16', 'M12 8h.01'],
		tecnica: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M10.5 9l5 3-5 3z'],
		volver: ['M15 5l-7 7 7 7'],
		hecha: ['M5 13l4 4L19 7'],
		cerrar: ['M6 6l12 12', 'M18 6L6 18'],
		borrar: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
		editar: ['M4 20h4L19 9l-4-4L4 16z', 'M14 6l4 4'],
		terminar: ['M6 3v18', 'M6 4h11l-2.5 4L17 12H6'],
		backup: ['M12 4v10', 'M8 12l4 4 4-4', 'M5 20h14'],
		favorito: ['M12 4l2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z'],
		aviso: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17h.01'],
		error: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9 9l6 6', 'M15 9l-6 6'],
		rueda: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3']
	};
</script>

<script lang="ts">
	let {
		nombre,
		tamano = 20,
		clase = ''
	}: {
		nombre: NombreIcono;
		/** Lado en píxeles. El trazo no se escala: a 16 px se ve más grueso, a propósito. */
		tamano?: number;
		clase?: string;
	} = $props();
</script>

<!--
	Decorativo por defecto: en toda la app el ícono acompaña a un texto o vive dentro
	de un botón que ya trae su `aria-label`. Un ícono que se anuncia solo duplicaría
	la etiqueta en el lector de pantalla.
-->
<svg
	class={clase}
	width={tamano}
	height={tamano}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#each TRAZOS[nombre] as trazo (trazo)}
		<path d={trazo} />
	{/each}
</svg>
