<script lang="ts">
	import { bandas } from '$lib/energia';

	/**
	 * Dónde cae el objetivo dentro de la banda del mantenimiento.
	 *
	 * No dibuja la banda sola: la gracia es ver que un déficit real queda por debajo de
	 * la banda entera. Eso dice más que el porcentaje —no estás comiendo "un poco menos",
	 * estás fuera de donde vive tu gasto— y no compite con la cifra grande porque son
	 * cinco píxeles de alto.
	 *
	 * La leyenda no es opcional. Sin ella son tres marcas sin nombre y el riel se lee como
	 * adorno: nadie puede saber que la línea fina es su mantenimiento. Va acá adentro y no
	 * en la pantalla para que no exista una copia del riel sin su explicación.
	 */
	let { tdee, sepv, objetivoKcal }: { tdee: number; sepv: number; objetivoKcal: number } = $props();

	const marcas = $derived.by(() => {
		const { banda68, banda95 } = bandas(tdee, sepv);
		const desde = Math.min(banda95.desde, objetivoKcal);
		const hasta = Math.max(banda95.hasta, objetivoKcal);
		const ancho = hasta - desde;
		if (ancho <= 0) return null;
		const pct = (v: number) => ((v - desde) / ancho) * 100;
		return {
			b68desde: pct(banda68.desde),
			b68ancho: pct(banda68.hasta) - pct(banda68.desde),
			mantenimiento: pct(tdee),
			objetivo: pct(objetivoKcal)
		};
	});
</script>

{#if marcas}
	<div
		class="relative h-[5px] rounded-full"
		style="background: var(--surface-3)"
		aria-hidden="true"
	>
		<div
			class="absolute inset-y-0 rounded-full"
			style="left: {marcas.b68desde}%; width: {marcas.b68ancho}%; background: rgb(var(--glow) / .5)"
		></div>
		<div
			class="absolute inset-y-[-3px] w-0.5"
			style="left: {marcas.mantenimiento}%; background: var(--muted)"
		></div>
		<div
			class="absolute inset-y-[-5px] w-[3px] rounded-full"
			style="left: {marcas.objetivo}%; background: var(--text)"
		></div>
	</div>

	<!-- Cada marca con su nombre, no por posición: en volumen el objetivo cae a la derecha
	     del mantenimiento y una leyenda de izquierda/derecha mentiría la mitad de las veces. -->
	<div
		class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6rem] font-bold uppercase tracking-[0.14em]"
		style="color: var(--muted)"
	>
		<span class="flex items-center gap-1.5">
			<span class="h-2.5 w-[3px] shrink-0 rounded-full" style="background: var(--text)"></span>
			Objetivo
		</span>
		<span class="flex items-center gap-1.5">
			<span class="h-2.5 w-0.5 shrink-0" style="background: var(--muted)"></span>
			Mantenimiento
		</span>
		<span class="flex items-center gap-1.5">
			<span class="h-[5px] w-4 shrink-0 rounded-full" style="background: rgb(var(--glow) / .5)"
			></span>
			2 de cada 3
		</span>
	</div>
{/if}
