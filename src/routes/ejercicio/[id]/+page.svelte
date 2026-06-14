<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { db, type SetSesion, type PrCelebrado } from '$lib/db';
	import { ejercicioPorId, grupos } from '$lib/catalog';
	import {
		sesionHoyObs,
		historialObs,
		ensureEjercicio,
		ultimaSesion,
		toggleSet,
		toggleMax,
		setPeso,
		setReps,
		setExtra,
		addSet,
		removeSet,
		marcarPrCelebrado,
		pesoEfectivo,
		valorMetrica,
		valorSet,
		mejorSet,
		DESCRIPCION_METRICA,
		hoyStr,
		sesionId,
		type MejorSet,
		type ModoPr,
		type MetricaEfectiva
	} from '$lib/sesion';
	import { notaObs, setNota, ajustesObs, setTimer, AJUSTES_DEFAULT } from '$lib/extras';
	import { sonarSetHecho, sonarExito } from '$lib/audio';
	import { descanso } from '$lib/descanso.svelte';
	import { dur } from '$lib/motion';
	import { fromLiveQuery } from '$lib/live';
	import { formatoNumero, formatoSet, fechaCorta } from '$lib/formato';
	import { youtubeEmbedUrl } from '$lib/youtube';
	import SetRow from '$lib/components/SetRow.svelte';
	import MiniChart from '$lib/components/MiniChart.svelte';
	import CelebracionOverlay from '$lib/components/CelebracionOverlay.svelte';
	import TecnicaModal from '$lib/components/TecnicaModal.svelte';
	import ProgresoEjercicio from '$lib/components/ProgresoEjercicio.svelte';
	import EditarSerieSheet, { type SerieEditable } from '$lib/components/EditarSerieSheet.svelte';

	const ej = $derived(ejercicioPorId($page.params.id!));
	const g = $derived(ej ? grupos[ej.grupo] : undefined);
	const diaId = $derived($page.url.searchParams.get('dia'));
	// `desde`: día desde el que se abrió la vista de progreso (para volver a entrenar).
	const desde = $derived($page.url.searchParams.get('desde'));
	const volver = $derived(
		diaId ? `/dia/${diaId}` : desde ? `/ejercicio/${$page.params.id}?dia=${desde}` : '/historial'
	);

	let sets = $state<SetSesion[]>([]);
	let anteriores = $state<SetSesion[]>([]);
	let anterioresFecha = $state<string | null>(null);
	let prCelebrado = $state<PrCelebrado | null>(null);
	// Fecha fija de la sesión activa: evita perder toques si cruzás la medianoche entrenando.
	let fechaSesion = $state(hoyStr());
	let notaTexto = $state('');
	let tieneNota = $state(false);
	let cargandoSeries = $state(false);
	let exito = $state<'normal' | 'pr' | 'parcial' | null>(null);
	let prExito = $state<MejorSet | null>(null);
	// Flash de PR no bloqueante: celebra el récord en el instante en que se gana,
	// sin esperar a "Terminar" (así no se pierde si salís con ←).
	let prFlash = $state<MejorSet | null>(null);
	let prFlashId: ReturnType<typeof setTimeout> | null = null;
	// El gif de demostración arranca grande en cada ejercicio; se puede achicar a
	// miniatura en el header tocándolo, pero al cambiar de ejercicio vuelve a grande.
	let videoGrande = $state(true);
	let tecnicaAbierta = $state(false);
	let tecnicaHistoryActiva = false;

	$effect(() => {
		$page.params.id; // dep: reinicia "grande" al cambiar de ejercicio
		videoGrande = true;
	});

	// Hint de MAX: solo en máquinas de placas, las primeras 3 visitas o hasta "Entendido".
	let mostrarHintMax = $state(false);
	// Hint para activar el descanso: una sola vez, al marcar una serie con el timer apagado.
	let mostrarHintTimer = $state(false);

	$effect(() => {
		if (!ej?.maquinaPlacas || localStorage.getItem('gb-hint-max-ok')) {
			mostrarHintMax = false;
			return;
		}
		const vistas = Number(localStorage.getItem('gb-hint-max-vistas') ?? '0');
		mostrarHintMax = vistas < 3;
		localStorage.setItem('gb-hint-max-vistas', String(vistas + 1));
	});

	function entendidoHintMax() {
		localStorage.setItem('gb-hint-max-ok', '1');
		mostrarHintMax = false;
	}

	// El descanso ahora es un store global (sobrevive navegar entre pantallas).
	let exitoId: ReturnType<typeof setTimeout> | null = null;

	// Ajustes, historial (PR) y nota como stores legibles con `$` (ver $lib/live).
	const ajustesStore = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const ajustes = $derived($ajustesStore);
	// El historial se recalcula al cambiar de ejercicio o de métrica; el `$` re-suscribe solo.
	const historial = $derived(
		fromLiveQuery(historialObs($page.params.id!, ajustes.metricaPr), [] as MejorSet[])
	);
	const puntos = $derived($historial);
	const notaStore = $derived(fromLiveQuery(notaObs($page.params.id!), undefined));
	$effect(() => {
		notaTexto = $notaStore?.texto ?? '';
		tieneNota = !!$notaStore?.texto;
	});

	$effect(() => {
		const exId = $page.params.id!;
		const dId = diaId;
		let cancelado = false;
		let sub: { unsubscribe: () => void } | undefined;
		if (!dId) {
			sets = [];
			anteriores = [];
			anterioresFecha = null;
			prCelebrado = null;
			cargandoSeries = false;
			return;
		}
		const fecha = hoyStr();
		fechaSesion = fecha;
		cargandoSeries = true;
		anteriores = [];
		anterioresFecha = null;
		(async () => {
			const dia = await db.dias.get(dId);
			const item = dia?.ejercicios.find((e) => e.exerciseId === exId);
			await ensureEjercicio(dId, exId, item?.seriesObjetivo ?? 4, fecha);
			if (cancelado) return;
			const prev = await ultimaSesion(dId, exId, fecha);
			if (cancelado) return;
			anteriores = prev?.sets ?? [];
			anterioresFecha = prev?.fecha ?? null;
			sub = sesionHoyObs(dId, fecha).subscribe((s) => {
				if (cancelado) return;
				const e = s?.ejercicios.find((x) => x.exerciseId === exId);
				sets = e ? e.sets : [];
				prCelebrado = e?.prCelebrado ?? null;
				cargandoSeries = false;
			});
		})().catch(() => {
			if (!cancelado) {
				sets = [];
				prCelebrado = null;
				cargandoSeries = false;
			}
		});
		return () => {
			cancelado = true;
			sub?.unsubscribe();
		};
	});

	onMount(() => {
		function cerrarTecnicaConBack() {
			if (!tecnicaAbierta || !tecnicaHistoryActiva) return;
			tecnicaHistoryActiva = false;
			tecnicaAbierta = false;
		}

		window.addEventListener('popstate', cerrarTecnicaConBack);
		return () => window.removeEventListener('popstate', cerrarTecnicaConBack);
	});

	onDestroy(() => {
		if (exitoId) clearTimeout(exitoId);
		if (prFlashId) clearTimeout(prFlashId);
	});

	const hechas = $derived(sets.filter((s) => s.hecha).length);
	const completo = $derived(sets.length > 0 && hechas === sets.length);
	const unidad = $derived(ajustes.unidad);
	const sonidoActivo = $derived(ajustes.sonido);
	const vibracionActiva = $derived(ajustes.vibracion ?? true);
	const metrica = $derived(ajustes.metricaPr);
	// Modo del ejercicio: por reps si ni el historial ni la sesión de hoy registraron peso (bodyweight).
	const modo = $derived<ModoPr>(
		puntos.some((p) => p.peso != null) || sets.some((s) => s.peso != null) ? 'peso' : 'reps'
	);
	const metricaEfectiva = $derived<MetricaEfectiva>(modo === 'reps' ? 'reps' : metrica);
	const metricaLabel = $derived(
		modo === 'reps'
			? 'reps máximas'
			: metrica === 'e1rm'
				? '1RM estimado (1 Repetición Máxima)'
				: 'peso máximo'
	);
	// Unidad del valor del PR: en modo reps el número son repeticiones, no kg/lb.
	const unidadValor = $derived(modo === 'reps' ? 'reps' : unidad);
	const otraMetrica = $derived(metrica === 'e1rm' ? 'peso' : 'e1rm');
	const otraLabel = $derived(metrica === 'e1rm' ? 'peso máx.' : '1RM est. (1 rep. máx.)');
	const tecnicaEmbedUrl = $derived(ej?.videoUrl ? youtubeEmbedUrl(ej.videoUrl) : null);

	const pr = $derived(puntos.reduce<MejorSet | null>((best, p) => mejorSet(best, p), null));
	// Equivalencia en la otra métrica: solo tiene sentido cuando el PR es por peso.
	const valorOtraPr = $derived(
		modo === 'peso' && pr && pesoEfectivo(pr) != null
			? valorMetrica(pesoEfectivo(pr)!, pr.reps, otraMetrica)
			: null
	);
	const mejorHoy = $derived(mejorSetLocal(sets, true));
	// "Previo" = todo menos la sesión actual: si hiciste este ejercicio hoy en otra
	// rutina, ese valor también cuenta (mismo criterio que recalcularPrCelebrado).
	const mejorPrevio = $derived(
		puntos
			.filter((p) => !diaId || p.sesionId !== sesionId(diaId, fechaSesion))
			.reduce<number | null>((m, p) => (m == null || p.valor > m ? p.valor : m), null)
	);
	const valorCelebrado = $derived(prCelebrado ? valorSet(prCelebrado, metrica, modo) : null);
	const valorMejorHoy = $derived(mejorHoy ? mejorHoy.valor : null);
	const superado = $derived(
		valorMejorHoy != null &&
			(mejorPrevio == null || valorMejorHoy > mejorPrevio) &&
			(valorCelebrado == null || valorMejorHoy > valorCelebrado)
	);
	const pasoPeso = $derived(ajustes.pasoPeso ?? AJUSTES_DEFAULT.pasoPeso);
	// Sin PR ni serie previa: es la primera vez con este ejercicio → hint de peso inicial.
	const sinHistorial = $derived(!cargandoSeries && puntos.length === 0 && anteriores.length === 0);

	function mejorSetLocal(localSets: SetSesion[], soloHechas: boolean): MejorSet | null {
		return localSets.reduce<MejorSet | null>((best, s) => {
			if (soloHechas && !s.hecha) return best;
			const valor = valorSet(s, metrica, modo);
			if (valor == null) return best;
			return mejorSet(best, {
				peso: s.peso,
				reps: s.reps,
				esMax: !!s.esMax,
				extraKg: s.extraKg,
				fecha: fechaSesion,
				valor
			});
		}, null);
	}

	function abrirTecnica() {
		if (tecnicaEmbedUrl) {
			tecnicaAbierta = true;
			if (!tecnicaHistoryActiva) {
				const estadoActual =
					history.state && typeof history.state === 'object' ? history.state : {};
				history.pushState({ ...estadoActual, gbTecnica: true }, '', window.location.href);
				tecnicaHistoryActiva = true;
			}
		} else if (ej?.videoUrl) window.open(ej.videoUrl, '_blank', 'noreferrer');
	}

	function cerrarTecnica() {
		if (!tecnicaAbierta) return;
		tecnicaAbierta = false;
		if (tecnicaHistoryActiva) {
			tecnicaHistoryActiva = false;
			history.back();
		}
	}

	/** Redondea a 1 decimal para evitar arrastre de flotantes con pasos de 2.5. */
	function redondear(n: number): number {
		return Math.round(n * 10) / 10;
	}

	function ajustarPeso(i: number, delta: number) {
		const actual = sets[i]?.peso ?? 0;
		const siguiente = redondear(Math.max(0, actual + delta));
		const peso = siguiente === 0 ? undefined : siguiente;
		if (sets[i]) sets[i].peso = peso;
		setPeso(diaId!, $page.params.id!, i, peso, fechaSesion, metrica);
	}

	function ajustarReps(i: number, delta: number) {
		const actual = sets[i]?.reps ?? 0;
		const siguiente = Math.max(0, actual + delta);
		const reps = siguiente === 0 ? undefined : siguiente;
		if (sets[i]) sets[i].reps = reps;
		setReps(diaId!, $page.params.id!, i, reps, fechaSesion, metrica);
	}

	function ajustarExtra(i: number, delta: number) {
		const actual = sets[i]?.extraKg ?? 0;
		const siguiente = redondear(Math.max(0, actual + delta));
		const extra = siguiente === 0 ? undefined : siguiente;
		if (sets[i]) sets[i].extraKg = extra;
		setExtra(diaId!, $page.params.id!, i, extra, fechaSesion, metrica);
	}

	function escribirPeso(i: number, el: HTMLInputElement) {
		const n = Number.parseFloat(el.value.replace(',', '.'));
		const peso = Number.isFinite(n) && n > 0 ? redondear(n) : undefined;
		if (sets[i]) sets[i].peso = peso;
		setPeso(diaId!, $page.params.id!, i, peso, fechaSesion, metrica);
		el.value = peso != null ? formatoNumero(peso) : '';
	}

	function quitarSerie() {
		if (!diaId || sets.length <= 1) return;
		const ultima = sets[sets.length - 1];
		// No borrar un registro real con un mistap: la serie hecha pide confirmación.
		if (
			ultima?.hecha &&
			!confirm(`La serie ${sets.length} ya está marcada como hecha. ¿Quitarla igual?`)
		)
			return;
		removeSet(diaId, $page.params.id!, sets.length - 1, fechaSesion, metrica);
	}

	function escribirReps(i: number, el: HTMLInputElement) {
		const n = Number.parseInt(el.value, 10);
		const reps = Number.isFinite(n) && n > 0 ? n : undefined;
		if (sets[i]) sets[i].reps = reps;
		setReps(diaId!, $page.params.id!, i, reps, fechaSesion, metrica);
		el.value = reps != null ? String(reps) : '';
	}

	async function onToggle(i: number) {
		const yaEstaba = sets[i]?.hecha;
		await toggleSet(diaId!, $page.params.id!, i, fechaSesion, metrica);
		if (yaEstaba) {
			descanso.saltar();
			return;
		}

		// ¿Esta serie acaba de marcar un PR? Lo celebramos y persistimos en el acto,
		// para que el récord no se pierda si salís con ← antes de "Terminar".
		const nuevoPr = prDeSet(sets[i]);
		if (nuevoPr) {
			void marcarPrCelebrado(
				diaId!,
				$page.params.id!,
				{ peso: nuevoPr.peso, reps: nuevoPr.reps, esMax: nuevoPr.esMax, extraKg: nuevoPr.extraKg },
				metrica,
				fechaSesion,
				modo
			);
			celebrarPrFlash(nuevoPr);
		} else {
			if (sonidoActivo) void sonarSetHecho().catch(() => {});
			// Háptica breve: el switch de silencio de iOS puede mutear el audio, la vibra no.
			if (vibracionActiva && 'vibrate' in navigator) navigator.vibrate(20);
		}

		const seCompletanTodas = sets.filter((s) => s.hecha).length === sets.length - 1;
		if (!seCompletanTodas && ajustes.timer.activo) {
			// recién hecha → arranca descanso, con la próxima serie como recordatorio
			descanso.iniciar(ajustes.timer.minutos, g?.glow ?? '124 92 255', proximaSerie(i));
		} else if (
			!seCompletanTodas &&
			!ajustes.timer.activo &&
			!localStorage.getItem('gb-hint-timer-ok')
		) {
			// Timer apagado: sugerir activarlo (una sola vez) para que avise cuándo volver.
			mostrarHintTimer = true;
		}
	}

	function activarDescansoDesdeHint() {
		cambiarTimer(ajustes.timer.minutos || 2);
		descartarHintTimer();
	}

	function descartarHintTimer() {
		localStorage.setItem('gb-hint-timer-ok', '1');
		mostrarHintTimer = false;
	}

	/** Etiqueta de lo que sigue tras el descanso: la próxima serie pendiente. */
	function proximaSerie(reciente: number): string {
		const pendientes = sets
			.map((s, idx) => ({ hecha: s.hecha, idx }))
			.filter((p) => p.idx !== reciente && !p.hecha);
		const prox = pendientes.find((p) => p.idx > reciente) ?? pendientes[0];
		return prox ? `${ej?.nombre ?? ''} · serie ${prox.idx + 1}/${sets.length}` : '';
	}

	/** Devuelve el set como MejorSet si supera al PR vigente; si no, null. */
	function prDeSet(s: SetSesion | undefined): MejorSet | null {
		if (!s) return null;
		const valor = valorSet(s, metrica, modo);
		if (valor == null) return null;
		const esNuevoPr =
			(mejorPrevio == null || valor > mejorPrevio) &&
			(valorCelebrado == null || valor > valorCelebrado);
		if (!esNuevoPr) return null;
		return {
			peso: s.peso,
			reps: s.reps,
			esMax: !!s.esMax,
			extraKg: s.extraKg,
			fecha: fechaSesion,
			valor
		};
	}

	// Serie histórica en edición (long-press en un punto del chart) → bottom sheet.
	let serieEditando = $state<SerieEditable | null>(null);

	function editarPuntoHistorial(punto: MejorSet) {
		if (!punto.sesionId || punto.setIndex == null) return;
		serieEditando = {
			sesionId: punto.sesionId,
			exerciseId: $page.params.id!,
			setIndex: punto.setIndex,
			set: { peso: punto.peso, reps: punto.reps, esMax: punto.esMax, extraKg: punto.extraKg },
			fecha: punto.fecha,
			maquinaPlacas: !!ej?.maquinaPlacas
		};
	}

	/** Recompensa especial inmediata por PR: no bloquea el registro (pointer-events-none). */
	function celebrarPrFlash(mejor: MejorSet) {
		prFlash = mejor;
		if (sonidoActivo) void sonarExito(true).catch(() => {});
		if (vibracionActiva && 'vibrate' in navigator) navigator.vibrate([120, 70, 180]);
		if (prFlashId) clearTimeout(prFlashId);
		prFlashId = setTimeout(() => (prFlash = null), 1700);
	}

	async function terminarEjercicio() {
		if (!diaId || exito) return;
		descanso.saltar();
		if (prFlashId) clearTimeout(prFlashId);
		prFlash = null;
		// Sin series hechas no hay nada que celebrar: salida directa y en silencio.
		if (hechas === 0) {
			goto(volver);
			return;
		}
		// PR honesto: solo cuentan las series realmente marcadas ✓ (no fabrica nada).
		const mejor = mejorSetLocal(sets, true);
		const valor = mejor ? mejor.valor : null;
		const esPr =
			valor != null &&
			(mejorPrevio == null || valor > mejorPrevio) &&
			(valorCelebrado == null || valor > valorCelebrado);
		if (esPr && mejor) {
			await marcarPrCelebrado(
				diaId,
				$page.params.id!,
				{ peso: mejor.peso, reps: mejor.reps, esMax: mejor.esMax, extraKg: mejor.extraKg },
				metrica,
				fechaSesion,
				modo
			);
		}
		// La fanfarria es para el ejercicio completo (o PR); cierre parcial = sobrio.
		exito = esPr ? 'pr' : completo ? 'normal' : 'parcial';
		prExito = esPr ? mejor : null;
		if (exito !== 'parcial') {
			if (sonidoActivo) void sonarExito(esPr).catch(() => {});
			if (vibracionActiva && 'vibrate' in navigator) navigator.vibrate(esPr ? [120, 70, 180] : 80);
		}
		if (exitoId) clearTimeout(exitoId);
		exitoId = setTimeout(() => goto(volver), esPr ? 2300 : exito === 'parcial' ? 900 : 1200);
	}

	function apagarTimer() {
		descanso.saltar();
		void setTimer(false, ajustes.timer.minutos);
	}

	function cambiarTimer(minutos: number) {
		void setTimer(true, minutos);
		// Si hay un descanso en curso, ajusta su fin en vez de reiniciarlo desde cero.
		descanso.ajustarFin(minutos);
	}
</script>

{#if !ej || !g}
	<main class="glow-bg grid min-h-dvh place-items-center">
		<p style="color: var(--muted)">Ejercicio no encontrado.</p>
	</main>
{:else}
	<main
		class="min-h-dvh px-5 pb-28 pt-6"
		style="background: radial-gradient(85% 42% at 50% 0%, rgb({g.glow} / 0.20), transparent 72%), var(--bg)"
	>
		<header class="mb-4 flex items-center gap-3">
			<a
				href={volver}
				class="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
				aria-label="Volver">←</a
			>
			{#if !videoGrande}
				<button
					onclick={() => (videoGrande = true)}
					class="shrink-0 overflow-hidden rounded-xl"
					aria-label="Ver demostración en grande"
				>
					<video
						src={ej.demoVideo}
						class="size-12 bg-white object-contain"
						autoplay
						loop
						muted
						playsinline
						preload="metadata"
					></video>
				</button>
			{/if}
			<div class="min-w-0 flex-1">
				<h1 class="text-lg font-bold leading-tight">{ej.nombre}</h1>
				<p class="mt-0.5 text-xs font-medium" style="color: rgb({g.glow})">
					{g.emoji}
					{g.label} · {ej.musculo}
				</p>
			</div>
		</header>

		{#if videoGrande}
			<button
				onclick={() => (videoGrande = false)}
				class="block w-full"
				aria-label="Achicar demostración"
			>
				<video
					src={ej.demoVideo}
					class="mx-auto aspect-square w-full max-w-xs rounded-2xl bg-white object-contain"
					aria-label={ej.nombre}
					autoplay
					loop
					muted
					playsinline
					preload="auto"
				></video>
			</button>
		{/if}

		{#if ej.videoUrl}
			<div class="mt-3 flex justify-center">
				<button
					onclick={abrirTecnica}
					class="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold"
					style="color: rgb({g.glow})"
					aria-label={`Ver video de técnica para ${ej.nombre}`}>▶ Ver técnica</button
				>
			</div>
		{/if}

		{#if !diaId}
			<!-- Sin ?dia= no se entrena: vista de consulta con el progreso completo. -->
			<ProgresoEjercicio
				exerciseId={$page.params.id!}
				glow={g.glow}
				unidad={ajustes.unidad}
				metrica={ajustes.metricaPr}
				{pasoPeso}
				maquinaPlacas={!!ej.maquinaPlacas}
			/>
		{:else}
			<section
				class="mt-6 rounded-2xl border border-white/10 p-4"
				style="background: var(--surface)"
			>
				<div class="flex items-start justify-between gap-3">
					<div>
						<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
							Series
							{#if ej.maquinaPlacas && !mostrarHintMax}
								<button
									onclick={() => (mostrarHintMax = true)}
									class="ml-1 align-middle text-[11px] font-bold normal-case"
									style="color: var(--muted)"
									aria-label="Qué es MAX">ⓘ</button
								>
							{/if}
						</p>
						<p
							class="mt-0.5 text-[11px] font-medium uppercase tracking-wider"
							style="color: var(--muted)"
						>
							Sesión actual
						</p>
						{#if anterioresFecha}
							<p class="mt-0.5 text-[11px] font-medium" style="color: var(--muted)">
								Última vez · {fechaCorta(anterioresFecha)}
							</p>
						{/if}
					</div>
					{#if cargandoSeries}
						<p class="text-xs font-bold" style="color: var(--muted)">Preparando…</p>
					{:else}
						<!-- Un solo control: hechas/total adentro del stepper de series de hoy -->
						<div class="flex items-center rounded-full bg-white/5 p-0.5">
							<button
								onclick={quitarSerie}
								disabled={sets.length <= 1}
								class="grid size-10 touch-manipulation place-items-center rounded-full text-sm font-bold disabled:opacity-35"
								style="color: var(--muted)"
								aria-label="Quitar serie de hoy">−</button
							>
							<span
								class="min-w-11 text-center text-sm font-bold tabular-nums"
								style="color: {completo ? `rgb(${g.glow})` : 'var(--text)'}"
								aria-label={`${hechas} de ${sets.length} series hechas`}
								>{hechas}/{sets.length}</span
							>
							<button
								onclick={() => addSet(diaId, $page.params.id!, fechaSesion)}
								class="grid size-10 touch-manipulation place-items-center rounded-full text-sm font-bold"
								style="background: rgb({g.glow} / .18); color: rgb({g.glow})"
								aria-label="Agregar serie de hoy">+</button
							>
						</div>
					{/if}
				</div>

				{#if cargandoSeries}
					<p
						class="mt-3 rounded-xl bg-white/[0.025] p-4 text-center text-sm"
						style="color: var(--muted)"
					>
						Preparando series…
					</p>
				{:else}
					<div class="mt-3 space-y-2">
						{#each sets as s, i (i)}
							<SetRow
								set={s}
								index={i}
								anterior={anteriores[i]}
								maquinaPlacas={!!ej.maquinaPlacas}
								glow={g.glow}
								{unidad}
								{pasoPeso}
								onToggle={() => onToggle(i)}
								onToggleMax={() => toggleMax(diaId, $page.params.id!, i, fechaSesion, metrica)}
								onAjustarPeso={(d) => ajustarPeso(i, d)}
								onEscribirPeso={(el) => escribirPeso(i, el)}
								onAjustarReps={(d) => ajustarReps(i, d)}
								onEscribirReps={(el) => escribirReps(i, el)}
								onAjustarExtra={(d) => ajustarExtra(i, d)}
							/>
						{/each}
					</div>
					{#if sinHistorial}
						<div
							class="mt-2 flex items-start gap-2 rounded-xl p-2.5"
							style="background: rgb({g.glow} / .08)"
						>
							<p class="flex-1 text-xs leading-relaxed" style="color: var(--muted)">
								💡 Primera vez con este ejercicio. Empezá con un peso que te deje hacer ~12
								repeticiones cómodas y ajustá la próxima.
							</p>
						</div>
					{/if}
					{#if mostrarHintMax}
						<div
							class="mt-2 flex items-start gap-2 rounded-xl p-2.5"
							style="background: rgb(var(--max) / .08)"
						>
							<p class="flex-1 text-xs leading-relaxed" style="color: var(--muted)">
								💡 ¿Llegaste al tope de la pila de placas? Marcá <b style="color: rgb(var(--max))"
									>MAX</b
								> en esa serie y anotá los kg extra que pongas encima.
							</p>
							<button
								onclick={entendidoHintMax}
								class="shrink-0 text-xs font-bold"
								style="color: rgb(var(--max))">Entendido</button
							>
						</div>
					{/if}
				{/if}

				<div class="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-3">
					<span class="mr-1 text-xs font-semibold" style="color: var(--muted)">⏱️ Descanso</span>
					<button
						onclick={apagarTimer}
						class="rounded-full px-2.5 py-1 text-xs font-semibold"
						style={!ajustes.timer.activo
							? 'background: var(--accent); color: white'
							: 'background: rgba(255,255,255,.06); color: var(--muted)'}>Off</button
					>
					{#each [1, 2, 3, 4, 5] as m (m)}
						<button
							onclick={() => cambiarTimer(m)}
							class="rounded-full px-2.5 py-1 text-xs font-semibold"
							style={ajustes.timer.activo && ajustes.timer.minutos === m
								? 'background: var(--accent); color: white'
								: 'background: rgba(255,255,255,.06); color: var(--muted)'}>{m}'</button
						>
					{/each}
				</div>
				{#if mostrarHintTimer}
					<div
						class="mt-2 flex items-center gap-2 rounded-xl p-2.5"
						style="background: rgb({g.glow} / .08)"
					>
						<p class="flex-1 text-xs leading-relaxed" style="color: var(--muted)">
							💡 ¿Activar el descanso? Te avisa cuándo volver a la serie.
						</p>
						<button
							onclick={activarDescansoDesdeHint}
							class="shrink-0 rounded-full px-3 py-1 text-xs font-bold"
							style="background: var(--accent); color: white">Activar</button
						>
						<button
							onclick={descartarHintTimer}
							class="shrink-0 text-xs font-bold"
							style="color: var(--muted)">Ahora no</button
						>
					</div>
				{/if}
			</section>

			{#if pr}
				<section
					class="mt-3 rounded-2xl border border-white/10 p-4"
					style="background: var(--surface)"
				>
					<div class="flex items-center justify-between">
						<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
							PR {metricaLabel}
						</p>
						{#if superado}
							<span
								class="rounded-full px-2 py-0.5 text-xs font-bold"
								style="background: rgb({g.glow} / .2); color: rgb({g.glow})">🎉 Nuevo PR</span
							>
						{/if}
					</div>
					<p class="mt-1 text-3xl font-extrabold">
						🏆 {formatoNumero(pr.valor)}<span
							class="ml-1 text-lg font-semibold"
							style="color: var(--muted)"
						>
							{unidadValor}</span
						>
					</p>
					<p class="mt-0.5 text-xs font-medium" style="color: var(--muted)">
						Mejor set: {formatoSet(pr, unidad)} · {fechaCorta(pr.fecha)}
					</p>
					{#if valorOtraPr != null}
						<p class="mt-0.5 text-[11px] font-medium" style="color: var(--muted)">
							≈ {formatoNumero(valorOtraPr)}
							{unidad} en {otraLabel}
						</p>
					{/if}
					<p
						class="mt-2.5 text-[11px] leading-relaxed border-t border-white/5 pt-2"
						style="color: var(--muted)"
					>
						💡 {DESCRIPCION_METRICA[metricaEfectiva]}
					</p>
					<MiniChart
						{puntos}
						glow={g.glow}
						{metricaLabel}
						unidad={unidadValor}
						onEditarPunto={editarPuntoHistorial}
					/>
					<!-- Link discreto: la operación manda, el progreso completo se consulta aparte. -->
					<a
						href={`/ejercicio/${$page.params.id}?desde=${diaId}`}
						class="mt-2.5 block text-right text-xs font-bold"
						style="color: rgb({g.glow})">Ver progreso completo →</a
					>
				</section>
			{:else if !cargandoSeries}
				<section
					class="mt-3 rounded-2xl border border-dashed border-white/15 p-4 text-center"
					style="background: var(--surface)"
				>
					<p class="text-3xl">🏆</p>
					<p class="mt-1 text-sm font-semibold">Todavía sin PR</p>
					<p class="mt-0.5 text-xs" style="color: var(--muted)">
						Marcá una serie con ✓ para registrar tu primer récord de {metricaLabel}.
					</p>
				</section>
			{/if}

			<details
				class="mt-3 rounded-2xl border border-white/10 p-4"
				style="background: var(--surface)"
			>
				<summary class="cursor-pointer text-sm font-medium" style="color: var(--muted)">
					📝 Notas {#if tieneNota}<span style="color: rgb({g.glow})">●</span>{/if}
				</summary>
				<textarea
					bind:value={notaTexto}
					onblur={() => setNota($page.params.id!, notaTexto)}
					placeholder="Ej: asiento en posición 4, agarre cerrado…"
					rows="3"
					class="mt-2 w-full resize-none rounded-lg bg-white/5 p-3 text-sm outline-none"
				></textarea>
			</details>

			{#if completo && descanso.restoSeg === 0 && !descanso.vencido}
				<!-- Con todo hecho, el cierre queda fijo al alcance del pulgar -->
				<div
					transition:fly={{ y: 40, duration: dur(200) }}
					class="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-5 pt-6"
					style="padding-bottom: calc(1.25rem + env(safe-area-inset-bottom)); background: linear-gradient(transparent, rgb(var(--scrim) / .92) 55%)"
				>
					<button
						onclick={terminarEjercicio}
						disabled={!!exito}
						class="block w-full rounded-2xl py-4 text-center font-bold"
						style="background: rgb({g.glow}); color: white"
						>{exito ? 'Cerrando…' : '✓ Volver al día'}</button
					>
				</div>
			{:else}
				<button
					onclick={terminarEjercicio}
					disabled={!!exito}
					class="mt-4 block w-full rounded-2xl py-4 text-center font-bold"
					style="background: var(--accent); color: white"
					>{exito ? 'Cerrando…' : 'Terminar ejercicio'}</button
				>
			{/if}
		{/if}
	</main>

	{#if tecnicaAbierta && tecnicaEmbedUrl}
		<TecnicaModal
			embedUrl={tecnicaEmbedUrl}
			videoUrl={ej.videoUrl}
			nombre={ej.nombre}
			glow={g.glow}
			onClose={cerrarTecnica}
		/>
	{/if}

	{#if exito && g}
		<CelebracionOverlay
			{exito}
			{prExito}
			glow={g.glow}
			unidad={unidadValor}
			{metricaLabel}
			{hechas}
			total={sets.length}
		/>
	{/if}

	{#if serieEditando && g}
		<EditarSerieSheet
			serie={serieEditando}
			glow={g.glow}
			{unidad}
			{pasoPeso}
			{metrica}
			onClose={() => (serieEditando = null)}
		/>
	{/if}

	{#if prFlash && g}
		<!-- Flash de PR: brillo celebratorio que deja seguir registrando debajo. -->
		<div
			class="pointer-events-none fixed inset-0 z-[60] grid place-items-center px-8"
			style="background: radial-gradient(70% 50% at 50% 42%, rgb({g.glow} / .26), transparent 72%)"
		>
			<div
				transition:fly={{ y: 18, duration: dur(240) }}
				class="text-center"
				aria-live="polite"
				aria-label="Nuevo PR"
			>
				<div
					class="mx-auto grid size-24 place-items-center rounded-full border border-white/15 text-5xl font-extrabold"
					style="background: rgb({g.glow} / .22); color: rgb({g.glow}); box-shadow: 0 0 55px rgb({g.glow} / .25)"
				>
					🏆
				</div>
				<p class="mt-5 text-2xl font-extrabold">¡Nuevo PR!</p>
				<p class="mt-2 text-4xl font-extrabold tabular-nums">
					{formatoNumero(prFlash.valor)}<span
						class="ml-1 text-xl font-semibold"
						style="color: var(--muted)"
					>
						{unidadValor}</span
					>
				</p>
				<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
					{metricaLabel} · {formatoSet(prFlash, unidad)}
				</p>
			</div>
		</div>
	{/if}
{/if}
