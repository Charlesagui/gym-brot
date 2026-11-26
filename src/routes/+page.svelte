<script lang="ts">
	import { liveQuery } from 'dexie';
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { goto } from '$app/navigation';
	import { flushSync, onDestroy, onMount } from 'svelte';
	import { db, type Dia, type Sesion } from '$lib/db';
	import { borrarDia, crearDia, reordenarDias } from '$lib/dias';
	import { hoy as reloj } from '$lib/hoy.svelte';
	import { serieCompleta } from '$lib/sesion-reglas';
	import { dur } from '$lib/motion';
	import { mantener } from '$lib/mantener';
	import Icono from '$lib/components/Icono.svelte';
	import ConfirmSheet from '$lib/components/ConfirmSheet.svelte';
	import AvisoAlmacenamiento from '$lib/components/AvisoAlmacenamiento.svelte';
	import { vibrar } from '$lib/vibracion';
	import { ajustesObs, AJUSTES_DEFAULT } from '$lib/extras';
	import { fromLiveQuery } from '$lib/live';
	import { modoOrden } from '$lib/modo-orden.svelte';
	import { bienvenidaVisible, cerrarBienvenida } from '$lib/preferencias-ui';
	import { guardarSinBloquear, reportarErrorDatos } from '$lib/errores-datos';

	const dias = liveQuery(() => db.dias.orderBy('orden').toArray());
	// El mismo reloj vivo que usan /dia y /ejercicio (lo inicia el layout): además de
	// volver a primer plano, cambia solo a la medianoche con la app abierta.
	const fechaHoy = $derived(reloj.valor);
	// Mediodía: el día de la semana de una fecha no puede depender del huso ni del DST.
	const hoy = $derived(new Date(`${fechaHoy}T12:00:00`).getDay());
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
	// Mismo modo global que el reordenado de ejercicios: atrás lo cierra y la barra
	// inferior se esconde mientras dura. Ver $lib/modo-orden.
	const reordenando = $derived(modoOrden.abierto);
	let creandoDia = $state(false);
	let ordenItems = $state<ItemDia[]>([]);
	const flipMs = dur(180);
	/** La tarjeta que no se anima porque es el ancla del movimiento: ver /dia/[id]. */
	let ancladaId = $state<string | null>(null);
	/** La tarjeta que se mantuvo apretada para abrir el modo: ver /dia/[id]. */
	let agarradaId = $state<string | null>(null);
	let confirmacion = $state<{
		titulo: string;
		mensaje: string;
		confirmarTexto: string;
		onConfirm: () => void | Promise<void>;
	} | null>(null);
	const ajustesStore = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const ajustes = $derived($ajustesStore);

	/** El orden que está EN LA BASE, en la forma que muestra el modo. */
	function itemsDeDias(lista: Dia[]): ItemDia[] {
		return lista.map((d) => ({
			id: d.id,
			nombre: d.nombre,
			color: d.color ?? '124 92 255',
			sub: `${agendaDia(d)} · ${d.ejercicios.length} ejercicios`
		}));
	}

	function entrarReordenar(diaId?: string) {
		const lista = $dias;
		if (!lista || lista.length < 2) return; // con un solo día no hay nada que ordenar
		ordenItems = itemsDeDias(lista);
		// Acusar la pulsación sostenida: ver el comentario largo en /dia/[id].
		vibrar(18, ajustes.vibracion ?? true);
		agarradaId = diaId ?? null;
		const antes = diaId ? topEnPantalla('data-dia-id', diaId) : null;
		modoOrden.abrir();
		if (antes == null) return;
		flushSync();
		const despues = topEnPantalla('data-orden-id', diaId!);
		if (despues != null && despues !== antes) window.scrollBy(0, despues - antes);
	}

	/** Ver el gemelo en /dia/[id]: dos mediciones al mismo scroll, así que basta el rect. */
	function topEnPantalla(atributo: string, id: string): number | null {
		const el = document.querySelector<HTMLElement>(`[${atributo}="${CSS.escape(id)}"]`);
		return el ? el.getBoundingClientRect().top : null;
	}

	function salirReordenar() {
		modoOrden.cerrar();
	}

	onDestroy(() => modoOrden.descartar());

	/** Ver el comentario gemelo en /dia/[id]: `offsetTop` no miente durante el `flip`. */
	function topDeTarjeta(id: string): number | null {
		const el = document.querySelector<HTMLElement>(`[data-orden-id="${CSS.escape(id)}"]`);
		return el ? el.offsetTop : null;
	}

	function alConsiderar(e: CustomEvent<DndEvent<ItemDia>>) {
		agarradaId = null;
		ordenItems = e.detail.items;
	}

	/** Si la base rechaza el orden, la pantalla vuelve al que sí está guardado: ver /dia/[id]. */
	function guardarOrdenDias() {
		reordenarDias(ordenItems.map((it) => it.id)).catch((error: unknown) => {
			if ($dias) ordenItems = itemsDeDias($dias);
			reportarErrorDatos(
				'No se pudo guardar el nuevo orden de las rutinas. Intentá de nuevo.',
				error
			);
		});
	}

	function alSoltar(e: CustomEvent<DndEvent<ItemDia>>) {
		ordenItems = e.detail.items;
		guardarOrdenDias();
	}

	/**
	 * Sube o baja una rutina dejando la tarjeta donde estaba en la pantalla: las flechas
	 * van adentro de la tarjeta y el `flip` mueve el nodo, así que sin compensar el
	 * scroll el segundo toque en el mismo lugar caía sobre la rutina de al lado y
	 * deshacía el primero. Mismo arreglo que en /dia/[id].
	 */
	function moverDia(id: string, delta: -1 | 1) {
		const origen = ordenItems.findIndex((item) => item.id === id);
		const destino = origen + delta;
		if (origen < 0 || destino < 0 || destino >= ordenItems.length) return;
		agarradaId = null;
		const antes = topDeTarjeta(id);
		const nuevos = [...ordenItems];
		const [movido] = nuevos.splice(origen, 1);
		nuevos.splice(destino, 0, movido!);
		ancladaId = id;
		ordenItems = nuevos;
		guardarOrdenDias();
		// `flushSync` y no `await tick()`: la corrección tiene que entrar en el mismo
		// click. Con un await en el medio, dos toques muy seguidos alcanzaban a caer
		// sobre la tarjeta vieja antes de que la página se hubiera acomodado.
		flushSync();
		const despues = topDeTarjeta(id);
		if (antes != null && despues != null && despues !== antes) window.scrollBy(0, despues - antes);
		ancladaId = null;
	}

	/**
	 * Borra una rutina sin salir del modo, como el ✕ del reordenar de ejercicios.
	 *
	 * Se borra PRIMERO y recién después se saca de la lista: `borrarDia` puede fallar
	 * —la base cambió abajo nuestro— y el sheet muestra el error, así que la tarjeta
	 * tiene que seguir ahí si al final no se borró nada.
	 *
	 * Y con menos de dos rutinas ya no hay orden que arreglar: el modo se cierra solo en
	 * vez de dejarte en una lista con las dos flechas apagadas, que es la misma guarda
	 * que ya tenía `entrarReordenar` para no abrirlo.
	 */
	function borrarEnReorden(it: ItemDia) {
		confirmacion = {
			titulo: 'Borrar día',
			mensaje: `Vas a borrar "${it.nombre}" de tus rutinas. El historial ya registrado no se borra.`,
			confirmarTexto: 'Borrar',
			onConfirm: async () => {
				await borrarDia(it.id);
				ordenItems = ordenItems.filter((x) => x.id !== it.id);
				confirmacion = null;
				if (ordenItems.length < 2) salirReordenar();
			}
		};
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
			// Un salto resuelve el día, pero no convierte el ejercicio en hecho. Si hubo
			// series reales, la portada muestra actividad sin inflar los completos.
			if (e.saltado) {
				conActividad++;
				continue;
			}
			if (e.sets.some(serieCompleta)) conActividad++;
			if (e.sets.every(serieCompleta)) completos++;
		}
		if (conActividad === 0 && !sesion.diaTerminado) return null;
		return { completos, total: dia.ejercicios.length, terminado: !!sesion.diaTerminado };
	}

	async function nuevoDia() {
		if (creandoDia) return;
		creandoDia = true;
		try {
			const id = await crearDia();
			await goto(`/dia/${id}`);
		} catch (error) {
			creandoDia = false;
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
		reloj.refrescar();
		mostrarWelcome = bienvenidaVisible();
	});
	function cerrarWelcome() {
		cerrarBienvenida();
		mostrarWelcome = false;
	}
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-var(--gb-nav))] px-5 pb-28" style="--gb-pt: 2.5rem">
	<header class="mb-7 text-center">
		<h1 class="text-3xl font-extrabold tracking-tight">
			GYM<span style="color: var(--accent-text)">·</span>BROT
		</h1>
		<p class="mt-1 text-xs capitalize" style="color: var(--muted)">{nombresDia[hoy]}</p>
	</header>

	<AvisoAlmacenamiento ultimoBackup={ajustes.ultimoBackup} />

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
				<Icono nombre="cerrar" tamano={18} />
			</button>
			<h2 class="text-sm font-bold" style="color: var(--accent-text)">¡Te damos la bienvenida!</h2>
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
				Arrastrá una tarjeta, o movela con las flechas
			</p>
			<section
				aria-label="Orden de rutinas"
				use:dndzone={{
					items: ordenItems,
					flipDurationMs: flipMs,
					dropTargetStyle: {},
					// Mismo motivo que en el reordenar de ejercicios: sin demora, un swipe
					// para scrollear arrancaba un arrastre en vez de mover la página.
					delayTouchStart: 200
				}}
				onconsider={alConsiderar}
				onfinalize={alSoltar}
				class="space-y-3"
			>
				{#each ordenItems as it (it.id)}
					<div
						animate:flip={{ duration: it.id === ancladaId ? 0 : flipMs }}
						data-orden-id={it.id}
						aria-label={`Mover ${it.nombre}`}
						class="gb-sortable-card flex touch-pan-y items-center gap-2 rounded-2xl border p-3 {it.id ===
						agarradaId
							? 'gb-agarrada'
							: 'border-white/10'}"
						style="--drag-color: {it.color}; background: linear-gradient(90deg, rgb({it.color} / 0.12), transparent 55%), var(--surface)"
					>
						<span class="gb-drag-grip"><Icono nombre="arrastrar" /></span>
						<div class="min-w-0 flex-1">
							<p class="gb-line-clamp-2 text-sm font-semibold leading-tight">{it.nombre}</p>
							<p class="truncate text-xs" style="color: var(--muted)">{it.sub}</p>
						</div>
						<div class="flex shrink-0 gap-1">
							<button
								onpointerdown={(evento) => evento.stopPropagation()}
								onclick={() => moverDia(it.id, -1)}
								disabled={ordenItems[0]?.id === it.id}
								class="grid size-11 place-items-center rounded-full bg-white/[0.06] disabled:opacity-30"
								aria-label={`Subir ${it.nombre}`}><Icono nombre="subir" tamano={18} /></button
							>
							<button
								onpointerdown={(evento) => evento.stopPropagation()}
								onclick={() => moverDia(it.id, 1)}
								disabled={ordenItems.at(-1)?.id === it.id}
								class="grid size-11 place-items-center rounded-full bg-white/[0.06] disabled:opacity-30"
								aria-label={`Bajar ${it.nombre}`}><Icono nombre="bajar" tamano={18} /></button
							>
							<!-- Borrar es el mismo ✕ del reordenar de ejercicios, y también pide confirmación. -->
							<button
								onpointerdown={(evento) => evento.stopPropagation()}
								onclick={() => borrarEnReorden(it)}
								class="grid size-11 place-items-center rounded-full"
								style="background: rgba(255,80,80,.15); color: #ff6b6b"
								aria-label={`Borrar ${it.nombre}`}><Icono nombre="cerrar" tamano={18} /></button
							>
						</div>
					</div>
				{/each}
			</section>
			<!-- Fija en el hueco de la barra inferior, como en /dia/[id]. -->
			<div
				class="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-5 pt-3"
				style="padding-bottom: calc(0.75rem + var(--safe-bottom)); background: linear-gradient(to top, var(--bg) 72%, transparent)"
			>
				<button
					onclick={salirReordenar}
					class="w-full rounded-2xl py-3 text-sm font-bold"
					style="background: var(--accent); color: var(--on-accent)">Terminar orden</button
				>
			</div>
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
					<p class="flex justify-center" style="color: var(--muted)" aria-hidden="true">
						<Icono nombre="descanso" tamano={28} />
					</p>
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
						onclick={() => entrarReordenar()}
						class="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-bold"
						style="color: var(--accent-text)"
						aria-label="Reordenar rutinas"><Icono nombre="ordenar" tamano={16} /> Reordenar</button
					>
				{/if}
			</div>
			<div class="gb-landscape-cards space-y-3">
				{#each $dias as d, i (d.id)}
					{@const prog = progresoDia(d, $sesionesHoy)}
					<a
						href={`/dia/${d.id}`}
						data-dia-id={d.id}
						use:mantener={() => entrarReordenar(d.id)}
						in:fly={{ y: 12, duration: dur(250), delay: dur(Math.min(i, 6) * 45) }}
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
				disabled={creandoDia}
				aria-busy={creandoDia}
				class="mt-4 w-full rounded-2xl border border-dashed border-white/20 p-4 text-sm font-medium disabled:opacity-60"
				style="color: var(--accent-text)"
			>
				{creandoDia ? 'Creando día…' : '+ Nuevo día'}
			</button>
		{/if}
	{:else}
		<p class="text-center text-sm" style="color: var(--muted)">Cargando…</p>
	{/if}
</main>

{#if confirmacion}
	<ConfirmSheet
		titulo={confirmacion.titulo}
		mensaje={confirmacion.mensaje}
		confirmarTexto={confirmacion.confirmarTexto}
		onConfirm={confirmacion.onConfirm}
		onCancel={() => (confirmacion = null)}
	/>
{/if}
