<script lang="ts">
	import { ajustesObs, diasDesde, necesitaBackup, AJUSTES_DEFAULT } from '$lib/extras';
	import { formatoNumero, fechaCorta } from '$lib/formato';
	import {
		crearHistorialResumen,
		resumenHistorialObs,
		type HistorialResumen
	} from '$lib/historial';
	import { ejercicioPorId } from '$lib/catalog';
	import { fromLiveQuery } from '$lib/live';
	import { hoyStr, recordsGlobalesObs, type RecordEjercicio } from '$lib/sesion';

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
	const semanas = $derived(historial.semanas.slice(0, 8));
	// Paginación: los récords viejos siempre son alcanzables.
	let recordsVisibles = $state(10);

	// Calendario mensual navegable: todo el historial es alcanzable, mes a mes.
	const hoy = hoyStr();
	let mesOffset = $state(0);

	interface Mes {
		label: string;
		ym: string;
		celdas: (string | null)[];
	}

	function mesGrid(offset: number): Mes {
		const ahora = new Date();
		const base = new Date(ahora.getFullYear(), ahora.getMonth() + offset, 1);
		const label = base.toLocaleDateString('es', { month: 'long', year: 'numeric' });
		// Semana arranca lunes: celdas vacías hasta el día 1.
		const pad = (base.getDay() + 6) % 7;
		const nDias = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
		const celdas: (string | null)[] = Array.from({ length: pad }, () => null);
		for (let dia = 1; dia <= nDias; dia++) {
			celdas.push(new Date(base.getFullYear(), base.getMonth(), dia).toLocaleDateString('sv'));
		}
		return { label, ym: celdas[pad]!.slice(0, 7), celdas };
	}

	const mes = $derived(mesGrid(mesOffset));
	const primeraFecha = $derived(historial.dias.at(-1)?.fecha ?? null);
	// Atrás solo hasta el mes del primer entrenamiento; adelante solo hasta hoy.
	const sinMesAnterior = $derived(!primeraFecha || mes.ym <= primeraFecha.slice(0, 7));

	// Recordatorio de backup: el historial vive solo en este teléfono.
	const recordarBackup = $derived(
		necesitaBackup(
			ajustes.ultimoBackup,
			historial.dias.map((d) => d.fecha)
		)
	);
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-5rem)] px-5 pb-12 pt-8">
	<header class="mb-6">
		<p class="text-xs font-bold uppercase tracking-[0.22em]" style="color: var(--muted)">
			Progreso
		</p>
		<h1 class="mt-1 text-3xl font-extrabold tracking-tight">Historial</h1>
	</header>

	{#if recordarBackup}
		<!-- Discreto y accionable: el dato local se puede perder sin backup (iOS purga IndexedDB). -->
		<a
			href="/ajustes"
			class="mb-4 flex items-center gap-3 rounded-2xl border border-white/10 p-3.5"
			style="background: var(--surface)"
		>
			<span class="text-lg">💾</span>
			<span class="min-w-0 flex-1 text-xs leading-relaxed" style="color: var(--muted)">
				Tu historial vive solo en este teléfono ·
				{ajustes.ultimoBackup
					? `último backup hace ${diasDesde(ajustes.ultimoBackup)} días`
					: 'todavía sin backup'}
			</span>
			<span class="shrink-0 text-xs font-bold" style="color: var(--accent)">Exportar →</span>
		</a>
	{/if}

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
		<div class="mb-3 flex items-center justify-between gap-2">
			<button
				onclick={() => (mesOffset -= 1)}
				disabled={sinMesAnterior}
				class="grid size-11 place-items-center rounded-full border border-white/10 text-base disabled:opacity-30"
				aria-label="Mes anterior">‹</button
			>
			<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
				{mes.label}
			</p>
			<button
				onclick={() => (mesOffset += 1)}
				disabled={mesOffset >= 0}
				class="grid size-11 place-items-center rounded-full border border-white/10 text-base disabled:opacity-30"
				aria-label="Mes siguiente">›</button
			>
		</div>
		<div class="grid grid-cols-7 gap-1.5">
			{#each ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as letra, i (i)}
				<p class="text-center text-[10px] font-bold" style="color: var(--muted)">{letra}</p>
			{/each}
			{#each mes.celdas as fecha, i (i)}
				{#if fecha == null}
					<div></div>
				{:else if diasEntrenados.has(fecha)}
					<!-- Día entrenado: tap → detalle de ese día -->
					<a
						href={`/historial/dia/${fecha}`}
						class="grid aspect-square place-items-center rounded-lg border text-[11px] font-bold"
						style="background: rgb(var(--exito) / .18); border-color: rgb(var(--exito) / {fecha ===
						hoy
							? '.9'
							: '.36'}); color: rgb(var(--exito))"
						aria-label={`${fechaCorta(fecha)} entrenado · ver detalle`}
					>
						{Number(fecha.slice(8, 10))}
					</a>
				{:else}
					<div
						class="grid aspect-square place-items-center rounded-lg border text-[11px] font-semibold {fecha >
						hoy
							? 'opacity-35'
							: ''}"
						style="background: rgba(255,255,255,.035); border-color: {fecha === hoy
							? 'rgba(255,255,255,.4)'
							: 'rgba(255,255,255,.06)'}; color: var(--muted)"
						aria-label={`${fechaCorta(fecha)} sin entrenamiento`}
					>
						{Number(fecha.slice(8, 10))}
					</div>
				{/if}
			{/each}
		</div>
		<p class="mt-2.5 text-right text-[11px] font-semibold" style="color: rgb(var(--exito))">
			● entrenado
		</p>
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
		<div class="mb-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 px-1">
			<p class="shrink-0 text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
				Récords vigentes
			</p>
			<p class="text-right text-xs font-semibold" style="color: var(--muted)">
				{metricaLabel} · recientes primero
			</p>
		</div>
		<div class="space-y-1.5">
			{#each records.slice(0, recordsVisibles) as record (record.exerciseId)}
				{@const ejercicio = ejercicioPorId(record.exerciseId)}
				<!-- Fila compacta: el detalle del set vive en la pantalla del ejercicio. -->
				<a
					href={`/ejercicio/${record.exerciseId}`}
					class="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 px-3 py-2"
					style="background: var(--surface)"
					aria-label={`Ver progreso de ${ejercicio?.nombre ?? 'ejercicio archivado'}`}
				>
					<p class="min-w-0 flex-1 truncate text-sm font-semibold">
						{ejercicio?.nombre ?? 'Ejercicio archivado'}
					</p>
					<span class="shrink-0 text-[11px]" style="color: var(--muted)"
						>{fechaCorta(record.fecha)}</span
					>
					<p
						class="shrink-0 text-right text-sm font-extrabold tabular-nums"
						style="color: rgb(var(--max))"
					>
						{formatoNumero(record.valor)}
						<span class="ml-1 text-[11px] font-semibold" style="color: var(--muted)"
							>{record.modo === 'reps' ? 'reps' : ajustes.unidad}</span
						>
					</p>
				</a>
			{/each}
			{#if records.length > recordsVisibles}
				<button
					onclick={() => (recordsVisibles += 15)}
					class="w-full rounded-xl border border-white/10 py-2.5 text-sm font-semibold"
					style="background: var(--surface); color: var(--muted)"
				>
					Ver más ({records.length - recordsVisibles}
					{records.length - recordsVisibles === 1 ? 'récord' : 'récords'})
				</button>
			{/if}
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
</main>
