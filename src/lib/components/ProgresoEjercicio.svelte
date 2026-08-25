<script lang="ts">
	import { db, type Ajustes, type MetricaPr, type ModoEsfuerzo } from '$lib/db';
	import { liveQuery } from 'dexie';
	import { DESCRIPCION_METRICA, type MetricaEfectiva } from '$lib/sesion-reglas';
	import {
		progresoPantallaObs,
		type DatosProgresoEjercicio,
		type ProgresoEjercicio
	} from '$lib/progreso';
	import { estadoLiveQuery } from '$lib/live';
	import { formatoNumero, formatoSet, fechaCorta } from '$lib/formato';
	import ChartProgreso from './ChartProgreso.svelte';
	import EditarSerieSheet, { type SerieEditable } from './EditarSerieSheet.svelte';
	import { etiquetaEsfuerzo } from '$lib/esfuerzo';

	let {
		exerciseId,
		glow,
		unidad,
		metrica,
		pasoPeso,
		maquinaPlacas,
		modoEsfuerzo
	}: {
		exerciseId: string;
		glow: string;
		unidad: Ajustes['unidad'];
		metrica: MetricaPr;
		pasoPeso: number;
		maquinaPlacas: boolean;
		modoEsfuerzo: ModoEsfuerzo;
	} = $props();

	const PROGRESO_VACIO: ProgresoEjercicio = {
		modo: 'peso',
		mejorPeso: null,
		mejorE1rm: null,
		mejorReps: null,
		setRecords: [],
		sesiones: [],
		totalSeries: 0
	};
	const VACIO: DatosProgresoEjercicio = {
		progreso: PROGRESO_VACIO,
		puntosCarga: [],
		puntosReps: []
	};

	const datosStore = $derived(
		estadoLiveQuery(progresoPantallaObs(exerciseId, metrica, unidad), VACIO)
	);
	const consultaDatos = $derived($datosStore);
	const datos = $derived(consultaDatos.valor);
	const progreso = $derived(datos.progreso);
	const puntosCarga = $derived(datos.puntosCarga);
	const puntosReps = $derived(datos.puntosReps);

	const modoReps = $derived(progreso.modo === 'reps');
	const puntos = $derived(modoReps ? puntosReps : puntosCarga);
	const hayHistorialMixto = $derived(!modoReps && puntosCarga.length > 0 && puntosReps.length > 0);
	const metricaEfectiva = $derived<MetricaEfectiva>(modoReps ? 'reps' : metrica);
	const metricaLabel = $derived(
		modoReps ? 'reps máximas' : metrica === 'e1rm' ? '1RM estimado' : 'peso máximo'
	);
	const unidadValor = $derived(modoReps ? 'reps' : unidad);

	// Historial completo paginado de a 15 sesiones.
	let visibles = $state(15);
	// Serie en edición → bottom sheet (sin prompt/confirm nativos).
	let serieEditando = $state<SerieEditable | null>(null);
	const diasStore = estadoLiveQuery(
		liveQuery(() => db.dias.toArray()),
		[]
	);
	const consultaDias = $derived($diasStore);
	const nombreDia = $derived(new Map(consultaDias.valor.map((dia) => [dia.id, dia.nombre])));
	const cargandoDatos = $derived(
		consultaDatos.estado === 'cargando' || consultaDias.estado === 'cargando'
	);
	const errorDatos = $derived(consultaDatos.estado === 'error' || consultaDias.estado === 'error');

	function etiquetaPr(metricaPr: MetricaEfectiva | undefined): string {
		if (!metricaPr) return 'PR registrado';
		return `PR de ${metricaPr === 'reps' ? 'reps máximas' : metricaPr === 'e1rm' ? '1RM estimado' : 'peso máximo'}`;
	}
</script>

{#if errorDatos}
	<section
		class="mt-6 rounded-2xl border border-red-400/25 bg-red-400/10 p-4 text-center"
		role="alert"
	>
		<p class="text-sm font-semibold" style="color: #ff9b9b">No se pudo cargar el progreso.</p>
		<p class="mt-1 text-xs leading-relaxed" style="color: var(--muted)">
			No cambiamos tus series. Recargá para volver a intentarlo.
		</p>
		<button
			onclick={() => location.reload()}
			class="mt-3 min-h-11 rounded-xl px-4 text-sm font-bold"
			style="background: rgba(255,255,255,.1); color: white">Reintentar</button
		>
	</section>
{:else}
	<section class="mt-6 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
		<div class="flex items-baseline justify-between gap-3">
			<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Progreso
			</p>
			<p class="text-[11px] font-medium" style="color: var(--muted)">
				{progreso.sesiones.length}
				{progreso.sesiones.length === 1 ? 'sesión' : 'sesiones'} · {progreso.totalSeries}
				{progreso.totalSeries === 1 ? 'serie' : 'series'} ✓
			</p>
		</div>
		<div class="mt-3">
			<ChartProgreso
				{puntos}
				{glow}
				{metricaLabel}
				unidad={unidadValor}
				seriesHechas={progreso.totalSeries}
				cargando={cargandoDatos}
			/>
		</div>
		{#if hayHistorialMixto}
			<div class="mt-5 border-t border-white/10 pt-4">
				<p class="text-xs font-bold" style="color: var(--muted)">Progreso sin carga</p>
				<p class="mt-1 text-[11px] leading-relaxed" style="color: var(--muted)">
					Las reps previas se muestran aparte: no son comparables con series con peso o lastre.
				</p>
				<div class="mt-3">
					<ChartProgreso
						puntos={puntosReps}
						{glow}
						metricaLabel="reps máximas"
						unidad="reps"
						seriesHechas={progreso.totalSeries}
						cargando={cargandoDatos}
					/>
				</div>
			</div>
		{/if}
		<p
			class="mt-3 border-t border-white/5 pt-2 text-[11px] leading-relaxed"
			style="color: var(--muted)"
		>
			💡 {DESCRIPCION_METRICA[metricaEfectiva]}
		</p>
	</section>

	{#if !cargandoDatos && (progreso.mejorPeso || progreso.mejorReps)}
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
							<span class="ml-1 text-sm font-semibold" style="color: var(--muted)">reps</span>
						</p>
						<p class="mt-0.5 text-[11px]" style="color: var(--muted)">
							{fechaCorta(progreso.mejorReps.fecha, true)}
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
								<span class="ml-1 text-sm font-semibold" style="color: var(--muted)">{unidad}</span>
							</p>
							<p class="mt-0.5 text-[11px]" style="color: var(--muted)">
								{formatoSet(progreso.mejorPeso, unidad)} · {fechaCorta(
									progreso.mejorPeso.fecha,
									true
								)}
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
								<span class="ml-1 text-sm font-semibold" style="color: var(--muted)">{unidad}</span>
							</p>
							<p class="mt-0.5 text-[11px]" style="color: var(--muted)">
								{formatoSet(progreso.mejorE1rm, unidad)} · {fechaCorta(
									progreso.mejorE1rm.fecha,
									true
								)}
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
							class="flex min-h-11 items-center justify-between gap-2 rounded-lg bg-white/[0.025] px-3 py-2 text-xs"
						>
							<span class="font-bold tabular-nums" style="color: rgb({glow})"
								>{record.reps} {record.reps === 1 ? 'rep' : 'reps'}</span
							>
							<span class="font-semibold tabular-nums">{formatoSet(record.set, unidad)}</span>
							<span class="w-14 text-right" style="color: var(--muted)"
								>{fechaCorta(record.fecha, true)}</span
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
		{#if cargandoDatos}
			<p
				class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm"
				style="color: var(--muted)"
			>
				Cargando historial…
			</p>
		{:else if progreso.sesiones.length === 0}
			<p
				class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm"
				style="color: var(--muted)"
			>
				Todavía no registraste series de este ejercicio.
			</p>
		{:else}
			<div class="space-y-2">
				{#each progreso.sesiones.slice(0, visibles) as sesion (sesion.sesionId)}
					<article
						class="rounded-2xl border border-white/10 p-4"
						style="background: var(--surface)"
					>
						<div class="flex items-center justify-between gap-3">
							<a href={`/historial/dia/${sesion.fecha}`} class="text-sm font-bold">
								{fechaCorta(sesion.fecha, true)}
							</a>
							{#if nombreDia.get(sesion.diaId)}
								<span class="min-w-0 flex-1 truncate text-[11px]" style="color: var(--muted)">
									{nombreDia.get(sesion.diaId)}
								</span>
							{/if}
							<span class="text-[11px] font-medium" style="color: var(--muted)">
								{sesion.series.length}
								{sesion.series.length === 1 ? 'serie' : 'series'}
							</span>
						</div>
						<div class="mt-2 space-y-1">
							{#each sesion.series as serie (serie.setIndex)}
								<button
									onclick={() =>
										(serieEditando = {
											sesionId: serie.sesionId,
											exerciseId,
											setIndex: serie.setIndex,
											set: serie.set,
											fecha: serie.fecha,
											maquinaPlacas
										})}
									class="flex min-h-11 w-full items-center gap-2 rounded-lg bg-white/[0.025] px-3 py-2 text-left text-xs"
									aria-label={`Editar serie ${formatoSet(serie.set, unidad)} del ${fechaCorta(serie.fecha, true)}`}
								>
									<span class="min-w-0 flex-1 truncate font-semibold tabular-nums">
										{formatoSet(serie.set, unidad)}
									</span>
									{#if serie.set.rir != null}<span
											class="shrink-0 text-[10px] font-bold"
											style="color: var(--accent-text)"
											>{etiquetaEsfuerzo(
												serie.set.rir,
												modoEsfuerzo === 'rpe' ? 'rpe' : 'rir'
											)}</span
										>{/if}
									{#if serie.esPr}
										<span class="shrink-0" aria-label={etiquetaPr(serie.metricaPr)}>🏆</span>
									{/if}
									<span class="shrink-0 text-[10px]" style="color: var(--muted)">✎</span>
								</button>
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
{/if}

{#if serieEditando}
	<EditarSerieSheet
		serie={serieEditando}
		{glow}
		{unidad}
		{pasoPeso}
		{metrica}
		{modoEsfuerzo}
		onClose={() => (serieEditando = null)}
	/>
{/if}
