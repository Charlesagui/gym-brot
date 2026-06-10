<script lang="ts">
	import { scaleTime } from 'd3-scale';
	import { curveMonotoneX } from 'd3-shape';
	import { Axis, Chart, Highlight, Points, Spline, Svg, Tooltip } from 'layerchart';
	import type { MejorSet } from '$lib/sesion';
	import { formatoNumero, formatoSet, fechaCorta } from '$lib/formato';
	import { dur, menosMovimiento } from '$lib/motion';

	type Rango = '3m' | '1a' | 'todo';

	let {
		puntos,
		glow,
		metricaLabel,
		unidad
	}: {
		/** Mejor set por sesión, ordenado por fecha ascendente (de historialObs). */
		puntos: MejorSet[];
		glow: string;
		metricaLabel: string;
		/** Unidad del valor: kg/lb, o "reps" en ejercicios sin peso. */
		unidad: string;
	} = $props();

	interface PuntoChart {
		fecha: Date;
		valor: number;
		fuente: MejorSet;
		/** Media móvil de las últimas 5 sesiones: tendencia que filtra días malos. */
		tendencia: number;
	}

	let rango = $state<Rango>('todo');

	const RANGOS: { id: Rango; label: string; dias: number | null }[] = [
		{ id: '3m', label: '3m', dias: 90 },
		{ id: '1a', label: '1 año', dias: 365 },
		{ id: 'todo', label: 'Todo', dias: null }
	];

	// Mediodía local: evita que la fecha "caiga" al día anterior por husos/DST.
	const todos = $derived(
		puntos.map((p, i): PuntoChart => {
			const ventana = puntos.slice(Math.max(0, i - 4), i + 1);
			return {
				fecha: new Date(`${p.fecha}T12:00:00`),
				valor: p.valor,
				fuente: p,
				tendencia: ventana.reduce((suma, q) => suma + q.valor, 0) / ventana.length
			};
		})
	);

	const datos = $derived.by(() => {
		const dias = RANGOS.find((r) => r.id === rango)?.dias;
		if (dias == null) return todos;
		const corte = new Date();
		corte.setDate(corte.getDate() - dias);
		return todos.filter((p) => p.fecha >= corte);
	});

	// Con pocas sesiones la media móvil no aporta: solo se dibuja desde 5 puntos.
	const conTendencia = $derived(datos.length >= 5);
	const ultimo = $derived(datos[datos.length - 1]);
	const maximo = $derived(
		datos.length ? datos.reduce((m, p) => (p.valor > m ? p.valor : m), -Infinity) : null
	);
	const sinMovimiento = menosMovimiento();

	function fechaTick(d: Date): string {
		return d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
	}
</script>

{#if datos.length === 0}
	<p
		class="rounded-2xl border border-dashed border-white/15 p-5 text-center text-sm"
		style="color: var(--muted)"
	>
		{puntos.length === 0
			? 'Sin series registradas todavía: el gráfico aparece cuando marques series hechas.'
			: 'Sin sesiones en este rango.'}
	</p>
{:else}
	<div
		role="img"
		aria-label={`Progreso de ${metricaLabel}: ${datos.length} ${datos.length === 1 ? 'sesión' : 'sesiones'}, último ${formatoNumero(ultimo!.valor)} ${unidad}, máximo ${formatoNumero(maximo!)} ${unidad}`}
	>
		<div class="h-52 w-full" style="touch-action: pan-y">
			<Chart
				data={datos}
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
				<Tooltip.Root variant="none" fadeDuration={dur(100)} x="data" y="data" anchor="bottom" yOffset={10}>
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
								{fechaCorta(data.fuente.fecha)} · {formatoSet(data.fuente, unidad)}
							</p>
						</div>
					{/snippet}
				</Tooltip.Root>
			</Chart>
		</div>
	</div>
{/if}

<div class="mt-2 flex items-center justify-between gap-2">
	<p class="text-[11px] font-medium" style="color: var(--muted)">
		📈 {metricaLabel}{#if conTendencia}
			· <span style="opacity:.85">- - tendencia (media de 5)</span>{/if}
	</p>
	<div class="flex items-center rounded-full bg-white/5 p-0.5">
		{#each RANGOS as r (r.id)}
			<button
				onclick={() => (rango = r.id)}
				class="min-h-7 rounded-full px-2.5 text-[11px] font-semibold"
				aria-pressed={rango === r.id}
				style={rango === r.id
					? `background: rgb(${glow} / .2); color: rgb(${glow})`
					: 'color: var(--muted)'}>{r.label}</button
			>
		{/each}
	</div>
</div>
