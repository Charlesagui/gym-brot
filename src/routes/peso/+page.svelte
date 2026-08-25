<script lang="ts">
	import { hoyStr } from '$lib/sesion';
	import { ajustesObs, AJUSTES_DEFAULT, setMetaPesoGramos } from '$lib/extras';
	import {
		borrarPesoCorporal,
		guardarPesoCorporal,
		pesosCorporalesObs,
		resumirPesoCorporal
	} from '$lib/peso-corporal';
	import { gramosAPeso, pesoAGramos } from '$lib/unidades';
	import { formatoNumero, fechaCorta } from '$lib/formato';
	import ChartPesoCorporal from '$lib/components/ChartPesoCorporal.svelte';
	import { reportarErrorDatos } from '$lib/errores-datos';
	import { fromLiveQuery } from '$lib/live';

	const ajustesStore = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const pesosStore = fromLiveQuery(pesosCorporalesObs(), []);
	let fecha = $state(hoyStr());
	let pesoTexto = $state<string | number>('');
	let metaTexto = $state<string | number>('');
	let editandoFecha = $state<string | null>(null);
	let confirmarBorrado = $state<string | null>(null);
	let guardando = $state(false);
	let mensaje = $state('');

	const ajustes = $derived($ajustesStore);
	const pesos = $derived($pesosStore);
	const resumen = $derived(resumirPesoCorporal(pesos, ajustes.metaPesoGramos));

	function texto(valor: string | number): string {
		return String(valor).trim();
	}

	function numero(textoNumero: string | number): number | undefined {
		const valor = Number(texto(textoNumero).replace(',', '.'));
		return Number.isFinite(valor) ? valor : undefined;
	}

	function cambio(gramos: number | null): string {
		if (gramos == null) return 'Sin datos suficientes';
		const visible = gramosAPeso(Math.abs(gramos), ajustes.unidad)!;
		if (gramos === 0) return `Sin cambio`;
		return `${gramos > 0 ? '+' : '−'}${formatoNumero(visible)} ${ajustes.unidad}`;
	}

	function distanciaMeta(gramos: number | null): string {
		if (gramos == null) return 'Sin meta configurada';
		const visible = gramosAPeso(Math.abs(gramos), ajustes.unidad)!;
		if (gramos === 0) return 'En la meta';
		return `${formatoNumero(visible)} ${ajustes.unidad} ${gramos > 0 ? 'por encima' : 'por debajo'}`;
	}

	async function guardar() {
		const visible = numero(pesoTexto);
		const gramos = visible == null ? undefined : pesoAGramos(visible, ajustes.unidad);
		if (gramos == null) {
			mensaje = 'Ingresá un peso válido.';
			return;
		}
		guardando = true;
		mensaje = '';
		try {
			await guardarPesoCorporal(fecha, gramos);
			pesoTexto = '';
			editandoFecha = null;
			fecha = hoyStr();
			mensaje = 'Medición guardada.';
		} catch (error) {
			reportarErrorDatos('No se pudo guardar la medición.', error);
		} finally {
			guardando = false;
		}
	}

	function editar(fechaEditar: string, gramos: number) {
		editandoFecha = fechaEditar;
		fecha = fechaEditar;
		pesoTexto = String(gramosAPeso(gramos, ajustes.unidad) ?? '');
		mensaje = '';
	}

	function cancelarEdicion() {
		editandoFecha = null;
		fecha = hoyStr();
		pesoTexto = '';
	}

	async function borrar(fechaBorrar: string) {
		if (confirmarBorrado !== fechaBorrar) {
			confirmarBorrado = fechaBorrar;
			return;
		}
		try {
			await borrarPesoCorporal(fechaBorrar);
			confirmarBorrado = null;
			if (editandoFecha === fechaBorrar) cancelarEdicion();
		} catch (error) {
			reportarErrorDatos('No se pudo borrar la medición.', error);
		}
	}

	async function guardarMeta() {
		const visible = numero(metaTexto);
		const gramos =
			texto(metaTexto) === ''
				? undefined
				: visible == null
					? undefined
					: pesoAGramos(visible, ajustes.unidad);
		if (texto(metaTexto) !== '' && gramos == null) {
			mensaje = 'Ingresá una meta válida o dejala vacía.';
			return;
		}
		try {
			await setMetaPesoGramos(gramos);
			metaTexto = '';
			mensaje = gramos == null ? 'Meta eliminada.' : 'Meta guardada.';
		} catch (error) {
			reportarErrorDatos('No se pudo guardar la meta.', error);
		}
	}
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-5rem)] px-5 pb-12 pt-6">
	<header class="mb-5 flex items-center gap-3">
		<a
			href="/"
			class="grid size-11 place-items-center rounded-full border border-white/10 text-lg"
			aria-label="Volver">←</a
		>
		<div>
			<h1 class="text-xl font-extrabold">Peso corporal</h1>
			<p class="text-xs" style="color: var(--muted)">
				Seguimiento personal, guardado solo en este dispositivo
			</p>
		</div>
	</header>

	<section class="grid grid-cols-2 gap-2" aria-label="Resumen de peso corporal">
		<div
			class="col-span-2 rounded-2xl border border-white/10 p-4"
			style="background: var(--surface)"
		>
			<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
				Peso actual
			</p>
			<p class="mt-1 text-3xl font-extrabold tabular-nums">
				{resumen.actual
					? formatoNumero(gramosAPeso(resumen.actual.pesoGramos, ajustes.unidad)!)
					: '—'}
				<span class="text-sm" style="color: var(--muted)">{ajustes.unidad}</span>
			</p>
			<p class="mt-1 text-xs" style="color: var(--muted)">
				{distanciaMeta(resumen.distanciaMetaGramos)}
			</p>
		</div>
		<div class="rounded-2xl border border-white/10 p-3" style="background: var(--surface)">
			<p class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--muted)">
				Cambio 7 días
			</p>
			<p class="mt-1 text-sm font-bold tabular-nums">{cambio(resumen.cambio7DiasGramos)}</p>
		</div>
		<div class="rounded-2xl border border-white/10 p-3" style="background: var(--surface)">
			<p class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--muted)">
				Cambio 30 días
			</p>
			<p class="mt-1 text-sm font-bold tabular-nums">{cambio(resumen.cambio30DiasGramos)}</p>
		</div>
	</section>

	<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
		<h2 class="text-sm font-bold">{editandoFecha ? 'Editar medición' : 'Registrar hoy'}</h2>
		<div class="mt-3 grid grid-cols-[1fr_1fr] gap-2">
			<label class="text-xs font-semibold" style="color: var(--muted)"
				>Fecha
				<input
					type="date"
					bind:value={fecha}
					disabled={editandoFecha != null}
					max={hoyStr()}
					class="mt-1 min-h-11 w-full rounded-xl bg-white/[0.06] px-3 text-base disabled:opacity-60"
				/>
			</label>
			<label class="text-xs font-semibold" style="color: var(--muted)"
				>Peso ({ajustes.unidad})
				<input
					type="number"
					inputmode="decimal"
					min="20"
					step="0.1"
					bind:value={pesoTexto}
					placeholder="—"
					class="mt-1 min-h-11 w-full rounded-xl bg-white/[0.06] px-3 text-base"
				/>
			</label>
		</div>
		<div class="mt-3 flex gap-2">
			{#if editandoFecha}<button
					type="button"
					onclick={cancelarEdicion}
					class="min-h-11 flex-1 rounded-xl border border-white/10 text-sm font-bold"
					>Cancelar</button
				>{/if}
			<button
				type="button"
				onclick={() => void guardar()}
				disabled={guardando}
				class="min-h-11 flex-1 rounded-xl text-sm font-bold disabled:opacity-60"
				style="background: var(--accent); color: var(--on-accent)"
				>{guardando ? 'Guardando…' : 'Guardar'}</button
			>
		</div>
		{#if mensaje}<p class="mt-2 text-xs" role="status" style="color: var(--muted)">
				{mensaje}
			</p>{/if}
	</section>

	<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
		<h2 class="text-sm font-bold">Meta opcional</h2>
		<p class="mt-1 text-xs leading-relaxed" style="color: var(--muted)">
			Puede servir para subir, bajar o mantener. No cambia tu historial.
		</p>
		<div class="mt-3 flex gap-2">
			<input
				type="number"
				inputmode="decimal"
				min="20"
				step="0.1"
				bind:value={metaTexto}
				placeholder={ajustes.metaPesoGramos == null
					? `Peso en ${ajustes.unidad}`
					: `${formatoNumero(gramosAPeso(ajustes.metaPesoGramos, ajustes.unidad)!)} ${ajustes.unidad}`}
				class="min-h-11 min-w-0 flex-1 rounded-xl bg-white/[0.06] px-3 text-base"
				aria-label={`Meta de peso en ${ajustes.unidad}`}
			/>
			<button
				type="button"
				onclick={() => void guardarMeta()}
				class="min-h-11 rounded-xl px-4 text-sm font-bold"
				style="background: rgba(255,255,255,.08)"
				>{texto(metaTexto)
					? 'Guardar'
					: ajustes.metaPesoGramos == null
						? 'Guardar'
						: 'Quitar'}</button
			>
		</div>
	</section>

	<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
		<h2 class="mb-3 text-sm font-bold">Evolución</h2>
		<ChartPesoCorporal {pesos} metaPesoGramos={ajustes.metaPesoGramos} unidad={ajustes.unidad} />
	</section>

	<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
		<h2 class="text-sm font-bold">Mediciones</h2>
		{#if pesos.length === 0}
			<p
				class="mt-3 rounded-xl border border-dashed border-white/15 p-4 text-center text-sm"
				style="color: var(--muted)"
			>
				Registrá una medición para empezar a ver cambios.
			</p>
		{:else}
			<ul class="mt-2 divide-y divide-white/10">
				{#each [...pesos].reverse() as peso (peso.fecha)}
					<li class="flex min-h-14 items-center gap-2 py-2">
						<div class="min-w-0 flex-1">
							<p class="text-sm font-bold tabular-nums">
								{formatoNumero(gramosAPeso(peso.pesoGramos, ajustes.unidad)!)}
								{ajustes.unidad}
							</p>
							<p class="text-xs" style="color: var(--muted)">{fechaCorta(peso.fecha, true)}</p>
						</div>
						<button
							type="button"
							onclick={() => editar(peso.fecha, peso.pesoGramos)}
							class="min-h-11 rounded-full px-3 text-xs font-bold"
							style="color: var(--accent-text)">Editar</button
						>
						<button
							type="button"
							onclick={() => void borrar(peso.fecha)}
							class="min-h-11 rounded-full px-3 text-xs font-bold"
							style="color: #ff8d8d"
							>{confirmarBorrado === peso.fecha ? 'Confirmar' : 'Borrar'}</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>
