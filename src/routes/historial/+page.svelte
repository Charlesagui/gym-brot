<script lang="ts">
	import { ajustesObs, AJUSTES_DEFAULT } from '$lib/extras';
	import { formatoNumero, formatoSet, formatoVolumen, fechaCorta } from '$lib/formato';
	import {
		crearHistorialResumen,
		resumenHistorialObs,
		type HistorialResumen
	} from '$lib/historial';
	import { ejercicioPorId } from '$lib/catalog';
	import { fromLiveQuery } from '$lib/live';
	import { recordsGlobalesObs, type RecordEjercicio } from '$lib/sesion';

	const VACIO: HistorialResumen = crearHistorialResumen([], []);

	const ajustesStore = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const ajustes = $derived($ajustesStore);
	const historialStore = fromLiveQuery(resumenHistorialObs(), VACIO);
	const historial = $derived($historialStore);
	const recordsStore = $derived(
		fromLiveQuery(recordsGlobalesObs(ajustes.metricaPr), [] as RecordEjercicio[])
	);
	const records = $derived($recordsStore);
	const metricaLabel = $derived(ajustes.metricaPr === 'e1rm' ? '1RM estimado' : 'peso máximo');

	const diasEntrenados = $derived(new Set(historial.dias.map((d) => d.fecha)));
	const calendario = $derived(
		ultimosDias(28).map((fecha) => ({ fecha, entrenado: diasEntrenados.has(fecha) }))
	);
	const semanas = $derived(historial.semanas.slice(0, 8));
	// Paginación de entrenamientos: el historial viejo siempre es alcanzable.
	let visibles = $state(10);

	function ultimosDias(cantidad: number): string[] {
		const hoy = new Date();
		return Array.from({ length: cantidad }, (_, i) => {
			const d = new Date(hoy);
			d.setDate(hoy.getDate() - (cantidad - 1 - i));
			return d.toLocaleDateString('sv');
		});
	}

	function inicialDia(fecha: string): string {
		const d = new Date(`${fecha}T00:00:00`);
		return d.toLocaleDateString('es', { weekday: 'narrow' }).slice(0, 1).toUpperCase();
	}
</script>

<main class="glow-bg min-h-[calc(100dvh-5rem)] px-5 pb-12 pt-8">
	<header class="mb-6">
		<p class="text-xs font-bold uppercase tracking-[0.22em]" style="color: var(--muted)">
			Progreso
		</p>
		<h1 class="mt-1 text-3xl font-extrabold tracking-tight">Historial</h1>
	</header>

	<section
		class="mb-4 rounded-2xl border border-white/10 p-4"
		style="background: radial-gradient(120% 120% at 0% 0%, rgb(var(--exito) / .18), transparent 62%), var(--surface)"
	>
		<div class="grid grid-cols-3 gap-2 text-center">
			<div>
				<p class="text-2xl font-extrabold tabular-nums">{historial.rachaSemanal}</p>
				<p class="mt-0.5 text-[11px] font-semibold" style="color: var(--muted)">semanas en racha</p>
			</div>
			<div>
				<p class="text-2xl font-extrabold tabular-nums">{historial.diasEstaSemana}</p>
				<p class="mt-0.5 text-[11px] font-semibold" style="color: var(--muted)">días esta semana</p>
			</div>
			<div>
				<p class="text-2xl font-extrabold tabular-nums">{historial.totalDias}</p>
				<p class="mt-0.5 text-[11px] font-semibold" style="color: var(--muted)">días entrenados</p>
			</div>
		</div>
		{#if historial.rachaSemanal > 0 && historial.diasEstaSemana === 0}
			<!-- Racha con gracia: la semana en curso no la corta hasta terminar sin entrenar. -->
			<p
				class="mt-3 border-t border-white/10 pt-2.5 text-center text-xs"
				style="color: var(--muted)"
			>
				Todavía no entrenaste esta semana · la racha se mantiene hasta el domingo
			</p>
		{/if}
	</section>

	<section class="mb-4 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
		<div class="mb-3 flex items-center justify-between">
			<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
				Últimos 28 días
			</p>
			<p class="text-xs font-semibold" style="color: rgb(var(--exito))">● entrenado</p>
		</div>
		<div class="grid grid-cols-7 gap-1.5">
			{#each calendario as d (d.fecha)}
				<div class="text-center">
					{#if d.entrenado}
						<!-- Día entrenado: tap → detalle de ese día -->
						<a
							href={`/historial/dia/${d.fecha}`}
							class="grid aspect-square place-items-center rounded-lg border text-[10px] font-bold"
							style="background: rgb(var(--exito) / .18); border-color: rgb(var(--exito) / .36); color: rgb(var(--exito))"
							aria-label={`${fechaCorta(d.fecha)} entrenado · ver detalle`}
						>
							{inicialDia(d.fecha)}
						</a>
					{:else}
						<div
							class="grid aspect-square place-items-center rounded-lg border text-[10px] font-bold"
							style="background: rgba(255,255,255,.035); border-color: rgba(255,255,255,.06); color: var(--muted)"
							aria-label={`${fechaCorta(d.fecha)} sin entrenamiento`}
						>
							{inicialDia(d.fecha)}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</section>

	<section class="mb-4 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
		<div class="mb-3 flex items-center justify-between gap-3">
			<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
				Racha semanal
			</p>
			<p class="text-xs font-semibold" style="color: var(--muted)">últimas {semanas.length}</p>
		</div>
		<div class="space-y-2">
			{#each semanas as semana (semana.inicio)}
				<div class="flex items-center gap-3">
					<div class="w-20 text-xs font-semibold tabular-nums" style="color: var(--muted)">
						{fechaCorta(semana.inicio)}
					</div>
					<div class="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
						<div
							class="h-full rounded-full"
							style="width: {Math.min(
								100,
								semana.diasEntrenados * 20
							)}%; background: {semana.entrenada ? 'rgb(var(--exito))' : 'rgba(255,255,255,.12)'}"
						></div>
					</div>
					<p class="w-12 text-right text-xs font-bold tabular-nums">
						{semana.diasEntrenados} día{semana.diasEntrenados === 1 ? '' : 's'}
					</p>
				</div>
			{/each}
			{#if semanas.length === 0}
				<p class="py-3 text-center text-sm" style="color: var(--muted)">
					Todavía no hay semanas entrenadas.
				</p>
			{/if}
		</div>
	</section>

	<section class="mb-4">
		<div class="mb-2 flex items-center justify-between gap-3 px-1">
			<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
				Récords vigentes
			</p>
			<p class="text-xs font-semibold" style="color: var(--muted)">{metricaLabel}</p>
		</div>
		<div class="space-y-2">
			{#each records.slice(0, 12) as record (record.exerciseId)}
				{@const ejercicio = ejercicioPorId(record.exerciseId)}
				<article class="rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="truncate text-sm font-bold">{ejercicio?.nombre ?? 'Ejercicio archivado'}</p>
							<p class="mt-0.5 text-xs" style="color: var(--muted)">
								{fechaCorta(record.fecha)} · {formatoSet(record, ajustes.unidad)}
							</p>
						</div>
						<p
							class="shrink-0 text-right text-sm font-extrabold tabular-nums"
							style="color: rgb(var(--max))"
						>
							{formatoNumero(record.valor)}
							<span class="text-[11px] font-semibold" style="color: var(--muted)"
								>{record.modo === 'reps' ? 'reps' : ajustes.unidad}</span
							>
						</p>
					</div>
				</article>
			{/each}
			{#if records.length === 0}
				<p
					class="rounded-2xl border border-dashed border-white/15 p-5 text-center text-sm"
					style="color: var(--muted)"
				>
					Tus récords aparecen cuando marques series hechas.
				</p>
			{/if}
		</div>
	</section>

	<section>
		<p class="mb-2 px-1 text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
			Últimos entrenamientos
		</p>
		<div class="space-y-2">
			{#each historial.dias.slice(0, visibles) as dia (dia.fecha)}
				<a
					href={`/historial/dia/${dia.fecha}`}
					class="block rounded-2xl border border-white/10 p-4"
					style="background: var(--surface)"
					aria-label={`Ver detalle del ${fechaCorta(dia.fecha)}`}
				>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="text-sm font-bold">{fechaCorta(dia.fecha)}</p>
							<p class="mt-0.5 truncate text-xs" style="color: var(--muted)">
								{dia.dias.length ? dia.dias.join(' · ') : 'Rutina'}
							</p>
						</div>
						{#if dia.prs > 0}
							<span
								class="rounded-full px-2.5 py-1 text-[11px] font-bold"
								style="background: rgb(var(--max) / .14); color: rgb(var(--max))">🏆 {dia.prs}</span
							>
						{/if}
					</div>
					<div class="mt-3 grid grid-cols-2 gap-2 text-xs">
						<div class="rounded-xl bg-white/[0.035] p-2">
							<p class="font-bold tabular-nums">{dia.sets}</p>
							<p style="color: var(--muted)">sets hechos</p>
						</div>
						<div class="rounded-xl bg-white/[0.035] p-2">
							<p class="font-bold tabular-nums">{formatoVolumen(dia.volumen)} {ajustes.unidad}</p>
							<p style="color: var(--muted)">volumen (peso × reps ✓)</p>
						</div>
					</div>
				</a>
			{/each}
			{#if historial.dias.length > visibles}
				<button
					onclick={() => (visibles += 10)}
					class="w-full rounded-2xl border border-white/10 py-3 text-sm font-semibold"
					style="background: var(--surface); color: var(--muted)"
				>
					Ver más ({historial.dias.length - visibles}
					{historial.dias.length - visibles === 1 ? 'anterior' : 'anteriores'})
				</button>
			{/if}
			{#if historial.dias.length === 0}
				<p
					class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm"
					style="color: var(--muted)"
				>
					Cuando completes tus primeras series, el historial aparece acá.
				</p>
			{/if}
		</div>
	</section>
</main>
