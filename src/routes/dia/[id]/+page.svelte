<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { liveQuery } from 'dexie';
	import { db, type Ajustes, type Dia, type Sesion } from '$lib/db';
	import { ejercicioPorId, grupos } from '$lib/catalog';
	import {
		actualizarDia,
		ajustarSeries,
		borrarDia,
		quitarEjercicio,
		toggleDiaSemana,
		coloresDia,
		reordenarEjercicios
	} from '$lib/dias';
	import { mantener } from '$lib/mantener';
	import {
		hoyStr,
		marcarDiaTerminado,
		reabrirDia,
		sesionHoyObs,
		saltarEjercicio,
		reanudarEjercicio
	} from '$lib/sesion';
	import { ajustesObs, AJUSTES_DEFAULT } from '$lib/extras';
	import { resumenDiaSesion } from '$lib/historial';
	import { sonarDiaTerminado } from '$lib/audio';
	import { reproducirEnVista } from '$lib/video';
	import { dur } from '$lib/motion';
	import { fromLiveQuery } from '$lib/live';
	import { formatoVolumen } from '$lib/formato';
	import ConfirmSheet from '$lib/components/ConfirmSheet.svelte';
	import { guardarSinBloquear, reportarErrorDatos } from '$lib/errores-datos';

	let dia = $state<Dia | undefined>(undefined);
	let cargando = $state(true);
	let editando = $state(false);
	let nombreEdit = $state('');
	let premioDia = $state(false);
	let premioId: ReturnType<typeof setTimeout> | null = null;
	let confirmacion = $state<{
		titulo: string;
		mensaje: string;
		confirmarTexto: string;
		onConfirm: () => void | Promise<void>;
	} | null>(null);
	// Modo reordenar: se entra con long-press; las cards se arrastran (svelte-dnd-action).
	interface ItemOrden {
		id: string;
		nombre: string;
		demoVideo: string;
		glow: string;
		emoji: string;
	}
	let reordenando = $state(false);
	let ordenItems = $state<ItemOrden[]>([]);
	const flipMs = dur(180);

	const diaId = $derived($page.params.id!);

	const abrevDia = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
	const grupoArchivado = { label: 'Archivado', glow: '148 163 184', emoji: '·' };

	// El día gestiona su propio flag de carga; la sesión y los ajustes son stores legibles con `$`.
	$effect(() => {
		const id = diaId;
		cargando = true;
		const sub = liveQuery(() => db.dias.get(id)).subscribe((d) => {
			dia = d;
			cargando = false;
		});
		return () => sub.unsubscribe();
	});

	// Fecha reactiva: si la app queda abierta y cruza la medianoche, al volver
	// a la vista la pantalla apunta a la sesión del día nuevo (no a la de ayer).
	let fechaHoy = $state(hoyStr());
	const sesionStore = $derived(fromLiveQuery(sesionHoyObs(diaId, fechaHoy), undefined));
	const sesion = $derived<Sesion | undefined>($sesionStore);
	const ajustesStore = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const ajustes = $derived<Ajustes>($ajustesStore);

	onMount(() => {
		const refrescarHoy = () => (fechaHoy = hoyStr());
		document.addEventListener('visibilitychange', refrescarHoy);
		window.addEventListener('focus', refrescarHoy);
		return () => {
			document.removeEventListener('visibilitychange', refrescarHoy);
			window.removeEventListener('focus', refrescarHoy);
		};
	});

	onDestroy(() => {
		if (premioId) clearTimeout(premioId);
	});

	function progreso(exId: string): { hechas: number; total: number } | null {
		const e = sesion?.ejercicios.find((x) => x.exerciseId === exId);
		if (!e || e.sets.length === 0) return null;
		return { hechas: e.sets.filter((s) => s.hecha).length, total: e.sets.length };
	}

	function estaCompleto(exId: string): boolean {
		const p = progreso(exId);
		return !!p && p.total > 0 && p.hechas === p.total;
	}

	function estaSaltado(exId: string): boolean {
		return !!sesion?.ejercicios.find((x) => x.exerciseId === exId)?.saltado;
	}

	const ejerciciosCompletos = $derived(
		dia?.ejercicios.filter((item) => estaCompleto(item.exerciseId)).length ?? 0
	);
	const ejerciciosSaltados = $derived(
		dia?.ejercicios.filter((item) => estaSaltado(item.exerciseId)).length ?? 0
	);
	// Un ejercicio "resuelto" está hecho o saltado: ninguno bloquea terminar el día.
	const ejerciciosResueltos = $derived(
		dia?.ejercicios.filter((item) => estaCompleto(item.exerciseId) || estaSaltado(item.exerciseId))
			.length ?? 0
	);
	const totalEjercicios = $derived(dia?.ejercicios.length ?? 0);
	const diaListo = $derived(totalEjercicios > 0 && ejerciciosResueltos === totalEjercicios);
	const diaTerminado = $derived(!!sesion?.diaTerminado);
	const sonidoActivo = $derived(ajustes.sonido);
	const resumenDia = $derived(resumenDiaSesion(sesion));

	function abrirEdicion() {
		nombreEdit = dia?.nombre ?? '';
		editando = true;
	}
	function guardarNombre() {
		if (dia && nombreEdit.trim()) {
			guardarSinBloquear(
				actualizarDia(diaId, { nombre: nombreEdit.trim() }),
				'No se pudo guardar el nombre de la rutina. Intentá de nuevo.'
			);
		}
	}
	async function eliminar() {
		if (!dia) return;
		confirmacion = {
			titulo: 'Borrar día',
			mensaje: `Vas a borrar "${dia.nombre}" de tus rutinas. El historial ya registrado no se borra.`,
			confirmarTexto: 'Borrar',
			onConfirm: async () => {
				await borrarDia(diaId);
				confirmacion = null;
				goto('/');
			}
		};
	}

	async function terminarDia() {
		if (!diaListo || diaTerminado) return;
		// La fecha va explícita: con `hoyStr()` adentro, terminar el día pasada la
		// medianoche marcaba una sesión nueva y vacía y dejaba abierta la real.
		try {
			await marcarDiaTerminado(diaId, fechaHoy);
		} catch (error) {
			reportarErrorDatos('No se pudo marcar la rutina como terminada. Intentá de nuevo.', error);
			return;
		}
		premioDia = true;
		if (sonidoActivo) void sonarDiaTerminado().catch(() => {});
		if ((ajustes.vibracion ?? true) && 'vibrate' in navigator)
			navigator.vibrate([120, 70, 120, 70, 220]);
		if (premioId) clearTimeout(premioId);
		premioId = setTimeout(() => (premioDia = false), 2400);
	}

	async function reabrir() {
		cerrarPremio();
		try {
			await reabrirDia(diaId, fechaHoy);
		} catch (error) {
			reportarErrorDatos('No se pudo reabrir la rutina. Intentá de nuevo.', error);
		}
	}

	function cerrarPremio() {
		premioDia = false;
		if (premioId) clearTimeout(premioId);
		premioId = null;
	}

	function entrarReordenar() {
		if (!dia) return;
		ordenItems = [...dia.ejercicios]
			.sort((a, b) => a.orden - b.orden)
			.map((it) => {
				const e = ejercicioPorId(it.exerciseId);
				const g = e ? grupos[e.grupo] : undefined;
				return {
					id: it.exerciseId,
					nombre: e?.nombre ?? it.exerciseId,
					demoVideo: e?.demoVideo ?? '',
					glow: g?.glow ?? '124 92 255',
					emoji: g?.emoji ?? ''
				};
			});
		reordenando = true;
	}

	function alConsiderar(e: CustomEvent<DndEvent<ItemOrden>>) {
		ordenItems = e.detail.items;
	}

	function alSoltar(e: CustomEvent<DndEvent<ItemOrden>>) {
		ordenItems = e.detail.items;
		guardarSinBloquear(
			reordenarEjercicios(
				diaId,
				ordenItems.map((it) => it.id)
			),
			'No se pudo guardar el orden de los ejercicios. Intentá de nuevo.'
		);
	}

	async function quitarEnReorden(it: ItemOrden) {
		confirmacion = {
			titulo: 'Quitar ejercicio',
			mensaje: `Vas a quitar "${it.nombre}" de este día. Si lo volvés a agregar, puede perder su configuración de series objetivo.`,
			confirmarTexto: 'Quitar',
			onConfirm: async () => {
				ordenItems = ordenItems.filter((x) => x.id !== it.id);
				await quitarEjercicio(diaId, it.id);
				confirmacion = null;
			}
		};
	}

	function confirmarQuitarEjercicio(nombre: string, exerciseId: string) {
		confirmacion = {
			titulo: 'Quitar ejercicio',
			mensaje: `Vas a quitar "${nombre}" de este día. Si lo volvés a agregar, puede perder su configuración de series objetivo.`,
			confirmarTexto: 'Quitar',
			onConfirm: async () => {
				await quitarEjercicio(diaId, exerciseId);
				confirmacion = null;
			}
		};
	}
</script>

<main class="gb-page glow-bg min-h-dvh px-5 pb-12 pt-6">
	<header class="mb-5 flex items-center gap-3">
		<a
			href="/"
			class="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
			aria-label="Volver">←</a
		>
		{#if editando}
			<input
				bind:value={nombreEdit}
				onblur={guardarNombre}
				class="min-w-0 flex-1 rounded-lg bg-white/5 px-3 py-1.5 text-lg font-bold outline-none"
				placeholder="Nombre del día (ej: Piernas, Pecho…)"
			/>
			<button
				onclick={() => (editando = false)}
				class="min-h-10 shrink-0 rounded-full px-4 py-2 text-sm font-bold"
				style="background: var(--accent); color: white">✓ Listo</button
			>
		{:else}
			<h1 class="flex-1 text-xl font-bold">{dia?.nombre ?? ''}</h1>
			{#if dia && !reordenando}
				<button
					onclick={abrirEdicion}
					class="flex min-h-10 items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-sm font-semibold"
					aria-label="Editar">✏️ Editar</button
				>
			{/if}
		{/if}
	</header>

	{#if cargando}
		<p class="text-center text-sm" style="color: var(--muted)">Cargando…</p>
	{:else if !dia}
		<p class="text-center text-sm" style="color: var(--muted)">Día no encontrado.</p>
	{:else if reordenando}
		<p
			class="mb-3 text-center text-xs font-semibold uppercase tracking-wider"
			style="color: var(--muted)"
		>
			Arrastrá para ordenar
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
					class="flex touch-none items-center gap-3 rounded-2xl border border-white/10 p-2.5"
					style="background: radial-gradient(150% 130% at 0% 0%, rgb({it.glow} / 0.14), transparent 60%), var(--surface)"
				>
					<span class="shrink-0 text-lg leading-none" style="color: var(--muted)" aria-hidden="true"
						>⠿</span
					>
					<video
						use:reproducirEnVista={it.demoVideo}
						class="size-14 shrink-0 rounded-xl bg-white object-contain"
						aria-label={it.nombre}
						loop
						muted
						playsinline
						preload="none"
					></video>
					<p class="min-w-0 flex-1 truncate text-sm font-semibold leading-tight">{it.nombre}</p>
					<span class="shrink-0 text-base" aria-hidden="true">{it.emoji}</span>
					<button
						onpointerdown={(ev) => ev.stopPropagation()}
						onclick={() => quitarEnReorden(it)}
						class="grid size-10 shrink-0 place-items-center rounded-full text-sm"
						style="background: rgba(255,80,80,.15); color: #ff6b6b"
						aria-label={`Quitar ${it.nombre}`}>✕</button
					>
				</div>
			{/each}
		</section>
		<button
			onclick={() => (reordenando = false)}
			class="mt-5 w-full rounded-2xl py-3 text-sm font-bold"
			style="background: var(--accent); color: white">✓ Listo</button
		>
	{:else}
		{#if editando}
			<p class="mb-2 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Días de la semana (podés elegir varios)
			</p>
			<div class="mb-4 flex gap-1.5">
				{#each abrevDia as d, i (i)}
					<button
						onclick={() =>
							guardarSinBloquear(
								toggleDiaSemana(diaId, i),
								'No se pudo guardar el día de entrenamiento. Intentá de nuevo.'
							)}
						class="min-h-11 flex-1 rounded-lg py-2 text-xs font-semibold"
						aria-pressed={dia.diasSemana?.includes(i) ?? false}
						aria-label={`Entrenar los días ${d}`}
						style={dia.diasSemana?.includes(i)
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
						onclick={() =>
							guardarSinBloquear(
								actualizarDia(diaId, { color: c.rgb }),
								'No se pudo guardar el color de la rutina. Intentá de nuevo.'
							)}
						class="size-8 rounded-full transition"
						aria-pressed={dia.color === c.rgb}
						aria-label={`Color ${c.nombre}`}
						style="background: rgb({c.rgb}); outline: {dia.color === c.rgb
							? '2px solid white'
							: '2px solid transparent'}; outline-offset: 2px"
					></button>
				{/each}
			</div>
		{/if}

		<div class="gb-landscape-cards space-y-3">
			{#each dia.ejercicios.slice().sort((a, b) => a.orden - b.orden) as item (item.exerciseId)}
				{@const e = ejercicioPorId(item.exerciseId)}
				{@const g = e ? grupos[e.grupo] : grupoArchivado}
				{@const nombre = e?.nombre ?? 'Ejercicio archivado'}
				{@const p = progreso(item.exerciseId)}
				{@const saltado = estaSaltado(item.exerciseId)}
				{#if editando}
					<div
						class="flex items-center gap-3 rounded-2xl border border-white/10 p-2.5"
						style="background: radial-gradient(150% 130% at 0% 0%, rgb({g.glow} / 0.14), transparent 60%), var(--surface)"
					>
						{#if e}
							<video
								use:reproducirEnVista={e.demoVideo}
								class="size-14 shrink-0 rounded-xl bg-white object-contain"
								aria-label={e.nombre}
								loop
								muted
								playsinline
								preload="none"
							></video>
						{:else}
							<div
								class="grid size-14 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-lg font-black"
								style="color: rgb({g.glow})"
								aria-label="Ejercicio archivado"
							>
								?
							</div>
						{/if}
						<div class="min-w-0 flex-1">
							<p class="gb-line-clamp-2 text-sm font-semibold leading-tight">{nombre}</p>
							{#if !e}
								<p class="mt-0.5 text-xs" style="color: var(--muted)">
									ID guardado: {item.exerciseId}
								</p>
							{/if}
							<!-- Deltas, no totales: con el total calculado acá, dos toques rápidos
							     escribían dos veces el mismo número y uno se perdía. -->
							<div class="mt-1.5 flex items-center gap-1.5">
								<button
									onclick={() =>
										guardarSinBloquear(
											ajustarSeries(diaId, item.exerciseId, -1),
											'No se pudo cambiar la cantidad de series. Intentá de nuevo.'
										)}
									class="grid size-10 shrink-0 touch-manipulation place-items-center rounded-full bg-white/10 text-sm"
									aria-label={`Menos series de ${nombre}`}>−</button
								>
								<span class="text-sm font-semibold tabular-nums"
									>{item.seriesObjetivo} series objetivo</span
								>
								<button
									onclick={() =>
										guardarSinBloquear(
											ajustarSeries(diaId, item.exerciseId, 1),
											'No se pudo cambiar la cantidad de series. Intentá de nuevo.'
										)}
									class="grid size-10 shrink-0 touch-manipulation place-items-center rounded-full bg-white/10 text-sm"
									aria-label={`Más series de ${nombre}`}>+</button
								>
							</div>
						</div>
						<button
							onclick={() => confirmarQuitarEjercicio(nombre, item.exerciseId)}
							class="grid size-10 shrink-0 place-items-center rounded-full text-sm"
							style="background: rgba(255,80,80,.15); color: #ff6b6b"
							aria-label="Quitar">✕</button
						>
					</div>
				{:else}
					<div
						use:mantener={entrarReordenar}
						class="flex items-center gap-2 rounded-2xl border border-white/10 p-2.5 {saltado
							? 'opacity-55'
							: ''}"
						style="background: radial-gradient(150% 130% at 0% 0%, rgb({g.glow} / 0.14), transparent 60%), var(--surface)"
					>
						<a
							href={`/ejercicio/${item.exerciseId}?dia=${diaId}`}
							class="flex min-w-0 flex-1 items-center gap-3"
						>
							{#if e}
								<video
									use:reproducirEnVista={e.demoVideo}
									class="size-16 shrink-0 rounded-xl bg-white object-contain"
									aria-label={e.nombre}
									loop
									muted
									playsinline
									preload="none"
								></video>
							{:else}
								<div
									class="grid size-16 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-xl font-black"
									style="color: rgb({g.glow})"
									aria-label="Ejercicio archivado"
								>
									?
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="gb-line-clamp-2 text-sm font-semibold leading-tight">{nombre}</p>
								<p class="mt-0.5 text-xs font-medium" style="color: rgb({g.glow})">
									{g.emoji}
									{g.label}
								</p>
								{#if !e}
									<p class="mt-0.5 truncate text-[11px]" style="color: var(--muted)">
										ID guardado: {item.exerciseId}
									</p>
								{/if}
							</div>
							<div class="pr-1 text-right">
								{#if saltado}
									<p class="text-[11px] font-bold leading-none" style="color: var(--muted)">
										Saltado
									</p>
									<p class="text-[11px]" style="color: var(--muted)">hoy</p>
								{:else if p && p.hechas === p.total}
									<p class="text-xl leading-none" style="color: rgb({g.glow})">✓</p>
									<p class="text-[11px]" style="color: var(--muted)">hecho</p>
								{:else if p}
									<p class="text-lg font-bold leading-none">{p.hechas}/{p.total}</p>
									<p class="text-[11px]" style="color: var(--muted)">series</p>
								{:else}
									<p class="text-lg font-bold leading-none">{item.seriesObjetivo}</p>
									<p class="text-[11px]" style="color: var(--muted)">series</p>
								{/if}
							</div>
						</a>
						{#if saltado}
							<button
								onclick={() =>
									guardarSinBloquear(
										reanudarEjercicio(diaId, item.exerciseId),
										'No se pudo reanudar el ejercicio. Intentá de nuevo.'
									)}
								class="grid size-11 shrink-0 place-items-center rounded-full border border-white/10 text-sm"
								style="color: var(--accent)"
								aria-label={`Reanudar ${nombre} hoy`}>↩</button
							>
						{:else}
							<button
								onclick={() =>
									guardarSinBloquear(
										saltarEjercicio(diaId, item.exerciseId, item.seriesObjetivo),
										'No se pudo guardar que saltaste el ejercicio. Intentá de nuevo.'
									)}
								class="min-h-11 shrink-0 rounded-full border border-white/10 px-3.5 py-2 text-xs font-bold"
								style="color: var(--muted)"
								aria-label={`Saltar ${nombre} hoy`}>Saltar</button
							>
						{/if}
					</div>
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

		{#if !editando && totalEjercicios > 0}
			<section
				class="mt-4 rounded-2xl border border-white/10 p-4"
				style="background: var(--surface)"
			>
				<div class="flex items-center justify-between gap-3">
					<div>
						<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
							Estado del día
						</p>
						<p class="mt-1 text-sm font-bold">
							{ejerciciosCompletos}/{totalEjercicios} ejercicios{#if ejerciciosSaltados > 0}<span
									class="font-medium"
									style="color: var(--muted)"
								>
									· {ejerciciosSaltados} saltado{ejerciciosSaltados === 1 ? '' : 's'}</span
								>{/if}
						</p>
					</div>
					{#if diaTerminado}
						<span
							class="rounded-full px-2.5 py-1 text-xs font-bold"
							style="background: rgb(var(--exito) / .16); color: rgb(var(--exito))">Terminado</span
						>
					{:else if diaListo}
						<span
							class="rounded-full px-2.5 py-1 text-xs font-bold"
							style="background: rgba(255,255,255,.08); color: var(--muted)">Listo</span
						>
					{:else}
						<span
							class="rounded-full px-2.5 py-1 text-xs font-bold"
							style="background: rgba(255,255,255,.08); color: var(--muted)">En curso</span
						>
					{/if}
				</div>

				{#if diaTerminado}
					<button
						onclick={reabrir}
						class="mt-3 w-full rounded-2xl border border-white/10 py-3 text-sm font-bold"
						style="color: var(--muted)">Reabrir día</button
					>
				{:else}
					<button
						onclick={terminarDia}
						disabled={!diaListo}
						class="mt-3 w-full rounded-2xl py-3 text-sm font-bold disabled:opacity-45"
						style="background: {diaListo
							? 'var(--accent)'
							: 'rgba(255,255,255,.08)'}; color: {diaListo ? 'white' : 'var(--muted)'}"
					>
						{#if diaListo}
							🏁 Terminar día
						{:else}
							{@const faltan = totalEjercicios - ejerciciosResueltos}
							Faltan {faltan} ejercicio{faltan === 1 ? '' : 's'}
						{/if}
					</button>
				{/if}
			</section>
		{/if}

		<a
			href={`/dia/${diaId}/agregar`}
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

{#if premioDia}
	<!-- Celebratorio pero no carcelero: un toque en cualquier lado lo cierra. -->
	<button
		onclick={cerrarPremio}
		aria-label="Cerrar resumen del día"
		class="fixed inset-0 z-[60] grid w-full cursor-default place-items-center px-8"
		style="background: radial-gradient(72% 50% at 50% 42%, rgb(var(--exito) / .22), transparent 72%), rgb(var(--scrim) / .84); backdrop-filter: blur(8px)"
	>
		<div transition:fly={{ y: 18, duration: dur(260) }} class="text-center" aria-live="polite">
			<div
				class="mx-auto grid size-24 place-items-center rounded-full border border-white/15 text-5xl font-extrabold"
				style="background: rgb(var(--exito) / .18); color: rgb(var(--exito)); box-shadow: 0 0 55px rgb(var(--exito) / .24)"
			>
				🏁
			</div>
			<p class="mt-5 text-2xl font-extrabold">Día terminado</p>
			<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
				{ejerciciosCompletos}/{totalEjercicios} ejercicios completos
			</p>
			<div class="mt-4 grid grid-cols-2 gap-2 text-left">
				<div class="rounded-xl border border-white/10 bg-white/[0.04] p-3">
					<p class="text-lg font-extrabold tabular-nums">
						{formatoVolumen(resumenDia.volumen)}
						<span class="text-sm" style="color: var(--muted)">{ajustes.unidad}</span>
					</p>
					<p class="text-[11px] font-semibold" style="color: var(--muted)">
						volumen (peso × reps ✓)
					</p>
				</div>
				<div class="rounded-xl border border-white/10 bg-white/[0.04] p-3">
					<p class="text-lg font-extrabold tabular-nums">{resumenDia.prs.length}</p>
					<p class="text-[11px] font-semibold" style="color: var(--muted)">PRs del día</p>
				</div>
			</div>
			{#if resumenDia.prs.length > 0}
				<div class="mt-3 space-y-1.5 text-left">
					{#each resumenDia.prs.slice(0, 3) as pr (pr.exerciseId)}
						<p
							class="truncate rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold"
							style="color: rgb(var(--max))"
						>
							🏆 {pr.nombre}
						</p>
					{/each}
					{#if resumenDia.prs.length > 3}
						<p class="text-center text-xs font-semibold" style="color: var(--muted)">
							+{resumenDia.prs.length - 3} PR{resumenDia.prs.length - 3 === 1 ? '' : 's'} más
						</p>
					{/if}
				</div>
			{/if}
			<p class="mt-5 text-[11px] font-semibold" style="color: var(--muted)">Tocá para cerrar</p>
		</div>
	</button>
{/if}

{#if confirmacion}
	<ConfirmSheet
		titulo={confirmacion.titulo}
		mensaje={confirmacion.mensaje}
		confirmarTexto={confirmacion.confirmarTexto}
		onConfirm={confirmacion.onConfirm}
		onCancel={() => (confirmacion = null)}
	/>
{/if}
