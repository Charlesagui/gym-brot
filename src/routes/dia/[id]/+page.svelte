<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { liveQuery } from 'dexie';
	import { db, type Dia, type Sesion } from '$lib/db';
	import { ejercicioPorId, grupos } from '$lib/catalog';
	import { actualizarDia, borrarDia, quitarEjercicio, setSeries, coloresDia } from '$lib/dias';
	import { sesionHoyObs } from '$lib/sesion';

	let dia = $state<Dia | undefined>(undefined);
	let cargando = $state(true);
	let editando = $state(false);
	let nombreEdit = $state('');
	let sesion = $state<Sesion | undefined>(undefined);

	const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

	$effect(() => {
		const id = $page.params.id;
		cargando = true;
		const sub = liveQuery(() => db.dias.get(id)).subscribe((d) => {
			dia = d;
			cargando = false;
		});
		return () => sub.unsubscribe();
	});

	$effect(() => {
		const id = $page.params.id;
		const sub = sesionHoyObs(id).subscribe((s) => (sesion = s));
		return () => sub.unsubscribe();
	});

	function progreso(exId: string): { hechas: number; total: number } | null {
		const e = sesion?.ejercicios.find((x) => x.exerciseId === exId);
		if (!e || e.sets.length === 0) return null;
		return { hechas: e.sets.filter((s) => s.hecha).length, total: e.sets.length };
	}

	function abrirEdicion() {
		nombreEdit = dia?.nombre ?? '';
		editando = true;
	}
	function guardarNombre() {
		if (dia && nombreEdit.trim()) actualizarDia(dia.id, { nombre: nombreEdit.trim() });
	}
	async function eliminar() {
		if (dia && confirm(`¿Borrar el día "${dia.nombre}"?`)) {
			await borrarDia(dia.id);
			goto('/');
		}
	}
</script>

<main class="glow-bg min-h-dvh px-5 pb-12 pt-6">
	<header class="mb-5 flex items-center gap-3">
		<a
			href="/"
			class="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
			aria-label="Volver">←</a
		>
		{#if editando}
			<input
				bind:value={nombreEdit}
				onblur={guardarNombre}
				class="min-w-0 flex-1 rounded-lg bg-white/5 px-3 py-1.5 text-lg font-bold outline-none"
				placeholder="Nombre del día"
			/>
			<button
				onclick={() => (editando = false)}
				class="shrink-0 rounded-full px-4 py-1.5 text-sm font-bold"
				style="background: var(--accent); color: white">Listo</button
			>
		{:else}
			<h1 class="flex-1 text-xl font-bold">{dia?.nombre ?? ''}</h1>
			{#if dia}
				<button
					onclick={abrirEdicion}
					class="grid size-9 shrink-0 place-items-center rounded-full border border-white/10"
					aria-label="Editar">✏️</button
				>
			{/if}
		{/if}
	</header>

	{#if cargando}
		<p class="text-center text-sm" style="color: var(--muted)">Cargando…</p>
	{:else if !dia}
		<p class="text-center text-sm" style="color: var(--muted)">Día no encontrado.</p>
	{:else}
		{#if editando}
			<p class="mb-2 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Día de la semana
			</p>
			<div class="mb-4 flex gap-1.5">
				{#each diasSemana as d, i (i)}
					<button
						onclick={() =>
							actualizarDia(dia.id, { diaSemana: dia.diaSemana === i ? undefined : i })}
						class="flex-1 rounded-lg py-2 text-xs font-semibold"
						style={dia.diaSemana === i
							? 'background: var(--accent); color: white'
							: 'background: rgba(255,255,255,.05); color: var(--muted)'}>{d}</button
					>
				{/each}
			</div>

			<p class="mb-2 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Color
			</p>
			<div class="mb-6 flex gap-2.5">
				{#each coloresDia as c (c.rgb)}
					<button
						onclick={() => actualizarDia(dia.id, { color: c.rgb })}
						class="size-8 rounded-full transition"
						style="background: rgb({c.rgb}); outline: {dia.color === c.rgb
							? '2px solid white'
							: '2px solid transparent'}; outline-offset: 2px"
						aria-label={c.nombre}
					></button>
				{/each}
			</div>
		{/if}

		<div class="space-y-3">
			{#each dia.ejercicios.slice().sort((a, b) => a.orden - b.orden) as item (item.exerciseId)}
				{@const e = ejercicioPorId(item.exerciseId)}
				{#if e}
					{@const g = grupos[e.grupo]}
					{@const p = progreso(e.id)}
					{#if editando}
						<div
							class="flex items-center gap-3 rounded-2xl border border-white/10 p-2.5"
							style="background: radial-gradient(150% 130% at 0% 0%, rgb({g.glow} / 0.14), transparent 60%), var(--surface)"
						>
							<img
								src={e.gif}
								alt={e.nombre}
								class="size-14 shrink-0 rounded-xl bg-white object-contain"
								loading="lazy"
							/>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-semibold leading-tight">{e.nombre}</p>
								<div class="mt-1.5 flex items-center gap-2">
									<button
										onclick={() => setSeries(dia.id, e.id, item.seriesObjetivo - 1)}
										class="grid size-6 place-items-center rounded-full bg-white/10 text-sm"
										aria-label="Menos series">−</button
									>
									<span class="text-sm font-semibold tabular-nums">{item.seriesObjetivo} series</span>
									<button
										onclick={() => setSeries(dia.id, e.id, item.seriesObjetivo + 1)}
										class="grid size-6 place-items-center rounded-full bg-white/10 text-sm"
										aria-label="Más series">+</button
									>
								</div>
							</div>
							<button
								onclick={() => quitarEjercicio(dia.id, e.id)}
								class="grid size-8 shrink-0 place-items-center rounded-full text-sm"
								style="background: rgba(255,80,80,.15); color: #ff6b6b"
								aria-label="Quitar">✕</button
							>
						</div>
					{:else}
						<a
							href={`/ejercicio/${e.id}?dia=${dia.id}`}
							class="flex items-center gap-3 rounded-2xl border border-white/10 p-2.5"
							style="background: radial-gradient(150% 130% at 0% 0%, rgb({g.glow} / 0.14), transparent 60%), var(--surface)"
						>
							<img
								src={e.gif}
								alt={e.nombre}
								class="size-16 shrink-0 rounded-xl bg-white object-contain"
								loading="lazy"
							/>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-semibold leading-tight">{e.nombre}</p>
								<p class="mt-0.5 text-xs font-medium" style="color: rgb({g.glow})">
									{g.emoji} {g.label}
								</p>
							</div>
							<div class="pr-1 text-right">
								{#if p && p.hechas === p.total}
									<p class="text-xl leading-none" style="color: rgb({g.glow})">✓</p>
									<p class="text-[10px]" style="color: var(--muted)">hecho</p>
								{:else if p}
									<p class="text-lg font-bold leading-none">{p.hechas}/{p.total}</p>
									<p class="text-[10px]" style="color: var(--muted)">series</p>
								{:else}
									<p class="text-lg font-bold leading-none">{item.seriesObjetivo}</p>
									<p class="text-[10px]" style="color: var(--muted)">series</p>
								{/if}
							</div>
						</a>
					{/if}
				{/if}
			{/each}

			{#if dia.ejercicios.length === 0}
				<p
					class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm"
					style="color: var(--muted)"
				>
					Sin ejercicios todavía. Agregá el primero 👇
				</p>
			{/if}
		</div>

		<a
			href={`/dia/${dia.id}/agregar`}
			class="mt-4 block rounded-2xl border border-dashed border-white/20 p-4 text-center text-sm font-medium"
			style="color: var(--accent)">+ Agregar ejercicio</a
		>

		{#if editando}
			<button
				onclick={eliminar}
				class="mt-3 w-full rounded-2xl border border-white/10 p-3 text-sm"
				style="color: #ff6b6b">🗑 Borrar día</button
			>
		{/if}
	{/if}
</main>
