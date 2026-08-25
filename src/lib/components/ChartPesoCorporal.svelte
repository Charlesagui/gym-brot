<script lang="ts">
	import type { PesoCorporal } from '$lib/db';
	import { gramosAPeso, type UnidadPeso } from '$lib/unidades';
	import { formatoNumero, fechaCorta } from '$lib/formato';

	type Rango = '3m' | '1a' | 'todo';
	let {
		pesos,
		metaPesoGramos,
		unidad
	}: { pesos: PesoCorporal[]; metaPesoGramos?: number; unidad: UnidadPeso } = $props();
	let rango = $state<Rango>('3m');

	const rangos: { id: Rango; label: string }[] = [
		{ id: '3m', label: '3 meses' },
		{ id: '1a', label: '1 año' },
		{ id: 'todo', label: 'Todo' }
	];

	function corte(valor: Rango): string | null {
		if (valor === 'todo') return null;
		const fecha = new Date();
		if (valor === '3m') fecha.setMonth(fecha.getMonth() - 3);
		else fecha.setFullYear(fecha.getFullYear() - 1);
		return fecha.toLocaleDateString('sv');
	}

	const visibles = $derived.by(() => {
		const desde = corte(rango);
		return [...pesos]
			.filter((peso) => desde == null || peso.fecha >= desde)
			.sort((a, b) => a.fecha.localeCompare(b.fecha));
	});
	const meta = $derived(gramosAPeso(metaPesoGramos, unidad));
	const puntos = $derived.by(() => {
		const valores = visibles.map((peso) => gramosAPeso(peso.pesoGramos, unidad)!);
		const dominio = meta == null ? valores : [...valores, meta];
		if (!dominio.length) return [];
		const minimoBase = Math.min(...dominio);
		const maximoBase = Math.max(...dominio);
		const margen = Math.max(1, (maximoBase - minimoBase) * 0.15);
		const min = minimoBase - margen;
		const max = maximoBase + margen;
		return visibles.map((peso, indice) => ({
			...peso,
			valor: gramosAPeso(peso.pesoGramos, unidad)!,
			x: visibles.length === 1 ? 160 : 18 + (indice / (visibles.length - 1)) * 284,
			y: 12 + ((max - gramosAPeso(peso.pesoGramos, unidad)!) / (max - min)) * 132,
			metaY: meta == null ? null : 12 + ((max - meta) / (max - min)) * 132
		}));
	});
	const path = $derived(puntos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' '));
	const ultimo = $derived(puntos.at(-1));
</script>

<div class="flex gap-2" aria-label="Período del gráfico">
	{#each rangos as opcion (opcion.id)}
		<button
			type="button"
			onclick={() => (rango = opcion.id)}
			aria-pressed={rango === opcion.id}
			class="min-h-11 flex-1 rounded-full px-3 text-xs font-bold"
			style={rango === opcion.id
				? 'background: var(--accent); color: var(--on-accent)'
				: 'background: rgba(255,255,255,.06); color: var(--muted)'}>{opcion.label}</button
		>
	{/each}
</div>

{#if puntos.length === 0}
	<p
		class="mt-3 rounded-xl border border-dashed border-white/15 p-5 text-center text-sm"
		style="color: var(--muted)"
	>
		Todavía no hay mediciones en este período.
	</p>
{:else}
	<div
		class="mt-3"
		role="img"
		aria-label={`Evolución del peso corporal: ${puntos.length} mediciones, último ${formatoNumero(ultimo!.valor)} ${unidad}${meta == null ? '' : `, meta ${formatoNumero(meta)} ${unidad}`}`}
	>
		<svg viewBox="0 0 320 160" class="h-48 w-full" aria-hidden="true">
			<line x1="18" x2="302" y1="144" y2="144" stroke="rgba(255,255,255,.12)" />
			{#if meta != null && puntos[0]?.metaY != null}
				<line
					x1="18"
					x2="302"
					y1={puntos[0].metaY}
					y2={puntos[0].metaY}
					stroke="rgb(var(--exito))"
					stroke-width="1.5"
					stroke-dasharray="5 4"
				/>
				<text
					x="300"
					y={Math.max(10, puntos[0].metaY - 5)}
					text-anchor="end"
					fill="rgb(var(--exito))"
					font-size="9">Meta</text
				>
			{/if}
			{#if puntos.length > 1}
				<path
					d={path}
					fill="none"
					stroke="var(--accent-text)"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{/if}
			{#each puntos as punto (punto.fecha)}
				<circle
					cx={punto.x}
					cy={punto.y}
					r="4"
					fill="var(--surface)"
					stroke="var(--accent-text)"
					stroke-width="2"
				/>
			{/each}
		</svg>
	</div>
	<details class="mt-1 rounded-xl bg-white/[0.025] px-3 py-2 text-xs" style="color: var(--muted)">
		<summary class="flex min-h-11 cursor-pointer items-center font-semibold"
			>Ver los datos del gráfico</summary
		>
		<ul class="mt-2 space-y-1">
			{#each visibles as peso (peso.fecha)}
				<li>
					{fechaCorta(peso.fecha, true)}: {formatoNumero(gramosAPeso(peso.pesoGramos, unidad)!)}
					{unidad}
				</li>
			{/each}
			{#if meta != null}<li class="font-semibold">Meta: {formatoNumero(meta)} {unidad}</li>{/if}
		</ul>
	</details>
{/if}
