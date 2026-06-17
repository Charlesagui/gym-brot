<script lang="ts">
	import { page } from '$app/stores';
	import { fly } from 'svelte/transition';
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db';
	import { catalogo, grupos, type Grupo, type Ejercicio } from '$lib/catalog';
	import { agregarEjercicio, quitarEjercicio } from '$lib/dias';
	import { reproducirEnVista } from '$lib/video';
	import { dur } from '$lib/motion';
	import { fromLiveQuery } from '$lib/live';

	const diaId = $derived($page.params.id!);
	const cierrePorArrastrePx = 76;

	const diaActual = $derived(
		fromLiveQuery(
			liveQuery(() => db.dias.get(diaId)),
			undefined
		)
	);
	const yaEn = $derived(new Set($diaActual?.ejercicios.map((e) => e.exerciseId) ?? []));

	let q = $state('');
	let filtro = $state<Grupo | 'todos'>('todos');
	const gruposList: Grupo[] = ['piernas', 'pecho', 'espalda', 'hombros', 'brazos', 'core'];

	// Quita acentos y pasa a minúsculas: en el teclado del gym se escribe sin tildes.
	function normalizar(s: string): string {
		return s
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase();
	}

	const filtrados = $derived.by(() => {
		const term = normalizar(q.trim());
		return catalogo.filter(
			(e) =>
				(filtro === 'todos' || e.grupo === filtro) &&
				// También busca por músculo: la premisa es guiarse sin depender del nombre.
				(term === '' || normalizar(e.nombre).includes(term) || normalizar(e.musculo).includes(term))
		);
	});

	function toggle(e: Ejercicio) {
		if (yaEn.has(e.id)) {
			// Quitar pierde las series objetivo configuradas: que no pase por un mistap.
			if (!confirm(`¿Quitar "${e.nombre}" de este día?`)) return;
			quitarEjercicio(diaId, e.id);
		} else agregarEjercicio(diaId, e.id);
	}

	let preview = $state<Ejercicio | null>(null);
	let inicioY = 0;
	let pointerActivo: number | null = null;
	let arrastrando = $state(false);
	let arrastreY = $state(0);

	function cerrarPreview() {
		preview = null;
		arrastrando = false;
		pointerActivo = null;
		arrastreY = 0;
	}

	function iniciarArrastre(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		pointerActivo = e.pointerId;
		inicioY = e.clientY;
		arrastreY = 0;
		arrastrando = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		if (e.cancelable) e.preventDefault();
	}

	function moverArrastre(e: PointerEvent) {
		if (!arrastrando || pointerActivo !== e.pointerId) return;
		arrastreY = e.clientY - inicioY;
		if (e.cancelable) e.preventDefault();
	}

	function terminarArrastre(e: PointerEvent) {
		if (!arrastrando || pointerActivo !== e.pointerId) return;
		const debeCerrar = Math.abs(arrastreY) >= cierrePorArrastrePx;
		arrastrando = false;
		pointerActivo = null;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			// El navegador puede liberar la captura antes si cambia el foco.
		}
		if (debeCerrar) {
			cerrarPreview();
		} else {
			arrastreY = 0;
		}
	}

	function cancelarArrastre(e: PointerEvent) {
		if (pointerActivo !== e.pointerId) return;
		arrastrando = false;
		pointerActivo = null;
		arrastreY = 0;
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && cerrarPreview()} />

<main class="gb-page glow-bg min-h-dvh px-5 pb-12 pt-6">
	<header class="mb-4 flex items-center gap-3">
		<a
			href={`/dia/${diaId}`}
			class="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
			aria-label="Volver">←</a
		>
		<h1 class="flex-1 text-xl font-bold">Agregar ejercicio</h1>
	</header>

	<input
		bind:value={q}
		placeholder="Buscar…"
		class="mb-3 w-full rounded-xl bg-white/5 px-4 py-2.5 outline-none"
	/>

	<div class="gb-filter-row mb-4 flex flex-wrap gap-2">
		<button
			onclick={() => (filtro = 'todos')}
			class="rounded-full px-3 py-1 text-xs font-semibold"
			style={filtro === 'todos'
				? 'background: var(--accent); color: white'
				: 'background: rgba(255,255,255,.06); color: var(--muted)'}>Todos</button
		>
		{#each gruposList as gKey (gKey)}
			{@const g = grupos[gKey]}
			<button
				onclick={() => (filtro = gKey)}
				class="rounded-full px-3 py-1 text-xs font-semibold"
				style={filtro === gKey
					? `background: rgb(${g.glow}); color: #000`
					: 'background: rgba(255,255,255,.06); color: var(--muted)'}>{g.emoji} {g.label}</button
			>
		{/each}
	</div>

	<div class="gb-landscape-catalog space-y-2.5">
		{#each filtrados as e (e.id)}
			{@const g = grupos[e.grupo]}
			{@const added = yaEn.has(e.id)}
			<div
				class="flex w-full items-center gap-2 rounded-2xl border p-2.5 transition"
				style="border-color: {added
					? `rgb(${g.glow} / .6)`
					: 'rgba(255,255,255,.1)'}; background: var(--surface)"
			>
				<button
					onclick={() => (preview = e)}
					class="flex min-w-0 flex-1 items-center gap-3 text-left"
					aria-label={`Ver ${e.nombre} en grande`}
				>
					<video
						use:reproducirEnVista={e.demoVideo}
						class="size-14 shrink-0 rounded-xl bg-white object-contain"
						aria-label={e.nombre}
						loop
						muted
						playsinline
						preload="none"
					></video>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-semibold leading-tight">{e.nombre}</p>
						<p class="mt-0.5 truncate text-xs font-medium" style="color: rgb({g.glow})">
							{g.emoji}
							{g.label} · {e.musculo}
						</p>
					</div>
				</button>
				<button
					onclick={() => toggle(e)}
					class="grid size-9 shrink-0 place-items-center rounded-full text-lg font-bold transition"
					style={added
						? `background: rgb(${g.glow}); color: #000`
						: 'background: rgba(255,255,255,.1); color: white'}
					aria-label={added ? `Quitar ${e.nombre}` : `Agregar ${e.nombre}`}
					>{added ? '✓' : '+'}</button
				>
			</div>
		{/each}

		{#if filtrados.length === 0}
			<p class="py-8 text-center text-sm" style="color: var(--muted)">
				Nada coincide con tu búsqueda.
			</p>
		{/if}
	</div>
</main>

{#if preview}
	{@const p = preview}
	{@const g = grupos[p.grupo]}
	{@const added = yaEn.has(p.id)}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center px-4"
		style="padding-top: calc(1.5rem + env(safe-area-inset-top)); padding-bottom: calc(1.5rem + env(safe-area-inset-bottom))"
		role="dialog"
		aria-modal="true"
		aria-label={`Vista previa de ${p.nombre}`}
	>
		<button
			class="absolute inset-0"
			style="background: rgb(var(--scrim) / .82); backdrop-filter: blur(6px)"
			aria-label="Cerrar vista previa"
			tabindex="-1"
			onclick={cerrarPreview}
		></button>
		<div in:fly={{ y: 40, duration: dur(240) }} class="relative mx-auto w-full max-w-sm">
			<div
				class="relative w-full overflow-y-auto overscroll-contain rounded-3xl border border-white/10 px-5 pt-3 shadow-2xl"
				style="background: radial-gradient(140% 100% at 50% 0%, rgb({g.glow} / 0.14), transparent 60%), var(--surface); max-height: calc(100dvh - 3rem - env(safe-area-inset-top) - env(safe-area-inset-bottom)); padding-bottom: calc(1.25rem + env(safe-area-inset-bottom)); transform: translate3d(0, {arrastreY}px, 0); transition: {arrastrando
					? 'none'
					: 'transform 160ms ease-out'}"
			>
				<div
					class="-mx-2 mb-2 flex h-8 touch-none select-none items-center justify-center"
					aria-hidden="true"
					onpointerdown={iniciarArrastre}
					onpointermove={moverArrastre}
					onpointerup={terminarArrastre}
					onpointercancel={cancelarArrastre}
				>
					<div class="h-1 w-10 rounded-full bg-white/25"></div>
				</div>
				<div class="mb-3 flex items-start justify-between gap-3">
					<div class="min-w-0 flex-1">
						<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
							Vista previa
						</p>
						<p class="truncate text-lg font-bold leading-tight">{p.nombre}</p>
					</div>
					<button
						onclick={cerrarPreview}
						class="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 text-xl font-bold"
						aria-label="Cerrar vista previa">×</button
					>
				</div>
				<video
					src={p.demoVideo}
					class="mx-auto aspect-square w-full max-w-xs rounded-2xl bg-white object-contain"
					aria-label={p.nombre}
					autoplay
					loop
					muted
					playsinline
					preload="auto"
					onpointerdown={iniciarArrastre}
					onpointermove={moverArrastre}
					onpointerup={terminarArrastre}
					onpointercancel={cancelarArrastre}
				></video>
				<p class="mt-3 text-center text-sm font-medium" style="color: rgb({g.glow})">
					{g.emoji}
					{g.label} · {p.musculo}
				</p>
				<button
					onclick={() => {
						toggle(p);
						cerrarPreview();
					}}
					class="mt-5 w-full rounded-2xl py-3.5 text-base font-bold transition"
					style={added
						? 'background: rgba(255,255,255,.08); color: var(--muted)'
						: `background: rgb(${g.glow}); color: #000`}
				>
					{added ? '✓ Quitar del día' : '+ Agregar al día'}
				</button>
			</div>
		</div>
	</div>
{/if}
