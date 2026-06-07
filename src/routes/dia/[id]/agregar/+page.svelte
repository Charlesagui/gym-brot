<script lang="ts">
	import { page } from '$app/stores';
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db';
	import { catalogo, grupos, type Grupo } from '$lib/catalog';
	import { agregarEjercicio, quitarEjercicio } from '$lib/dias';

	const diaId = $derived($page.params.id!);

	let yaEn = $state<Set<string>>(new Set());
	$effect(() => {
		const id = diaId;
		const sub = liveQuery(() => db.dias.get(id)).subscribe((d) => {
			yaEn = new Set(d?.ejercicios.map((e) => e.exerciseId) ?? []);
		});
		return () => sub.unsubscribe();
	});

	let q = $state('');
	let filtro = $state<Grupo | 'todos'>('todos');
	const gruposList: Grupo[] = ['piernas', 'pecho', 'espalda', 'hombros', 'brazos', 'core'];

	const filtrados = $derived(
		catalogo.filter(
			(e) =>
				(filtro === 'todos' || e.grupo === filtro) &&
				e.nombre.toLowerCase().includes(q.toLowerCase())
		)
	);

	function toggle(id: string) {
		if (yaEn.has(id)) quitarEjercicio(diaId, id);
		else agregarEjercicio(diaId, id);
	}
</script>

<main class="glow-bg min-h-dvh px-5 pb-12 pt-6">
	<header class="mb-4 flex items-center gap-3">
		<a
			href={`/dia/${diaId}`}
			class="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
			aria-label="Volver">←</a
		>
		<h1 class="flex-1 text-xl font-bold">Agregar ejercicio</h1>
	</header>

	<input
		bind:value={q}
		placeholder="Buscar…"
		class="mb-3 w-full rounded-xl bg-white/5 px-4 py-2.5 outline-none"
	/>

	<div class="mb-4 flex flex-wrap gap-2">
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

	<div class="space-y-2.5">
		{#each filtrados as e (e.id)}
			{@const g = grupos[e.grupo]}
			{@const added = yaEn.has(e.id)}
			<button
				onclick={() => toggle(e.id)}
				class="flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition"
				style="border-color: {added ? `rgb(${g.glow} / .6)` : 'rgba(255,255,255,.1)'}; background: var(--surface)"
			>
				<img
					src={e.gif}
					alt={e.nombre}
					class="size-14 shrink-0 rounded-xl bg-white object-contain"
					loading="lazy"
				/>
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-semibold leading-tight">{e.nombre}</p>
					<p class="mt-0.5 text-xs font-medium" style="color: rgb({g.glow})">{g.emoji} {g.label}</p>
				</div>
				<span
					class="grid size-8 shrink-0 place-items-center rounded-full text-lg font-bold"
					style={added
						? `background: rgb(${g.glow}); color: #000`
						: 'background: rgba(255,255,255,.1); color: white'}>{added ? '✓' : '+'}</span
				>
			</button>
		{/each}

		{#if filtrados.length === 0}
			<p class="py-8 text-center text-sm" style="color: var(--muted)">Nada coincide con tu búsqueda.</p>
		{/if}
	</div>
</main>
