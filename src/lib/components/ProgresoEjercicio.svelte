<script lang="ts">
	import type { MetricaPr } from '$lib/db';
	import {
		historialObs,
		DESCRIPCION_METRICA,
		type MejorSet,
		type MetricaEfectiva
	} from '$lib/sesion';
	import { progresoEjercicioObs, type ProgresoEjercicio } from '$lib/progreso';
	import { fromLiveQuery } from '$lib/live';
	import { formatoNumero, formatoSet, fechaCorta } from '$lib/formato';
	import ChartProgreso from './ChartProgreso.svelte';

	let {
		exerciseId,
		glow,
		unidad,
		metrica
	}: {
		exerciseId: string;
		glow: string;
		unidad: string;
		metrica: MetricaPr;
	} = $props();

	const VACIO: ProgresoEjercicio = {
		modo: 'peso',
		mejorPeso: null,
		mejorE1rm: null,
		mejorReps: null,
		setRecords: [],
		sesiones: [],
		totalSeries: 0
	};

	const progresoStore = $derived(fromLiveQuery(progresoEjercicioObs(exerciseId), VACIO));
	const progreso = $derived($progresoStore);
	const historialStore = $derived(
		fromLiveQuery(historialObs(exerciseId, metrica), [] as MejorSet[])
	);
	const puntos = $derived($historialStore);

	const modoReps = $derived(progreso.modo === 'reps');
	const metricaEfectiva = $derived<MetricaEfectiva>(modoReps ? 'reps' : metrica);
	const metricaLabel = $derived(
		modoReps ? 'reps máximas' : metrica === 'e1rm' ? '1RM estimado' : 'peso máximo'
	);
	const unidadValor = $derived(modoReps ? 'reps' : unidad);

	// Historial completo paginado de a 15 sesiones.
	let visibles = $state(15);
</script>

<section class="mt-6 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
	<div class="flex items-baseline justify-between gap-3">
		<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
			Progreso
		</p>
		<p class="text-[11px] font-medium" style="color: var(--muted)">
			{progreso.sesiones.length}
			{progreso.sesiones.length === 1 ? 'sesión' : 'sesiones'} · {progreso.totalSeries} series ✓
		</p>
	</div>
	<div class="mt-3">
		<ChartProgreso {puntos} {glow} {metricaLabel} unidad={unidadValor} />
	</div>
	<p
		class="mt-3 border-t border-white/5 pt-2 text-[11px] leading-relaxed"
		style="color: var(--muted)"
	>
		💡 {DESCRIPCION_METRICA[metricaEfectiva]}
	</p>
</section>

{#if progreso.mejorPeso || progreso.mejorReps}
	<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
		<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
			Récords
		</p>
		<div class="mt-3 grid grid-cols-2 gap-2">
			{#if modoReps && progreso.mejorReps}
				<div class="col-span-2 rounded-xl bg-white/[0.035] p-3">
					<p class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--muted)">
						Reps máximas
					</p>
					<p class="mt-1 text-xl font-extrabold tabular-nums">
						🏆 {formatoNumero(progreso.mejorReps.valor)}
						<span class="text-sm font-semibold" style="color: var(--muted)">reps</span>
					</p>
					<p class="mt-0.5 text-[11px]" style="color: var(--muted)">
						{fechaCorta(progreso.mejorReps.fecha)}
					</p>
				</div>
			{:else}
				{#if progreso.mejorPeso}
					<div class="rounded-xl bg-white/[0.035] p-3">
						<p class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--muted)">
							Peso máximo
						</p>
						<p class="mt-1 text-xl font-extrabold tabular-nums">
							{formatoNumero(progreso.mejorPeso.valor)}
							<span class="text-sm font-semibold" style="color: var(--muted)">{unidad}</span>
						</p>
						<p class="mt-0.5 text-[11px]" style="color: var(--muted)">
							{formatoSet(progreso.mejorPeso, unidad)} · {fechaCorta(progreso.mejorPeso.fecha)}
						</p>
					</div>
				{/if}
				{#if progreso.mejorE1rm}
					<div class="rounded-xl bg-white/[0.035] p-3">
						<p class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--muted)">
							1RM estimado
						</p>
						<p class="mt-1 text-xl font-extrabold tabular-nums">
							{formatoNumero(progreso.mejorE1rm.valor)}
							<span class="text-sm font-semibold" style="color: var(--muted)">{unidad}</span>
						</p>
						<p class="mt-0.5 text-[11px]" style="color: var(--muted)">
							{formatoSet(progreso.mejorE1rm, unidad)} · {fechaCorta(progreso.mejorE1rm.fecha)}
						</p>
					</div>
				{/if}
			{/if}
		</div>

		{#if progreso.setRecords.length > 0}
			<p class="mt-4 text-[11px] font-bold uppercase tracking-wider" style="color: var(--muted)">
				Mejor peso por reps
			</p>
			<div class="mt-2 space-y-1">
				{#each progreso.setRecords as record (record.reps)}
					<div
						class="flex items-center justify-between gap-2 rounded-lg bg-white/[0.025] px-3 py-1.5 text-xs"
					>
						<span class="font-bold tabular-nums" style="color: rgb({glow})"
							>{record.reps} {record.reps === 1 ? 'rep' : 'reps'}</span
						>
						<span class="font-semibold tabular-nums">{formatoSet(record.set, unidad)}</span>
						<span class="w-14 text-right" style="color: var(--muted)"
							>{fechaCorta(record.fecha)}</span
						>
					</div>
				{/each}
			</div>
		{/if}
	</section>
{/if}

<section class="mt-3">
	<p class="mb-2 px-1 text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
		Historial completo
	</p>
	{#if progreso.sesiones.length === 0}
		<p
			class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm"
			style="color: var(--muted)"
		>
			Todavía no registraste series de este ejercicio.
		</p>
	{:else}
		<div class="space-y-2">
			{#each progreso.sesiones.slice(0, visibles) as sesion (sesion.sesionId)}
				<article class="rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
					<div class="flex items-center justify-between gap-3">
						<a href={`/historial/dia/${sesion.fecha}`} class="text-sm font-bold">
							{fechaCorta(sesion.fecha)}
						</a>
						<span class="text-[11px] font-medium" style="color: var(--muted)">
							{sesion.series.length}
							{sesion.series.length === 1 ? 'serie' : 'series'}
						</span>
					</div>
					<div class="mt-2 space-y-1">
						{#each sesion.series as serie (serie.setIndex)}
							<div class="flex items-center gap-2 rounded-lg bg-white/[0.025] px-3 py-1.5 text-xs">
								<span class="min-w-0 flex-1 truncate font-semibold tabular-nums">
									{formatoSet(serie.set, unidad)}
								</span>
								{#if serie.esPr}
									<span class="shrink-0" aria-label={`PR de ${metricaLabel}`}>🏆</span>
								{/if}
							</div>
						{/each}
					</div>
				</article>
			{/each}
			{#if progreso.sesiones.length > visibles}
				<button
					onclick={() => (visibles += 15)}
					class="w-full rounded-2xl border border-white/10 py-3 text-sm font-semibold"
					style="background: var(--surface); color: var(--muted)"
				>
					Ver más ({progreso.sesiones.length - visibles}
					{progreso.sesiones.length - visibles === 1 ? 'anterior' : 'anteriores'})
				</button>
			{/if}
		</div>
	{/if}
</section>
