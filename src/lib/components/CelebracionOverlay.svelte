<script lang="ts">
	import { fly } from 'svelte/transition';
	import type { MejorSet } from '$lib/sesion';
	import { dur } from '$lib/motion';
	import { formatoNumero, formatoSet } from '$lib/formato';

	let {
		exito,
		prExito,
		glow,
		unidad,
		metricaLabel,
		hechas,
		total
	}: {
		exito: 'normal' | 'pr' | 'parcial';
		prExito: MejorSet | null;
		glow: string;
		/** Unidad del valor del PR: kg/lb, o "reps" en ejercicios sin peso. */
		unidad: string;
		metricaLabel: string;
		hechas: number;
		total: number;
	} = $props();
</script>

<div
	class="fixed inset-0 z-[60] grid place-items-center px-8"
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
		<div
			class="mx-auto grid size-24 place-items-center rounded-full border border-white/15 text-5xl font-extrabold"
			style={exito === 'parcial'
				? 'background: rgba(255,255,255,.08); color: var(--muted)'
				: `background: rgb(${glow} / .22); color: rgb(${glow}); box-shadow: 0 0 55px rgb(${glow} / .25)`}
		>
			{exito === 'pr' ? '🏆' : '✓'}
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
				{formatoNumero(prExito.valor)}<span class="text-xl font-semibold" style="color: var(--muted)">
					{unidad}</span
				>
			</p>
			<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
				{metricaLabel} · mejor set {formatoSet(prExito, unidad)}
			</p>
		{:else if exito === 'parcial'}
			<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
				{hechas}/{total} series · volviendo al día…
			</p>
		{:else}
			<p class="mt-1 text-sm font-medium" style="color: var(--muted)">Volviendo al día…</p>
		{/if}
	</div>
</div>
