<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { liveQuery } from 'dexie';
	import { db, type Ajustes, type Dia, type Sesion } from '$lib/db';
	import { ejercicioPorId, grupos } from '$lib/catalog';
	import { actualizarDia, borrarDia, quitarEjercicio, setSeries, coloresDia } from '$lib/dias';
	import { marcarDiaTerminado, reabrirDia, sesionHoyObs } from '$lib/sesion';
	import { ajustesObs, AJUSTES_DEFAULT } from '$lib/extras';

	let dia = $state<Dia | undefined>(undefined);
	let cargando = $state(true);
	let editando = $state(false);
	let nombreEdit = $state('');
	let sesion = $state<Sesion | undefined>(undefined);
	let ajustes = $state<Ajustes>(AJUSTES_DEFAULT);
	let premioDia = $state(false);
	let premioId: ReturnType<typeof setTimeout> | null = null;
	type AudioContextConstructor = new () => AudioContext;
	type AudioWindow = Window &
		typeof globalThis & { webkitAudioContext?: AudioContextConstructor };
	let audioCtx: AudioContext | null = null;

	const diaId = $derived($page.params.id!);

	const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

	$effect(() => {
		const id = diaId;
		cargando = true;
		const sub = liveQuery(() => db.dias.get(id)).subscribe((d) => {
			dia = d;
			cargando = false;
		});
		return () => sub.unsubscribe();
	});

	$effect(() => {
		const id = diaId;
		const sub = sesionHoyObs(id).subscribe((s) => (sesion = s));
		return () => sub.unsubscribe();
	});

	$effect(() => {
		const sub = ajustesObs().subscribe((a) => (ajustes = a));
		return () => sub.unsubscribe();
	});

	onDestroy(() => {
		if (premioId) clearTimeout(premioId);
	});

	const ejerciciosCompletos = $derived(
		dia?.ejercicios.filter((item) => {
			const p = progreso(item.exerciseId);
			return !!p && p.total > 0 && p.hechas === p.total;
		}).length ?? 0
	);
	const totalEjercicios = $derived(dia?.ejercicios.length ?? 0);
	const diaListo = $derived(totalEjercicios > 0 && ejerciciosCompletos === totalEjercicios);
	const diaTerminado = $derived(!!sesion?.diaTerminado);
	const sonidoActivo = $derived(ajustes.sonido);

	function progreso(exId: string): { hechas: number; total: number } | null {
		const e = sesion?.ejercicios.find((x) => x.exerciseId === exId);
		if (!e || e.sets.length === 0) return null;
		// El calentamiento no cuenta para el progreso/completado del ejercicio.
		const trabajo = e.sets.filter((s) => !s.esCalentamiento);
		const base = trabajo.length ? trabajo : e.sets;
		return { hechas: base.filter((s) => s.hecha).length, total: base.length };
	}

	function abrirEdicion() {
		nombreEdit = dia?.nombre ?? '';
		editando = true;
	}
	function guardarNombre() {
		if (dia && nombreEdit.trim()) actualizarDia(diaId, { nombre: nombreEdit.trim() });
	}
	async function eliminar() {
		if (dia && confirm(`¿Borrar el día "${dia.nombre}"?`)) {
			await borrarDia(diaId);
			goto('/');
		}
	}

	async function terminarDia() {
		if (!diaListo || diaTerminado) return;
		await marcarDiaTerminado(diaId);
		premioDia = true;
		void sonarDiaTerminado().catch(() => {});
		if ('vibrate' in navigator) navigator.vibrate([120, 70, 120, 70, 220]);
		if (premioId) clearTimeout(premioId);
		premioId = setTimeout(() => (premioDia = false), 2400);
	}

	async function reabrir() {
		premioDia = false;
		if (premioId) clearTimeout(premioId);
		await reabrirDia(diaId);
	}

	function getAudioContext(): AudioContext | null {
		if (typeof window === 'undefined') return null;
		const audioWindow = window as AudioWindow;
		const Ctx = window.AudioContext ?? audioWindow.webkitAudioContext;
		if (!Ctx) return null;
		audioCtx ??= new Ctx();
		return audioCtx;
	}

	function beep(ctx: AudioContext, start: number, freq: number, duracion: number, volumen: number) {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = 'triangle';
		osc.frequency.setValueAtTime(freq, start);
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(volumen, start + 0.012);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + duracion);
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start(start);
		osc.stop(start + duracion + 0.04);
	}

	async function sonarDiaTerminado() {
		if (!sonidoActivo) return;
		const ctx = getAudioContext();
		if (!ctx) return;
		if (ctx.state === 'suspended') await ctx.resume();
		const now = ctx.currentTime;
		beep(ctx, now, 392, 0.14, 0.16);
		beep(ctx, now + 0.09, 587, 0.16, 0.18);
		beep(ctx, now + 0.2, 784, 0.22, 0.2);
		beep(ctx, now + 0.36, 1175, 0.32, 0.16);
	}
</script>

<main class="glow-bg min-h-dvh px-5 pb-12 pt-6">
	<header class="mb-5 flex items-center gap-3">
		<a
			href="/"
			class="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
			aria-label="Volver">←</a
		>
		{#if editando}
			<input
				bind:value={nombreEdit}
				onblur={guardarNombre}
				class="min-w-0 flex-1 rounded-lg bg-white/5 px-3 py-1.5 text-lg font-bold outline-none"
				placeholder="Nombre del día"
			/>
			<button
				onclick={() => (editando = false)}
				class="shrink-0 rounded-full px-4 py-1.5 text-sm font-bold"
				style="background: var(--accent); color: white">Listo</button
			>
		{:else}
			<h1 class="flex-1 text-xl font-bold">{dia?.nombre ?? ''}</h1>
			{#if dia}
				<button
					onclick={abrirEdicion}
					class="grid size-9 shrink-0 place-items-center rounded-full border border-white/10"
					aria-label="Editar">✏️</button
				>
			{/if}
		{/if}
	</header>

	{#if cargando}
		<p class="text-center text-sm" style="color: var(--muted)">Cargando…</p>
	{:else if !dia}
		<p class="text-center text-sm" style="color: var(--muted)">Día no encontrado.</p>
	{:else}
		{#if editando}
			<p class="mb-2 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Día de la semana
			</p>
			<div class="mb-4 flex gap-1.5">
				{#each diasSemana as d, i (i)}
					<button
						onclick={() =>
							actualizarDia(diaId, { diaSemana: dia?.diaSemana === i ? undefined : i })}
						class="flex-1 rounded-lg py-2 text-xs font-semibold"
						style={dia.diaSemana === i
							? 'background: var(--accent); color: white'
							: 'background: rgba(255,255,255,.05); color: var(--muted)'}>{d}</button
					>
				{/each}
			</div>

			<p class="mb-2 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Color
			</p>
			<div class="mb-6 flex gap-2.5">
				{#each coloresDia as c (c.rgb)}
					<button
						onclick={() => actualizarDia(diaId, { color: c.rgb })}
						class="size-8 rounded-full transition"
						style="background: rgb({c.rgb}); outline: {dia.color === c.rgb
							? '2px solid white'
							: '2px solid transparent'}; outline-offset: 2px"
						aria-label={c.nombre}
					></button>
				{/each}
			</div>
		{/if}

		<div class="space-y-3">
			{#each dia.ejercicios.slice().sort((a, b) => a.orden - b.orden) as item (item.exerciseId)}
				{@const e = ejercicioPorId(item.exerciseId)}
				{#if e}
					{@const g = grupos[e.grupo]}
					{@const p = progreso(e.id)}
					{#if editando}
						<div
							class="flex items-center gap-3 rounded-2xl border border-white/10 p-2.5"
							style="background: radial-gradient(150% 130% at 0% 0%, rgb({g.glow} / 0.14), transparent 60%), var(--surface)"
						>
							<img
								src={e.gif}
								alt={e.nombre}
								class="size-14 shrink-0 rounded-xl bg-white object-contain"
								loading="lazy"
							/>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-semibold leading-tight">{e.nombre}</p>
								<div class="mt-1.5 flex items-center gap-2">
									<button
										onclick={() => setSeries(diaId, e.id, item.seriesObjetivo - 1)}
										class="grid size-6 place-items-center rounded-full bg-white/10 text-sm"
										aria-label="Menos series">−</button
									>
									<span class="text-sm font-semibold tabular-nums"
										>{item.seriesObjetivo} objetivo</span
									>
									<button
										onclick={() => setSeries(diaId, e.id, item.seriesObjetivo + 1)}
										class="grid size-6 place-items-center rounded-full bg-white/10 text-sm"
										aria-label="Más series">+</button
									>
								</div>
							</div>
							<button
								onclick={() => quitarEjercicio(diaId, e.id)}
								class="grid size-8 shrink-0 place-items-center rounded-full text-sm"
								style="background: rgba(255,80,80,.15); color: #ff6b6b"
								aria-label="Quitar">✕</button
							>
						</div>
					{:else}
						<a
							href={`/ejercicio/${e.id}?dia=${diaId}`}
							class="flex items-center gap-3 rounded-2xl border border-white/10 p-2.5"
							style="background: radial-gradient(150% 130% at 0% 0%, rgb({g.glow} / 0.14), transparent 60%), var(--surface)"
						>
							<img
								src={e.gif}
								alt={e.nombre}
								class="size-16 shrink-0 rounded-xl bg-white object-contain"
								loading="lazy"
							/>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-semibold leading-tight">{e.nombre}</p>
								<p class="mt-0.5 text-xs font-medium" style="color: rgb({g.glow})">
									{g.emoji} {g.label}
								</p>
							</div>
							<div class="pr-1 text-right">
								{#if p && p.hechas === p.total}
									<p class="text-xl leading-none" style="color: rgb({g.glow})">✓</p>
									<p class="text-[10px]" style="color: var(--muted)">hecho</p>
								{:else if p}
									<p class="text-lg font-bold leading-none">{p.hechas}/{p.total}</p>
									<p class="text-[10px]" style="color: var(--muted)">series</p>
								{:else}
									<p class="text-lg font-bold leading-none">{item.seriesObjetivo}</p>
									<p class="text-[10px]" style="color: var(--muted)">series</p>
								{/if}
							</div>
						</a>
					{/if}
				{/if}
			{/each}

			{#if dia.ejercicios.length === 0}
				<p
					class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm"
					style="color: var(--muted)"
				>
					Sin ejercicios todavía. Agregá el primero 👇
				</p>
			{/if}
		</div>

		{#if !editando && totalEjercicios > 0}
			<section class="mt-4 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
				<div class="flex items-center justify-between gap-3">
					<div>
						<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
							Estado del día
						</p>
						<p class="mt-1 text-sm font-bold">
							{ejerciciosCompletos}/{totalEjercicios} ejercicios
						</p>
					</div>
					{#if diaTerminado}
						<span
							class="rounded-full px-2.5 py-1 text-xs font-bold"
							style="background: rgba(74,222,128,.16); color: #4ade80">Terminado</span
						>
					{:else if diaListo}
						<span
							class="rounded-full px-2.5 py-1 text-xs font-bold"
							style="background: rgba(255,255,255,.08); color: var(--muted)">Listo</span
						>
					{:else}
						<span
							class="rounded-full px-2.5 py-1 text-xs font-bold"
							style="background: rgba(255,255,255,.08); color: var(--muted)">En curso</span
						>
					{/if}
				</div>

				{#if diaTerminado}
					<button
						onclick={reabrir}
						class="mt-3 w-full rounded-2xl border border-white/10 py-3 text-sm font-bold"
						style="color: var(--muted)">Reabrir día</button
					>
				{:else}
					<button
						onclick={terminarDia}
						disabled={!diaListo}
						class="mt-3 w-full rounded-2xl py-3 text-sm font-bold disabled:opacity-45"
						style="background: {diaListo ? 'var(--accent)' : 'rgba(255,255,255,.08)'}; color: {diaListo ? 'white' : 'var(--muted)'}"
					>
						{diaListo ? '🏁 Terminar día' : `Faltan ${totalEjercicios - ejerciciosCompletos}`}
					</button>
				{/if}
			</section>
		{/if}

		<a
			href={`/dia/${diaId}/agregar`}
			class="mt-4 block rounded-2xl border border-dashed border-white/20 p-4 text-center text-sm font-medium"
			style="color: var(--accent)">+ Agregar ejercicio</a
		>

		{#if editando}
			<button
				onclick={eliminar}
				class="mt-3 w-full rounded-2xl border border-white/10 p-3 text-sm"
				style="color: #ff6b6b">🗑 Borrar día</button
			>
		{/if}
	{/if}
</main>

{#if premioDia}
	<div
		class="fixed inset-0 z-[60] grid place-items-center px-8"
		style="background: radial-gradient(72% 50% at 50% 42%, rgb(74 222 128 / .22), transparent 72%), rgba(8,8,12,.84); backdrop-filter: blur(8px)"
	>
		<div transition:fly={{ y: 18, duration: 260 }} class="text-center" aria-live="polite">
			<div
				class="mx-auto grid size-24 place-items-center rounded-full border border-white/15 text-5xl font-extrabold"
				style="background: rgba(74,222,128,.18); color: #4ade80; box-shadow: 0 0 55px rgba(74,222,128,.24)"
			>
				🏁
			</div>
			<p class="mt-5 text-2xl font-extrabold">Día terminado</p>
			<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
				{ejerciciosCompletos}/{totalEjercicios} ejercicios completos
			</p>
		</div>
	</div>
{/if}
