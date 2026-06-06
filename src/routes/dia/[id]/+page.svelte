<script lang="ts">
	import { page } from '$app/stores';
	import { db, type Dia } from '$lib/db';
	import { ejercicioPorId, grupos } from '$lib/catalog';

	let dia = $state<Dia | undefined>(undefined);
	let cargando = $state(true);

	$effect(() => {
		const id = $page.params.id;
		cargando = true;
		let cancel = false;
		db.dias.get(id).then((d) => {
			if (!cancel) {
				dia = d;
				cargando = false;
			}
		});
		return () => {
			cancel = true;
		};
	});
</script>

<main class="glow-bg min-h-dvh px-5 pb-12 pt-6">
	<header class="mb-5 flex items-center gap-3">
		<a
			href="/"
			class="grid size-9 place-items-center rounded-full border border-white/10 text-lg"
			aria-label="Volver">←</a
		>
		<h1 class="text-xl font-bold">{dia?.nombre ?? ''}</h1>
	</header>

	{#if cargando}
		<p class="text-center text-sm" style="color: var(--muted)">Cargando…</p>
	{:else if !dia}
		<p class="text-center text-sm" style="color: var(--muted)">Día no encontrado.</p>
	{:else}
		<div class="space-y-3">
			{#each dia.ejercicios.slice().sort((a, b) => a.orden - b.orden) as item (item.exerciseId)}
				{@const e = ejercicioPorId(item.exerciseId)}
				{#if e}
					{@const g = grupos[e.grupo]}
					<a
						href={`/ejercicio/${e.id}?dia=${dia.id}`}
						class="flex items-center gap-3 rounded-2xl border border-white/10 p-2.5"
						style="background: radial-gradient(150% 130% at 0% 0%, rgb({g.glow} / 0.14), transparent 60%), var(--surface)"
					>
						<img
							src={e.gif}
							alt={e.nombre}
							class="size-16 shrink-0 rounded-xl bg-white object-contain"
							loading="lazy"
						/>
						<div class="flex-1">
							<p class="text-sm font-semibold leading-tight">{e.nombre}</p>
							<p class="mt-0.5 text-xs font-medium" style="color: rgb({g.glow})">
								{g.emoji} {g.label}
							</p>
						</div>
						<div class="pr-1 text-right">
							<p class="text-lg font-bold leading-none">{item.seriesObjetivo}</p>
							<p class="text-[10px]" style="color: var(--muted)">series</p>
						</div>
					</a>
				{/if}
			{/each}
		</div>

		<button
			class="mt-4 w-full rounded-2xl border border-dashed border-white/15 p-4 text-sm"
			style="color: var(--muted)"
			disabled
		>
			+ Agregar ejercicio <span class="opacity-60">(Fase 2)</span>
		</button>
	{/if}
</main>
