<script module lang="ts">
	export interface SerieEditable {
		sesionId: string;
		exerciseId: string;
		setIndex: number;
		set: { peso?: number; reps?: number; esMax?: boolean; extraKg?: number };
		fecha?: string;
		/** Máquina con pila de placas: habilita MAX + kg extra. */
		maquinaPlacas: boolean;
	}
</script>

<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import type { MetricaPr } from '$lib/db';
	import { actualizarSetHistorial, borrarSetHistorial } from '$lib/sesion';
	import { dur } from '$lib/motion';
	import { formatoNumero, fechaCorta } from '$lib/formato';
	import Stepper from './Stepper.svelte';

	let {
		serie,
		glow,
		unidad,
		pasoPeso,
		metrica,
		onClose
	}: {
		serie: SerieEditable;
		glow: string;
		unidad: string;
		pasoPeso: number;
		metrica: MetricaPr;
		onClose: () => void;
	} = $props();

	// Copia local editable del valor inicial: nada se persiste hasta tocar "Guardar".
	// El sheet se monta por cada apertura, así que capturar el valor inicial es lo buscado.
	// svelte-ignore state_referenced_locally
	let peso = $state(serie.set.peso);
	// svelte-ignore state_referenced_locally
	let reps = $state(serie.set.reps);
	// svelte-ignore state_referenced_locally
	let esMax = $state(!!serie.set.esMax);
	// svelte-ignore state_referenced_locally
	let extraKg = $state(serie.set.extraKg);
	let confirmandoBorrado = $state(false);
	let ocupado = $state(false);
	let error = $state<string | null>(null);

	const NO_ENCONTRADA =
		'No se encontró esta serie: puede haberse editado en otra pestaña o restaurado un backup. Volvé atrás y abrila de nuevo.';

	/** Redondea a 1 decimal para evitar arrastre de flotantes con pasos de 2.5. */
	function redondear(n: number): number {
		return Math.round(n * 10) / 10;
	}

	function ajustarPeso(delta: number) {
		const siguiente = redondear(Math.max(0, (peso ?? 0) + delta));
		peso = siguiente === 0 ? undefined : siguiente;
	}

	function escribirPeso(el: HTMLInputElement) {
		const n = Number.parseFloat(el.value.replace(',', '.'));
		peso = Number.isFinite(n) && n > 0 ? redondear(n) : undefined;
		el.value = peso != null ? formatoNumero(peso) : '';
	}

	function ajustarReps(delta: number) {
		const siguiente = Math.max(0, (reps ?? 0) + delta);
		reps = siguiente === 0 ? undefined : siguiente;
	}

	function escribirReps(el: HTMLInputElement) {
		const n = Number.parseInt(el.value, 10);
		reps = Number.isFinite(n) && n > 0 ? n : undefined;
		el.value = reps != null ? String(reps) : '';
	}

	function ajustarExtra(delta: number) {
		const siguiente = redondear(Math.max(0, (extraKg ?? 0) + delta));
		extraKg = siguiente === 0 ? undefined : siguiente;
	}

	function escribirExtra(el: HTMLInputElement) {
		const n = Number.parseFloat(el.value.replace(',', '.'));
		extraKg = Number.isFinite(n) && n > 0 ? redondear(n) : undefined;
		el.value = extraKg != null ? formatoNumero(extraKg) : '';
	}

	/**
	 * Cerrar el sheet es decirle al usuario "guardado". Si la escritura no encontró la
	 * serie o falló, se queda abierto con el motivo: antes cerraba igual y el cambio
	 * se perdía en silencio.
	 */
	async function conResultado(accion: () => Promise<boolean>) {
		if (ocupado) return;
		ocupado = true;
		error = null;
		try {
			if (await accion()) onClose();
			else error = NO_ENCONTRADA;
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo guardar el cambio.';
		} finally {
			ocupado = false;
		}
	}

	function guardar() {
		// actualizarSetHistorial recalcula el prCelebrado de la sesión.
		return conResultado(() =>
			actualizarSetHistorial(
				serie.sesionId,
				serie.exerciseId,
				serie.setIndex,
				{
					peso,
					reps,
					esMax: esMax || undefined,
					extraKg: esMax ? extraKg : undefined
				},
				metrica
			)
		);
	}

	function borrar() {
		return conResultado(() =>
			borrarSetHistorial(serie.sesionId, serie.exerciseId, serie.setIndex, metrica)
		);
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<div class="fixed inset-0 z-[70]">
	<button
		transition:fade={{ duration: dur(140) }}
		onclick={onClose}
		class="absolute inset-0 w-full"
		style="background: rgb(var(--scrim) / .72)"
		aria-label="Cerrar sin guardar"
	></button>
	<div
		transition:fly={{ y: 220, duration: dur(220) }}
		role="dialog"
		aria-modal="true"
		aria-label="Editar serie histórica"
		class="absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-3xl border-t border-white/10 px-5 pt-3"
		style="background: var(--surface); padding-bottom: calc(1.25rem + env(safe-area-inset-bottom))"
	>
		<div class="mx-auto h-1 w-10 rounded-full bg-white/15"></div>
		<div class="mt-3 flex items-center justify-between gap-3">
			<p class="text-sm font-bold">Editar serie</p>
			{#if serie.fecha}
				<p class="text-xs font-semibold" style="color: var(--muted)">{fechaCorta(serie.fecha)}</p>
			{/if}
		</div>

		<div class="mt-3 grid grid-cols-2 gap-2">
			<div class="min-w-0">
				<p class="mb-1 text-[11px] font-bold uppercase tracking-wider" style="color: var(--muted)">
					Peso ({unidad})
				</p>
				<Stepper
					value={peso}
					format={formatoNumero}
					inputmode="decimal"
					step={pasoPeso}
					{glow}
					onStep={ajustarPeso}
					onCommit={escribirPeso}
					ariaDown={`Bajar ${pasoPeso} ${unidad}`}
					ariaUp={`Subir ${pasoPeso} ${unidad}`}
					ariaInput={`Peso de la serie en ${unidad}`}
				/>
			</div>
			<div class="min-w-0">
				<p class="mb-1 text-[11px] font-bold uppercase tracking-wider" style="color: var(--muted)">
					Reps
				</p>
				<Stepper
					value={reps}
					format={String}
					inputmode="numeric"
					step={1}
					{glow}
					onStep={ajustarReps}
					onCommit={escribirReps}
					ariaDown="Bajar reps"
					ariaUp="Subir reps"
					ariaInput="Reps de la serie"
				/>
			</div>
		</div>

		{#if serie.maquinaPlacas}
			<div class="mt-2 flex items-center gap-2">
				<button
					onclick={() => (esMax = !esMax)}
					class="flex h-10 shrink-0 touch-manipulation items-center rounded-full border px-3 text-[11px] font-bold"
					style={esMax
						? 'background: rgb(var(--max) / .22); color: rgb(var(--max)); border-color: rgb(var(--max) / .5)'
						: 'color: var(--muted); border-color: rgba(255,255,255,.16); border-style: dashed'}
					aria-pressed={esMax}>🔥 MAX</button
				>
				{#if esMax}
					<div class="min-w-0 flex-1">
						<Stepper
							value={extraKg}
							format={formatoNumero}
							inputmode="decimal"
							step={pasoPeso}
							glow="var(--max)"
							onStep={ajustarExtra}
							onCommit={escribirExtra}
							ariaDown={`Bajar ${pasoPeso} ${unidad} encima de la pila`}
							ariaUp={`Subir ${pasoPeso} ${unidad} encima de la pila`}
							ariaInput={`Kg encima de la pila en ${unidad}`}
						/>
					</div>
				{/if}
			</div>
		{/if}

		{#if error}
			<p
				class="mt-3 rounded-xl p-3 text-xs leading-relaxed"
				style="background: rgb(255 107 107 / .1); color: #ff6b6b"
				role="alert"
			>
				{error}
			</p>
		{/if}

		<button
			onclick={guardar}
			disabled={ocupado}
			class="mt-4 block w-full rounded-2xl py-3.5 text-center font-bold disabled:opacity-60"
			style="background: rgb({glow}); color: white"
			>{ocupado ? 'Guardando…' : 'Guardar cambios'}</button
		>

		{#if confirmandoBorrado}
			<!-- Confirmación inline: nada de confirm() nativo. -->
			<div
				class="mt-2 flex items-center gap-2 rounded-2xl p-2"
				style="background: rgb(255 107 107 / .1)"
			>
				<p class="flex-1 px-1 text-xs font-semibold" style="color: #ff6b6b">
					¿Borrar esta serie del historial?
				</p>
				<button
					onclick={() => (confirmandoBorrado = false)}
					class="rounded-xl px-3 py-2 text-xs font-bold"
					style="background: rgba(255,255,255,.06); color: var(--muted)">Cancelar</button
				>
				<button
					onclick={borrar}
					disabled={ocupado}
					class="rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-60"
					style="background: #ff6b6b; color: white">Borrar</button
				>
			</div>
		{:else}
			<button
				onclick={() => (confirmandoBorrado = true)}
				class="mt-2 block w-full rounded-2xl border border-white/10 py-3 text-center text-sm font-semibold"
				style="color: #ff6b6b">🗑 Borrar serie</button
			>
		{/if}
	</div>
</div>
