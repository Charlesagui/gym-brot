<script lang="ts">
	import type { DiaEntrenado } from '$lib/historial';
	import { crearHeatmapAnual, ETIQUETAS_NIVEL } from '$lib/heatmap';
	import { fechaCorta, formatoNumero } from '$lib/formato';
	import { onMount } from 'svelte';

	// El volumen es peso × reps: sin la unidad, el único lector del heatmap (un lector de
	// pantalla) recibía un número sin magnitud.
	let { dias, hoy, unidad }: { dias: DiaEntrenado[]; hoy: string; unidad: string } = $props();
	let contenedor: HTMLDivElement;
	const heatmap = $derived(crearHeatmapAnual(dias, new Date(`${hoy}T12:00:00`)));

	function descripcion(celda: (typeof heatmap.semanas)[number]['celdas'][number]): string {
		if (celda.futura) return `${fechaCorta(celda.fecha, true)}: fecha futura`;
		if (celda.sets === 0) return `${fechaCorta(celda.fecha, true)}: sin series completadas`;
		const rutinas = celda.dias.length ? celda.dias.join(', ') : 'rutina sin nombre';
		return `${fechaCorta(celda.fecha, true)}: ${rutinas}; ${celda.sets} series completadas; volumen ${formatoNumero(celda.volumen)} ${unidad}`;
	}

	onMount(() => {
		requestAnimationFrame(() => {
			contenedor.scrollLeft = contenedor.scrollWidth;
		});
	});
</script>

<section
	class="rounded-2xl border border-white/10 p-4"
	style="background: var(--surface)"
	aria-labelledby="titulo-heatmap"
>
	<div class="flex items-start justify-between gap-3">
		<div>
			<h2 id="titulo-heatmap" class="text-sm font-bold">Actividad del último año</h2>
			<p class="mt-0.5 text-xs" style="color: var(--muted)">Series realmente completadas por día</p>
		</div>
		<p class="shrink-0 text-right text-xs font-semibold" style="color: var(--muted)">
			{heatmap.diasEntrenados} días<br />{heatmap.totalSets} series
		</p>
	</div>

	<div class="mt-4 grid grid-cols-[1.3rem_1fr] gap-2">
		<div class="grid grid-rows-7 gap-1 pt-5 text-[9px] font-semibold" style="color: var(--muted)">
			<span></span><span>Mar</span><span></span><span>Jue</span><span></span><span>Sáb</span><span
			></span>
		</div>
		<div bind:this={contenedor} class="overflow-x-auto pb-2" aria-label="Mapa anual desplazable">
			<div class="grid min-w-max grid-flow-col auto-cols-[1.5rem] gap-1 pt-5">
				{#each heatmap.semanas as semana (semana.inicio)}
					<div class="relative grid grid-rows-7 gap-1">
						{#if semana.mes}<span
								class="absolute -top-5 left-0 text-[9px] font-semibold capitalize"
								style="color: var(--muted)">{semana.mes}</span
							>{/if}
						{#each semana.celdas as celda (celda.fecha)}
							{#if celda.sets > 0}
								<a
									href={`/historial/dia/${celda.fecha}`}
									class="gb-heat-cell rounded-[3px] border"
									data-nivel={celda.nivel}
									data-hoy={celda.esHoy || undefined}
									aria-label={`${descripcion(celda)}. Ver detalle`}
									title={descripcion(celda)}
								></a>
							{:else}
								<span
									class="gb-heat-cell rounded-[3px] border"
									data-nivel="0"
									data-hoy={celda.esHoy || undefined}
									data-futura={celda.futura || undefined}
									aria-label={descripcion(celda)}
									title={descripcion(celda)}
								></span>
							{/if}
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</div>

	<div
		class="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px]"
		style="color: var(--muted)"
	>
		<p>Mejor racha diaria: <b>{heatmap.mejorRacha}</b></p>
		<div class="flex items-center gap-1" aria-label={`Leyenda: ${ETIQUETAS_NIVEL.join(', ')}`}>
			<span>Menos</span>
			{#each ETIQUETAS_NIVEL as etiqueta, nivel (nivel)}
				<span class="gb-heat-cell muestra rounded-[3px] border" data-nivel={nivel} title={etiqueta}
				></span>
			{/each}
			<span>Más</span>
		</div>
	</div>
</section>

<style>
	/* 24 px: los días con actividad son enlaces, y a 0,85rem quedaban por debajo del
	   mínimo de target táctil que el resto de la app ya respeta. La tira se sigue
	   desplazando y arranca posicionada en hoy. */
	.gb-heat-cell {
		width: 1.5rem;
		height: 1.5rem;
		background: rgba(255, 255, 255, 0.035);
		border-color: rgba(255, 255, 255, 0.08);
	}
	/* La leyenda no es un target: es sólo referencia visual. */
	.gb-heat-cell.muestra {
		width: 0.75rem;
		height: 0.75rem;
	}
	.gb-heat-cell[data-nivel='1'] {
		background: rgb(var(--exito) / 0.22);
		border-color: rgb(var(--exito) / 0.32);
	}
	.gb-heat-cell[data-nivel='2'] {
		background: rgb(var(--exito) / 0.42);
		border-color: rgb(var(--exito) / 0.52);
	}
	.gb-heat-cell[data-nivel='3'] {
		background: rgb(var(--exito) / 0.66);
		border-color: rgb(var(--exito) / 0.76);
	}
	.gb-heat-cell[data-nivel='4'] {
		background: rgb(var(--exito) / 0.92);
		border-color: rgb(var(--exito));
	}
	.gb-heat-cell[data-hoy] {
		outline: 2px solid white;
		outline-offset: 1px;
	}
	.gb-heat-cell[data-futura] {
		opacity: 0.28;
	}
	a.gb-heat-cell:focus-visible {
		outline: 3px solid white;
		outline-offset: 2px;
	}
</style>
