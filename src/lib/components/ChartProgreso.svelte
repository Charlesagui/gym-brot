<script lang="ts">
	import { scaleTime } from 'd3-scale';
	import { curveMonotoneX } from 'd3-shape';
	import { Axis, Chart, Highlight, Points, Spline, Svg, Tooltip } from 'layerchart';
	import { mejorSet, type MejorSet } from '$lib/sesion';
	import { formatoNumero, formatoSet, fechaCorta } from '$lib/formato';
	import { dur, menosMovimiento } from '$lib/motion';

	type Rango = '3m' | '1a' | 'todo';

	let {
		puntos,
		glow,
		metricaLabel,
		unidad,
		seriesHechas = 0,
		cargando = false
	}: {
		/** Mejor set por sesión, ordenado por fecha ascendente. */
		puntos: MejorSet[];
		glow: string;
		metricaLabel: string;
		/** Unidad del valor: kg/lb, o "reps" en ejercicios sin peso. */
		unidad: string;
		/** Distingue una ausencia real de series de datos hechos aún no graficables. */
		seriesHechas?: number;
		cargando?: boolean;
	} = $props();

	interface PuntoChart {
		fecha: Date;
		fechaStr: string;
		valor: number;
		fuente: MejorSet;
		sesiones: number;
		/** Media móvil de las últimas cinco fechas con datos. */
		tendencia: number;
	}

	let rango = $state<Rango>('todo');

	const RANGOS: { id: Rango; label: string }[] = [
		{ id: '3m', label: '3 meses' },
		{ id: '1a', label: '1 año' },
		{ id: 'todo', label: 'Todo' }
	];

	function inicioDelDia(fecha = new Date()): Date {
		const resultado = new Date(fecha);
		resultado.setHours(0, 0, 0, 0);
		return resultado;
	}

	function limiteRango(valor: Rango): Date | null {
		if (valor === 'todo') return null;
		const corte = inicioDelDia();
		if (valor === '3m') corte.setMonth(corte.getMonth() - 3);
		else corte.setFullYear(corte.getFullYear() - 1);
		return corte;
	}

	/** Una fecha puede tener varias rutinas: se muestra su mejor serie del día, sin solaparlas. */
	function agruparPorFecha(series: MejorSet[]): PuntoChart[] {
		const porFecha = new Map<string, { fuente: MejorSet; sesiones: Set<string | undefined> }>();
		for (const punto of series) {
			const existente = porFecha.get(punto.fecha);
			if (!existente) {
				porFecha.set(punto.fecha, { fuente: punto, sesiones: new Set([punto.sesionId]) });
				continue;
			}
			existente.fuente = mejorSet(existente.fuente, punto);
			existente.sesiones.add(punto.sesionId);
		}
		const ordenados = [...porFecha.entries()]
			.map(([fechaStr, valor]) => ({
				fecha: new Date(`${fechaStr}T12:00:00`),
				fechaStr,
				valor: valor.fuente.valor,
				fuente: valor.fuente,
				sesiones: valor.sesiones.size,
				tendencia: 0
			}))
			.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
		return ordenados.map((punto, indice) => {
			const ventana = ordenados.slice(Math.max(0, indice - 4), indice + 1);
			return {
				...punto,
				tendencia: ventana.reduce((suma, p) => suma + p.valor, 0) / ventana.length
			};
		});
	}

	/** Mantiene el gráfico fluido sin ocultar los extremos cuando el historial es muy largo. */
	function reducirParaDibujar(datos: PuntoChart[], maximo = 180): PuntoChart[] {
		if (datos.length <= maximo) return datos;
		const resultado: PuntoChart[] = [datos[0]];
		const ancho = Math.ceil(datos.length / Math.floor(maximo / 2));
		for (let inicio = 1; inicio < datos.length - 1; inicio += ancho) {
			const grupo = datos.slice(inicio, Math.min(inicio + ancho, datos.length - 1));
			const minimo = grupo.reduce((a, b) => (a.valor <= b.valor ? a : b));
			const maximoGrupo = grupo.reduce((a, b) => (a.valor >= b.valor ? a : b));
			resultado.push(minimo, maximoGrupo);
		}
		resultado.push(datos[datos.length - 1]);
		return [
			...new Map(resultado.map((punto) => [`${punto.fechaStr}:${punto.valor}`, punto])).values()
		].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
	}

	const todos = $derived(agruparPorFecha(puntos));
	const datos = $derived.by(() => {
		const corte = limiteRango(rango);
		const hoy = inicioDelDia();
		return todos.filter((punto) => punto.fecha >= (corte ?? new Date(0)) && punto.fecha <= hoy);
	});
	const datosDibujados = $derived(reducirParaDibujar(datos));
	const conTendencia = $derived(datos.length >= 5);
	const ultimo = $derived(datos[datos.length - 1]);
	const maximo = $derived(
		datos.length
			? datos.reduce((mejor, punto) => (punto.valor > mejor ? punto.valor : mejor), -Infinity)
			: null
	);
	let sinMovimiento = $state(menosMovimiento());
	$effect(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		const actualizar = () => (sinMovimiento = mq.matches);
		actualizar();
		mq.addEventListener('change', actualizar);
		return () => mq.removeEventListener('change', actualizar);
	});

	function fechaTick(fecha: Date): string {
		return fecha.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: '2-digit' });
	}
</script>

{#if cargando}
	<p
		class="rounded-2xl border border-dashed border-white/15 p-5 text-center text-sm"
		style="color: var(--muted)"
	>
		Cargando datos de progreso…
	</p>
{:else if datos.length === 0}
	<p
		class="rounded-2xl border border-dashed border-white/15 p-5 text-center text-sm"
		style="color: var(--muted)"
	>
		{#if puntos.length === 0 && seriesHechas > 0}
			Hay series hechas, pero faltan peso o reps para poder graficarlas.
		{:else if puntos.length === 0}
			Sin series registradas todavía: el gráfico aparece cuando marques series hechas.
		{:else}
			Sin sesiones pasadas en este rango.
		{/if}
	</p>
{:else}
	<div
		role="img"
		aria-label={`Progreso de ${metricaLabel}: ${datos.length} ${datos.length === 1 ? 'día' : 'días'}, último ${formatoNumero(ultimo!.valor)} ${unidad}, máximo ${formatoNumero(maximo!)} ${unidad}`}
	>
		<div class="h-52 w-full" style="touch-action: pan-y">
			<Chart
				data={datosDibujados}
				x={(d: PuntoChart) => d.fecha}
				xScale={scaleTime()}
				y={(d: PuntoChart) => d.valor}
				yNice
				padding={{ top: 8, right: 10, bottom: 22, left: 34 }}
				tooltipContext={{ mode: 'bisect-x' }}
			>
				<Svg>
					<Axis
						placement="left"
						ticks={4}
						format={(v: number) => formatoNumero(v)}
						fill="var(--muted)"
						stroke="rgba(255,255,255,.08)"
						grid
						tickLabelProps={{ class: 'text-[10px] font-medium tabular-nums' }}
					/>
					<Axis
						placement="bottom"
						ticks={4}
						format={fechaTick}
						fill="var(--muted)"
						stroke="rgba(255,255,255,.08)"
						tickLabelProps={{ class: 'text-[10px] font-medium' }}
					/>
					{#if conTendencia}
						<Spline
							y={(d: PuntoChart) => d.tendencia}
							curve={curveMonotoneX}
							stroke="rgba(255,255,255,.32)"
							stroke-width={1.4}
							stroke-dasharray="4 4"
							motion={sinMovimiento ? 'none' : undefined}
						/>
					{/if}
					<Spline
						curve={curveMonotoneX}
						stroke={`rgb(${glow})`}
						stroke-width={2}
						motion={sinMovimiento ? 'none' : undefined}
					/>
					<Points r={3} fill="var(--surface)" stroke={`rgb(${glow})`} stroke-width={1.5} />
					<Highlight
						points={{ r: 4.5, fill: `rgb(${glow})` }}
						lines={{ stroke: `rgb(${glow} / .35)` }}
						motion={sinMovimiento ? 'none' : undefined}
					/>
				</Svg>
				<Tooltip.Root
					variant="none"
					fadeDuration={dur(100)}
					x="data"
					y="data"
					anchor="bottom"
					yOffset={10}
				>
					{#snippet children({ data }: { data: PuntoChart })}
						<div
							class="rounded-xl border border-white/15 px-3 py-2 text-xs shadow-lg"
							style="background: var(--surface)"
						>
							<p class="font-bold" style="color: rgb({glow})">
								{formatoNumero(data.valor)}
								{unidad}
							</p>
							<p class="mt-0.5 font-medium" style="color: var(--muted)">
								{fechaCorta(data.fuente.fecha, true)} · {formatoSet(data.fuente, unidad)}
								{#if data.sesiones > 1}
									· mejor de {data.sesiones} sesiones{/if}
							</p>
						</div>
					{/snippet}
				</Tooltip.Root>
			</Chart>
		</div>
	</div>
	<details
		class="mt-2 rounded-lg bg-white/[0.025] px-3 py-2 text-[11px]"
		style="color: var(--muted)"
	>
		<summary class="cursor-pointer font-semibold">Ver los datos que muestra el gráfico</summary>
		<ol class="mt-2 space-y-1">
			{#each datosDibujados as punto (punto.fechaStr + punto.valor)}
				<li>
					{fechaCorta(punto.fechaStr, true)}: {formatoNumero(punto.valor)}
					{unidad}{punto.sesiones > 1 ? ` (mejor de ${punto.sesiones} sesiones)` : ''}
				</li>
			{/each}
		</ol>
	</details>
{/if}

<div class="mt-2 flex flex-wrap items-center justify-between gap-2">
	<p class="text-[11px] font-medium" style="color: var(--muted)">
		📈 Cada punto es el mejor set hecho de ese día · {metricaLabel}
		{#if conTendencia}<span style="opacity:.85"> · - - media móvil de hasta 5 días</span>{/if}
	</p>
	<div
		class="flex min-h-11 items-center rounded-full bg-white/5 p-0.5"
		role="group"
		aria-label="Rango del gráfico"
	>
		{#each RANGOS as opcion (opcion.id)}
			<button
				onclick={() => (rango = opcion.id)}
				class="min-h-11 rounded-full px-2.5 text-[11px] font-semibold"
				aria-pressed={rango === opcion.id}
				style={rango === opcion.id
					? `background: rgb(${glow} / .2); color: rgb(${glow})`
					: 'color: var(--muted)'}>{opcion.label}</button
			>
		{/each}
	</div>
</div>
