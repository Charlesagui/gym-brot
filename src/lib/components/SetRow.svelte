<script lang="ts">
	import type { SetSesion, Ajustes, ModoEsfuerzo } from '$lib/db';
	import { pulsar } from '$lib/pulsar';
	import { formatoNumero, formatoAnterior, formatoSet } from '$lib/formato';
	import { redondear, sumarPeso } from '$lib/numeros';
	import Stepper from './Stepper.svelte';
	import Icono from './Icono.svelte';
	import { etiquetaEsfuerzo, rpeARir } from '$lib/esfuerzo';

	let {
		set,
		index,
		anterior,
		maquinaPlacas,
		glow,
		unidad,
		pasoPeso,
		activa = false,
		abierta = false,
		pendiente = false,
		flash = false,
		modoEsfuerzo = 'off',
		onToggle,
		onToggleMax,
		onAjustarPeso,
		onPonerPeso,
		onEscribirPeso,
		onAjustarReps,
		onEscribirReps,
		onAjustarExtra,
		onSetRir,
		onAbrir,
		onCerrar,
		onQuitar,
		puedeQuitar = false
	}: {
		set: SetSesion;
		index: number;
		anterior: SetSesion | undefined;
		maquinaPlacas: boolean;
		glow: string;
		unidad: Ajustes['unidad'];
		pasoPeso: number;
		/** La primera serie sin hacer: la única que se muestra abierta y con relieve. */
		activa?: boolean;
		/**
		 * Abierta a pedido de la pantalla. Vive afuera y no acá adentro porque es una
		 * decisión de la lista, no de la fila: hay una sola abierta a la vez además de la
		 * que estás haciendo, y volver del descanso a corregir tiene que poder abrirla
		 * aunque el usuario la haya cerrado un rato antes.
		 */
		abierta?: boolean;
		pendiente?: boolean;
		/** Breve acuse visual tras confirmar el guardado (no se usa al desmarcar). */
		flash?: boolean;
		modoEsfuerzo?: ModoEsfuerzo;
		onToggle: () => void;
		onToggleMax: () => void;
		onAjustarPeso: (delta: number) => void;
		/** Fija un peso exacto (chips de memoria), sin pasar por el ±. */
		onPonerPeso: (peso: number) => void;
		onEscribirPeso: (el: HTMLInputElement) => void;
		onAjustarReps: (delta: number) => void;
		onEscribirReps: (el: HTMLInputElement) => void;
		onAjustarExtra: (delta: number) => void;
		onSetRir: (rir?: number) => void;
		/** La tocaron para abrirla (corregir una hecha o preparar una que falta). */
		onAbrir: () => void;
		/** La cerraron con su propio botón. */
		onCerrar: () => void;
		/** Quitar ESTA serie del ejercicio de hoy (no la última de la lista). */
		onQuitar: () => void;
		/** Falso cuando es la única serie: un ejercicio sin ninguna serie no existe. */
		puedeQuitar?: boolean;
	} = $props();

	const ant = $derived(formatoAnterior(anterior, unidad));
	let mostrarEsfuerzo = $state(false);
	/**
	 * Una serie hecha se contrae a un renglón. Se puede volver a abrir para corregirla
	 * sin desmarcarla: al desmarcar se recalcula el PR, y "me equivoqué en las reps" no
	 * tiene por qué costar eso.
	 */
	/**
	 * Tres estados, no uno: la que estás haciendo se muestra entera, la que ya hiciste
	 * se contrae a lo que levantaste y la que falta se contrae a su objetivo. Cualquiera
	 * de las contraídas se abre tocándola, y se cierra con su propio botón.
	 */
	const desplegada = $derived(activa || abierta);
	const compacta = $derived(!desplegada && set.hecha);
	const porHacer = $derived(!desplegada && !set.hecha);
	const escala = $derived(modoEsfuerzo === 'rpe' ? 'rpe' : 'rir');
	const opciones = $derived(
		Array.from({ length: 11 }, (_, indice) => (escala === 'rir' ? indice / 2 : 10 - indice / 2))
	);
	const etiquetaToggle = $derived(`${set.hecha ? 'Desmarcar' : 'Marcar'} serie ${index + 1}`);

	/**
	 * Chips de memoria: mover la carga de la vez pasada un paso arriba o abajo en un toque.
	 *
	 * "Igual" se fue: la serie ya viene prellenada con el peso anterior
	 * (`serieDesdeAnterior` en $lib/sesion), así que el chip escribía el valor que ya
	 * estaba. Ocupaba una fila de 44 px y no hacía nada, salvo en el caso raro de volver
	 * atrás después de haber cambiado el peso a mano, que es lo que hace el stepper.
	 */
	const memoria = $derived.by(() => {
		if (set.hecha || anterior?.peso == null) return [];
		const base = anterior.peso;
		const arriba = sumarPeso(base, pasoPeso);
		const abajo = sumarPeso(base, -pasoPeso);
		const opcionesChips: { etiqueta: string; valor: number }[] = [];
		if (arriba != null && arriba !== base) opcionesChips.push({ etiqueta: 'Subir', valor: arriba });
		if (abajo != null && abajo > 0) opcionesChips.push({ etiqueta: 'Bajar', valor: abajo });
		return opcionesChips;
	});

	/**
	 * Cuánto se movió la carga respecto de la misma serie de la vez pasada. Cierra el
	 * renglón contraído por la derecha porque contesta la pregunta que uno se hace
	 * mirando una serie hecha: ¿subí?
	 */
	const delta = $derived.by(() => {
		if (set.peso == null || anterior?.peso == null) return null;
		const diferencia = redondear(set.peso - anterior.peso);
		// El signo va explícito: "2.5" a secas se confunde con un peso, "+2.5" es un salto.
		const texto =
			diferencia === 0
				? '='
				: `${diferencia > 0 ? '+' : '−'}${formatoNumero(Math.abs(diferencia))}`;
		const frase =
			diferencia === 0
				? 'igual que la vez pasada'
				: `${formatoNumero(Math.abs(diferencia))} ${unidad} ${diferencia > 0 ? 'más' : 'menos'} que la vez pasada`;
		return { diferencia, texto, frase };
	});

	/**
	 * Nombre accesible del renglón contraído. El `aria-label` REEMPLAZA al contenido del
	 * botón, así que "Corregir serie 2" a secas dejaba el peso y las reps inaudibles: la
	 * lista entera se escuchaba "corregir serie 1, corregir serie 2, corregir serie 3".
	 * Mismo criterio que el historial, que ya nombraba la serie con lo que levantaste.
	 */
	const etiquetaCorregir = $derived(
		`Corregir serie ${index + 1}: ${formatoSet(set, unidad)}${delta ? `, ${delta.frase}` : ''}`
	);

	/**
	 * Qué es el número que muestra una serie que todavía no hiciste. Es el prellenado de
	 * la sesión anterior, no un objetivo de la rutina: mientras no lo toques dice "Última
	 * vez", y en cuanto lo movés pasa a ser lo que dejaste preparado. Decirle "objetivo" a
	 * lo que levantaste la vez pasada es justo lo que CLAUDE.md pide no hacer.
	 */
	const rotuloFalta = $derived(
		anterior != null && set.peso === anterior.peso && set.reps === anterior.reps
			? 'Última vez'
			: 'Preparada'
	);

	const etiquetaAbrir = $derived(
		set.peso != null || set.reps != null
			? `Abrir serie ${index + 1}: ${rotuloFalta.toLowerCase()}, ${formatoSet(set, unidad)}`
			: `Abrir serie ${index + 1}: sin cargar`
	);

	function cambiarEsfuerzo(valor: string) {
		if (!valor) {
			onSetRir(undefined);
			return;
		}
		const numero = Number(valor);
		onSetRir(escala === 'rir' ? numero : rpeARir(numero));
	}

	function alternar() {
		onToggle();
	}
</script>

{#if compacta}
	<!--
		Serie hecha: el aro con el número ES el check. Al confirmar, la tarjeta se contrae a
		ese mismo aro ya lleno de verde, que es lo que el botón grande venía prometiendo:
		antes el número quedaba en gris a la izquierda y el ✓ aparecía como otro botón a
		262 px de distancia, sin continuidad entre la acción y su resultado.

		Los valores se pegan al aro como un solo bloque. La versión anterior los ponía en una
		columna fija de 4.4rem dimensionada para el peor caso ("137.5") y alineada a la
		derecha: con un peso de dos dígitos dejaba 42 px de vacío contra el número de serie y
		otros 48 en la columna de insignias, así que la fila entera se leía corrida. Alinear
		la coma entre renglones no se puede hacer bien fila por fila —cada una es su propio
		grid— y con tres o cuatro series no compensa el hueco.

		Las unidades no van acá: las dice el rótulo de la tarjeta, y repetidas por fila
		costaban 30 px que son del número.
	-->
	<div
		class="gb-set-row gb-set-row--hecha grid grid-cols-[2.75rem_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-1.5 py-1 {flash
			? 'gb-row-flash'
			: ''}"
		style="background: var(--surface-2); --row-glow: {glow}"
	>
		<button
			onclick={alternar}
			disabled={pendiente}
			class="grid size-11 shrink-0 touch-manipulation place-items-center rounded-full {flash
				? 'gb-pop'
				: ''}"
			aria-pressed={set.hecha}
			aria-busy={pendiente}
			aria-label={etiquetaToggle}
		>
			{#if pendiente}
				<span class="gb-set-spinner" aria-hidden="true"></span>
			{:else}
				<span
					class="cifra grid size-9 place-items-center rounded-full border-2 text-[0.95rem]"
					style="background: rgb(var(--exito) / .16); border-color: rgb(var(--exito) / .55); color: rgb(var(--exito))"
					aria-hidden="true">{index + 1}</span
				>
			{/if}
		</button>
		<button
			onclick={onAbrir}
			class="flex min-h-11 items-baseline gap-1 rounded-lg text-left"
			aria-label={etiquetaCorregir}
		>
			<span class="cifra text-2xl">{set.peso != null ? formatoNumero(set.peso) : '—'}</span>
			<span class="cifra text-xl" style="color: var(--muted)">×</span>
			<span class="cifra text-2xl" style="color: #c2c6d6">{set.reps ?? '—'}</span>
		</button>
		<span class="flex min-w-0 items-center gap-1.5 overflow-hidden" aria-hidden="true">
			{#if set.esMax}
				<span
					class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
					style="background: rgb(var(--max) / .16); color: rgb(var(--max))"
					>MAX{set.extraKg ? ` +${formatoNumero(set.extraKg)}` : ''}</span
				>
			{/if}
			{#if set.rir != null}
				<span class="shrink-0 text-[10px] font-bold" style="color: var(--muted)"
					>{escala.toUpperCase()}
					{escala === 'rir' ? set.rir : 10 - set.rir}</span
				>
			{/if}
		</span>
		<!--
			El delta va oculto para el lector de pantalla porque `aria-label` sobre un span
			genérico se descarta: lo dice `etiquetaCorregir`, que sí es el nombre de un botón.
		-->
		<span class="gb-delta flex justify-end pr-1" aria-hidden="true">
			{#if delta}
				<span
					class="cifra text-base"
					style="color: {delta.diferencia > 0 ? 'rgb(var(--exito))' : 'var(--muted)'}"
					>{delta.texto}</span
				>
			{/if}
		</span>
	</div>
{:else if porHacer}
	<!--
		Serie que todavía no llegaste: lo que tiene cargado, en un renglón punteado. Tocarla
		la abre por si querés dejar la carga preparada antes de tiempo.

		El rótulo dice de dónde sale el número. Decía "Objetivo", pero el prellenado viene de
		la sesión anterior (`serieDesdeAnterior`), no de la rutina: bajar el peso una vez por
		una molestia convertía ese peso reducido en tu "objetivo" de la vez siguiente.
	-->
	<button
		onclick={onAbrir}
		class="gb-set-row grid min-h-11 w-full grid-cols-[2.75rem_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-dashed border-white/10 px-1.5 py-1 text-left"
		aria-label={etiquetaAbrir}
	>
		<span
			class="cifra grid size-9 place-items-center justify-self-center rounded-full border text-[0.95rem]"
			style="border-color: rgba(255,255,255,.12); color: var(--muted)">{index + 1}</span
		>
		{#if set.peso != null || set.reps != null}
			<span class="flex items-baseline gap-1" style="color: var(--muted)">
				<span class="cifra text-2xl">{set.peso != null ? formatoNumero(set.peso) : '—'}</span>
				<span class="cifra text-xl">×</span>
				<span class="cifra text-2xl">{set.reps ?? '—'}</span>
			</span>
			<span></span>
			<span class="pr-1 text-[10px] font-bold uppercase tracking-wider" style="color: var(--muted)"
				>{rotuloFalta}</span
			>
		{:else}
			<span class="col-span-3 text-sm" style="color: var(--muted)">Sin cargar</span>
		{/if}
	</button>
{:else}
	<div
		class="gb-set-row rounded-xl p-2.5 {activa ? 'gb-foco' : ''} {flash ? 'gb-row-flash' : ''}"
		style="background: {activa ? '' : 'var(--surface-2)'}; --row-glow: {glow}; --foco-color: {glow}"
	>
		<div class="gb-set-row-head flex items-center gap-2">
			<span
				class="grid size-9 shrink-0 place-items-center rounded-full border text-sm font-bold"
				style={activa
					? `border-color: rgb(${glow} / .5); color: rgb(${glow})`
					: 'border-color: rgba(255,255,255,.1); color: var(--muted)'}>{index + 1}</span
			>
			{#if activa}
				<span
					class="shrink-0 text-[11px] font-bold uppercase tracking-wider"
					style="color: rgb({glow})">En curso</span
				>
			{/if}
			{#if maquinaPlacas}
				<button
					onclick={onToggleMax}
					class="flex min-h-11 shrink-0 touch-manipulation items-center gap-1 rounded-full border px-2.5 text-[11px] font-bold"
					style={set.esMax
						? 'background: rgb(var(--max) / .22); color: rgb(var(--max)); border-color: rgb(var(--max) / .5)'
						: 'color: var(--muted); border-color: rgba(255,255,255,.16); border-style: dashed'}
					aria-pressed={set.esMax}
					aria-label={`Serie ${index + 1}: tope de la pila de placas`}
					><Icono nombre="max" tamano={14} /> MAX</button
				>
			{/if}
			<p
				class="min-w-0 flex-1 truncate text-right text-[11px] font-medium"
				style="color: var(--muted)"
			>
				{ant ? `Ant: ${ant}` : ''}
			</p>
		</div>

		{#if activa && memoria.length}
			<div class="mt-2 flex flex-wrap gap-1.5" aria-label="Repetir la carga anterior">
				{#each memoria as opcion (opcion.etiqueta)}
					<button
						onclick={() => onPonerPeso(opcion.valor!)}
						class="gb-relieve flex min-h-11 items-center gap-1.5 rounded-full bg-white/[0.06] px-3"
						aria-label={`${opcion.etiqueta} a ${formatoNumero(opcion.valor!)} ${unidad} en la serie ${index + 1}`}
					>
						<span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--muted)"
							>{opcion.etiqueta}</span
						>
						<span class="cifra text-lg">{formatoNumero(opcion.valor!)}</span>
					</button>
				{/each}
			</div>
		{/if}

		<div class="gb-set-grid mt-2 grid grid-cols-2 gap-2">
			<div class="min-w-0">
				{#if !activa}
					<p
						class="mb-1 text-[11px] font-bold uppercase tracking-wider"
						style="color: var(--muted)"
					>
						Peso ({unidad})
					</p>
				{/if}
				<Stepper
					value={set.peso}
					format={formatoNumero}
					inputmode="decimal"
					step={pasoPeso}
					{glow}
					grande={activa}
					{unidad}
					onStep={onAjustarPeso}
					onCommit={onEscribirPeso}
					ariaDown={`Bajar ${pasoPeso} ${unidad} en serie ${index + 1}`}
					ariaUp={`Subir ${pasoPeso} ${unidad} en serie ${index + 1}`}
					ariaInput={`Peso de la serie ${index + 1} en ${unidad}`}
				/>
			</div>
			<div class="min-w-0">
				{#if !activa}
					<p
						class="mb-1 text-[11px] font-bold uppercase tracking-wider"
						style="color: var(--muted)"
					>
						Reps
					</p>
				{/if}
				<Stepper
					value={set.reps}
					format={String}
					inputmode="numeric"
					step={1}
					{glow}
					grande={activa}
					unidad="reps"
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
				<span
					class="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider"
					style="color: rgb(var(--max))"
				>
					<Icono nombre="max" tamano={14} /> Encima de la pila
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

		<!--
			El confirmar deja de ser un círculo perdido arriba a la derecha: es el botón
			más grande de la fila, del color del grupo, al alcance del pulgar.
		-->
		<button
			onclick={alternar}
			disabled={pendiente}
			class="mt-2.5 flex min-h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-xl px-4 {flash
				? 'gb-pop'
				: ''} {set.hecha ? '' : 'gb-relieve gb-barrido'}"
			style={set.hecha
				? 'background: rgba(255,255,255,.06); color: var(--muted)'
				: `background: rgb(${glow}); color: var(--on-bright)`}
			aria-pressed={set.hecha}
			aria-busy={pendiente}
			aria-label={etiquetaToggle}
		>
			{#if set.hecha}
				<span class="text-sm font-bold">Desmarcar serie</span>
			{:else}
				<!--
					Casillero, no cartel: el aro vacío es lo que dice que falta hacerlo, y al
					marcarla la fila se contrae a ese mismo aro ya lleno de verde con el número
					adentro. Respira despacio para señalar que es lo próximo que hay que tocar;
					mientras guarda, el anillo del spinner ocupa su lugar.
				-->
				<span
					class="grid size-11 place-items-center rounded-full border-[2.5px] border-current"
					aria-hidden="true"
				>
					{#if pendiente}
						<span class="gb-set-spinner gb-set-spinner--oscuro"></span>
					{:else}
						<Icono nombre="hecha" tamano={24} />
					{/if}
				</span>
			{/if}
		</button>

		<!--
			Quitar vive acá y no en el contador de arriba porque el − de arriba siempre se
			llevaba la ÚLTIMA serie: para borrar la 2 de cuatro había que borrar la 4, la 3 y
			la 2 y volver a cargar dos. La serie que se quita es la que tenés abierta.
		-->
		<div class="mt-1 flex items-center gap-2">
			{#if puedeQuitar}
				<button
					type="button"
					onclick={onQuitar}
					class="min-h-11 flex-1 rounded-xl text-xs font-bold"
					style="color: rgb(var(--max))"
					aria-label={`Quitar la serie ${index + 1} de hoy`}>Quitar serie</button
				>
			{/if}
			{#if !activa}
				<!--
					La que estás haciendo no se cierra: es el trabajo en curso. Cualquier otra que
					hayas abierto vos —hecha o pendiente— tiene que poder volver a su renglón, o
					abrirla para mirarla se convierte en un viaje de ida.
				-->
				<button
					type="button"
					onclick={onCerrar}
					class="min-h-11 flex-1 rounded-xl text-xs font-bold"
					style="color: var(--muted)"
					aria-label={`Cerrar serie ${index + 1}`}>Cerrar</button
				>
			{/if}
		</div>
	</div>
{/if}

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

	/*
	 * Renglón muy angosto —la columna de trabajo en apaisado, o 320 px con zoom de
	 * pantalla—: "137.5 × 12" con el aro y el delta no entra. Lo primero que se va es el
	 * delta; los números que levantaste, que son el dato, quedan siempre.
	 *
	 * (La regla que escondía `.cifra-u` se borró: el renglón contraído ya no imprime
	 * unidades, las dice el rótulo de la tarjeta.)
	 */
	@container (max-width: 17rem) {
		.gb-set-row--hecha .gb-delta {
			display: none;
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

	/* Dentro del confirmar el fondo es el color del grupo: la tinta va oscura. */
	.gb-set-spinner--oscuro {
		border-color: rgb(0 0 0 / 0.25);
		border-top-color: var(--on-bright);
	}

	@keyframes gb-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
