<script lang="ts">
	import { untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { dur } from '$lib/motion';
	import { modal } from '$lib/modal';
	import RuedaTiempo from './RuedaTiempo.svelte';
	import {
		RUEDA_DESCANSO,
		descansoEnSegundos,
		etiquetaDescanso,
		relojDescanso,
		segundosAMinutos
	} from '$lib/descanso-preset';

	/**
	 * Elegir cuánto dura el descanso de un ejercicio, sin gastar la pantalla de entrenar.
	 *
	 * La fila del ejercicio ya no tiene ocho botones: tiene un interruptor y este valor.
	 * Los cuatro atajos redondos se fueron con ellos porque la rueda los cubre a todos en
	 * el mismo gesto, y porque el lugar natural para decidir cuánto descansar es mientras
	 * descansás (ahí la misma rueda vive en el descanso a pantalla completa).
	 */
	let {
		minutos,
		glow,
		vibracion = true,
		tieneValorPropio,
		generalMinutos,
		generalActivo,
		onElegir,
		onSeguirGeneral,
		onCerrar
	}: {
		/** Duración efectiva de hoy en este ejercicio, en minutos. */
		minutos: number;
		glow: string;
		vibracion?: boolean;
		/** El ejercicio tiene un descanso propio: se puede ofrecer volver al general. */
		tieneValorPropio: boolean;
		generalMinutos: number;
		generalActivo: boolean;
		/** El gesto terminó: acá y sólo acá se guarda. */
		onElegir: (minutos: number) => void;
		onSeguirGeneral: () => void;
		onCerrar: () => void;
	} = $props();

	/**
	 * Espejo local: girar es explorar y no puede escribir en la base a cada detent.
	 *
	 * Se siembra una sola vez a propósito (`untrack`). La hoja se monta de cero cada vez
	 * que se abre, así que el valor inicial siempre es el vigente; seguir a la prop haría
	 * que el guardado que dispara la propia rueda le devolviera el número al dedo.
	 */
	let segundos = $state(untrack(() => descansoEnSegundos(minutos)));
</script>

<div
	use:modal={{ onClose: onCerrar, focoInicial: '[data-modal-inicial]' }}
	class="fixed inset-0 z-[80]"
>
	<button
		transition:fade={{ duration: dur(140) }}
		onclick={onCerrar}
		class="gb-no-press absolute inset-0 w-full"
		style="background: rgb(var(--scrim) / .72)"
		aria-label="Cerrar"
		tabindex="-1"
	></button>
	<div
		transition:fly={{ y: 220, duration: dur(220) }}
		role="dialog"
		aria-modal="true"
		aria-label="Descanso de este ejercicio"
		class="absolute inset-x-0 bottom-0 mx-auto max-h-[calc(100dvh-1rem)] max-w-md overflow-y-auto rounded-t-3xl border-t border-white/10 px-5 pt-3 shadow-2xl"
		style="background: var(--surface); padding-bottom: calc(1.25rem + var(--safe-bottom))"
	>
		<div class="mx-auto h-1 w-10 rounded-full bg-white/15"></div>
		<p class="mt-4 text-lg font-extrabold leading-tight">Descanso de este ejercicio</p>
		<p class="mt-1 text-sm leading-relaxed" style="color: var(--muted)">
			Girá la rueda. Vale sólo para este ejercicio y se recuerda para las próximas veces.
		</p>

		<div class="mt-5 flex flex-col items-center gap-3">
			<RuedaTiempo
				{segundos}
				min={RUEDA_DESCANSO.min}
				max={RUEDA_DESCANSO.max}
				paso={RUEDA_DESCANSO.paso}
				{glow}
				{vibracion}
				etiqueta="Duración del descanso de este ejercicio"
				onCambio={(valor) => (segundos = valor)}
				onFin={(valor) => onElegir(segundosAMinutos(valor))}
			/>
		</div>

		{#if tieneValorPropio}
			<!--
				"Auto" dejó de ser un botón de la pantalla de entrenar, pero la posibilidad no
				se pierde: seguir el descanso general es lo que hace un ejercicio hasta que le
				elegís uno propio, y tiene que haber forma de volver.
			-->
			<button
				onclick={onSeguirGeneral}
				class="mt-4 min-h-11 w-full rounded-xl text-xs font-bold"
				style="background: rgba(255,255,255,.05); color: var(--muted)"
				aria-label={generalActivo
					? `Seguir el descanso general, de ${etiquetaDescanso(generalMinutos)}`
					: 'Seguir el descanso general, que está apagado'}
				>Seguir el general · {generalActivo ? relojDescanso(generalMinutos) : 'apagado'}</button
			>
		{/if}

		<button
			data-modal-inicial
			onclick={onCerrar}
			class="mt-2 min-h-12 w-full rounded-2xl px-4 text-sm font-bold"
			style="background: var(--accent); color: var(--on-accent)">Listo</button
		>
	</div>
</div>
