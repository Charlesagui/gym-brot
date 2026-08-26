<script lang="ts">
	import { GEOMETRIA_CUERPO } from '$lib/body-geometry';
	import { formatoNumero } from '$lib/formato';
	import { estadoLiveQuery } from '$lib/live';
	import {
		crearDistribucionMuscular,
		distribucionMuscularObs,
		MUSCULOS,
		type MusculoMapa
	} from '$lib/musculos';

	let { hoy }: { hoy: string } = $props();
	let semanas = $state<1 | 4 | 12>(4);
	let soloDuras = $state(false);
	let seleccionado = $state<MusculoMapa | null>(null);

	const store = $derived(
		estadoLiveQuery(
			distribucionMuscularObs(hoy, semanas, soloDuras),
			crearDistribucionMuscular([], hoy, semanas, soloDuras)
		)
	);
	const consulta = $derived($store);
	const distribucion = $derived(consulta.valor);
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

<section
	class="rounded-2xl border border-white/10 p-4"
	style="background: var(--surface)"
	aria-labelledby="titulo-mapa-corporal"
>
	<div class="flex items-start justify-between gap-3">
		<div>
			<h2 id="titulo-mapa-corporal" class="text-sm font-bold">Distribución estimada de series</h2>
			<p class="mt-0.5 text-xs leading-relaxed" style="color: var(--muted)">
				1 por músculo principal · 0,4 por secundario · sólo series completadas
			</p>
		</div>
		<p class="shrink-0 text-right text-xs font-semibold" style="color: var(--muted)">
			{distribucion.seriesConsideradas}
			{distribucion.soloDuras ? 'series duras' : 'series'}<br />{semanas === 1
				? '7 días'
				: `${semanas} semanas`}
		</p>
	</div>

	<div class="mt-3 grid grid-cols-3 gap-2" aria-label="Período del mapa corporal">
		{#each [{ valor: 1, label: '1 semana' }, { valor: 4, label: '4 semanas' }, { valor: 12, label: '12 semanas' }] as opcion (opcion.valor)}
			<button
				type="button"
				onclick={() => (semanas = opcion.valor as 1 | 4 | 12)}
				aria-pressed={semanas === opcion.valor}
				class="min-h-11 rounded-xl px-2 text-xs font-bold"
				style={semanas === opcion.valor
					? 'background: rgb(var(--exito) / .2); color: rgb(var(--exito))'
					: 'background: rgba(255,255,255,.05); color: var(--muted)'}>{opcion.label}</button
			>
		{/each}
	</div>

	{#if distribucion.seriesSinRepresentacion > 0}
		<!-- Series reales que el dibujo no puede representar (ejercicio archivado o sin
		     músculo mapeado). Se dicen: el encabezado cuenta sólo lo que sostiene el mapa,
		     y sin esta línea la diferencia contra el historial no tendría explicación. -->
		<p class="mt-2 rounded-xl bg-white/[0.035] px-3 py-2 text-[11px]" style="color: var(--muted)">
			{distribucion.seriesSinRepresentacion}
			{distribucion.seriesSinRepresentacion === 1 ? 'serie más' : 'series más'} del período no
			{distribucion.seriesSinRepresentacion === 1 ? 'entra' : 'entran'} en el mapa: su ejercicio no tiene
			músculos asignados. Sí {distribucion.seriesSinRepresentacion === 1 ? 'cuenta' : 'cuentan'} en el
			historial.
		</p>
	{/if}

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

	{#if consulta.estado === 'error'}
		<p class="mt-4 rounded-xl bg-red-400/10 p-3 text-xs" style="color: #ff9b9b" role="alert">
			No se pudo calcular el mapa. Tus sesiones no fueron modificadas.
		</p>
	{:else}
		<p class="mt-3 text-center text-[10px]" style="color: var(--muted)">
			Silueta anatómica única, no personalizada por sexo o género
		</p>
		<div class="mt-2 grid grid-cols-2 gap-2">
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
								<g
									role="button"
									tabindex="0"
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
	{/if}

	{#if seleccionado}
		{@const carga = porMusculo.get(seleccionado)}
		<div class="mt-2 rounded-xl border border-white/10 bg-white/[0.045] p-3" aria-live="polite">
			<p class="text-sm font-bold">{MUSCULOS[seleccionado].label}</p>
			<p class="mt-0.5 text-xs" style="color: var(--muted)">
				{formatoNumero(carga?.seriesEstimadas ?? 0)} series estimadas · {carga?.seriesPrimarias ??
					0}
				principales · {carga?.seriesSecundarias ?? 0} aportes secundarios
			</p>
		</div>
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
							<strong class="text-xs tabular-nums" style="color: rgb(var(--exito))">
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

	<p class="mt-3 text-[10px] leading-relaxed" style="color: var(--muted)">
		Estimación de distribución, no mide fatiga, recuperación ni activación médica. La intensidad es
		relativa al músculo con más series del período. Geometría MuscleMap © 2026 Melih Colpan, MIT.
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
