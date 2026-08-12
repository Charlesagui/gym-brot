<script lang="ts">
	import { liveQuery } from 'dexie';
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { db, type Dia, type Sesion } from '$lib/db';
	import { crearDia, reordenarDias } from '$lib/dias';
	import { hoyStr } from '$lib/sesion';
	import { serieCompleta } from '$lib/sesion-reglas';
	import { dur } from '$lib/motion';
	import { mantener } from '$lib/mantener';
	import { bienvenidaVisible, cerrarBienvenida } from '$lib/preferencias-ui';
	import { guardarSinBloquear, reportarErrorDatos } from '$lib/errores-datos';

	const dias = liveQuery(() => db.dias.orderBy('orden').toArray());
	let fechaHoy = $state(hoyStr());
	let hoy = $state(new Date().getDay());
	// Sesiones de hoy, para reflejar el progreso del día en la portada.
	const sesionesHoy = $derived(
		liveQuery(() => db.sesiones.where('fecha').equals(fechaHoy).toArray())
	);

	// Modo reordenar días: se entra con long-press; las cards se arrastran (svelte-dnd-action).
	interface ItemDia {
		id: string;
		nombre: string;
		color: string;
		sub: string;
	}
	let reordenando = $state(false);
	let ordenItems = $state<ItemDia[]>([]);
	const flipMs = dur(180);

	function entrarReordenar() {
		const lista = $dias;
		if (!lista || lista.length < 2) return; // con un solo día no hay nada que ordenar
		ordenItems = lista.map((d) => ({
			id: d.id,
			nombre: d.nombre,
			color: d.color ?? '124 92 255',
			sub: `${agendaDia(d)} · ${d.ejercicios.length} ejercicios`
		}));
		reordenando = true;
	}

	function alConsiderar(e: CustomEvent<DndEvent<ItemDia>>) {
		ordenItems = e.detail.items;
	}

	function guardarOrdenDias() {
		guardarSinBloquear(
			reordenarDias(ordenItems.map((it) => it.id)),
			'No se pudo guardar el nuevo orden de las rutinas. Intentá de nuevo.'
		);
	}

	function alSoltar(e: CustomEvent<DndEvent<ItemDia>>) {
		ordenItems = e.detail.items;
		guardarOrdenDias();
	}

	function moverDia(id: string, delta: -1 | 1) {
		const origen = ordenItems.findIndex((item) => item.id === id);
		const destino = origen + delta;
		if (origen < 0 || destino < 0 || destino >= ordenItems.length) return;
		const nuevos = [...ordenItems];
		const [movido] = nuevos.splice(origen, 1);
		nuevos.splice(destino, 0, movido!);
		ordenItems = nuevos;
		guardarOrdenDias();
	}

	interface ProgresoDia {
		completos: number;
		total: number;
		terminado: boolean;
	}

	/** Progreso de un día según la sesión de hoy (null si todavía no se tocó nada). */
	function progresoDia(dia: Dia, sesiones: Sesion[] | undefined): ProgresoDia | null {
		const sesion = sesiones?.find((s) => s.diaId === dia.id);
		if (!sesion || dia.ejercicios.length === 0) return null;
		let completos = 0;
		let conActividad = 0;
		for (const item of dia.ejercicios) {
			const e = sesion.ejercicios.find((x) => x.exerciseId === item.exerciseId);
			if (!e || e.sets.length === 0) continue;
			// Saltado cuenta como resuelto (igual que en la pantalla del día).
			if (e.saltado) {
				conActividad++;
				completos++;
				continue;
			}
			if (e.sets.some(serieCompleta)) conActividad++;
			if (e.sets.every(serieCompleta)) completos++;
		}
		if (conActividad === 0 && !sesion.diaTerminado) return null;
		return { completos, total: dia.ejercicios.length, terminado: !!sesion.diaTerminado };
	}

	async function nuevoDia() {
		try {
			const id = await crearDia();
			await goto(`/dia/${id}`);
		} catch (error) {
			reportarErrorDatos('No se pudo crear la rutina. Intentá de nuevo.', error);
		}
	}
	const nombresDia = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
	const abrevDia = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

	function agendaDia(dia: Dia): string {
		if (!dia.diasSemana?.length) return 'Sin día asignado';
		return dia.diasSemana.map((i) => abrevDia[i]).join(' · ');
	}

	let mostrarWelcome = $state(false);
	onMount(() => {
		function refrescarHoy() {
			fechaHoy = hoyStr();
			hoy = new Date().getDay();
		}

		refrescarHoy();
		mostrarWelcome = bienvenidaVisible();
		document.addEventListener('visibilitychange', refrescarHoy);
		window.addEventListener('focus', refrescarHoy);
		return () => {
			document.removeEventListener('visibilitychange', refrescarHoy);
			window.removeEventListener('focus', refrescarHoy);
		};
	});
	function cerrarWelcome() {
		cerrarBienvenida();
		mostrarWelcome = false;
	}
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-5rem)] px-5 pb-12 pt-10">
	<header class="mb-7 text-center">
		<h1 class="text-3xl font-extrabold tracking-tight">
			GYM<span style="color: var(--accent-text)">·</span>BROT
		</h1>
		<p class="mt-1 text-xs capitalize" style="color: var(--muted)">{nombresDia[hoy]}</p>
	</header>

	{#if mostrarWelcome}
		<div
			class="mb-6 rounded-2xl border border-white/10 p-4 relative"
			style="background: radial-gradient(100% 100% at 0% 0%, rgba(99, 102, 241, 0.15), transparent), var(--surface)"
		>
			<button
				onclick={cerrarWelcome}
				class="absolute right-1 top-1 grid size-11 place-items-center text-sm font-bold"
				style="color: var(--muted)"
				aria-label="Cerrar bienvenida"
			>
				✕
			</button>
			<h2 class="text-sm font-bold" style="color: var(--accent-text)">
				👋 ¡Te damos la bienvenida!
			</h2>
			<p class="mt-1.5 text-xs leading-relaxed" style="color: var(--muted)">
				Agregamos rutinas de ejemplo para que explores la app. Podés editarlas o eliminarlas en
				cualquier momento. ¡Comenzá tocando una rutina!
			</p>
		</div>
	{/if}

	{#if $dias}
		{#if reordenando}
			<p
				class="mb-3 text-center text-xs font-semibold uppercase tracking-wider"
				style="color: var(--muted)"
			>
				Arrastrá o usá las flechas para ordenar
			</p>
			<section
				use:dndzone={{ items: ordenItems, flipDurationMs: flipMs, dropTargetStyle: {} }}
				onconsider={alConsiderar}
				onfinalize={alSoltar}
				class="space-y-3"
			>
				{#each ordenItems as it (it.id)}
					<div
						animate:flip={{ duration: flipMs }}
						class="flex touch-none items-center gap-3 rounded-2xl border border-white/10 p-4"
						style="background: linear-gradient(90deg, rgb({it.color} / 0.12), transparent 55%), var(--surface)"
					>
						<span
							class="shrink-0 text-lg leading-none"
							style="color: var(--muted)"
							aria-hidden="true">⠿</span
						>
						<span class="h-11 w-1.5 shrink-0 rounded-full" style="background: rgb({it.color})"
						></span>
						<div class="min-w-0 flex-1">
							<p class="truncate font-semibold leading-tight">{it.nombre}</p>
							<p class="truncate text-xs" style="color: var(--muted)">{it.sub}</p>
						</div>
						<div class="flex shrink-0 gap-1">
							<button
								onpointerdown={(evento) => evento.stopPropagation()}
								onclick={() => moverDia(it.id, -1)}
								disabled={ordenItems[0]?.id === it.id}
								class="grid size-11 place-items-center rounded-full bg-white/[0.06] text-sm disabled:opacity-30"
								aria-label={`Subir ${it.nombre}`}>↑</button
							>
							<button
								onpointerdown={(evento) => evento.stopPropagation()}
								onclick={() => moverDia(it.id, 1)}
								disabled={ordenItems.at(-1)?.id === it.id}
								class="grid size-11 place-items-center rounded-full bg-white/[0.06] text-sm disabled:opacity-30"
								aria-label={`Bajar ${it.nombre}`}>↓</button
							>
						</div>
					</div>
				{/each}
			</section>
			<button
				onclick={() => (reordenando = false)}
				class="mt-5 w-full rounded-2xl py-3 text-sm font-bold"
				style="background: var(--accent); color: var(--on-accent)">✓ Listo</button
			>
		{:else}
			{@const hoyDias = $dias.filter((d) => d.diasSemana?.includes(hoy))}
			{#if hoyDias.length > 0}
				<div class="gb-landscape-cards mb-6 space-y-3">
					{#each hoyDias as hoyDia (hoyDia.id)}
						{@const prog = progresoDia(hoyDia, $sesionesHoy)}
						<a
							href={`/dia/${hoyDia.id}`}
							class="block rounded-2xl border border-white/10 p-4"
							style="background: radial-gradient(120% 130% at 0% 0%, rgb({hoyDia.color} / 0.30), transparent 62%), var(--surface)"
						>
							<div class="flex items-center justify-between gap-3">
								<p
									class="text-[11px] font-bold uppercase tracking-[0.2em]"
									style="color: rgb({hoyDia.color})"
								>
									Hoy entrenás
								</p>
								{#if prog?.terminado}
									<span
										class="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
										style="background: rgb(var(--exito) / .16); color: rgb(var(--exito))"
										>✓ Terminado</span
									>
								{/if}
							</div>
							<p class="mt-1 text-2xl font-bold leading-tight">{hoyDia.nombre}</p>
							{#if prog && !prog.terminado}
								<p class="mt-0.5 text-xs font-semibold" style="color: rgb({hoyDia.color})">
									{prog.completos}/{prog.total} ejercicios hechos →
								</p>
							{:else}
								<p class="mt-0.5 text-xs" style="color: var(--muted)">
									{agendaDia(hoyDia)} · {hoyDia.ejercicios.length} ejercicios →
								</p>
							{/if}
						</a>
					{/each}
				</div>
			{:else}
				<div
					class="mb-6 rounded-2xl border border-white/10 p-4 text-center"
					style="background: var(--surface)"
				>
					<p class="text-2xl">💤</p>
					<p class="mt-1 text-sm font-semibold">Hoy es tu día de descanso</p>
					<p class="mt-0.5 text-xs" style="color: var(--muted)">
						No tenés rutinas agendadas. Si igual entrenás, tocá cualquier rutina de abajo: se
						registra con la fecha de hoy.
					</p>
				</div>
			{/if}

			<div class="mb-2 flex min-h-11 items-center justify-between gap-3 px-1">
				<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
					Tus días
				</p>
				{#if $dias.length > 1}
					<button
						onclick={entrarReordenar}
						class="min-h-11 rounded-full px-3 text-xs font-bold"
						style="color: var(--accent-text)"
						aria-label="Reordenar rutinas">↕ Reordenar</button
					>
				{/if}
			</div>
			<div class="gb-landscape-cards space-y-3">
				{#each $dias as d, i (d.id)}
					{@const prog = progresoDia(d, $sesionesHoy)}
					<a
						href={`/dia/${d.id}`}
						use:mantener={entrarReordenar}
						in:fly={{ y: 12, duration: dur(250), delay: dur(i * 45) }}
						class="flex items-center gap-3 rounded-2xl border border-white/10 p-4"
						style="background: linear-gradient(90deg, rgb({d.color} / 0.12), transparent 55%), var(--surface)"
					>
						<span class="h-11 w-1.5 rounded-full" style="background: rgb({d.color})"></span>
						<div class="flex-1">
							<p class="font-semibold leading-tight">{d.nombre}</p>
							<p class="text-xs" style="color: var(--muted)">
								{agendaDia(d)} · {d.ejercicios.length} ejercicios
							</p>
						</div>
						{#if prog?.terminado}
							<span
								class="rounded-full px-2.5 py-1 text-[11px] font-bold"
								style="background: rgb(var(--exito) / .16); color: rgb(var(--exito))">✓ Hoy</span
							>
						{:else if prog}
							<span class="text-xs font-bold tabular-nums" style="color: rgb({d.color})"
								>{prog.completos}/{prog.total}</span
							>
						{:else}
							<span class="text-2xl" aria-hidden="true" style="color: var(--muted)">›</span>
						{/if}
					</a>
				{/each}
			</div>

			<button
				onclick={nuevoDia}
				class="mt-4 w-full rounded-2xl border border-dashed border-white/20 p-4 text-sm font-medium"
				style="color: var(--accent-text)"
			>
				+ Nuevo día
			</button>
		{/if}
	{:else}
		<p class="text-center text-sm" style="color: var(--muted)">Cargando…</p>
	{/if}
</main>
