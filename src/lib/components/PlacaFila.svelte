<script lang="ts">
	import { fechaCorta } from '$lib/formato';
	import { pieDePlaca, type Placa } from '$lib/placas';
	import Icono from './Icono.svelte';

	/**
	 * Una placa de tablero, en su estado.
	 *
	 * Es una fila de serie: los tres estados son los de `SetRow`. La que falta se insinúa
	 * en penumbra con su objetivo; la que está en curso va entera y con relieve, con el
	 * canto de color de `.gb-foco`; la ganada se contrae a la cifra y el tilde.
	 *
	 * El disco es un anillo de progreso, no un escudo: el mismo lenguaje que el aro del
	 * descanso. Ícono de trazo, cero emoji, como en toda la interfaz operativa.
	 */
	let {
		placa,
		/** Color de la familia, como terna rgb sin comas. Constancia es el verde de día terminado. */
		color = 'var(--exito)'
	}: { placa: Placa; color?: string } = $props();

	// r = 24 en un viewBox de 56: circunferencia 2π·24.
	const CIRCUNFERENCIA = 150.8;
	const avance = $derived(placa.objetivo > 0 ? placa.progreso / placa.objetivo : 0);
	const dashOffset = $derived(CIRCUNFERENCIA * (1 - Math.min(1, avance)));
	const pie = $derived(pieDePlaca(placa, (f) => fechaCorta(f, true)));
	const porcentaje = $derived(Math.round(avance * 100));
</script>

<div
	class="relative grid min-h-14 items-center gap-3 rounded-2xl px-3.5 py-2.5 {placa.estado ===
	'en-curso'
		? 'gb-foco'
		: placa.estado === 'ganada'
			? 'gb-relieve-suave'
			: ''}"
	style="grid-template-columns: 3.5rem 1fr auto; --foco-color: {color}; {placa.estado === 'ganada'
		? 'background: var(--surface-3)'
		: placa.estado === 'falta'
			? 'background: var(--surface-2); color: var(--muted)'
			: ''}"
	role="listitem"
	aria-label="{placa.nombre}: {pie}"
>
	<div class="relative grid size-14 place-items-center">
		<svg class="absolute inset-0 -rotate-90" viewBox="0 0 56 56" aria-hidden="true">
			<circle
				cx="28"
				cy="28"
				r="24"
				fill="none"
				stroke={placa.estado === 'ganada' ? `rgb(${color} / .28)` : 'rgba(255,255,255,.08)'}
				stroke-width="4"
			/>
			{#if placa.estado === 'en-curso' && placa.progreso > 0}
				<circle
					cx="28"
					cy="28"
					r="24"
					fill="none"
					stroke="rgb({color})"
					stroke-width="4"
					stroke-linecap="round"
					stroke-dasharray={CIRCUNFERENCIA}
					stroke-dashoffset={dashOffset}
				/>
			{/if}
		</svg>
		{#if placa.estado === 'ganada'}
			<span class="relative" style="color: rgb({color})"><Icono nombre="hecha" tamano={22} /></span>
		{:else}
			<span
				class="cifra relative text-[0.95rem]"
				style={placa.estado === 'en-curso' ? `color: rgb(${color})` : 'color: var(--muted)'}
				>{placa.estado === 'en-curso' ? placa.progreso : placa.objetivo}</span
			>
		{/if}
	</div>
	<div class="flex min-w-0 flex-col gap-0.5">
		<span class="text-[0.95rem] font-bold">{placa.nombre}</span>
		<span class="text-xs" style="color: var(--muted)">{pie}</span>
	</div>
	<div class="text-right whitespace-nowrap">
		{#if placa.estado === 'ganada'}
			<span class="text-[11px] font-bold tracking-[0.12em] uppercase" style="color: rgb({color})"
				>Ganada</span
			>
		{:else if placa.estado === 'en-curso'}
			<span class="cifra text-2xl" style="color: rgb({color})"
				>{porcentaje}<span class="cifra-u">%</span></span
			>
		{:else}
			<span class="text-[11px] font-bold tracking-[0.12em] uppercase" style="color: var(--muted)"
				>Falta</span
			>
		{/if}
	</div>
</div>
