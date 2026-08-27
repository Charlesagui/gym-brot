<script lang="ts">
	import Icono from '$lib/components/Icono.svelte';
	import RielBanda from '$lib/components/RielBanda.svelte';
	import { calibrar, DIAS_VENTANA_MAX, estadoCalibracion, type Adherencia } from '$lib/calibracion';
	import { bandas, macros, rotuloObjetivo } from '$lib/energia';
	import { fraseProteina, frasesPara } from '$lib/frases';
	import { hoyCalendarioLocal } from '$lib/fechas';
	import { AJUSTES_DEFAULT, ajustesObs } from '$lib/extras';
	import { formatoNumero, formatoVolumen } from '$lib/formato';
	import { fromLiveQuery } from '$lib/live';
	import {
		borrarObjetivos,
		guardarRevision,
		objetivoAnterior,
		objetivoVigenteObs
	} from '$lib/perfil-energia';
	import { pesosRecientesObs, resumirPesoCorporal } from '$lib/peso-corporal';
	import { gramosAPeso, KG_TO_LB } from '$lib/unidades';

	const ajustes = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	// Ventana acotada: acá alcanza con el peso actual y los cambios de 7 y 30 días.
	// El historial entero vive en /peso, que es donde se necesita.
	// La ventana de calibración llega hasta 56 días; el resumen necesita 45. Se pide la
	// más larga de las dos, una sola vez, y sigue acotada por índice.
	const pesos = fromLiveQuery(pesosRecientesObs(DIAS_VENTANA_MAX + 7), []);
	const objetivo = fromLiveQuery(objetivoVigenteObs(), null);

	const unidad = $derived($ajustes.unidad);
	const resumen = $derived(resumirPesoCorporal($pesos, $ajustes.metaPesoGramos));
	const banda = $derived($objetivo ? bandas($objetivo.tdeeKcal, $objetivo.sepvKcal).banda68 : null);

	const ritmoTexto = $derived.by(() => {
		if (!$objetivo) return '';
		const kgSemana = ($objetivo.ritmoPctSemana / 100) * ($objetivo.perfil.pesoGramos / 1000);
		const visible = unidad === 'kg' ? kgSemana : kgSemana * KG_TO_LB;
		const signo = visible > 0 ? '+' : visible < 0 ? '−' : '';
		return `${signo}${Math.abs(visible).toFixed(2).replace('.', ',')}`;
	});

	const revision = $derived(
		$objetivo
			? estadoCalibracion(
					{
						creadoAt: $objetivo.creadoAt,
						meta: $objetivo.meta,
						objetivoKcal: $objetivo.objetivoKcal,
						tdeeKcal: $objetivo.tdeeKcal
					},
					$pesos,
					hoyCalendarioLocal()
				)
			: null
	);

	/**
	 * El mantenimiento del objetivo que esta revisión reemplazó. Es una lectura por
	 * clave primaria y solo cuando hay cadena: alimenta la frase que dice cuánto se
	 * corrigió, que es la prueba concreta de por qué la fórmula sola no alcanzaba.
	 */
	let tdeeAnteriorKcal = $state<number | null>(null);
	$effect(() => {
		const id = $objetivo?.calibradoDe;
		if (!id) {
			tdeeAnteriorKcal = null;
			return;
		}
		void objetivoAnterior(id).then((previo) => (tdeeAnteriorKcal = previo?.tdeeKcal ?? null));
	});

	/**
	 * Predicciones, no consejos: cada una es verificable y ninguna habla de comida.
	 *
	 * Solo la primera queda a la vista y el resto se pliega. La lista viene ordenada por
	 * lo que más le sirve al usuario hoy, así que la primera es la única que puede pedir
	 * una acción —«hace nueve días que no te pesás»—; las que siguen explican, y explicar
	 * abajo de la cifra son doscientos píxeles de prosa que empujaban la pantalla a un
	 * scroll entero.
	 */
	const frases = $derived(
		frasesPara({
			objetivo: $objetivo,
			pesoActualGramos: resumen.actual?.pesoGramos ?? null,
			fechaUltimoPeso: resumen.actual?.fecha ?? null,
			calibracion: revision,
			tdeeAnteriorKcal,
			unidad,
			hoy: hoyCalendarioLocal()
		}).slice(0, 3)
	);

	/**
	 * Los tres macros de la fila, en el orden en que se resuelven en el motor: la proteína
	 * tiene objetivo propio, la grasa sale de un porcentaje con piso y los carbos son lo
	 * que queda. Ese orden es también el de importancia para quien entrena.
	 *
	 * Se derivan del objetivo guardado, no se leen de la fila: `macros()` es función pura
	 * de (peso, kcal, meta) y los tres campos ya están persistidos. Así la sección y el
	 * asistente no pueden mostrar repartos distintos del mismo objetivo.
	 */
	const macrosVisibles = $derived.by(() => {
		if (!$objetivo) return [];
		const { proteinaG, grasaG, carbosG } = macros(
			$objetivo.perfil.pesoGramos / 1000,
			$objetivo.objetivoKcal,
			$objetivo.meta
		);
		return [
			{ rotulo: 'Proteína', gramos: proteinaG },
			{ rotulo: 'Grasa', gramos: grasaG },
			{ rotulo: 'Carbos', gramos: carbosG }
		];
	});

	const COLOR_TONO = {
		neutro: 'var(--muted)',
		aviso: 'rgb(var(--max))',
		exito: 'rgb(var(--exito))'
	} as const;

	let confirmandoBorrado = $state(false);
	let preguntandoAdherencia = $state(false);

	/**
	 * Borra la cadena entera. Borrar solo el vigente dejaría al anterior en su lugar,
	 * y nadie pidió revivir un objetivo de hace tres meses.
	 */
	async function borrar() {
		if (!confirmandoBorrado) {
			confirmandoBorrado = true;
			return;
		}
		try {
			await borrarObjetivos();
		} catch {
			errorRevision = 'No pudimos borrar el objetivo. Recargá la app e intentá de nuevo.';
		} finally {
			confirmandoBorrado = false;
		}
	}
	let revisando = $state(false);
	let errorRevision = $state<string | null>(null);

	const ADHERENCIAS: Array<{ id: Adherencia; rotulo: string }> = [
		{ id: 'casi_todos', rotulo: 'Casi todos los días' },
		{ id: 'la_mayoria', rotulo: 'La mayoría' },
		{ id: 'menos_de_la_mitad', rotulo: 'Menos de la mitad' }
	];

	async function aplicarRevision(adherencia: Adherencia) {
		if (!$objetivo || revision?.estado !== 'listo' || !resumen.actual) return;
		errorRevision = null;
		const ajuste = calibrar($objetivo.tdeeKcal, revision.tdeeMedido, adherencia);
		if (!ajuste) {
			// Con adherencia baja no se toca el número: el dato no dice lo que parece decir.
			preguntandoAdherencia = false;
			errorRevision =
				'Sin haber seguido el objetivo la mayoría de los días, tu peso no dice si la cuenta estaba bien o mal. Dejamos el número como está.';
			return;
		}
		revisando = true;
		try {
			const nuevo = await guardarRevision($objetivo, ajuste.tdeeNuevo, resumen.actual.pesoGramos);
			if (!nuevo) errorRevision = 'No pudimos guardar la revisión. Revisá tus datos.';
			else preguntandoAdherencia = false;
		} catch {
			errorRevision = 'No pudimos guardar la revisión. Recargá la app e intentá de nuevo.';
		} finally {
			revisando = false;
		}
	}

	function kgTexto(kg: number, conSigno = true): string {
		const visible = unidad === 'kg' ? kg : kg * KG_TO_LB;
		const signo = conSigno ? (visible > 0 ? '+' : visible < 0 ? '−' : '') : '';
		return `${signo}${Math.abs(visible).toFixed(2).replace('.', ',')}`;
	}

	function cambio(gramos: number | null): string | null {
		if (gramos == null) return null;
		const visible = gramosAPeso(Math.abs(gramos), unidad);
		if (visible == null) return null;
		const signo = gramos > 0 ? '+' : gramos < 0 ? '−' : '';
		return `${signo}${formatoNumero(visible)} ${unidad}`;
	}
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-4rem)] px-4 pb-8 pt-3">
	<header class="mb-3 flex min-h-10 items-center justify-between gap-3">
		<h1 class="text-xl font-extrabold">Macros</h1>
	</header>

	<!-- ===== Revisión, cuando hay algo que decir ===== -->
	{#if $objetivo && revision && revision.estado !== 'esperando'}
		<section
			class="gb-foco mb-3 rounded-2xl py-4 pl-5 pr-4"
			style="--foco-color: {revision.estado === 'listo' ? 'var(--exito)' : 'var(--glow)'}"
		>
			<p class="text-[0.6rem] font-bold uppercase tracking-[0.14em]" style="color: var(--muted)">
				{revision.estado === 'listo' ? 'Hora de revisar' : 'Todavía no'}
			</p>

			{#if revision.estado === 'listo'}
				<p class="mt-1 flex items-baseline">
					<span class="cifra text-[3rem]"
						>{kgTexto(revision.cambioKg)}<span class="cifra-u">{unidad}</span></span
					>
				</p>
				<p class="mt-1 text-xs leading-relaxed" style="color: var(--muted)">
					En {revision.dias} días te moviste a {kgTexto(revision.kgPorSemana)}
					{unidad} por semana. Con tu peso real, tu mantenimiento parece estar cerca de {formatoVolumen(
						revision.tdeeMedido
					)} kcal.
				</p>

				{#if preguntandoAdherencia}
					<p class="mt-3 text-sm font-semibold">
						¿Cuántos días de este período apuntaste al objetivo?
					</p>
					<div class="mt-2 flex flex-col gap-2">
						{#each ADHERENCIAS as opcion (opcion.id)}
							<button
								onclick={() => aplicarRevision(opcion.id)}
								disabled={revisando}
								class="min-h-14 rounded-xl px-4 text-left text-sm font-semibold disabled:opacity-50"
								style="background: var(--surface-3)">{opcion.rotulo}</button
							>
						{/each}
					</div>
					<p class="mt-2 text-[0.7rem] leading-relaxed" style="color: var(--muted)">
						Hace falta porque la app no ve lo que comés: sin esto, «no bajaste» y «no seguiste el
						objetivo» son la misma observación.
					</p>
				{:else}
					<button
						onclick={() => (preguntandoAdherencia = true)}
						class="gb-relieve mt-3 min-h-14 w-full rounded-2xl text-base font-bold"
						style="background: var(--accent); color: var(--on-accent)">Revisar con mi peso</button
					>
				{/if}
			{:else if revision.estado === 'sin-senal'}
				<p class="mt-1.5 text-sm leading-relaxed">
					Todavía no puedo distinguir tu tendencia del ruido de la balanza. Vas a
					{kgTexto(revision.kgPorSemana)}
					{unidad} por semana, con un margen de ±{kgTexto(revision.errorKgPorSemana, false)}: el
					margen se come la señal. Pesate unos días más y vuelvo a mirar.
				</p>
			{:else}
				<p class="mt-1.5 text-sm leading-relaxed">
					Van {revision.ventana.pesajes} mediciones en este período y hacen falta al menos {revision.minimo}.
					Cuantos más días te peses, antes puedo corregir el número.
				</p>
			{/if}

			{#if errorRevision}
				<p
					class="mt-3 flex gap-2 rounded-xl border p-3 text-xs leading-relaxed"
					style="border-color: rgb(var(--max) / .35); background: rgb(var(--max) / .08); color: rgb(var(--max))"
				>
					<Icono nombre="aviso" tamano={16} clase="mt-px shrink-0" />
					<span>{errorRevision}</span>
				</p>
			{/if}
		</section>
	{/if}

	<!-- ===== Objetivo ===== -->
	{#if $objetivo}
		<section
			class="gb-relieve rounded-2xl border border-white/10 p-4"
			style="background: var(--surface)"
		>
			<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
				{rotuloObjetivo($objetivo.meta, $objetivo.nivel)}{$objetivo.calibradoDe
					? ' · revisado con tu peso'
					: ''}
			</p>
			<p class="mt-1 flex items-baseline">
				<span class="cifra text-[4.2rem]"
					>{formatoVolumen($objetivo.objetivoKcal)}<span class="cifra-u">kcal</span></span
				>
			</p>

			<div class="mt-3">
				<RielBanda
					tdee={$objetivo.tdeeKcal}
					sepv={$objetivo.sepvKcal}
					objetivoKcal={$objetivo.objetivoKcal}
				/>
			</div>

			<!--
				Los tres macros, y los tres siempre.

				Antes esta fila entera vivía dentro de un `{#if meta !== 'mantener'}`, así que
				quien elegía mantenimiento entraba a una sección llamada Macros y no veía ni uno:
				el asistente le había mostrado su proteína, la fila guardada la tenía, y la
				pantalla la tapaba. Lo único que de verdad no aplica en mantenimiento es el ritmo,
				y ese se esconde solo, más abajo.
			-->
			<div class="mt-4 grid grid-cols-3 gap-2">
				{#each macrosVisibles as macro (macro.rotulo)}
					<div class="min-w-0">
						<p
							class="text-[0.6rem] font-bold uppercase tracking-[0.14em]"
							style="color: var(--muted)"
						>
							{macro.rotulo}
						</p>
						<p class="cifra text-2xl">{macro.gramos}<span class="cifra-u">g</span></p>
					</div>
				{/each}
			</div>

			<!-- El mantenimiento es una cifra, no un dato de la prosa: es contra lo que se
			     compara el objetivo y merece leerse de un vistazo. En mantenimiento la fila
			     entera se va: el objetivo *es* el mantenimiento y el ritmo es cero. -->
			{#if $objetivo.meta !== 'mantener'}
				<div class="mt-3 grid grid-cols-2 gap-2">
					<div class="min-w-0">
						<p
							class="text-[0.6rem] font-bold uppercase tracking-[0.14em]"
							style="color: var(--muted)"
						>
							Mantenimiento
						</p>
						<p class="cifra text-2xl">
							{formatoVolumen($objetivo.tdeeKcal)}<span class="cifra-u">kcal</span>
						</p>
					</div>
					<div class="min-w-0">
						<p
							class="text-[0.6rem] font-bold uppercase tracking-[0.14em]"
							style="color: var(--muted)"
						>
							Ritmo
						</p>
						<p class="cifra text-2xl">{ritmoTexto}<span class="cifra-u">{unidad}/sem</span></p>
					</div>
				</div>
			{/if}

			<!-- La primera frase queda a la vista: es la única de la lista que puede pedir una
			     acción. Las que siguen explican y viven abajo, plegadas. -->
			{#if frases[0]}
				<p class="mt-3 text-xs leading-relaxed" style="color: {COLOR_TONO[frases[0].tono]}">
					{frases[0].texto}
				</p>
			{/if}

			<a
				href="/herramientas/calorias"
				class="mt-4 flex min-h-12 items-center justify-center rounded-2xl text-sm font-bold"
				style="background: var(--surface-3); color: var(--text)">Cambiar objetivo</a
			>

			<!--
				Todo lo que explica el número, plegado.

				No es prosa de relleno y por eso no se borra: la banda, el porqué de la proteína y
				las predicciones son lo que separa esta sección de una calculadora. Pero son ~200 px
				de texto de 12 px abajo de la cifra, y abiertos empujaban la pantalla a un scroll
				entero. Quien quiere el número lo tiene arriba; quien quiere la razón, la abre.
			-->
			<details class="mt-2 rounded-2xl" style="background: var(--surface-2)">
				<summary
					class="flex min-h-12 cursor-pointer items-center justify-between px-4 text-sm font-bold"
					>¿De dónde sale este número?<Icono nombre="info" tamano={18} clase="shrink-0" /></summary
				>
				<div class="px-4 pb-4">
					{#if banda}
						<p class="text-xs leading-relaxed" style="color: var(--muted)">
							Tu mantenimiento estimado es {formatoVolumen($objetivo.tdeeKcal)} kcal. 2 de cada 3 personas
							con tu perfil están entre {formatoVolumen(banda.desde)} y {formatoVolumen(
								banda.hasta
							)}. Es una cuenta, no una medición.
						</p>
					{/if}

					<p class="mt-3 text-xs leading-relaxed" style="color: var(--muted)">
						La proteína es un piso y sale de tu peso: {fraseProteina($objetivo)} La grasa es el 25 % de
						las calorías, con un piso por kilo, y los carbos son lo que queda — son la palanca que sostiene
						el entrenamiento.
					</p>

					{#each frases.slice(1) as frase (frase.id)}
						<p class="mt-3 text-xs leading-relaxed" style="color: {COLOR_TONO[frase.tono]}">
							{frase.texto}
						</p>
					{/each}

					<!-- Acción secundaria, discreta: no compite con nada y se confirma en dos toques. -->
					<button
						onclick={borrar}
						class="mt-4 min-h-11 text-xs font-bold"
						style="color: {confirmandoBorrado ? 'rgb(var(--max))' : 'var(--muted)'}"
						>{confirmandoBorrado ? 'Tocá otra vez para borrarlo' : 'Borrar objetivo'}</button
					>
				</div>
			</details>
		</section>
	{:else}
		<section class="rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
			<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
				Objetivo de calorías
			</p>
			<p class="mt-1.5 text-sm leading-relaxed">
				Todavía no calculaste el tuyo. Son cuatro pantallas y usa el peso que ya registrás.
			</p>
			<a
				href="/herramientas/calorias"
				class="gb-relieve mt-4 flex min-h-14 items-center justify-center rounded-2xl text-base font-bold"
				style="background: var(--accent); color: var(--on-accent)">Calcular mi objetivo</a
			>
		</section>
	{/if}

	<!--
		Peso corporal, en una franja y no en una tarjeta.

		Acá el peso no es el tema: es el dato que corrige el objetivo y la puerta a /peso, que
		es donde vive de verdad. Como tarjeta se llevaba ~190 px —rótulo, cifra de 2,6 rem,
		deltas y un botón a ancho completo— para decir tres números y abrir un link.
	-->
	<a
		href="/peso"
		class="mt-3 flex min-h-14 items-center gap-3 rounded-2xl border border-white/10 px-4"
		style="background: var(--surface)"
	>
		{#if resumen.actual}
			<span class="text-[0.6rem] font-bold uppercase tracking-[0.14em]" style="color: var(--muted)"
				>Peso hoy</span
			>
			<span class="cifra shrink-0 text-xl"
				>{formatoNumero(gramosAPeso(resumen.actual.pesoGramos, unidad)!)}<span class="cifra-u"
					>{unidad}</span
				></span
			>
			<span class="ml-auto flex shrink-0 gap-3 text-xs" style="color: var(--muted)">
				{#if cambio(resumen.cambio7DiasGramos)}
					<span>7 d <b style="color: var(--text)">{cambio(resumen.cambio7DiasGramos)}</b></span>
				{/if}
				{#if cambio(resumen.cambio30DiasGramos)}
					<span>30 d <b style="color: var(--text)">{cambio(resumen.cambio30DiasGramos)}</b></span>
				{/if}
			</span>
		{:else}
			<span class="text-sm font-bold">Registrar mi primer peso</span>
			<span class="ml-auto text-xs" style="color: var(--muted)">corrige tu objetivo</span>
		{/if}
	</a>
</main>
