<script lang="ts">
	import Icono from './Icono.svelte';
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

	function expandir() {
		descanso.expandirFocus();
	}
</script>

{#if descanso.restoSeg > 0 || descanso.vencido}
	<!-- Contenedor no interactivo: antes era un role="button" con botones adentro, que
	     para un lector de pantalla es un botón dentro de otro. -->
	<div
		transition:fly={{ y: 80, duration: dur(220) }}
		class="rest-bar fixed inset-x-0 z-50 mx-auto flex max-w-md items-center justify-between gap-3 border-t border-white/10 px-5 pt-3 {descanso.vencido
			? 'rest-vencido'
			: ''}"
		style="bottom: {offsetNav ? 'calc(64px + var(--safe-bottom))' : '0'}; padding-bottom: {offsetNav
			? '0.75rem'
			: 'calc(0.75rem + var(--safe-bottom))'}; background: {descanso.vencido
			? `linear-gradient(0deg, rgb(${descanso.glow} / 0.22), rgb(${descanso.glow} / 0.10)), color-mix(in oklab, var(--surface) 94%, transparent)`
			: 'color-mix(in oklab, var(--surface) 94%, transparent)'}; backdrop-filter: blur(10px)"
	>
		{#if descanso.restoSeg > 0}
			<button
				onclick={expandir}
				class="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
				aria-label="Abrir descanso en pantalla completa"
			>
				<span class="min-w-0 flex-1">
					<span class="flex items-center gap-1.5 text-sm font-semibold" style="color: var(--muted)">
						<Icono nombre="descanso" tamano={15} /> Descanso
					</span>
					{#if descanso.siguiente}
						<span class="block truncate text-[11px] font-medium" style="color: var(--muted)">
							Sig: {descanso.siguiente}
						</span>
					{/if}
				</span>
				<span class="cifra text-[2.6rem]" style="color: rgb({descanso.glow})"
					>{mmss(descanso.restoSeg)}</span
				>
			</button>
			<button
				onclick={() => descanso.saltar()}
				class="min-h-11 shrink-0 rounded-full px-5 text-sm font-semibold"
				style="background: rgba(255,255,255,.12)">Saltar</button
			>
		{:else}
			<!-- Vencido: queda hasta que se atienda; el excedido dice cuánto te pasaste. -->
			<button
				onclick={expandir}
				class="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
				aria-label="Abrir descanso en pantalla completa"
			>
				<span class="min-w-0 flex-1" aria-live="polite">
					<span
						class="flex items-center gap-1.5 text-base font-extrabold"
						style="color: rgb({descanso.glow})"
					>
						<Icono nombre="aviso" tamano={15} /> ¡A la serie!
					</span>
					{#if descanso.siguiente}
						<span class="block truncate text-[11px] font-medium" style="color: var(--muted)">
							{descanso.siguiente}
						</span>
					{/if}
				</span>
				<span class="cifra text-[2.2rem]" style="color: rgb({descanso.glow})"
					>+{mmss(descanso.vencidoSeg)}</span
				>
			</button>
			<button
				onclick={() => descanso.atender()}
				class="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-5 text-sm font-bold"
				style="background: rgb({descanso.glow}); color: var(--on-bright)"
			>
				<Icono nombre="hecha" tamano={16} /> Listo
			</button>
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

	@media (orientation: landscape) and (max-height: 520px) {
		.rest-bar {
			max-width: min(100vw, 64rem);
			padding-top: 0.6rem !important;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rest-vencido {
			animation: none;
		}
	}
</style>
