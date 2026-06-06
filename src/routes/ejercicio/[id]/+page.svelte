<script lang="ts">
	import { page } from '$app/stores';
	import { ejercicioPorId, grupos } from '$lib/catalog';

	const ej = $derived(ejercicioPorId($page.params.id));
	const g = $derived(ej ? grupos[ej.grupo] : undefined);
	const diaId = $derived($page.url.searchParams.get('dia'));
	const volver = $derived(diaId ? `/dia/${diaId}` : '/');

	// Demo local de series — la persistencia real llega en Fase 3.
	const objetivo = 4;
	let extra = $state(0);
	let hechas = $state(2);

	function tocar(i: number) {
		hechas = i + 1 <= hechas ? i : i + 1;
	}
</script>

{#if !ej || !g}
	<main class="glow-bg grid min-h-dvh place-items-center">
		<p style="color: var(--muted)">Ejercicio no encontrado.</p>
	</main>
{:else}
	<main
		class="min-h-dvh px-5 pb-12 pt-6"
		style="background: radial-gradient(85% 42% at 50% 0%, rgb({g.glow} / 0.20), transparent 72%), var(--bg)"
	>
		<header class="mb-4 flex items-center gap-3">
			<a
				href={volver}
				class="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
				aria-label="Volver">←</a
			>
			<h1 class="flex-1 text-lg font-bold leading-tight">{ej.nombre}</h1>
		</header>

		<img
			src={ej.gif}
			alt={ej.nombre}
			class="mx-auto aspect-square w-full max-w-xs rounded-2xl bg-white object-contain"
		/>
		<p class="mt-2 text-center text-sm font-medium" style="color: rgb({g.glow})">
			{g.emoji} {g.label} · {ej.musculo}
		</p>

		<section class="mt-6 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
			<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">Series</p>
			<div class="mt-3 flex flex-wrap items-center gap-2.5">
				{#each Array.from({ length: objetivo + extra }) as _, i (i)}
					<button
						onclick={() => tocar(i)}
						class="size-9 rounded-full border-2 transition-colors"
						style={i < hechas
							? 'background: var(--accent); border-color: var(--accent)'
							: 'border-color: rgba(255,255,255,.22)'}
						aria-label={`Serie ${i + 1}`}
					></button>
				{/each}
				<button
					onclick={() => (extra += 1)}
					class="grid size-9 place-items-center rounded-full border-2 border-dashed border-white/25 text-lg"
					style="color: var(--muted)"
					aria-label="Sumar serie">+</button
				>
			</div>
			<p class="mt-3 text-sm" style="color: var(--muted)">{hechas} de {objetivo + extra} series</p>
		</section>

		<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
			<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Peso de hoy
			</p>
			<div class="mt-3 flex items-center gap-2 text-lg">
				<span class="rounded-lg bg-white/5 px-3 py-2 font-semibold">— kg</span>
				<span style="color: var(--muted)">×</span>
				<span class="rounded-lg bg-white/5 px-3 py-2 font-semibold">— reps</span>
			</div>
			<p class="mt-2 text-xs" style="color: var(--muted)">🏆 PR y 🔥 MAX llegan en la Fase 4</p>
		</section>

		<details class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
			<summary class="cursor-pointer text-sm font-medium" style="color: var(--muted)">📝 Notas</summary>
			<p class="mt-2 text-xs" style="color: var(--muted)">
				Acá vas a poder anotar los settings de la máquina (Fase 5).
			</p>
		</details>

		<a
			href={volver}
			class="mt-5 block rounded-2xl py-4 text-center font-bold"
			style="background: var(--accent); color: white">✓ Terminar ejercicio</a
		>
	</main>
{/if}
