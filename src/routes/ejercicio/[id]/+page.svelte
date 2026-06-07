<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { db, type SetSesion } from '$lib/db';
	import { ejercicioPorId, grupos } from '$lib/catalog';
	import { sesionHoyObs, ensureEjercicio, toggleSet, setPeso, setReps, addSet } from '$lib/sesion';

	const ej = $derived(ejercicioPorId($page.params.id));
	const g = $derived(ej ? grupos[ej.grupo] : undefined);
	const diaId = $derived($page.url.searchParams.get('dia'));
	const volver = $derived(diaId ? `/dia/${diaId}` : '/');

	let sets = $state<SetSesion[]>([]);

	$effect(() => {
		const exId = $page.params.id;
		const dId = diaId;
		if (!dId) {
			sets = [];
			return;
		}
		const sub = sesionHoyObs(dId).subscribe((s) => {
			const e = s?.ejercicios.find((x) => x.exerciseId === exId);
			sets = e ? e.sets : [];
		});
		return () => sub.unsubscribe();
	});

	onMount(async () => {
		const exId = $page.params.id;
		if (!diaId) return;
		const dia = await db.dias.get(diaId);
		const item = dia?.ejercicios.find((e) => e.exerciseId === exId);
		await ensureEjercicio(diaId, exId, item?.seriesObjetivo ?? 4);
	});

	const hechas = $derived(sets.filter((s) => s.hecha).length);
	const completo = $derived(sets.length > 0 && hechas === sets.length);

	function num(v: string): number | undefined {
		const n = parseFloat(v.replace(',', '.'));
		return isNaN(n) ? undefined : n;
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

		{#if !diaId}
			<p
				class="mt-6 rounded-2xl border border-white/10 p-4 text-center text-sm"
				style="color: var(--muted)"
			>
				Abrí este ejercicio desde un día para registrar tus series.
			</p>
		{:else}
			<section class="mt-6 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
				<div class="flex items-center justify-between">
					<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
						Series
					</p>
					<p
						class="text-xs font-bold"
						style="color: {completo ? `rgb(${g.glow})` : 'var(--muted)'}"
					>
						{hechas}/{sets.length} hechas
					</p>
				</div>

				<div class="mt-3 space-y-2">
					{#each sets as s, i (i)}
						<div class="flex items-center gap-2">
							<span class="w-5 shrink-0 text-center text-sm font-bold" style="color: var(--muted)"
								>{i + 1}</span
							>
							<input
								type="number"
								inputmode="decimal"
								value={s.peso ?? ''}
								placeholder="—"
								onchange={(e) => setPeso(diaId, $page.params.id, i, num(e.currentTarget.value))}
								class="w-16 rounded-lg bg-white/5 px-2 py-2 text-center font-semibold outline-none"
							/>
							<span class="text-sm" style="color: var(--muted)">kg ×</span>
							<input
								type="number"
								inputmode="numeric"
								value={s.reps ?? ''}
								placeholder="—"
								onchange={(e) => setReps(diaId, $page.params.id, i, num(e.currentTarget.value))}
								class="w-14 rounded-lg bg-white/5 px-2 py-2 text-center font-semibold outline-none"
							/>
							<button
								onclick={() => toggleSet(diaId, $page.params.id, i)}
								class="ml-auto grid size-10 shrink-0 place-items-center rounded-full border-2 text-sm font-bold transition-colors"
								style={s.hecha
									? 'background: var(--accent); border-color: var(--accent); color: white'
									: 'border-color: rgba(255,255,255,.22); color: transparent'}
								aria-label={`Marcar serie ${i + 1}`}>✓</button
							>
						</div>
					{/each}
				</div>

				<button
					onclick={() => addSet(diaId, $page.params.id)}
					class="mt-3 w-full rounded-lg border border-dashed border-white/20 py-2 text-sm"
					style="color: var(--muted)">+ serie</button
				>
			</section>

			<details class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
				<summary class="cursor-pointer text-sm font-medium" style="color: var(--muted)">📝 Notas</summary>
				<p class="mt-2 text-xs" style="color: var(--muted)">Notas de la máquina — llegan en la Fase 5.</p>
			</details>

			<p class="mt-3 text-center text-xs" style="color: var(--muted)">🏆 PR y 🔥 MAX llegan en la Fase 4</p>

			<a
				href={volver}
				class="mt-4 block rounded-2xl py-4 text-center font-bold"
				style="background: {completo ? `rgb(${g.glow})` : 'var(--accent)'}; color: white"
				>{completo ? '✓ ¡Completado!' : '✓ Terminar ejercicio'}</a
			>
		{/if}
	</main>
{/if}
