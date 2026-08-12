<script lang="ts">
	import { page } from '$app/stores';
	import { liveQuery } from 'dexie';
	import { db, type Dia, type Sesion, type SetSesion } from '$lib/db';
	import { ejercicioPorId, grupos } from '$lib/catalog';
	import { resumenDiaSesion } from '$lib/historial';
	import { indexSetPr } from '$lib/progreso';
	import { ajustesObs, AJUSTES_DEFAULT } from '$lib/extras';
	import { fromLiveQuery } from '$lib/live';
	import { formatoSet, formatoVolumen } from '$lib/formato';
	import { pasoPesoEfectivo } from '$lib/paso-peso';
	import EditarSerieSheet, { type SerieEditable } from '$lib/components/EditarSerieSheet.svelte';

	// La fecha viene de la URL: si no tiene forma de YYYY-MM-DD no se consulta nada y
	// el título no muestra "Invalid Date".
	const fecha = $derived($page.params.fecha!);
	const fechaValida = $derived(/^\d{4}-\d{2}-\d{2}$/.test(fecha));

	const ajustesStore = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const ajustes = $derived($ajustesStore);

	// Serie en edición → bottom sheet; guarda también el glow del grupo del ejercicio.
	let serieEditando = $state<SerieEditable | null>(null);
	let glowEditando = $state('124 92 255');
	const ejercicioEditando = $derived(
		serieEditando ? ejercicioPorId(serieEditando.exerciseId) : undefined
	);
	const pasoPesoEditando = $derived(
		ejercicioEditando ? pasoPesoEfectivo(ejercicioEditando, ajustes) : ajustes.pasoPeso
	);

	// Puede haber más de una sesión (día de rutina) en la misma fecha: se muestran agrupadas.
	const sesionesStore = $derived(
		fromLiveQuery(
			liveQuery(async () => {
				if (!fechaValida) return { sesiones: [] as Sesion[], dias: [] as Dia[] };
				const [sesiones, dias] = await Promise.all([
					db.sesiones.where('fecha').equals(fecha).toArray(),
					db.dias.toArray()
				]);
				return { sesiones, dias };
			}),
			{ sesiones: [] as Sesion[], dias: [] as Dia[] }
		)
	);
	const conEntrenamiento = $derived(
		$sesionesStore.sesiones.filter((s) => s.ejercicios.some((e) => e.sets.some((x) => x.hecha)))
	);
	const nombreDia = $derived(new Map($sesionesStore.dias.map((d) => [d.id, d.nombre])));

	const resumenes = $derived(conEntrenamiento.map((s) => resumenDiaSesion(s)));
	const totalSets = $derived(resumenes.reduce((n, r) => n + r.setsHechos, 0));
	const totalVolumen = $derived(resumenes.reduce((n, r) => n + r.volumen, 0));
	const totalSinVolumen = $derived(resumenes.reduce((n, r) => n + r.setsSinVolumen, 0));
	const totalPrs = $derived(resumenes.reduce((n, r) => n + r.prs.length, 0));

	const fechaLarga = $derived(
		fechaValida
			? new Date(`${fecha}T00:00:00`).toLocaleDateString('es', {
					weekday: 'long',
					day: 'numeric',
					month: 'long',
					year: 'numeric'
				})
			: 'fecha desconocida'
	);
	const fechaTitulo = $derived(
		(fechaLarga[0]?.toLocaleUpperCase('es') ?? '') + fechaLarga.slice(1)
	);

	function labelPr(metrica: 'peso' | 'e1rm' | 'reps' | undefined, tienePeso: boolean): string {
		if (!tienePeso || metrica === 'reps') return 'reps máximas';
		if (metrica === 'peso') return 'peso máximo';
		if (metrica === 'e1rm') return '1RM estimado';
		return 'registrado';
	}

	function sinVolumen(s: SetSesion): boolean {
		return s.peso == null || s.reps == null;
	}
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-5rem)] px-5 pb-12 pt-6">
	<header class="mb-5 flex items-center gap-3">
		<a
			href="/historial"
			class="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
			aria-label="Volver al historial">←</a
		>
		<div class="min-w-0">
			<p class="text-xs font-bold uppercase tracking-[0.22em]" style="color: var(--muted)">
				Entrenamiento
			</p>
			<h1 class="mt-0.5 text-xl font-extrabold leading-tight">{fechaTitulo}</h1>
		</div>
	</header>

	{#if conEntrenamiento.length === 0}
		<p
			class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm"
			style="color: var(--muted)"
		>
			No hay series registradas en esta fecha.
		</p>
	{:else}
		<section
			class="mb-4 rounded-2xl border border-white/10 p-4"
			style="background: radial-gradient(120% 120% at 0% 0%, rgb(var(--exito) / .14), transparent 62%), var(--surface)"
		>
			<div class="grid grid-cols-3 gap-2 text-center">
				<div>
					<p class="text-2xl font-extrabold tabular-nums">{totalSets}</p>
					<p class="mt-0.5 text-[11px] font-semibold" style="color: var(--muted)">sets hechos</p>
				</div>
				<div>
					<p class="text-2xl font-extrabold tabular-nums">
						{formatoVolumen(totalVolumen)}
					</p>
					<p class="mt-0.5 text-[11px] font-semibold" style="color: var(--muted)">
						volumen {ajustes.unidad} (peso × reps ✓)
					</p>
				</div>
				<div>
					<p class="text-2xl font-extrabold tabular-nums">{totalPrs}</p>
					<p class="mt-0.5 text-[11px] font-semibold" style="color: var(--muted)">
						PRs registrados
					</p>
				</div>
			</div>
			{#if totalSinVolumen > 0}
				<p
					class="mt-3 border-t border-white/10 pt-2.5 text-center text-xs"
					style="color: var(--muted)"
				>
					{totalSinVolumen}
					{totalSinVolumen === 1
						? 'serie hecha sin peso o reps no cuenta'
						: 'series hechas sin peso o reps no cuentan'}
					para el volumen
				</p>
			{/if}
		</section>

		{#each conEntrenamiento as sesion (sesion.id)}
			<section class="mb-4">
				<p class="mb-2 px-1 text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
					{nombreDia.get(sesion.diaId) ?? 'Rutina'}
				</p>
				<div class="space-y-2">
					{#each sesion.ejercicios.filter( (e) => e.sets.some((s) => s.hecha) ) as ejercicio (ejercicio.exerciseId)}
						{@const ej = ejercicioPorId(ejercicio.exerciseId)}
						{@const g = ej ? grupos[ej.grupo] : undefined}
						{@const setPr = indexSetPr(ejercicio.sets, ejercicio.prCelebrado)}
						<article
							class="rounded-2xl border border-white/10 p-4"
							style="background: var(--surface)"
						>
							<div class="flex items-center justify-between gap-3">
								<a
									href={`/ejercicio/${ejercicio.exerciseId}`}
									class="min-w-0 flex-1 truncate text-sm font-bold"
								>
									{#if g}<span style="color: rgb({g.glow})">{g.emoji}</span>{/if}
									{ej?.nombre ?? 'Ejercicio archivado'}
								</a>
								{#if ejercicio.prCelebrado}
									<span
										class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold"
										style="background: rgb(var(--max) / .14); color: rgb(var(--max))"
										>🏆 PR {labelPr(
											ejercicio.prCelebrado.metrica,
											ejercicio.prCelebrado.peso != null
										)}</span
									>
								{/if}
							</div>
							<div class="mt-2.5 space-y-1.5">
								{#each ejercicio.sets as set, i (i)}
									{#if set.hecha}
										<button
											onclick={() => {
												glowEditando = g?.glow ?? '124 92 255';
												serieEditando = {
													sesionId: sesion.id,
													exerciseId: ejercicio.exerciseId,
													setIndex: i,
													set,
													fecha: sesion.fecha,
													maquinaPlacas: !!ej?.maquinaPlacas
												};
											}}
											class="flex min-h-11 w-full items-center gap-2 rounded-xl bg-white/[0.025] px-3 py-2 text-left text-sm"
											aria-label={`Editar serie ${i + 1}: ${formatoSet(set, ajustes.unidad)}`}
										>
											<span
												class="grid size-6 shrink-0 place-items-center rounded-full border border-white/10 text-[11px] font-bold"
												style="color: var(--muted)">{i + 1}</span
											>
											<span class="min-w-0 flex-1 truncate font-semibold tabular-nums">
												{formatoSet(set, ajustes.unidad)}
											</span>
											{#if i === setPr}
												<span class="shrink-0 text-sm" aria-label="Set del PR">🏆</span>
											{/if}
											{#if sinVolumen(set)}
												<span class="shrink-0 text-[10px] font-medium" style="color: var(--muted)"
													>sin volumen</span
												>
											{/if}
											<span class="shrink-0 text-[10px]" style="color: var(--muted)">✎</span>
										</button>
									{/if}
								{/each}
							</div>
						</article>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</main>

{#if serieEditando}
	<EditarSerieSheet
		serie={serieEditando}
		glow={glowEditando}
		unidad={ajustes.unidad}
		pasoPeso={pasoPesoEditando}
		metrica={ajustes.metricaPr}
		onClose={() => (serieEditando = null)}
	/>
{/if}
