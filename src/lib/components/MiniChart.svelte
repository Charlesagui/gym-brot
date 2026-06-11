<script lang="ts">
	import type { MejorSet } from '$lib/sesion';
	import { formatoNumero } from '$lib/formato';
	import { mantener } from '$lib/mantener';

	let {
		puntos,
		glow,
		metricaLabel,
		unidad,
		onEditarPunto
	}: {
		puntos: MejorSet[];
		glow: string;
		metricaLabel: string;
		/** Unidad del valor: kg/lb, o "reps" en ejercicios sin peso. */
		unidad: string;
		onEditarPunto?: (punto: MejorSet) => void;
	} = $props();

	interface ChartPoint {
		x: number;
		y: number;
		valor: number;
		label: string;
		source: MejorSet;
	}

	function chartPoints(pts: MejorSet[]): ChartPoint[] {
		const u = pts.slice(-10);
		if (u.length === 0) return [];
		const valores = u.map((p) => p.valor);
		const min = Math.min(...valores);
		const max = Math.max(...valores);
		const range = max - min || 1;
		const W = 100;
		const H = 28;
		const pad = 2;
		return u.map((p, i) => {
			const x = u.length === 1 ? W / 2 : pad + (i / (u.length - 1)) * (W - 2 * pad);
			const valor = p.valor;
			const y = u.length === 1 ? H / 2 : pad + (1 - (valor - min) / range) * (H - 2 * pad);
			return { x, y, valor, label: formatoNumero(valor), source: p };
		});
	}

	function chartLine(points: ChartPoint[]): string {
		return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
	}

	const chart = $derived(chartPoints(puntos));
	const ultimoChart = $derived(chart[chart.length - 1]);
	const chartMax = $derived(chart.length ? Math.max(...chart.map((p) => p.valor)) : null);
	const chartMin = $derived(chart.length ? Math.min(...chart.map((p) => p.valor)) : null);
</script>

{#if chart.length}
	<div class="mt-3 flex items-stretch gap-2">
		<!-- Referencia min/max: una línea casi plana puede ser igual progreso real -->
		<div
			class="flex shrink-0 flex-col {chartMin === chartMax
				? 'justify-center'
				: 'justify-between'} text-right text-[10px] font-medium tabular-nums"
			style="color: var(--muted)"
		>
			<span>{chartMax != null ? formatoNumero(chartMax) : ''}</span>
			{#if chartMin != null && chartMin !== chartMax}
				<span>{formatoNumero(chartMin)}</span>
			{/if}
		</div>
		<svg
			viewBox="0 0 100 28"
			class="min-w-0 flex-1"
			preserveAspectRatio="none"
			style="height: 46px"
			role="img"
			aria-label={`Mini gráfico de ${metricaLabel}: último ${ultimoChart.label} ${unidad}${chartMax != null ? `, máximo ${formatoNumero(chartMax)} ${unidad}` : ''}`}
		>
			{#if chartMin !== chartMax}
				<line
					x1="0"
					x2="100"
					y1="2"
					y2="2"
					stroke="rgba(255,255,255,.09)"
					stroke-width="1"
					stroke-dasharray="3 3"
					vector-effect="non-scaling-stroke"
				/>
				<line
					x1="0"
					x2="100"
					y1="26"
					y2="26"
					stroke="rgba(255,255,255,.09)"
					stroke-width="1"
					stroke-dasharray="3 3"
					vector-effect="non-scaling-stroke"
				/>
			{/if}
			<polyline
				points={chartLine(chart)}
				fill="none"
				stroke="rgb({glow})"
				stroke-width="2"
				vector-effect="non-scaling-stroke"
				stroke-linejoin="round"
				stroke-linecap="round"
			/>
			{#each chart as p, i (`${p.x}-${p.y}`)}
				<circle
					use:mantener={() => onEditarPunto?.(p.source)}
					cx={p.x}
					cy={p.y}
					r={i === chart.length - 1 ? 2.4 : 1.7}
					fill={i === chart.length - 1 ? `rgb(${glow})` : 'var(--surface)'}
					stroke="rgb({glow})"
					stroke-width="1.4"
					vector-effect="non-scaling-stroke"
				/>
			{/each}
		</svg>
	</div>
	<div class="mt-1 flex items-center justify-between gap-2 text-[11px]" style="color: var(--muted)">
		<span
			>📈 {metricaLabel} · últimas {Math.min(puntos.length, 10)}
			{Math.min(puntos.length, 10) === 1 ? 'sesión' : 'sesiones'}</span
		>
		<span>Último {ultimoChart.label} {unidad}</span>
	</div>
{/if}
