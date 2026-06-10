<script lang="ts">
	import { liveQuery } from 'dexie';
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { db, type Dia, type Sesion } from '$lib/db';
	import { crearDia } from '$lib/dias';
	import { hoyStr } from '$lib/sesion';
	import { dur } from '$lib/motion';

	const dias = liveQuery(() => db.dias.orderBy('orden').toArray());
	// Sesiones de hoy, para reflejar el progreso del día en la portada.
	const sesionesHoy = liveQuery(() => db.sesiones.where('fecha').equals(hoyStr()).toArray());

	interface ProgresoDia {
		completos: number;
		total: number;
		terminado: boolean;
	}

	/** Progreso de un día según la sesión de hoy (null si todavía no se tocó nada). */
	function progresoDia(dia: Dia, sesiones: Sesion[] | undefined): ProgresoDia | null {
		const sesion = sesiones?.find((s) => s.diaId === dia.id);
		if (!sesion || dia.ejercicios.length === 0) return null;
		let completos = 0;
		let conActividad = 0;
		for (const item of dia.ejercicios) {
			const e = sesion.ejercicios.find((x) => x.exerciseId === item.exerciseId);
			if (!e || e.sets.length === 0) continue;
			// Saltado cuenta como resuelto (igual que en la pantalla del día).
			if (e.saltado) {
				conActividad++;
				completos++;
				continue;
			}
			if (e.sets.some((s) => s.hecha)) conActividad++;
			if (e.sets.every((s) => s.hecha)) completos++;
		}
		if (conActividad === 0 && !sesion.diaTerminado) return null;
		return { completos, total: dia.ejercicios.length, terminado: !!sesion.diaTerminado };
	}

	async function nuevoDia() {
		const id = await crearDia();
		goto(`/dia/${id}`);
	}
	const hoy = new Date().getDay();
	const nombresDia = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

	let mostrarWelcome = $state(false);
	onMount(() => {
		mostrarWelcome = !localStorage.getItem('gym-brot-welcome-closed');
	});
	function cerrarWelcome() {
		localStorage.setItem('gym-brot-welcome-closed', 'true');
		mostrarWelcome = false;
	}
</script>

<main class="glow-bg min-h-dvh px-5 pb-12 pt-10">
	<header class="mb-7 text-center">
		<h1 class="text-3xl font-extrabold tracking-tight">
			GYM<span style="color: var(--accent)">·</span>BROT
		</h1>
		<p class="mt-1 text-xs capitalize" style="color: var(--muted)">{nombresDia[hoy]}</p>
	</header>

	{#if mostrarWelcome}
		<div
			class="mb-6 rounded-2xl border border-white/10 p-4 relative"
			style="background: radial-gradient(100% 100% at 0% 0%, rgba(99, 102, 241, 0.15), transparent), var(--surface)"
		>
			<button
				onclick={cerrarWelcome}
				class="absolute right-3 top-3 text-sm font-bold"
				style="color: var(--muted)"
				aria-label="Cerrar bienvenida"
			>
				✕
			</button>
			<h2 class="text-sm font-bold" style="color: var(--accent)">👋 ¡Te damos la bienvenida!</h2>
			<p class="mt-1.5 text-xs leading-relaxed" style="color: var(--muted)">
				Agregamos rutinas de ejemplo para que explores la app. Podés editarlas o eliminarlas en cualquier momento. ¡Comenzá tocando una rutina!
			</p>
		</div>
	{/if}

	{#if $dias}
		{@const hoyDia = $dias.find((d) => d.diaSemana === hoy)}
		{#if hoyDia}
			{@const prog = progresoDia(hoyDia, $sesionesHoy)}
			<a
				href={`/dia/${hoyDia.id}`}
				class="mb-6 block rounded-2xl border border-white/10 p-4"
				style="background: radial-gradient(120% 130% at 0% 0%, rgb({hoyDia.color} / 0.30), transparent 62%), var(--surface)"
			>
				<div class="flex items-center justify-between gap-3">
					<p class="text-[11px] font-bold uppercase tracking-[0.2em]" style="color: rgb({hoyDia.color})">
						Hoy entrenás
					</p>
					{#if prog?.terminado}
						<span
							class="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
							style="background: rgb(var(--exito) / .16); color: rgb(var(--exito))">✓ Terminado</span
						>
					{/if}
				</div>
				<p class="mt-1 text-2xl font-bold leading-tight">{hoyDia.nombre}</p>
				{#if prog && !prog.terminado}
					<p class="mt-0.5 text-xs font-semibold" style="color: rgb({hoyDia.color})">
						{prog.completos}/{prog.total} ejercicios hechos →
					</p>
				{:else}
					<p class="mt-0.5 text-xs" style="color: var(--muted)">
						{hoyDia.ejercicios.length} ejercicios →
					</p>
				{/if}
			</a>
		{:else}
			<div
				class="mb-6 rounded-2xl border border-white/10 p-4 text-center"
				style="background: var(--surface)"
			>
				<p class="text-2xl">💤</p>
				<p class="mt-1 text-sm font-semibold">Hoy es tu día de descanso</p>
				<p class="mt-0.5 text-xs" style="color: var(--muted)">
					No tenés rutinas agendadas para hoy. ¡A recuperar energías!
				</p>
			</div>
		{/if}

		<p class="mb-2 px-1 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
			Tus días
		</p>
		<div class="space-y-3">
			{#each $dias as d, i (d.id)}
				{@const prog = progresoDia(d, $sesionesHoy)}
				<a
					href={`/dia/${d.id}`}
					in:fly={{ y: 12, duration: dur(250), delay: dur(i * 45) }}
					class="flex items-center gap-3 rounded-2xl border border-white/10 p-4"
					style="background: linear-gradient(90deg, rgb({d.color} / 0.12), transparent 55%), var(--surface)"
				>
					<span class="h-11 w-1.5 rounded-full" style="background: rgb({d.color})"></span>
					<div class="flex-1">
						<p class="font-semibold leading-tight">{d.nombre}</p>
						<p class="text-xs" style="color: var(--muted)">{d.ejercicios.length} ejercicios</p>
					</div>
					{#if prog?.terminado}
						<span
							class="rounded-full px-2.5 py-1 text-[11px] font-bold"
							style="background: rgb(var(--exito) / .16); color: rgb(var(--exito))">✓ Hoy</span
						>
					{:else if prog}
						<span class="text-xs font-bold tabular-nums" style="color: rgb({d.color})"
							>{prog.completos}/{prog.total}</span
						>
					{:else}
						<span class="text-2xl" aria-hidden="true" style="color: var(--muted)">›</span>
					{/if}
				</a>
			{/each}
		</div>

		<button
			onclick={nuevoDia}
			class="mt-4 w-full rounded-2xl border border-dashed border-white/20 p-4 text-sm font-medium"
			style="color: var(--accent)"
		>
			+ Nuevo día
		</button>
	{:else}
		<p class="text-center text-sm" style="color: var(--muted)">Cargando…</p>
	{/if}
</main>
