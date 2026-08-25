<script lang="ts">
	import type { SetSesion, Ajustes, ModoEsfuerzo } from '$lib/db';
	import { pulsar } from '$lib/pulsar';
	import { formatoNumero, formatoAnterior } from '$lib/formato';
	import Stepper from './Stepper.svelte';
	import { etiquetaEsfuerzo, rpeARir } from '$lib/esfuerzo';

	let {
		set,
		index,
		anterior,
		maquinaPlacas,
		glow,
		unidad,
		pasoPeso,
		pendiente = false,
		flash = false,
		modoEsfuerzo = 'off',
		onToggle,
		onToggleMax,
		onAjustarPeso,
		onEscribirPeso,
		onAjustarReps,
		onEscribirReps,
		onAjustarExtra,
		onSetRir
	}: {
		set: SetSesion;
		index: number;
		anterior: SetSesion | undefined;
		maquinaPlacas: boolean;
		glow: string;
		unidad: Ajustes['unidad'];
		pasoPeso: number;
		pendiente?: boolean;
		/** Breve acuse visual tras confirmar el guardado (no se usa al desmarcar). */
		flash?: boolean;
		modoEsfuerzo?: ModoEsfuerzo;
		onToggle: () => void;
		onToggleMax: () => void;
		onAjustarPeso: (delta: number) => void;
		onEscribirPeso: (el: HTMLInputElement) => void;
		onAjustarReps: (delta: number) => void;
		onEscribirReps: (el: HTMLInputElement) => void;
		onAjustarExtra: (delta: number) => void;
		onSetRir: (rir?: number) => void;
	} = $props();

	const ant = $derived(formatoAnterior(anterior, unidad));
	let mostrarEsfuerzo = $state(false);
	const escala = $derived(modoEsfuerzo === 'rpe' ? 'rpe' : 'rir');
	const opciones = $derived(
		Array.from({ length: 11 }, (_, indice) => (escala === 'rir' ? indice / 2 : 10 - indice / 2))
	);

	function cambiarEsfuerzo(valor: string) {
		if (!valor) {
			onSetRir(undefined);
			return;
		}
		const numero = Number(valor);
		onSetRir(escala === 'rir' ? numero : rpeARir(numero));
	}
</script>

<div
	class="gb-set-row rounded-xl p-2.5 {flash ? 'gb-row-flash' : ''}"
	style="background: var(--surface-2); --row-glow: {glow}"
>
	<div class="gb-set-row-head flex items-center gap-2">
		<span
			class="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 text-sm font-bold"
			style="color: var(--muted)">{index + 1}</span
		>
		{#if maquinaPlacas}
			<button
				onclick={onToggleMax}
				class="flex min-h-11 shrink-0 touch-manipulation items-center rounded-full border px-3 text-[11px] font-bold"
				style={set.esMax
					? 'background: rgb(var(--max) / .22); color: rgb(var(--max)); border-color: rgb(var(--max) / .5)'
					: 'color: var(--muted); border-color: rgba(255,255,255,.16); border-style: dashed'}
				aria-pressed={set.esMax}
				aria-label={`Serie ${index + 1}: tope de la pila de placas`}>🔥 MAX</button
			>
		{/if}
		<p class="min-w-0 flex-1 truncate text-[11px] font-medium" style="color: var(--muted)">
			{ant ? `Ant: ${ant}` : ''}
		</p>
		<button
			onclick={onToggle}
			disabled={pendiente}
			class="relative grid size-12 shrink-0 touch-manipulation place-items-center rounded-full border-2 text-base font-bold {flash
				? 'gb-pop'
				: ''}"
			style={set.hecha
				? 'background: var(--accent); border-color: var(--accent); color: var(--on-accent)'
				: 'border-color: rgba(255,255,255,.22); color: transparent'}
			aria-pressed={set.hecha}
			aria-busy={pendiente}
			aria-label={`${set.hecha ? 'Desmarcar' : 'Marcar'} serie ${index + 1}`}
		>
			{#if pendiente}
				<span class="gb-set-spinner" aria-hidden="true"></span>
			{:else}
				✓
			{/if}
		</button>
	</div>
	<div class="gb-set-grid mt-2 grid grid-cols-2 gap-2">
		<div class="min-w-0">
			<p class="mb-1 text-[11px] font-bold uppercase tracking-wider" style="color: var(--muted)">
				Peso ({unidad})
			</p>
			<Stepper
				value={set.peso}
				format={formatoNumero}
				inputmode="decimal"
				step={pasoPeso}
				{glow}
				onStep={onAjustarPeso}
				onCommit={onEscribirPeso}
				ariaDown={`Bajar ${pasoPeso} ${unidad} en serie ${index + 1}`}
				ariaUp={`Subir ${pasoPeso} ${unidad} en serie ${index + 1}`}
				ariaInput={`Peso de la serie ${index + 1} en ${unidad}`}
			/>
		</div>
		<div class="min-w-0">
			<p class="mb-1 text-[11px] font-bold uppercase tracking-wider" style="color: var(--muted)">
				Reps
			</p>
			<Stepper
				value={set.reps}
				format={String}
				inputmode="numeric"
				step={1}
				{glow}
				onStep={onAjustarReps}
				onCommit={onEscribirReps}
				ariaDown={`Bajar reps en serie ${index + 1}`}
				ariaUp={`Subir reps en serie ${index + 1}`}
				ariaInput={`Reps de la serie ${index + 1}`}
			/>
		</div>
	</div>
	{#if set.esMax}
		<div
			class="mt-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1"
			style="background: rgb(var(--max) / .1)"
		>
			<span class="text-[11px] font-bold uppercase tracking-wider" style="color: rgb(var(--max))">
				🔥 Encima de la pila
			</span>
			<div class="flex items-center gap-1.5">
				<button
					use:pulsar={() => onAjustarExtra(-pasoPeso)}
					class="grid size-11 touch-manipulation select-none place-items-center rounded-lg text-sm font-bold"
					style="background: rgba(255,255,255,.06); color: var(--muted)"
					aria-label={`Bajar ${pasoPeso} ${unidad} encima en serie ${index + 1}`}>−</button
				>
				<span
					class="min-w-12 text-center text-xs font-bold tabular-nums"
					style="color: rgb(var(--max))"
				>
					{set.extraKg ? `+${formatoNumero(set.extraKg)} ${unidad}` : '—'}
				</span>
				<button
					use:pulsar={() => onAjustarExtra(pasoPeso)}
					class="grid size-11 touch-manipulation select-none place-items-center rounded-lg text-sm font-bold"
					style="background: rgb(var(--max) / .18); color: rgb(var(--max))"
					aria-label={`Subir ${pasoPeso} ${unidad} encima en serie ${index + 1}`}>+</button
				>
			</div>
		</div>
	{/if}
	{#if modoEsfuerzo !== 'off'}
		{#if set.rir == null && !mostrarEsfuerzo}
			<button
				type="button"
				onclick={() => (mostrarEsfuerzo = true)}
				class="mt-2 min-h-11 rounded-full px-3 text-xs font-bold"
				style="color: var(--accent-text); background: rgba(255,255,255,.04)"
				>+ {escala.toUpperCase()}</button
			>
		{:else}
			<div
				class="mt-2 flex min-h-11 items-center gap-2 rounded-xl px-2"
				style="background: rgba(255,255,255,.035)"
			>
				<label class="min-w-0 flex-1 text-xs font-bold" style="color: var(--muted)">
					Esfuerzo
					<select
						value={set.rir == null ? '' : escala === 'rir' ? set.rir : 10 - set.rir}
						onchange={(evento) => cambiarEsfuerzo(evento.currentTarget.value)}
						class="ml-2 min-h-11 rounded-lg bg-white/[0.06] px-3 font-bold"
						aria-label={`${escala.toUpperCase()} de la serie ${index + 1}`}
					>
						<option value="">Sin registrar</option>
						{#each opciones as opcion (opcion)}<option value={opcion}
								>{escala.toUpperCase()} {opcion}</option
							>{/each}
					</select>
				</label>
				{#if set.rir != null}<span
						class="shrink-0 text-xs font-semibold"
						style="color: var(--accent-text)">{etiquetaEsfuerzo(set.rir, escala)}</span
					>{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	/*
	 * Los steppers conservan blancos tactiles grandes. Si la tarjeta no puede darles
	 * espacio suficiente, Peso y Reps se apilan en vez de recortar el valor central.
	 * La consulta al contenedor tambien cubre split-screen y zoom de pantalla.
	 */
	.gb-set-row {
		container-type: inline-size;
	}

	/*
	 * El ancho fisico no alcanza para inferir el espacio que ocupa el texto: Android
	 * permite aumentarlo sin achicar el viewport CSS. En vertical priorizamos siempre
	 * el valor completo; en horizontal conservamos la version compacta si entra.
	 */
	@media (orientation: portrait) {
		.gb-set-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@container (max-width: 19.5rem) {
		.gb-set-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	/* Guardando: anillo breve, no bloquea la lectura del número/estado alrededor. */
	.gb-set-spinner {
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 999px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: var(--text);
		animation: gb-spin 0.7s linear infinite;
	}

	@keyframes gb-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
