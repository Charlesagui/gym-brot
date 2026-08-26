<script lang="ts">
	import type { SetSesion, Ajustes, ModoEsfuerzo } from '$lib/db';
	import { pulsar } from '$lib/pulsar';
	import { formatoNumero, formatoAnterior } from '$lib/formato';
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
	 * Chips de memoria: la app ya sabe con cuánto hiciste esta serie la vez pasada, y
	 * hasta acá ese dato era texto gris. Repetir la carga anterior (o moverla un paso)
	 * es lo que se hace en la mayoría de las series, y ahora cuesta un toque.
	 */
	const memoria = $derived.by(() => {
		if (set.hecha || anterior?.peso == null) return [];
		const base = anterior.peso;
		const arriba = sumarPeso(base, pasoPeso);
		const abajo = sumarPeso(base, -pasoPeso);
		const opcionesChips = [{ etiqueta: 'Igual', valor: base }];
		if (arriba != null && arriba !== base) opcionesChips.push({ etiqueta: 'Subir', valor: arriba });
		if (abajo != null && abajo > 0) opcionesChips.push({ etiqueta: 'Bajar', valor: abajo });
		return opcionesChips;
	});

	/**
	 * Cuánto se movió la carga respecto de la misma serie de la vez pasada.
	 *
	 * Vive en el renglón contraído porque ahí sobraba entre un 39 % y un 56 % del ancho:
	 * los valores arrancan siempre en el mismo x —que es lo que deja leer la columna de
	 * arriba abajo, y por eso no se centran— y a la derecha no había nada. En vez de
	 * rellenar con aire, va el dato que contesta la pregunta que uno se hace mirando una
	 * serie hecha: ¿subí?
	 */
	const delta = $derived.by(() => {
		if (set.peso == null || anterior?.peso == null) return null;
		const diferencia = redondear(set.peso - anterior.peso);
		// El signo va explícito: "2.5" a secas se confunde con un peso, "+2.5" es un salto.
		const texto =
			diferencia === 0
				? '='
				: `${diferencia > 0 ? '+' : '−'}${formatoNumero(Math.abs(diferencia))}`;
		return { diferencia, texto };
	});

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
		Serie hecha: un renglón con lo que realmente levantaste. El check verde sigue
		siendo el que desmarca; el resto de la fila abre la corrección.
	-->
	<!--
		Tres columnas y no una fila: las dos de los costados son `1fr`, o sea que miden lo
		mismo, y por eso la del medio cae en el centro exacto del renglón. Con flex los
		valores quedaban 8 px a la izquierda, porque el bloque de la izquierda (el número)
		mide 54 px y el de la derecha (delta y lápiz) 81: centrar "en lo que sobra" no es
		centrar en el renglón cuando los costados son distintos.
	-->
	<div
		class="gb-set-row gb-set-row--hecha grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl p-1.5 {flash
			? 'gb-row-flash'
			: ''}"
		style="background: var(--surface-2); --row-glow: {glow}"
	>
		<!--
			El número va también en la fila contraída: sin él, la lista de hechas es una
			pila de valores sin decir cuál es cuál, y la columna de la izquierda deja de
			leerse 1-2-3-4 de arriba abajo.
		-->
		<button
			onclick={alternar}
			disabled={pendiente}
			class="flex min-h-11 w-fit touch-manipulation items-center gap-1.5 rounded-full px-2.5 {flash
				? 'gb-pop'
				: ''}"
			style="background: rgb(var(--exito) / .16); color: rgb(var(--exito))"
			aria-pressed={set.hecha}
			aria-busy={pendiente}
			aria-label={etiquetaToggle}
		>
			<span class="cifra text-lg">{index + 1}</span>
			{#if pendiente}
				<span class="gb-set-spinner" aria-hidden="true"></span>
			{:else}
				<Icono nombre="hecha" tamano={18} />
			{/if}
		</button>
		<button
			onclick={onAbrir}
			class="flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-1"
			aria-label={`Corregir serie ${index + 1}`}
		>
			<!--
				20 px y no 24: con el delta reservado a la derecha, "102.5 kg × 10 reps" no
				entraba y se cortaba. De paso ordena la jerarquía, porque la cifra que tiene
				que gritar es la de la serie en curso, no la de las que ya hiciste.
			-->
			<span class="cifra min-w-0 truncate text-xl">
				{set.peso != null ? formatoNumero(set.peso) : '—'}<span class="cifra-u">{unidad}</span>
				<span class="mx-0.5" style="color: var(--muted)">×</span>{set.reps ?? '—'}<span
					class="cifra-u">reps</span
				>
			</span>
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
		</button>
		<!--
			El delta y el lápiz también abren la corrección, pero para el lector de pantalla
			son el mismo botón que ya está anunciado al medio: acá van como blanco táctil y
			nada más, para que tocar la derecha del renglón haga lo mismo que tocar el centro.

			El delta ocupa su lugar aunque no exista. Sin eso, las series sin sesión anterior
			corrían los valores 37 px respecto de las que sí la tienen.
		-->
		<button
			onclick={onAbrir}
			tabindex="-1"
			aria-hidden="true"
			class="flex min-h-11 w-full items-center justify-end gap-2 rounded-lg pr-1"
		>
			<span class="gb-delta flex w-12 justify-end">
				{#if delta}
					<span
						class="cifra text-base"
						style="color: {delta.diferencia > 0 ? 'rgb(var(--exito))' : 'var(--muted)'}"
						>{delta.texto}</span
					>
				{/if}
			</span>
			<span class="shrink-0" style="color: var(--muted)">
				<Icono nombre="editar" tamano={15} />
			</span>
		</button>
	</div>
{:else if porHacer}
	<!--
		Serie que todavía no llegaste: su objetivo en un renglón punteado. Tocarla la abre
		por si querés dejar la carga preparada antes de tiempo.
	-->
	<button
		onclick={onAbrir}
		class="gb-set-row flex w-full min-h-11 items-center gap-3 rounded-xl border border-dashed border-white/10 p-1.5 text-left"
		aria-label={`Abrir serie ${index + 1}`}
	>
		<span
			class="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 text-sm font-bold"
			style="color: var(--muted)">{index + 1}</span
		>
		<span class="cifra min-w-0 flex-1 truncate text-xl" style="color: var(--muted)">
			{#if set.peso != null || set.reps != null}
				{set.peso != null ? formatoNumero(set.peso) : '—'}<span class="cifra-u">{unidad}</span>
				<span class="mx-0.5">×</span>{set.reps ?? '—'}<span class="cifra-u">reps</span>
			{:else}
				<span class="text-sm" style="font-family: inherit">Sin cargar</span>
			{/if}
		</span>
		<span
			class="shrink-0 text-[10px] font-bold uppercase tracking-wider"
			style="color: var(--muted)">Objetivo</span
		>
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
	 * Renglón hecho en pantalla angosta: "137.5 kg × 12 reps" con el delta y el lápiz al
	 * lado no entra a 320 px con una cifra redonda. Lo primero que se va son las
	 * unidades, que el `×` ya sobreentiende; los números, que son el dato, quedan.
	 */
	@container (max-width: 17rem) {
		.gb-set-row--hecha :global(.cifra-u) {
			display: none;
		}

		/*
		 * Y si aun sin unidades no entra —"137.5 × 12" a 320 px—, lo siguiente en irse es
		 * el delta. El orden de prioridad del renglón es siempre el mismo: los números que
		 * levantaste, después cuánto te moviste, al final cómo se llaman las unidades.
		 */
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
