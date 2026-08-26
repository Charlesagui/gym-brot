<script lang="ts">
	import { bandas } from '$lib/energia';

	/**
	 * Dónde cae el objetivo dentro de la banda del mantenimiento.
	 *
	 * No dibuja la banda sola: la gracia es ver que un déficit real queda por debajo de
	 * la banda entera. Eso dice más que el porcentaje —no estás comiendo "un poco menos",
	 * estás fuera de donde vive tu gasto— y no compite con la cifra grande porque son
	 * cinco píxeles de alto.
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
{/if}
