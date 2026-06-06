<script lang="ts">
	import { liveQuery } from 'dexie';
	import { goto } from '$app/navigation';
	import { db } from '$lib/db';
	import { crearDia } from '$lib/dias';

	const dias = liveQuery(() => db.dias.orderBy('orden').toArray());

	async function nuevoDia() {
		const id = await crearDia();
		goto(`/dia/${id}`);
	}
	const hoy = new Date().getDay();
	const nombresDia = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
</script>

<main class="glow-bg min-h-dvh px-5 pb-12 pt-10">
	<header class="mb-7 text-center">
		<h1 class="text-3xl font-extrabold tracking-tight">
			GYM<span style="color: var(--accent)">·</span>BROT
		</h1>
		<p class="mt-1 text-xs capitalize" style="color: var(--muted)">{nombresDia[hoy]}</p>
	</header>

	{#if $dias}
		{@const hoyDia = $dias.find((d) => d.diaSemana === hoy)}
		{#if hoyDia}
			<a
				href={`/dia/${hoyDia.id}`}
				class="mb-6 block rounded-2xl border border-white/10 p-4"
				style="background: radial-gradient(120% 130% at 0% 0%, rgb({hoyDia.color} / 0.30), transparent 62%), var(--surface)"
			>
				<p class="text-[11px] font-bold uppercase tracking-[0.2em]" style="color: rgb({hoyDia.color})">
					Hoy entrenás
				</p>
				<p class="mt-1 text-2xl font-bold leading-tight">{hoyDia.nombre}</p>
				<p class="mt-0.5 text-xs" style="color: var(--muted)">
					{hoyDia.ejercicios.length} ejercicios →
				</p>
			</a>
		{/if}

		<p class="mb-2 px-1 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
			Tus días
		</p>
		<div class="space-y-3">
			{#each $dias as d (d.id)}
				<a
					href={`/dia/${d.id}`}
					class="flex items-center gap-3 rounded-2xl border border-white/10 p-4"
					style="background: linear-gradient(90deg, rgb({d.color} / 0.12), transparent 55%), var(--surface)"
				>
					<span class="h-11 w-1.5 rounded-full" style="background: rgb({d.color})"></span>
					<div class="flex-1">
						<p class="font-semibold leading-tight">{d.nombre}</p>
						<p class="text-xs" style="color: var(--muted)">{d.ejercicios.length} ejercicios</p>
					</div>
					<span class="text-2xl" style="color: var(--muted)">›</span>
				</a>
			{/each}
		</div>

		<button
			onclick={nuevoDia}
			class="mt-4 w-full rounded-2xl border border-dashed border-white/20 p-4 text-sm font-medium"
			style="color: var(--accent)"
		>
			+ Nuevo día
		</button>
	{:else}
		<p class="text-center text-sm" style="color: var(--muted)">Cargando…</p>
	{/if}
</main>
