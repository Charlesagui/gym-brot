<script lang="ts">
	import { onDestroy } from 'svelte';
	import { pulsar } from '$lib/pulsar';
	import { DUR_FAST } from '$lib/motion';
	import { vibrar } from '$lib/vibracion';

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
		unidad,
		barrido = false,
		vibracion = true
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
		/**
		 * Habilita barrer la cifra con el dedo para moverla de a pasos.
		 *
		 * Apagado por defecto, y a propósito. En el peso de una serie un solo toque le
		 * gana a cualquier gesto: el peso que buscás ya está en pantalla, prellenado
		 * desde la vez anterior. Donde sí gana el barrido es donde no hay nada
		 * prellenado y el objetivo se explora — la calculadora de discos, donde ir de
		 * 60 a 100 kg son dieciséis toques del +.
		 *
		 * No reemplaza nada: el ±, el teclado y el foco siguen funcionando igual, y el
		 * barrido no es alcanzable por teclado porque no hace falta que lo sea.
		 */
		barrido?: boolean;
		/** Solo aplica al barrido: un tic háptico por paso, como la rueda. */
		vibracion?: boolean;
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

	/*
	 * Barrer la cifra.
	 *
	 * Cuánto hay que arrastrar para mover un paso. 12 px es lo que hace que el gesto se
	 * sienta enganchado al dedo sin que un temblor mueva el número: barrer la pantalla
	 * entera de un teléfono son unos 30 pasos.
	 */
	const PIXELES_POR_PASO = 12;
	/**
	 * Hasta acá el gesto todavía puede ser un toque. Recién pasado el umbral se captura
	 * el puntero y se cancela el foco: si no, tocar el campo para escribir movería el
	 * peso un paso antes de abrir el teclado.
	 */
	const UMBRAL = 6;

	let arrastrando = $state(false);
	let desplazamiento = $state(0);
	let origenX: number | null = null;
	let recorrido = 0;
	let sobra = 0;
	let arrastro = false;

	function alApretarCifra(evento: PointerEvent) {
		if (!barrido) return;
		if (evento.pointerType === 'mouse' && evento.button !== 0) return;
		origenX = evento.clientX;
		recorrido = 0;
		sobra = 0;
		arrastro = false;
	}

	function alBarrer(evento: PointerEvent) {
		if (!barrido || origenX === null) return;
		recorrido = evento.clientX - origenX;

		if (!arrastro) {
			if (Math.abs(recorrido) < UMBRAL) return;
			arrastro = true;
			arrastrando = true;
			// Con el teclado abierto el barrido no se ve: el campo tapa media pantalla.
			campo?.blur();
			campo?.setPointerCapture(evento.pointerId);
		}

		// `touch-action: pan-y` deja pasar el scroll vertical y nos cede el horizontal.
		evento.preventDefault();
		sobra = recorrido;
		desplazamiento = ((recorrido % PIXELES_POR_PASO) + PIXELES_POR_PASO) % PIXELES_POR_PASO;

		while (Math.abs(sobra) >= PIXELES_POR_PASO) {
			const signo = sobra > 0 ? 1 : -1;
			onStep(signo * step);
			vibrar(6, vibracion);
			sobra -= signo * PIXELES_POR_PASO;
			origenX += signo * PIXELES_POR_PASO;
		}
	}

	function alSoltarCifra(evento: PointerEvent) {
		if (!barrido) return;
		if (campo?.hasPointerCapture(evento.pointerId)) campo.releasePointerCapture(evento.pointerId);
		origenX = null;
		arrastrando = false;
		desplazamiento = 0;
	}

	/** Tras un barrido el navegador emite un click: sin esto, enfocaría y abriría el teclado. */
	function alClickCifra(evento: MouseEvent) {
		if (!arrastro) return;
		arrastro = false;
		evento.preventDefault();
		evento.stopImmediatePropagation();
	}

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
	<div class="relative flex min-w-0 flex-1 flex-col justify-center">
		<input
			bind:this={campo}
			type="text"
			{inputmode}
			value={value != null ? format(value) : ''}
			placeholder="—"
			onfocus={(e) => e.currentTarget.select()}
			onchange={(e) => onCommit(e.currentTarget)}
			onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
			onpointerdown={alApretarCifra}
			onpointermove={alBarrer}
			onpointerup={alSoltarCifra}
			onpointercancel={alSoltarCifra}
			onclick={alClickCifra}
			class="w-full min-w-0 rounded-lg bg-white/[0.035] px-1 text-center outline-none focus:bg-white/[0.08] {grande
				? 'cifra min-h-12 text-[2.35rem]'
				: 'min-h-11 text-base font-bold tabular-nums'} {barrido ? 'gb-barrible' : ''}"
			aria-label={ariaInput}
		/>
		{#if grande && unidad}
			<span
				class="pointer-events-none pb-0.5 text-center text-[0.6rem] font-bold uppercase tracking-[0.14em]"
				style="color: var(--muted); opacity: {arrastrando ? 0 : 1}"
				aria-hidden="true">{unidad}</span
			>
		{/if}
		{#if barrido}
			<!--
				La cinta: aparece solo mientras barrés y ocupa el lugar de la unidad, así que
				no mueve nada de sitio. Las marcas corren con el dedo y la del centro se queda
				fija, que es la que dice dónde estás parado.
			-->
			<div
				class="gb-cinta pointer-events-none absolute inset-x-0 bottom-0"
				style="opacity: {arrastrando ? 1 : 0}; --gb-cinta-off: {desplazamiento}px"
				aria-hidden="true"
			>
				<span class="gb-cinta-marca"></span>
			</div>
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

<style>
	/*
	 * `pan-y` y no `none`: el navegador se queda con el scroll vertical —la página
	 * sigue scrolleando con el dedo encima del número— y nos cede el horizontal, que
	 * es el único eje que usa el barrido. Con `none` la cifra sería un agujero donde
	 * la página no scrollea.
	 */
	.gb-barrible {
		touch-action: pan-y;
	}

	.gb-cinta {
		height: 10px;
		transition: opacity var(--dur-fast) var(--ease-out);
		/* Marcas cada 12 px: un paso del stepper es una marca. */
		background: repeating-linear-gradient(
			to right,
			rgb(255 255 255 / 0.28) 0 1px,
			transparent 1px 12px
		);
		background-position-x: var(--gb-cinta-off);
		mask-image: linear-gradient(to right, transparent, #000 22%, #000 78%, transparent);
	}

	/* La marca del centro no corre: es contra ella que se mide el desplazamiento. */
	.gb-cinta-marca {
		position: absolute;
		left: 50%;
		top: 0;
		bottom: 0;
		width: 2px;
		margin-left: -1px;
		border-radius: 1px;
		background: var(--accent-text);
	}
</style>
