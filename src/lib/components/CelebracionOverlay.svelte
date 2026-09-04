<script lang="ts">
	import { fly } from 'svelte/transition';
	import type { PrGanado } from '$lib/sesion';
	import { dur } from '$lib/motion';
	import { formatoNumero, formatoSet } from '$lib/formato';
	import CelebracionParticulas from './CelebracionParticulas.svelte';

	let {
		exito,
		prExito,
		glow,
		unidad,
		metricaLabel,
		hechas,
		total,
		onClose
	}: {
		exito: 'normal' | 'pr' | 'parcial';
		prExito: PrGanado | null;
		glow: string;
		/** Unidad del valor del PR: kg/lb, o "reps" en ejercicios sin peso. */
		unidad: string;
		metricaLabel: string;
		hechas: number;
		total: number;
		/** Salir ya, sin esperar la fanfarria: celebrar no puede ser encerrar. */
		onClose: () => void;
	} = $props();
</script>

<!-- Celebratorio pero no carcelero: un toque en cualquier lado sigue de largo. -->
<button
	onclick={onClose}
	aria-label="Continuar"
	class="gb-no-press fixed inset-0 z-[60] grid w-full cursor-default place-items-center px-8"
	style="background: {exito === 'parcial'
		? 'rgb(var(--scrim) / .82)'
		: `radial-gradient(70% 50% at 50% 42%, rgb(${glow} / .26), transparent 72%), rgb(var(--scrim) / .82)`}; backdrop-filter: blur(8px)"
>
	<div
		transition:fly={{ y: 18, duration: dur(260) }}
		class="text-center"
		aria-live="polite"
		aria-label={exito === 'pr'
			? 'Nuevo PR'
			: exito === 'parcial'
				? 'Series guardadas'
				: 'Ejercicio terminado'}
	>
		<div class="relative mx-auto grid size-24 place-items-center">
			{#if exito === 'pr'}
				<div class="gb-shockwave" style="--shock-color: {glow}"></div>
				<CelebracionParticulas color={glow} cantidad={14} />
			{/if}
			<div
				class="relative grid size-24 place-items-center rounded-full border border-white/15 text-5xl font-extrabold"
				style={exito === 'parcial'
					? 'background: rgba(255,255,255,.08); color: var(--muted)'
					: `background: rgb(${glow} / .22); color: rgb(${glow}); box-shadow: 0 0 55px rgb(${glow} / .25)`}
			>
				{exito === 'pr' ? '🏆' : '✓'}
			</div>
		</div>
		<p class="mt-5 text-2xl font-extrabold">
			{exito === 'pr'
				? '¡Nuevo PR!'
				: exito === 'parcial'
					? 'Series guardadas'
					: 'Ejercicio terminado'}
		</p>
		{#if exito === 'pr' && prExito}
			<p class="mt-2 text-4xl font-extrabold tabular-nums">
				{formatoNumero(prExito.valor)}<span
					class="ml-1 text-xl font-semibold"
					style="color: var(--muted)"
				>
					{unidad}</span
				>
			</p>
			<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
				{metricaLabel} · mejor set {formatoSet(prExito, unidad)}
			</p>
			<!-- El récord que acabás de romper; ausente en el primero y en los PR viejos. -->
			{#if prExito.previo}
				<p class="mt-1.5 text-sm font-semibold tabular-nums" style="color: rgb({glow} / .85)">
					Venías de {formatoNumero(prExito.previo.valor)}
					{unidad}
				</p>
			{/if}
		{:else if exito === 'parcial'}
			<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
				{hechas}/{total}
				{total === 1 ? 'serie' : 'series'} guardadas
			</p>
		{/if}
		<p class="mt-5 text-[11px] font-semibold" style="color: var(--muted)">Tocá para continuar</p>
	</div>
</button>
