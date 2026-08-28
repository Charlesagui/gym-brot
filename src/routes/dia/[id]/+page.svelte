<script lang="ts">
	import Icono from '$lib/components/Icono.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
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
		descartarReapertura,
		hoyStr,
		reiniciarDia,
		type InstantaneaSesion,
		marcarDiaTerminado,
		reabrirDia,
		sesionHoyObs,
		saltarEjercicio,
		reanudarEjercicio
	} from '$lib/sesion';
	import { estadoEjercicioSesion, estadoSesion, serieCompleta } from '$lib/sesion-reglas';
	import { ajustesObs, AJUSTES_DEFAULT } from '$lib/extras';
	import { resumenDiaSesion, rachaSemanalActual } from '$lib/historial';
	import { sonarDiaTerminado, sonarExito } from '$lib/audio';
	import { vibrar } from '$lib/vibracion';
	import { reproducirEnVista } from '$lib/video';
	import { dur } from '$lib/motion';
	import { estadoLiveQuery, fromLiveQuery } from '$lib/live';
	import { formatoVolumen } from '$lib/formato';
	import { fechaSesionDesdeUrl } from '$lib/fechas';
	import { fechaCorta } from '$lib/formato';
	import ConfirmSheet from '$lib/components/ConfirmSheet.svelte';
	import ToastAccion from '$lib/components/ToastAccion.svelte';
	import { deshacer } from '$lib/deshacer.svelte';
	import CelebracionParticulas from '$lib/components/CelebracionParticulas.svelte';
	import { guardarSinBloquear, reportarErrorDatos } from '$lib/errores-datos';

	let editando = $state(false);
	let nombreEdit = $state('');
	let avisoDia = $state<string | null>(null);
	let premioDia = $state(false);
	let premioId: ReturnType<typeof setTimeout> | null = null;
	// Solo se muestra si es una racha real (2+ semanas seguidas): no infla la primera.
	let rachaSemanal = $state(0);
	let confirmacion = $state<{
		titulo: string;
		mensaje: string;
		confirmarTexto: string;
		onConfirm: () => void | Promise<void>;
	} | null>(null);
	/**
	 * Reiniciar el día borra el trabajo de todos los ejercicios, así que va en dos tiempos:
	 * el botón arma el aviso y el aviso reinicia. Después quedan unos segundos de "Deshacer".
	 */
	let toast = $state<{
		mensaje: string;
		accionTexto: string;
		onAccion: () => void | Promise<void>;
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

	const diaStore = $derived(
		estadoLiveQuery(
			liveQuery(() => db.dias.get(diaId)),
			undefined
		)
	);
	const consultaDia = $derived($diaStore);
	const dia = $derived<Dia | undefined>(consultaDia.valor);
	const cargando = $derived(consultaDia.estado === 'cargando');

	// La fecha queda fijada al abrir. Si viene en la URL sobrevive navegación, recarga
	// y medianoche; las URLs antiguas sin parámetro siguen empezando en hoy.
	const fechaApertura = hoyStr();
	const fechaSesion = $derived(
		fechaSesionDesdeUrl($page.url.searchParams.get('fecha'), fechaApertura)
	);
	const fechaInvalida = $derived(fechaSesion == null);
	const sesionStore = $derived(
		fromLiveQuery(sesionHoyObs(diaId, fechaSesion ?? 'fecha-invalida'), undefined)
	);
	const sesion = $derived<Sesion | undefined>($sesionStore);
	const ajustesStore = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const ajustes = $derived<Ajustes>($ajustesStore);

	onDestroy(() => {
		if (premioId) clearTimeout(premioId);
	});

	function progreso(exId: string): { hechas: number; total: number } | null {
		const e = sesion?.ejercicios.find((x) => x.exerciseId === exId);
		if (!e || e.sets.length === 0) return null;
		return { hechas: e.sets.filter(serieCompleta).length, total: e.sets.length };
	}

	function estaCompleto(exId: string): boolean {
		const e = sesion?.ejercicios.find((x) => x.exerciseId === exId);
		return !!e && estadoEjercicioSesion(e.sets, e.saltado) === 'completado';
	}

	function estaSaltado(exId: string): boolean {
		return !!sesion?.ejercicios.find((x) => x.exerciseId === exId)?.saltado;
	}
	function estaParcialSaltado(exId: string): boolean {
		const e = sesion?.ejercicios.find((x) => x.exerciseId === exId);
		return !!e && estadoEjercicioSesion(e.sets, e.saltado) === 'parcial';
	}

	const ejerciciosCompletos = $derived(
		dia?.ejercicios.filter((item) => estaCompleto(item.exerciseId)).length ?? 0
	);
	// Datos viejos pueden traer un ejercicio marcado saltado Y completo: el resumen decía
	// "3/3 ejercicios · 1 saltado" sobre el mismo. Manda lo que de verdad se hizo.
	const ejerciciosSaltados = $derived(
		dia?.ejercicios.filter(
			(item) =>
				estaSaltado(item.exerciseId) &&
				!estaParcialSaltado(item.exerciseId) &&
				!estaCompleto(item.exerciseId)
		).length ?? 0
	);
	const ejerciciosParciales = $derived(
		dia?.ejercicios.filter((item) => estaParcialSaltado(item.exerciseId)).length ?? 0
	);
	// Un ejercicio "resuelto" está hecho o saltado: ninguno bloquea terminar el día.
	const ejerciciosResueltos = $derived(
		dia?.ejercicios.filter((item) => estaCompleto(item.exerciseId) || estaSaltado(item.exerciseId))
			.length ?? 0
	);
	const totalEjercicios = $derived(dia?.ejercicios.length ?? 0);
	const diaListo = $derived(totalEjercicios > 0 && ejerciciosResueltos === totalEjercicios);
	const diaTerminado = $derived(!!sesion?.diaTerminado);
	// Veredicto único del producto, el mismo que lee el historial y el objetivo calórico.
	const calidadDia = $derived(sesion ? estadoSesion(sesion).calidad : 'nula');
	const seriesPlanDia = $derived(sesion?.plan?.series ?? null);
	// Los logros tienen su propio canal: la alarma de descanso es funcional y esto
	// es celebratorio, así que se puede querer una sin la otra.
	const sonidoActivo = $derived(ajustes.sonido && ajustes.sonidoLogros);
	const resumenDia = $derived(resumenDiaSesion(sesion, ajustes.unidad));
	// Por qué el día dejó de estar terminado. Vive en la sesión y no en un estado local
	// porque la reapertura casi siempre se dispara en la pantalla de ejercicio y se lee
	// acá, después de navegar: sin persistirlo, la app se llevaba la celebración en silencio.
	const reapertura = $derived(!diaTerminado ? (sesion?.reaperturaMotivo ?? null) : null);
	const editandoPasado = $derived(!!fechaSesion && fechaSesion !== fechaApertura);

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

	/**
	 * Cerrar el día ya no exige haber resuelto todo.
	 *
	 * Antes sí, y era la trampa: quien hacía un ejercicio y se iba sólo podía saltar el
	 * resto —mintiendo sobre por qué no los hizo— o dejar el día abierto para siempre.
	 * Ahora el botón siempre está, y cuando queda trabajo afuera la app lo dice con
	 * números antes de cerrar en vez de esconderlo.
	 */
	async function terminarDia() {
		if (diaTerminado || !fechaSesion || !hayTrabajo) return;
		if (diaListo) {
			await cerrarDia(false);
			return;
		}
		const faltan = totalEjercicios - ejerciciosResueltos;
		const hechas = seriesPlanDia
			? `${seriesHechasDia} de ${seriesPlanDia} series`
			: `${seriesHechasDia} ${seriesHechasDia === 1 ? 'serie' : 'series'}`;
		confirmacion = {
			titulo: 'Cerrar día con lo hecho',
			mensaje: `Vas a cerrar "${dia?.nombre ?? 'la rutina'}" con ${hechas} y ${faltan} ejercicio${
				faltan === 1 ? '' : 's'
			} sin resolver. Queda registrado como día parcial y podés reabrirlo cuando quieras.`,
			confirmarTexto: 'Cerrar día',
			onConfirm: async () => {
				confirmacion = null;
				await cerrarDia(true);
			}
		};
	}

	async function cerrarDia(conPendientes: boolean) {
		if (!fechaSesion) return;
		// La fecha va explícita: con `hoyStr()` adentro, terminar el día pasada la
		// medianoche marcaba una sesión nueva y vacía y dejaba abierta la real.
		try {
			const resultado = await marcarDiaTerminado(diaId, fechaSesion, { conPendientes });
			if (!resultado.terminado) {
				avisoDia =
					resultado.razon === 'ejercicios-pendientes'
						? 'La rutina cambió mientras la cerrabas. Revisá el ejercicio pendiente antes de terminar el día.'
						: resultado.razon === 'sin-trabajo'
							? 'Todavía no hay nada que cerrar: marcá una serie o saltá un ejercicio.'
							: 'Esta rutina ya no está disponible. Volvé a tus rutinas e intentá de nuevo.';
				return;
			}
		} catch (error) {
			reportarErrorDatos('No se pudo marcar la rutina como terminada. Intentá de nuevo.', error);
			return;
		}
		avisoDia = null;
		premioDia = true;
		rachaSemanal = 0;
		// La recompensa sigue al veredicto, no al toque: la fiesta entera es para el día
		// completo, y el parcial recibe el acuse corto. Celebrar los dos igual es lo que
		// hacía que "día terminado" no significara nada.
		const completo = calidadDia === 'completa';
		const conActividadReal = resumenDia.setsHechos > 0;
		if (conActividadReal && sonidoActivo)
			void (completo ? sonarDiaTerminado() : sonarExito(false)).catch(() => {});
		if (conActividadReal)
			vibrar(completo ? [120, 70, 120, 70, 220] : [90], ajustes.vibracion ?? true);
		if (completo) {
			// Puntual, no suscripta: ver el comentario en rachaSemanalActual().
			void rachaSemanalActual()
				.then((valor) => {
					if (premioDia) rachaSemanal = valor;
				})
				.catch(() => {});
		}
		if (premioId) clearTimeout(premioId);
		premioId = setTimeout(() => (premioDia = false), completo ? 2400 : 1600);
	}

	async function saltarEjercicioActual(exerciseId: string) {
		if (!fechaSesion) return;
		try {
			const resultado = await saltarEjercicio(diaId, exerciseId, fechaSesion, ajustes.unidad);
			if (resultado.saltado) return;
			avisoDia =
				resultado.razon === 'ya-completado'
					? 'Ese ejercicio ya está hecho: no hace falta saltarlo.'
					: 'Este ejercicio ya no está en la rutina. No se guardó ningún cambio.';
		} catch (error) {
			reportarErrorDatos('No se pudo guardar que saltaste el ejercicio. Intentá de nuevo.', error);
		}
	}

	/** Series realmente marcadas hoy: sin ninguna, no hay nada que reiniciar ni que cerrar. */
	const seriesHechasDia = $derived(resumenDia.setsHechos);
	const hayTrabajo = $derived(seriesHechasDia > 0 || ejerciciosSaltados > 0);
	const hayQueReiniciar = $derived(hayTrabajo);

	function pedirReinicioDia() {
		if (!fechaSesion || !hayQueReiniciar) return;
		const partes: string[] = [];
		if (seriesHechasDia > 0)
			partes.push(`${seriesHechasDia} ${seriesHechasDia === 1 ? 'serie' : 'series'}`);
		if (ejerciciosSaltados > 0)
			partes.push(`${ejerciciosSaltados} ${ejerciciosSaltados === 1 ? 'salto' : 'saltos'}`);
		toast = {
			mensaje: `Se desmarca todo el día: ${partes.join(' y ')}. Los pesos y las reps quedan como referencia.`,
			accionTexto: 'Reiniciar',
			onAccion: hacerReinicioDia
		};
	}

	async function hacerReinicioDia() {
		if (!fechaSesion) return;
		toast = null;
		cerrarPremio();
		let instantanea: InstantaneaSesion | null;
		try {
			instantanea = await reiniciarDia(diaId, fechaSesion);
		} catch (error) {
			reportarErrorDatos('No se pudo reiniciar el día. Intentá de nuevo.', error);
			return;
		}
		if (!instantanea) return;
		deshacer.ofrecer('Día reiniciado.', diaId, fechaSesion, instantanea);
	}

	function descartarAvisoReapertura() {
		if (!fechaSesion) return;
		guardarSinBloquear(
			descartarReapertura(diaId, fechaSesion),
			'No se pudo descartar el aviso. Intentá de nuevo.'
		);
	}

	async function reabrir() {
		if (!fechaSesion) return;
		cerrarPremio();
		try {
			await reabrirDia(diaId, fechaSesion);
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

	function guardarOrdenEjercicios() {
		guardarSinBloquear(
			reordenarEjercicios(
				diaId,
				ordenItems.map((it) => it.id)
			),
			'No se pudo guardar el orden de los ejercicios. Intentá de nuevo.'
		);
	}

	function alSoltar(e: CustomEvent<DndEvent<ItemOrden>>) {
		ordenItems = e.detail.items;
		guardarOrdenEjercicios();
	}

	function moverEjercicio(id: string, delta: -1 | 1) {
		const origen = ordenItems.findIndex((item) => item.id === id);
		const destino = origen + delta;
		if (origen < 0 || destino < 0 || destino >= ordenItems.length) return;
		const nuevos = [...ordenItems];
		const [movido] = nuevos.splice(origen, 1);
		nuevos.splice(destino, 0, movido!);
		ordenItems = nuevos;
		guardarOrdenEjercicios();
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

<main class="gb-page glow-bg min-h-[calc(100dvh-var(--gb-nav))] px-5 pb-28">
	<header class="mb-5 flex flex-wrap items-center gap-3">
		<a
			href="/"
			class="grid size-11 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
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
				class="min-h-11 basis-full rounded-full px-4 py-2 text-sm font-bold"
				style="background: var(--accent); color: var(--on-accent)">Guardar nombre</button
			>
		{:else}
			<div class="min-w-0 flex-1">
				<h1 class="truncate text-xl font-bold leading-tight">{dia?.nombre ?? ''}</h1>
				{#if editandoPasado}
					<!-- Se llega acá desde el historial: entrenar ayer no puede parecerse a hoy. -->
					<p class="text-[11px] font-semibold leading-tight" style="color: rgb(var(--max))">
						Entrenamiento del {fechaCorta(fechaSesion!)} · no es hoy
					</p>
				{/if}
			</div>
			{#if dia && !reordenando}
				<button
					onclick={abrirEdicion}
					class="flex min-h-11 items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-sm font-semibold"
					aria-label="Editar">✏️ Editar</button
				>
			{/if}
		{/if}
	</header>

	{#if cargando}
		<p class="text-center text-sm" style="color: var(--muted)">Cargando…</p>
	{:else if consultaDia.estado === 'error'}
		<div class="rounded-2xl border border-red-400/25 bg-red-400/10 p-4 text-center" role="alert">
			<p class="text-sm font-semibold" style="color: #ff9b9b">No se pudo cargar esta rutina.</p>
			<button
				onclick={() => location.reload()}
				class="mt-3 min-h-11 rounded-xl px-4 text-sm font-bold"
				style="background: rgba(255,255,255,.1); color: white">Reintentar</button
			>
		</div>
	{:else if fechaInvalida}
		<section class="rounded-2xl border border-dashed border-white/15 p-5 text-center" role="alert">
			<p class="text-sm font-bold">La fecha de esta sesión no es válida</p>
			<p class="mt-1 text-xs" style="color: var(--muted)">
				No se creó ni modificó ningún entrenamiento.
			</p>
			<a
				href={`/dia/${diaId}`}
				class="mt-4 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold"
				style="background: var(--accent); color: var(--on-accent)"
			>
				Abrir la sesión de hoy
			</a>
		</section>
	{:else if !dia}
		<section class="rounded-2xl border border-dashed border-white/15 p-5 text-center">
			<p class="text-sm font-bold">Día no encontrado</p>
			<p class="mt-1 text-xs" style="color: var(--muted)">Esta rutina pudo haber sido eliminada.</p>
			<a
				href="/"
				class="mt-4 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold"
				style="background: var(--accent); color: var(--on-accent)"
			>
				Volver a rutinas
			</a>
		</section>
	{:else if reordenando}
		<p
			class="mb-3 text-center text-xs font-semibold uppercase tracking-wider"
			style="color: var(--muted)"
		>
			Mantené una tarjeta y movela, o usá las flechas
		</p>
		<section
			aria-label="Orden de ejercicios"
			use:dndzone={{
				items: ordenItems,
				flipDurationMs: flipMs,
				dropTargetStyle: {},
				// Sin esto, un swipe para scrollear la lista arrancaba un arrastre en vez
				// de mover la página: con muchos ejercicios era imposible bajar la lista.
				delayTouchStart: 200
			}}
			onconsider={alConsiderar}
			onfinalize={alSoltar}
			class="space-y-3"
		>
			{#each ordenItems as it (it.id)}
				<div
					animate:flip={{ duration: flipMs }}
					aria-label={`Mover ${it.nombre}`}
					class="gb-sortable-card grid touch-pan-y grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-2xl border border-white/10 p-2.5"
					style="--drag-color: {it.glow}; background: radial-gradient(150% 130% at 0% 0%, rgb({it.glow} / 0.14), transparent 60%), var(--surface)"
				>
					<span class="gb-drag-grip" aria-hidden="true">⠿</span>
					<video
						use:reproducirEnVista={it.demoVideo}
						class="gb-thumb-frame size-14 shrink-0 rounded-xl object-contain"
						aria-label={it.nombre}
						loop
						muted
						playsinline
						preload="none"
					></video>
					<p class="gb-line-clamp-2 min-w-0 text-sm font-semibold leading-tight">{it.nombre}</p>
					<div class="col-span-2 grid grid-cols-2 gap-2">
						<button
							onpointerdown={(evento) => evento.stopPropagation()}
							onclick={() => moverEjercicio(it.id, -1)}
							disabled={ordenItems[0]?.id === it.id}
							class="grid size-11 place-items-center rounded-full bg-white/[0.06] text-sm disabled:opacity-30"
							aria-label={`Subir ${it.nombre}`}>↑</button
						>
						<button
							onpointerdown={(evento) => evento.stopPropagation()}
							onclick={() => moverEjercicio(it.id, 1)}
							disabled={ordenItems.at(-1)?.id === it.id}
							class="grid size-11 place-items-center rounded-full bg-white/[0.06] text-sm disabled:opacity-30"
							aria-label={`Bajar ${it.nombre}`}>↓</button
						>
					</div>
					<button
						onpointerdown={(ev) => ev.stopPropagation()}
						onclick={() => quitarEnReorden(it)}
						class="col-start-3 row-start-2 grid min-h-11 w-full place-items-center rounded-xl text-sm"
						style="background: rgba(255,80,80,.15); color: #ff6b6b"
						aria-label={`Quitar ${it.nombre}`}>✕</button
					>
				</div>
			{/each}
		</section>
		<button
			onclick={() => (reordenando = false)}
			class="mt-5 w-full rounded-2xl py-3 text-sm font-bold"
			style="background: var(--accent); color: var(--on-accent)">Terminar orden</button
		>
	{:else}
		{#if editando}
			{#if dia.ejercicios.length > 1}
				<button
					onclick={entrarReordenar}
					class="mb-4 min-h-11 w-full rounded-xl border border-white/10 px-4 text-sm font-bold"
					style="color: var(--accent-text)">↕ Reordenar ejercicios</button
				>
			{/if}
			<p class="mb-2 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Días de la semana (podés elegir varios)
			</p>
			<div class="mb-4 grid grid-cols-4 gap-1.5">
				{#each abrevDia as d, i (i)}
					<button
						onclick={() =>
							guardarSinBloquear(
								toggleDiaSemana(diaId, i),
								'No se pudo guardar el día de entrenamiento. Intentá de nuevo.'
							)}
						class="min-h-11 min-w-11 rounded-lg py-2 text-xs font-semibold"
						aria-pressed={dia.diasSemana?.includes(i) ?? false}
						aria-label={`Entrenar los días ${d}`}
						style={dia.diasSemana?.includes(i)
							? 'background: var(--accent); color: var(--on-accent)'
							: 'background: rgba(255,255,255,.05); color: var(--muted)'}>{d}</button
					>
				{/each}
			</div>

			<p class="mb-2 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Color
			</p>
			<div class="mb-6 flex flex-wrap gap-2.5">
				{#each coloresDia as c (c.rgb)}
					<button
						onclick={() =>
							guardarSinBloquear(
								actualizarDia(diaId, { color: c.rgb }),
								'No se pudo guardar el color de la rutina. Intentá de nuevo.'
							)}
						class="size-11 rounded-full transition"
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
			{#each dia.ejercicios.slice().sort((a, b) => a.orden - b.orden) as item, i (item.exerciseId)}
				{@const e = ejercicioPorId(item.exerciseId)}
				{@const g = e ? grupos[e.grupo] : grupoArchivado}
				{@const nombre = e?.nombre ?? 'Ejercicio archivado'}
				{@const p = progreso(item.exerciseId)}
				{@const saltado = estaSaltado(item.exerciseId)}
				{#if editando}
					<div
						class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 p-2.5"
						style="background: radial-gradient(150% 130% at 0% 0%, rgb({g.glow} / 0.14), transparent 60%), var(--surface)"
					>
						{#if e}
							<video
								use:reproducirEnVista={e.demoVideo}
								class="gb-thumb-frame size-14 shrink-0 rounded-xl object-contain"
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
						</div>
						<!-- Deltas, no totales: con el total calculado acá, dos toques rápidos
							     escribían dos veces el mismo número y uno se perdía. -->
						<div class="col-span-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5">
							<button
								onclick={() =>
									guardarSinBloquear(
										ajustarSeries(diaId, item.exerciseId, -1),
										'No se pudo cambiar la cantidad de series. Intentá de nuevo.'
									)}
								class="grid size-11 shrink-0 touch-manipulation place-items-center rounded-full bg-white/10 text-sm"
								aria-label={`Menos series de ${nombre}`}>−</button
							>
							<span class="text-sm font-semibold tabular-nums"
								>{item.seriesObjetivo}
								{item.seriesObjetivo === 1 ? 'serie' : 'series'} objetivo</span
							>
							<button
								onclick={() =>
									guardarSinBloquear(
										ajustarSeries(diaId, item.exerciseId, 1),
										'No se pudo cambiar la cantidad de series. Intentá de nuevo.'
									)}
								class="grid size-11 shrink-0 touch-manipulation place-items-center rounded-full bg-white/10 text-sm"
								aria-label={`Más series de ${nombre}`}>+</button
							>
						</div>
						<button
							onclick={() => confirmarQuitarEjercicio(nombre, item.exerciseId)}
							class="col-start-3 row-start-1 grid size-11 shrink-0 place-items-center rounded-full text-sm"
							style="background: rgba(255,80,80,.15); color: #ff6b6b"
							aria-label="Quitar">✕</button
						>
					</div>
				{:else}
					<!-- Cascada corta al entrar, como en la portada. El tope de 6 importa acá:
					     una rutina larga si no deja la última tarjeta llegando a los 700ms, y a
					     esta pantalla se vuelve entre serie y serie. -->
					<div
						use:mantener={entrarReordenar}
						in:fly={{ y: 12, duration: dur(250), delay: dur(Math.min(i, 6) * 45) }}
						class="flex items-center gap-2 rounded-2xl border border-white/10 p-2.5 {saltado
							? 'opacity-55'
							: ''}"
						style="background: radial-gradient(150% 130% at 0% 0%, rgb({g.glow} / 0.14), transparent 60%), var(--surface)"
					>
						<a
							href={`/ejercicio/${item.exerciseId}?dia=${diaId}&fecha=${fechaSesion}`}
							class="flex min-w-0 flex-1 items-center gap-3"
						>
							{#if e}
								<video
									use:reproducirEnVista={e.demoVideo}
									class="gb-thumb-frame size-16 shrink-0 rounded-xl object-contain"
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
								{#if estaParcialSaltado(item.exerciseId) && p}
									<p class="text-lg font-bold leading-none">{p.hechas}/{p.total}</p>
									<p class="max-w-16 text-[10px] leading-tight" style="color: var(--muted)">
										resto saltado
									</p>
								{:else if saltado}
									<p class="text-[11px] font-bold leading-none" style="color: var(--muted)">
										Saltado
									</p>
									<p class="text-[11px]" style="color: var(--muted)">hoy</p>
								{:else if p && p.hechas === p.total}
									<p class="text-xl leading-none" style="color: rgb({g.glow})">✓</p>
									<p class="text-[11px]" style="color: var(--muted)">hecho</p>
								{:else if p}
									<p class="text-lg font-bold leading-none">{p.hechas}/{p.total}</p>
									<p class="text-[11px]" style="color: var(--muted)">
										{p.total === 1 ? 'serie' : 'series'}
									</p>
								{:else}
									<p class="text-lg font-bold leading-none">{item.seriesObjetivo}</p>
									<p class="text-[11px]" style="color: var(--muted)">
										{item.seriesObjetivo === 1 ? 'serie' : 'series'}
									</p>
								{/if}
							</div>
						</a>
						{#if saltado}
							<button
								onclick={() =>
									guardarSinBloquear(
										reanudarEjercicio(diaId, item.exerciseId, fechaSesion!),
										'No se pudo reanudar el ejercicio. Intentá de nuevo.'
									)}
								class="grid size-11 shrink-0 place-items-center rounded-full border border-white/10 text-sm"
								style="color: var(--accent-text)"
								aria-label={`Reanudar ${nombre} hoy`}>↩</button
							>
						{:else if estaCompleto(item.exerciseId)}
							<!-- Un ejercicio hecho no se salta: se corrige. Saltarlo lo rotulaba
							     "Saltado" en gris y reabría el día por nada. -->
							<a
								href={`/ejercicio/${item.exerciseId}?dia=${diaId}&fecha=${fechaSesion}`}
								class="grid min-h-11 shrink-0 place-items-center rounded-full px-3 text-xs font-medium"
								style="color: var(--muted)"
								aria-label={`Corregir o agregar series de ${nombre}`}>Corregir</a
							>
						{:else}
							<!-- Acción secundaria: sin borde ni negrita, para no competir con el
							     progreso de la fila. El target táctil se mantiene en 44px. -->
							<button
								onclick={() => void saltarEjercicioActual(item.exerciseId)}
								class="min-h-11 shrink-0 rounded-full px-3 py-2 text-xs font-medium"
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
			{#if reapertura}
				<div
					class="mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5"
					style="background: rgb(var(--max) / .1)"
					role="status"
				>
					<p class="flex-1 text-xs font-semibold leading-relaxed" style="color: rgb(var(--max))">
						Este día dejó de estar terminado: {reapertura.toLowerCase()}.
					</p>
					<button
						onclick={descartarAvisoReapertura}
						class="min-h-11 shrink-0 px-2 text-xs font-bold"
						style="color: rgb(var(--max))"
						aria-label="Descartar el aviso de reapertura">Entendido</button
					>
				</div>
			{/if}
			{#if avisoDia}
				<p
					class="mt-4 rounded-xl px-3 py-2.5 text-xs font-semibold leading-relaxed"
					style="background: rgb(var(--max) / .1); color: rgb(var(--max))"
					role="alert"
				>
					{avisoDia}
				</p>
			{/if}
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
							{ejerciciosCompletos}/{totalEjercicios} ejercicios{#if ejerciciosParciales > 0}<span
									class="font-medium"
									style="color: var(--muted)"
								>
									· {ejerciciosParciales} parcial{ejerciciosParciales === 1 ? '' : 'es'}</span
								>{/if}{#if ejerciciosSaltados > 0}<span
									class="font-medium"
									style="color: var(--muted)"
								>
									· {ejerciciosSaltados} saltado{ejerciciosSaltados === 1 ? '' : 's'}</span
								>{/if}
						</p>
					</div>
					<div class="flex shrink-0 flex-col items-end gap-1">
						{#if diaTerminado}
							<span
								class="rounded-full px-2.5 py-1 text-xs font-bold"
								style="background: {calidadDia === 'completa'
									? 'rgb(var(--exito) / .16)'
									: 'rgba(255,255,255,.08)'}; color: {calidadDia === 'completa'
									? 'rgb(var(--exito))'
									: 'var(--muted)'}"
								>{calidadDia === 'completa' ? 'Terminado' : 'Cerrado parcial'}</span
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
				</div>

				<!--
					Reiniciar comparte la fila con la acción principal en vez de colgar debajo. No es
					solo estética: todo lo que se agrega DEBAJO de la lista de ejercicios le da scroll
					extra a la página, y con ese colchón la última tarjeta queda pegada al borde
					inferior, justo donde la barra fija se come los toques. Acá suma cero alto.
				-->
				<div class="mt-3 grid gap-2 {hayQueReiniciar ? 'grid-cols-[minmax(0,1fr)_auto]' : ''}">
					{#if diaTerminado}
						<button
							onclick={reabrir}
							class="rounded-2xl border border-white/10 py-3 text-sm font-bold"
							style="color: var(--muted)">Reabrir día</button
						>
					{:else}
						<!--
							Siempre apretable mientras haya trabajo real. Con el día incompleto no
							cierra de una: confirma diciendo cuánto queda afuera. Antes estaba
							deshabilitado y la única salida honesta era saltar los ejercicios que
							faltaban, que es mentir sobre por qué no se hicieron.
						-->
						<button
							onclick={terminarDia}
							disabled={!hayTrabajo}
							class="rounded-2xl py-3 text-sm font-bold disabled:opacity-45"
							style="background: {diaListo
								? 'var(--accent)'
								: 'rgba(255,255,255,.08)'}; color: {diaListo ? 'white' : 'var(--muted)'}"
						>
							{#if diaListo}
								<span class="inline-flex items-center gap-2">
									<Icono nombre="terminar" tamano={18} /> Terminar día
								</span>
							{:else if hayTrabajo}
								{@const faltan = totalEjercicios - ejerciciosResueltos}
								Cerrar con lo hecho · faltan {faltan}
							{:else}
								{@const faltan = totalEjercicios - ejerciciosResueltos}
								Faltan {faltan} ejercicio{faltan === 1 ? '' : 's'}
							{/if}
						</button>
					{/if}
					{#if hayQueReiniciar}
						<button
							onclick={pedirReinicioDia}
							class="rounded-2xl px-3 text-xs font-semibold"
							style="color: var(--muted)"
							aria-label="Reiniciar el día">Reiniciar</button
						>
					{/if}
				</div>
			</section>
		{/if}

		<a
			href={`/dia/${diaId}/agregar?fecha=${fechaSesion}`}
			class="mt-4 block rounded-2xl border border-dashed border-white/20 p-4 text-center text-sm font-medium"
			style="color: var(--accent-text)">+ Agregar ejercicio</a
		>

		{#if editando}
			<button
				onclick={eliminar}
				class="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 p-3 text-sm"
				style="color: #ff6b6b"><Icono nombre="borrar" tamano={16} /> Borrar día</button
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
		style={calidadDia === 'completa'
			? 'background: radial-gradient(72% 50% at 50% 42%, rgb(var(--exito) / .22), transparent 72%), rgb(var(--scrim) / .84); backdrop-filter: blur(8px)'
			: 'background: rgb(var(--scrim) / .9); backdrop-filter: blur(8px)'}
	>
		<div transition:fly={{ y: 18, duration: dur(260) }} class="text-center" aria-live="polite">
			<div class="relative mx-auto grid size-24 place-items-center">
				<!-- Las partículas y el halo son del día completo. Un día parcial recibe el
				     acuse corto: celebrar los dos igual es lo que hacía que "día terminado"
				     no significara nada. -->
				{#if calidadDia === 'completa'}
					<CelebracionParticulas color="var(--exito)" cantidad={16} />
				{/if}
				<div
					class="relative grid size-24 place-items-center rounded-full border border-white/15 text-5xl font-extrabold"
					style="background: rgb(var(--exito) / {calidadDia === 'completa'
						? '.18'
						: '.1'}); color: rgb(var(--exito)); box-shadow: {calidadDia === 'completa'
						? '0 0 55px rgb(var(--exito) / .24)'
						: 'none'}"
				>
					<Icono nombre={calidadDia === 'completa' ? 'terminar' : 'hecha'} tamano={42} />
				</div>
			</div>
			{#if calidadDia === 'completa'}
				<p class="mt-5 text-2xl font-extrabold">Día terminado</p>
				<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
					{ejerciciosCompletos} completos · {ejerciciosParciales} parciales · {ejerciciosSaltados}
					saltados
				</p>
			{:else if resumenDia.setsHechos > 0}
				<p class="mt-5 text-xl font-bold">Día cerrado</p>
				<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
					{seriesPlanDia
						? `${seriesHechasDia} de ${seriesPlanDia} series`
						: `${seriesHechasDia} ${seriesHechasDia === 1 ? 'serie' : 'series'}`} · queda como día parcial
				</p>
			{:else}
				<p class="mt-5 text-xl font-bold">
					Día cerrado · {ejerciciosSaltados} saltado{ejerciciosSaltados === 1 ? '' : 's'}
				</p>
				<p class="mt-1 text-sm font-medium" style="color: var(--muted)">Sin series registradas</p>
			{/if}
			{#if resumenDia.setsHechos > 0}<div class="mt-4 grid grid-cols-2 gap-2 text-left">
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
				</div>{/if}
			{#if resumenDia.prs.length > 0}
				<div class="mt-3 space-y-1.5 text-left">
					{#each resumenDia.prs.slice(0, 3) as pr (pr.exerciseId)}
						<p
							class="truncate rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold"
							style="color: rgb(var(--max))"
						>
							<span class="inline-flex items-center gap-1.5">
								<Icono nombre="record" tamano={14} />
								{pr.nombre}
							</span>
						</p>
					{/each}
					{#if resumenDia.prs.length > 3}
						<p class="text-center text-xs font-semibold" style="color: var(--muted)">
							+{resumenDia.prs.length - 3} PR{resumenDia.prs.length - 3 === 1 ? '' : 's'} más
						</p>
					{/if}
				</div>
			{/if}
			{#if rachaSemanal >= 2}
				<p
					class="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold"
					style="color: rgb(var(--exito))"
				>
					🔥 {rachaSemanal} semanas seguidas
				</p>
			{/if}
			<p class="mt-5 text-[11px] font-semibold" style="color: var(--muted)">Tocá para cerrar</p>
		</div>
	</button>
{/if}

{#if toast}
	<ToastAccion
		mensaje={toast.mensaje}
		accionTexto={toast.accionTexto}
		onAccion={toast.onAccion}
		onCerrar={() => (toast = null)}
		offsetNav
	/>
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
