<script lang="ts">
	import { hoyStr } from '$lib/sesion';
	import { ajustesObs, AJUSTES_DEFAULT, setMetaPesoGramos } from '$lib/extras';
	import {
		borrarPesoCorporal,
		guardarPesoCorporal,
		PESO_CORPORAL_MAX_GRAMOS,
		PESO_CORPORAL_MIN_GRAMOS,
		pesosCorporalesObs,
		resumirPesoCorporal
	} from '$lib/peso-corporal';
	import { gramosAPeso, pesoAGramos, type UnidadPeso } from '$lib/unidades';
	import { formatoNumero, fechaCorta } from '$lib/formato';
	import ChartPesoCorporal from '$lib/components/ChartPesoCorporal.svelte';
	import Icono from '$lib/components/Icono.svelte';
	import CintaPeso from '$lib/components/CintaPeso.svelte';
	import { reportarErrorDatos } from '$lib/errores-datos';
	import { fromLiveQuery } from '$lib/live';

	const ajustesStore = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const pesosStore = fromLiveQuery(pesosCorporalesObs(), []);
	let fecha = $state(hoyStr());
	let pesoEntero = $state(70);
	let pesoDecimal = $state(0);
	let selectorUnidad = $state<UnidadPeso>('kg');
	let selectorTocado = $state(false);
	let ultimoPesoSincronizado = $state<number | null>(null);
	let metaTexto = $state<string | number>('');
	let editandoFecha = $state<string | null>(null);
	let confirmarBorrado = $state<string | null>(null);
	let guardando = $state(false);
	let mensaje = $state('');
	/**
	 * Se acaba de guardar una medición, y por eso el acuse es tocable.
	 *
	 * Es aparte de `mensaje` porque no todos los mensajes de esta pantalla merecen el
	 * ofrecimiento: "ingresá un peso válido" y "meta guardada" no llevan a ningún lado.
	 * Sólo el peso recién anotado tiene a dónde ir — es el único dato de esta pantalla que
	 * cambia algo en otra.
	 */
	let recienGuardado = $state(false);

	const ajustes = $derived($ajustesStore);
	const pesos = $derived($pesosStore);
	const resumen = $derived(resumirPesoCorporal(pesos, ajustes.metaPesoGramos));
	const minimoVisible = $derived(gramosAPeso(PESO_CORPORAL_MIN_GRAMOS, ajustes.unidad)!);
	const maximoVisible = $derived(gramosAPeso(PESO_CORPORAL_MAX_GRAMOS, ajustes.unidad)!);
	const pesoSeleccionado = $derived(pesoEntero + pesoDecimal / 10);

	function fijarSelector(valor: number) {
		const decimas = Math.round(valor * 10);
		pesoEntero = Math.floor(decimas / 10);
		pesoDecimal = decimas % 10;
	}

	function tocarSelector() {
		selectorTocado = true;
		mensaje = '';
		recienGuardado = false;
	}

	$effect(() => {
		const unidadActual = ajustes.unidad;
		const pesoActualGramos = resumen.actual?.pesoGramos;
		if (selectorUnidad !== unidadActual) {
			const gramosSeleccionados = pesoAGramos(pesoSeleccionado, selectorUnidad);
			fijarSelector(
				gramosAPeso(gramosSeleccionados ?? pesoActualGramos ?? 70_000, unidadActual) ?? 70
			);
			selectorUnidad = unidadActual;
		}
		if (
			!selectorTocado &&
			editandoFecha == null &&
			pesoActualGramos != null &&
			pesoActualGramos !== ultimoPesoSincronizado
		) {
			fijarSelector(gramosAPeso(pesoActualGramos, unidadActual)!);
			ultimoPesoSincronizado = pesoActualGramos;
		}
	});

	function texto(valor: string | number): string {
		return String(valor).trim();
	}

	function numero(textoNumero: string | number): number | undefined {
		const valor = Number(texto(textoNumero).replace(',', '.'));
		return Number.isFinite(valor) ? valor : undefined;
	}

	async function guardar() {
		const gramos = pesoAGramos(pesoSeleccionado, ajustes.unidad);
		if (gramos == null) {
			mensaje = 'Ingresá un peso válido.';
			recienGuardado = false;
			return;
		}
		if (fecha > hoyStr()) {
			mensaje = 'No podés registrar una medición futura.';
			recienGuardado = false;
			return;
		}
		guardando = true;
		mensaje = '';
		recienGuardado = false;
		try {
			await guardarPesoCorporal(fecha, gramos);
			editandoFecha = null;
			fecha = hoyStr();
			selectorTocado = false;
			ultimoPesoSincronizado = null;
			// El acuse lo da el bloque tocable, con su propio texto.
			mensaje = '';
			recienGuardado = true;
		} catch (error) {
			reportarErrorDatos('No se pudo guardar la medición.', error);
		} finally {
			guardando = false;
		}
	}

	function editar(fechaEditar: string, gramos: number) {
		editandoFecha = fechaEditar;
		fecha = fechaEditar;
		fijarSelector(gramosAPeso(gramos, ajustes.unidad) ?? 70);
		selectorTocado = true;
		mensaje = '';
		recienGuardado = false;
	}

	function cancelarEdicion() {
		editandoFecha = null;
		fecha = hoyStr();
		selectorTocado = false;
		ultimoPesoSincronizado = null;
		recienGuardado = false;
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
			recienGuardado = false;
			return;
		}
		try {
			await setMetaPesoGramos(gramos);
			metaTexto = '';
			mensaje = gramos == null ? 'Meta eliminada.' : 'Meta guardada.';
			recienGuardado = false;
		} catch (error) {
			reportarErrorDatos('No se pudo guardar la meta.', error);
		}
	}
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-5rem)] px-5 pb-28">
	<header class="mb-5 flex items-center gap-3">
		<!--
			Vuelve a Macros y no a la portada. El único enlace a esta pantalla en toda la app
			sale de la tarjeta de Macros, y la barra de abajo marca Macros como la sección
			activa mientras estás acá: mandar a Rutinas era mandar a un lugar del que no
			viniste, contradiciendo a la propia barra.
		-->
		<a
			href="/cuerpo"
			class="grid size-11 place-items-center rounded-full border border-white/10 text-lg"
			aria-label="Volver a Macros">←</a
		>
		<div>
			<h1 class="text-xl font-extrabold">Peso corporal</h1>
			<p class="text-xs" style="color: var(--muted)">
				Seguimiento personal, guardado solo en este dispositivo
			</p>
		</div>
	</header>

	<section
		class="flex items-center justify-between rounded-2xl border border-white/10 px-4 py-3"
		style="background: var(--surface)"
		aria-label="Peso corporal actual"
	>
		<div>
			<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">Actual</p>
			<p class="mt-0.5 text-2xl font-extrabold tabular-nums">
				{resumen.actual
					? formatoNumero(gramosAPeso(resumen.actual.pesoGramos, ajustes.unidad)!)
					: '—'}
				<span class="text-sm" style="color: var(--muted)">{ajustes.unidad}</span>
			</p>
		</div>
		{#if resumen.actual}
			<p class="text-right text-xs" style="color: var(--muted)">
				{fechaCorta(resumen.actual.fecha, true)}
			</p>
		{/if}
	</section>

	<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
		<div class="flex items-center justify-between gap-3">
			<div>
				<h2 class="text-sm font-bold">{editandoFecha ? 'Editar medición' : 'Registrar peso'}</h2>
				<p class="mt-0.5 text-xs" style="color: var(--muted)">Arrastrá la cinta con el dedo</p>
			</div>
			<span class="text-xs font-bold uppercase tracking-wider" style="color: var(--accent-text)"
				>{ajustes.unidad}</span
			>
		</div>

		<!--
			Una cifra manda y la cinta la mueve. Antes eran dos <select> nativos, uno para el
			entero y otro para la décima: el dato salía bien pero se elegía con dos menús del
			sistema, que es lo único de la app que no se siente parte de la app.
		-->
		<p class="mt-2 flex items-baseline justify-center">
			<span class="cifra text-[3.4rem]"
				>{formatoNumero(pesoSeleccionado)}<span class="cifra-u">{ajustes.unidad}</span></span
			>
		</p>
		<div class="mt-1">
			<CintaPeso
				valor={pesoSeleccionado}
				min={minimoVisible}
				max={maximoVisible}
				paso={0.1}
				cadaMayor={5}
				formato={formatoNumero}
				unidad={ajustes.unidad}
				vibracion={ajustes.vibracion ?? true}
				etiqueta={`Peso en ${ajustes.unidad}`}
				onCambio={(nuevo) => {
					fijarSelector(nuevo);
					tocarSelector();
				}}
			/>
		</div>

		<label class="mt-3 block text-xs font-semibold" style="color: var(--muted)"
			>Fecha
			<input
				type="date"
				bind:value={fecha}
				disabled={editandoFecha != null}
				max={hoyStr()}
				class="mt-1 min-h-11 w-full rounded-xl bg-white/[0.06] px-3 text-base disabled:opacity-60"
			/>
		</label>
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
		<!--
			Guardar no navega, y por eso el acuse es tocable.

			Esta pantalla no es un formulario: abajo están el gráfico de evolución, la meta y
			el historial editable. El momento después de guardar es mirar la curva con el punto
			nuevo, y navegar solo se lo lleva puesto — además de expulsarte en cada medición
			cuando cargás varios días salteados de a uno.

			Pero el peso es el único dato de acá que cambia algo en otra pantalla: es lo que
			corrige el objetivo. Sin esto no se enteraba nadie — Macros pasa de "todavía no
			registraste ningún peso" a una predicción de verdad y no había nada que lo dijera.
			Así el ofrecimiento está y la decisión sigue siendo del usuario.
		-->
		{#if recienGuardado}
			<div
				class="mt-2 flex min-h-11 items-center justify-between gap-2 rounded-xl pl-3 text-xs font-bold"
				style="background: rgb(var(--exito) / .14); color: rgb(var(--exito))"
			>
				<!--
					La barra no es el enlace, y el `role="status"` no va adentro de él.

					Las dos cosas se probaron y las dos estaban mal. Con la barra entera como enlace
					y el estado adentro, Chrome dejaba al enlace **sin nombre accesible**: `status`
					no aporta al nombre por contenido, y el árbol lo reportaba como un link mudo.
					Separados, cada uno dice lo suyo — el estado anuncia que se guardó, el enlace se
					llama "Ver tu objetivo".
				-->
				<span class="flex items-center gap-2">
					<Icono nombre="hecha" tamano={16} />
					<span role="status">Medición guardada.</span>
				</span>
				<a href="/cuerpo" class="flex min-h-11 items-center rounded-xl px-3">Ver tu objetivo →</a>
			</div>
		{:else if mensaje}
			<p class="mt-2 text-xs" role="status" style="color: var(--muted)">{mensaje}</p>
		{/if}
	</section>

	<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
		<h2 class="mb-3 text-sm font-bold">Evolución</h2>
		<ChartPesoCorporal {pesos} metaPesoGramos={ajustes.metaPesoGramos} unidad={ajustes.unidad} />
	</section>

	<details class="mt-3 rounded-2xl border border-white/10 px-4" style="background: var(--surface)">
		<summary class="flex min-h-14 cursor-pointer items-center justify-between text-sm font-bold">
			<span>Meta opcional</span>
			<span class="text-xs" style="color: var(--muted)">
				{ajustes.metaPesoGramos == null
					? 'Sin configurar'
					: `${formatoNumero(gramosAPeso(ajustes.metaPesoGramos, ajustes.unidad)!)} ${ajustes.unidad}`}
			</span>
		</summary>
		<div class="pb-4">
			<div class="flex gap-2">
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
		</div>
	</details>

	<details class="mt-3 rounded-2xl border border-white/10 px-4" style="background: var(--surface)">
		<summary class="flex min-h-14 cursor-pointer items-center justify-between text-sm font-bold">
			<span>Mediciones</span>
			<span class="text-xs" style="color: var(--muted)">{pesos.length}</span>
		</summary>
		{#if pesos.length === 0}
			<p
				class="mb-4 rounded-xl border border-dashed border-white/15 p-4 text-center text-sm"
				style="color: var(--muted)"
			>
				Registrá una medición para empezar a ver cambios.
			</p>
		{:else}
			<ul class="divide-y divide-white/10 pb-2">
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
	</details>
</main>
