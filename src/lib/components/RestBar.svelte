<script lang="ts">
	import { fly } from 'svelte/transition';
	import { descanso } from '$lib/descanso.svelte';
	import { dur } from '$lib/motion';

	// Cuando hay BottomNav, la barra se apoya encima de él; si no (pantalla de
	// ejercicio), va pegada abajo respetando el safe-area del iPhone.
	let { offsetNav = false }: { offsetNav?: boolean } = $props();

	function mmss(s: number): string {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${String(sec).padStart(2, '0')}`;
	}
</script>

{#if descanso.restoSeg > 0 || descanso.avisoFin}
	<div
		transition:fly={{ y: 80, duration: dur(220) }}
		class="fixed inset-x-0 z-50 mx-auto flex max-w-md items-center justify-between gap-3 border-t border-white/10 px-5 pt-3"
		style="bottom: {offsetNav
			? 'calc(64px + env(safe-area-inset-bottom))'
			: '0'}; padding-bottom: {offsetNav
			? '0.75rem'
			: 'calc(0.75rem + env(safe-area-inset-bottom))'}; background: color-mix(in oklab, var(--surface) 94%, transparent); backdrop-filter: blur(10px)"
	>
		{#if descanso.restoSeg > 0}
			<span class="text-sm font-semibold" style="color: var(--muted)">⏱️ Descanso</span>
			<span class="text-3xl font-extrabold tabular-nums" style="color: rgb({descanso.glow})"
				>{mmss(descanso.restoSeg)}</span
			>
			<button
				onclick={() => descanso.saltar()}
				class="min-h-10 rounded-full px-5 text-sm font-semibold"
				style="background: rgba(255,255,255,.12)">Saltar</button
			>
		{:else}
			<span
				class="mx-auto py-1.5 text-xl font-extrabold"
				style="color: rgb({descanso.glow})"
				aria-live="polite">✓ Descanso terminado</span
			>
		{/if}
	</div>
{/if}
