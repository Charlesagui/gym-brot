<script lang="ts">
	import { GEOMETRIA_CUERPO } from '$lib/body-geometry';
	import { formatoNumero } from '$lib/formato';
	import { estadoLiveQuery } from '$lib/live';
	import {
		crearDistribucionMuscular,
		desdeDistribucion,
		distribucionMuscularObs,
		MUSCULOS,
		type DistribucionMuscular,
		type MusculoMapa
	} from '$lib/musculos';

	let { hoy }: { hoy: string } = $props();
	let semanas = $state<1 | 4 | 12>(4);
	let soloDuras = $state(false);
	let seleccionado = $state<MusculoMapa | null>(null);

	/**
	 * Último resultado bueno. Deliberadamente FUERA de `$state`: lo lee el `$derived` de
	 * acá abajo y lo escribe el `$effect` que observa la consulta, así que hacerlo
	 * reactivo cerraría el ciclo.
	 *
	 * Existe porque cambiar de período crea un store nuevo, y su valor inicial era la
	 * distribución vacía: durante el frame que tarda IndexedDB el cuerpo se apagaba
	 * entero y la lista afirmaba "No hay series completadas para este período". Un cero
	 * falso dura poco, pero sigue siendo un cero falso. Ahora se sostiene el dibujo
	 * anterior con `aria-busy`, que es lo que de verdad está pasando.
	 */
	let ultima: DistribucionMuscular | null = null;

	/**
	 * El período y el filtro se pisan con lo que la persona acaba de tocar: si el rótulo
	 * dijera "4 semanas" con el botón de 1 semana ya encendido, el control y el texto se
	 * contradirían. Las cifras siguen siendo las del cálculo anterior por un frame — por
	 * eso la sección va marcada como ocupada mientras dura.
	 */
	const inicial = $derived.by(() => {
		// A una `let` que se asigna desde otro closure TypeScript no le estrecha el tipo:
		// hay que copiarla a una const para que el `null` quede descartado de verdad.
		const previa = ultima;
		return previa
			? { ...previa, semanas, soloDuras, hasta: hoy, desde: desdeDistribucion(hoy, semanas) }
			: crearDistribucionMuscular([], hoy, semanas, soloDuras);
	});
	const store = $derived(
		estadoLiveQuery(distribucionMuscularObs(hoy, semanas, soloDuras), inicial)
	);
	const consulta = $derived($store);
	const distribucion = $derived(consulta.valor);
	const recalculando = $derived(consulta.estado === 'cargando');
	$effect(() => {
		if (consulta.estado === 'listo') ultima = consulta.valor;
	});

	const porMusculo = $derived(new Map(distribucion.cargas.map((carga) => [carga.musculo, carga])));
	const geometriaAMusculo = new Map(
		(Object.entries(MUSCULOS) as [MusculoMapa, (typeof MUSCULOS)[MusculoMapa]][]).map(
			([musculo, datos]) => [datos.geometria, musculo]
		)
	);

	function intensidad(musculo: MusculoMapa | undefined): number {
		if (!musculo || distribucion.maximo <= 0) return 0;
		return (porMusculo.get(musculo)?.seriesEstimadas ?? 0) / distribucion.maximo;
	}

	function activar(musculo: MusculoMapa | undefined) {
		if (musculo) seleccionado = seleccionado === musculo ? null : musculo;
	}

	function teclado(event: KeyboardEvent, musculo: MusculoMapa | undefined) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		activar(musculo);
	}

	function etiqueta(musculo: MusculoMapa): string {
		const carga = porMusculo.get(musculo);
		return `${MUSCULOS[musculo].label}: ${formatoNumero(carga?.seriesEstimadas ?? 0)} series estimadas`;
	}
</script>

<!--
	El dibujo primero.

	Es lo que la persona viene a ver, y hasta acá entraba último: título, subtítulo de
	ponderación, selector de período, filtro de RIR y un descargo sobre la silueta le
	ganaban de mano 398 px, más de lo que mide el cuerpo entero (344 px). En un teléfono
	de 664 px de alto había que scrollear 142 px para verlo completo.

	Ahora arriba del dibujo sólo queda lo que lo encabeza —qué es y sobre cuántas series
	está calculado—, los controles bajan a después (se ajustan mirando el resultado, no
	antes) y toda la letra chica se junta en un solo pie.
-->
<section
	class="rounded-2xl border border-white/10 p-4"
	style="background: var(--surface)"
	aria-labelledby="titulo-mapa-corporal"
	aria-busy={recalculando}
>
	<div class="flex items-start justify-between gap-3">
		<h2 id="titulo-mapa-corporal" class="text-sm font-bold">Distribución estimada de series</h2>
		<!-- El "en el mapa" aparece sólo cuando hay series que el dibujo no puede
		     representar, y no es cosmético: sin él este número se leería como el total del
		     período y no lo es. Así el encabezado nunca afirma de más, y la explicación
		     completa puede vivir abajo sin dejar un hueco de verdad en el medio. -->
		<p class="shrink-0 text-right text-xs font-semibold" style="color: var(--muted)">
			{distribucion.seriesConsideradas}
			{distribucion.soloDuras ? 'series duras' : 'series'}{distribucion.seriesSinRepresentacion > 0
				? ' en el mapa'
				: ''}<br />{semanas === 1 ? '7 días' : `${semanas} semanas`}
		</p>
	</div>

	{#if consulta.estado === 'error'}
		<p class="mt-4 rounded-xl bg-red-400/10 p-3 text-xs" style="color: #ff9b9b" role="alert">
			No se pudo calcular el mapa. Tus sesiones no fueron modificadas.
		</p>
	{:else}
		<div class="mt-3 grid grid-cols-2 gap-2">
			{#each ['front', 'back'] as lado (lado)}
				{@const cuerpo = GEOMETRIA_CUERPO[lado as 'front' | 'back']}
				<div>
					<p
						class="text-center text-[11px] font-bold uppercase tracking-wider"
						style="color: var(--muted)"
					>
						{lado === 'front' ? 'Frente' : 'Espalda'}
					</p>
					<svg
						viewBox={cuerpo.viewBox}
						class="mx-auto h-auto max-h-[25rem] w-full"
						role="group"
						aria-label={`Cuerpo de ${lado === 'front' ? 'frente' : 'espalda'}`}
					>
						{#each cuerpo.zones as zona (zona.slug)}
							{@const musculo = geometriaAMusculo.get(zona.slug)}
							{@const carga = musculo ? porMusculo.get(musculo) : undefined}
							{#if musculo}
								<!--
									Fuera del orden de tabulación a propósito (`tabindex="-1"`, sigue
									enfocable por código). Eran 24 paradas de tab que repetían, una por
									una, los botones de "Detalle equivalente" — y con peores blancos: la
									zona más chica mide 28×7 px contra los 44 px que el resto de la app
									respeta. El dibujo se toca con el dedo; el camino de teclado y de
									lector de pantalla es la lista de abajo, que para eso existe.
								-->
								<g
									role="button"
									tabindex="-1"
									aria-label={etiqueta(musculo)}
									aria-pressed={seleccionado === musculo}
									onclick={() => activar(musculo)}
									onkeydown={(event) => teclado(event, musculo)}
									class="interactivo"
									class:seleccionado={seleccionado === musculo}
								>
									{#each zona.paths as path}
										<path
											d={path}
											style={`fill: rgb(var(--exito) / ${carga ? 0.18 + intensidad(musculo) * 0.78 : 0.07})`}
										/>
									{/each}
								</g>
							{:else}
								<g aria-hidden="true">
									{#each zona.paths as path}
										<path d={path} style="fill: rgba(255,255,255,.035)" />
									{/each}
								</g>
							{/if}
						{/each}
					</svg>
				</div>
			{/each}
		</div>

		{#if seleccionado}
			{@const carga = porMusculo.get(seleccionado)}
			<div class="mt-2 rounded-xl border border-white/10 bg-white/[0.045] p-3" aria-live="polite">
				<p class="text-sm font-bold">{MUSCULOS[seleccionado].label}</p>
				<p class="mt-0.5 text-xs" style="color: var(--muted)">
					<span class="cifra">{formatoNumero(carga?.seriesEstimadas ?? 0)}</span> series estimadas ·
					{carga?.seriesPrimarias ?? 0}
					principales · {carga?.seriesSecundarias ?? 0} aportes secundarios
				</p>
			</div>
		{/if}

		{#if distribucion.seriesSinRepresentacion > 0}
			<!-- Series reales que el dibujo no puede representar (ejercicio archivado o sin
			     músculo mapeado). Se dicen igual: el encabezado ya avisa con "en el mapa" que
			     su número no es el total, y acá se explica por qué y adónde fueron a parar. -->
			<p class="mt-2 rounded-xl bg-white/[0.035] px-3 py-2 text-[11px]" style="color: var(--muted)">
				{distribucion.seriesSinRepresentacion}
				{distribucion.seriesSinRepresentacion === 1 ? 'serie más' : 'series más'} del período no
				{distribucion.seriesSinRepresentacion === 1 ? 'entra' : 'entran'} en el mapa: su ejercicio no
				tiene músculos asignados. Sí {distribucion.seriesSinRepresentacion === 1
					? 'cuenta'
					: 'cuentan'} en el historial.
			</p>
		{/if}

		<!-- Los controles, después del dibujo: se ajusta el período mirando el resultado,
		     no antes de tenerlo. Con relieve porque son grandes y hay que verlos apretables. -->
		<div class="mt-3 grid grid-cols-3 gap-2" aria-label="Período del mapa corporal">
			{#each [{ valor: 1, label: '1 semana' }, { valor: 4, label: '4 semanas' }, { valor: 12, label: '12 semanas' }] as opcion (opcion.valor)}
				<button
					type="button"
					onclick={() => (semanas = opcion.valor as 1 | 4 | 12)}
					aria-pressed={semanas === opcion.valor}
					class="gb-relieve min-h-11 rounded-xl px-2 text-xs font-bold"
					style={semanas === opcion.valor
						? 'background: rgb(var(--exito) / .2); color: rgb(var(--exito))'
						: 'background: rgba(255,255,255,.05); color: var(--muted)'}>{opcion.label}</button
				>
			{/each}
		</div>

		{#if distribucion.puedeFiltrarDuras || soloDuras}
			<label
				class="mt-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl bg-white/[0.035] px-3"
			>
				<input type="checkbox" bind:checked={soloDuras} class="size-4 accent-[rgb(var(--exito))]" />
				<span class="text-xs font-semibold">Sólo series duras (RIR 0–2)</span>
				<span class="ml-auto text-[11px]" style="color: var(--muted)">
					RIR en {Math.round(distribucion.coberturaRir * 100)}%
				</span>
			</label>
		{/if}
	{/if}

	<div class="mt-4 border-t border-white/10 pt-3">
		<h3 class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
			Detalle equivalente
		</h3>
		{#if distribucion.cargas.length}
			<ol class="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
				{#each distribucion.cargas as carga (carga.musculo)}
					<li>
						<button
							type="button"
							onclick={() => activar(carga.musculo)}
							aria-pressed={seleccionado === carga.musculo}
							class="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left"
							style={seleccionado === carga.musculo
								? 'background: rgb(var(--exito) / .14)'
								: 'background: rgba(255,255,255,.025)'}
						>
							<span class="min-w-0 flex-1 text-xs font-semibold">{carga.label}</span>
							<strong class="cifra text-sm" style="color: rgb(var(--exito))">
								{formatoNumero(carga.seriesEstimadas)}
							</strong>
						</button>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="py-4 text-center text-xs" style="color: var(--muted)">
				No hay series completadas para este período{soloDuras ? ' con RIR 0–2' : ''}.
			</p>
		{/if}
	</div>

	<!-- Toda la letra chica junta, al pie. Antes eran tres textos separados que decían
	     partes del mismo descargo —la ponderación arriba del dibujo, la silueta en el
	     medio y el alcance abajo—, y entre los tres empujaban el cuerpo 132 px hacia
	     abajo. No se sacó ninguna afirmación: se las juntó donde se leen las notas. -->
	<p class="mt-3 text-[10px] leading-relaxed" style="color: var(--muted)">
		1 serie al músculo principal y 0,4 a cada secundario, sólo sobre series completadas. La
		intensidad es relativa al músculo con más series del período: estima distribución, no mide
		fatiga, recuperación ni activación médica. Silueta anatómica única, no personalizada por sexo o
		género. Geometría MuscleMap © 2026 Melih Colpan, MIT.
	</p>
</section>

<style>
	g path {
		stroke: rgba(255, 255, 255, 0.1);
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
	}
	g.interactivo {
		cursor: pointer;
		outline: none;
	}
	g.interactivo:hover path,
	g.interactivo:focus-visible path {
		stroke: white;
		stroke-width: 5;
	}
	g.seleccionado path {
		stroke: white;
		stroke-width: 7;
	}
	@media (prefers-reduced-motion: no-preference) {
		g.interactivo path {
			transition:
				fill var(--dur-med) var(--ease-out),
				stroke-width var(--dur-fast) var(--ease-out);
		}
	}
</style>
