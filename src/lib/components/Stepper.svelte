<script lang="ts">
	import { onDestroy } from 'svelte';
	import { pulsar } from '$lib/pulsar';
	import { DUR_FAST } from '$lib/motion';

	// Control reutilizable −/input/+ (peso y reps). El − es neutro; el + se tiñe con el glow.
	let {
		value,
		format,
		inputmode,
		step,
		glow,
		onStep,
		onCommit,
		ariaDown,
		ariaUp,
		ariaInput,
		grande = false,
		unidad
	}: {
		value: number | undefined;
		format: (n: number) => string;
		inputmode: 'decimal' | 'numeric';
		step: number;
		glow: string;
		onStep: (delta: number) => void;
		onCommit: (el: HTMLInputElement) => void;
		ariaDown: string;
		ariaUp: string;
		ariaInput: string;
		/**
		 * Versión de la serie en curso: botones de 56 px y la cifra en grande. El resto
		 * de la app (editar una serie del historial) sigue con la compacta, que convive
		 * con otros controles y no es lo que estás tocando entre repeticiones.
		 */
		grande?: boolean;
		/** Unidad debajo de la cifra, solo en la versión grande ("kg", "reps"). */
		unidad?: string;
	} = $props();

	let campo: HTMLInputElement | undefined;
	let ticId: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Acuse del valor, no del botón: el ± ya se hunde al tocarlo, pero lo que
	 * importa confirmar es que el número efectivamente se movió. Va acá y no en
	 * un `$effect` sobre `value` para no dispararse mientras se tipea el peso.
	 */
	function paso(delta: number) {
		onStep(delta);
		if (!campo) return;
		campo.classList.remove('gb-tick');
		void campo.offsetWidth; // reflow: permite re-disparar en toques seguidos
		campo.classList.add('gb-tick');
		if (ticId) clearTimeout(ticId);
		ticId = setTimeout(() => campo?.classList.remove('gb-tick'), DUR_FAST);
	}

	onDestroy(() => {
		if (ticId) clearTimeout(ticId);
	});

	/**
	 * El valor se confirma con `change` (blur o Enter). Si la app se va a background
	 * con el teclado abierto, ese evento no llega y el peso recién tipeado se pierde:
	 * al ocultarse la página forzamos el blur, que dispara el commit.
	 */
	function commitSiEstaEditando() {
		if (document.visibilityState !== 'hidden') return;
		if (document.activeElement === campo) campo?.blur();
	}
</script>

<svelte:document onvisibilitychange={commitSiEstaEditando} />

<div class="flex items-stretch rounded-xl bg-white/5 p-1 {grande ? 'min-h-[4.5rem]' : 'min-h-12'}">
	<button
		use:pulsar={() => paso(-step)}
		class="grid shrink-0 touch-manipulation select-none place-items-center rounded-lg font-bold {grande
			? 'min-h-16 w-14 text-3xl'
			: 'min-h-11 w-11 text-lg'}"
		style="background: rgba(255,255,255,.06); color: var(--muted)"
		aria-label={ariaDown}>−</button
	>
	<div class="flex min-w-0 flex-1 flex-col justify-center">
		<input
			bind:this={campo}
			type="text"
			{inputmode}
			value={value != null ? format(value) : ''}
			placeholder="—"
			onfocus={(e) => e.currentTarget.select()}
			onchange={(e) => onCommit(e.currentTarget)}
			onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
			class="w-full min-w-0 rounded-lg bg-white/[0.035] px-1 text-center outline-none focus:bg-white/[0.08] {grande
				? 'cifra min-h-12 text-[2.35rem]'
				: 'min-h-11 text-base font-bold tabular-nums'}"
			aria-label={ariaInput}
		/>
		{#if grande && unidad}
			<span
				class="pointer-events-none pb-0.5 text-center text-[0.6rem] font-bold uppercase tracking-[0.14em]"
				style="color: var(--muted)"
				aria-hidden="true">{unidad}</span
			>
		{/if}
	</div>
	<button
		use:pulsar={() => paso(step)}
		class="grid shrink-0 touch-manipulation select-none place-items-center rounded-lg font-bold {grande
			? 'min-h-16 w-14 text-3xl'
			: 'min-h-11 w-11 text-lg'}"
		style="background: rgb({glow} / .18); color: rgb({glow})"
		aria-label={ariaUp}>+</button
	>
</div>
