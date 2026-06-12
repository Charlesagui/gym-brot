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

{#if descanso.restoSeg > 0 || descanso.vencido}
	<div
		transition:fly={{ y: 80, duration: dur(220) }}
		class="fixed inset-x-0 z-50 mx-auto flex max-w-md items-center justify-between gap-3 border-t border-white/10 px-5 pt-3 {descanso.vencido
			? 'rest-vencido'
			: ''}"
		style="bottom: {offsetNav
			? 'calc(64px + env(safe-area-inset-bottom))'
			: '0'}; padding-bottom: {offsetNav
			? '0.75rem'
			: 'calc(0.75rem + env(safe-area-inset-bottom))'}; background: {descanso.vencido
			? `linear-gradient(0deg, rgb(${descanso.glow} / 0.22), rgb(${descanso.glow} / 0.10)), color-mix(in oklab, var(--surface) 94%, transparent)`
			: 'color-mix(in oklab, var(--surface) 94%, transparent)'}; backdrop-filter: blur(10px)"
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
			<!-- Vencido: queda hasta que se atienda; el excedido dice cuánto te pasaste. -->
			<span class="text-base font-extrabold" style="color: rgb({descanso.glow})" aria-live="polite"
				>⏰ ¡A la serie!</span
			>
			<span class="text-2xl font-extrabold tabular-nums" style="color: rgb({descanso.glow})"
				>+{mmss(descanso.vencidoSeg)}</span
			>
			<button
				onclick={() => descanso.atender()}
				class="min-h-10 rounded-full px-5 text-sm font-bold"
				style="background: rgb({descanso.glow}); color: white">✓ Listo</button
			>
		{/if}
	</div>
{/if}

<style>
	@keyframes rest-pulso {
		0%,
		100% {
			filter: brightness(1);
		}
		50% {
			filter: brightness(1.35);
		}
	}
	.rest-vencido {
		animation: rest-pulso 1.1s ease-in-out infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.rest-vencido {
			animation: none;
		}
	}
</style>
