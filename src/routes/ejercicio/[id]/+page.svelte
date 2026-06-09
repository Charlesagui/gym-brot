<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { db, type SetSesion, type Ajustes, type PrCelebrado } from '$lib/db';
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
		mejorSet,
		DESCRIPCION_METRICA,
		hoyStr,
		type MejorSet
	} from '$lib/sesion';
	import { notaObs, setNota, ajustesObs, setTimer, AJUSTES_DEFAULT } from '$lib/extras';
	import { sonarSetHecho, sonarExito, sonarDescansoTerminado } from '$lib/audio';
	import { pulsar } from '$lib/pulsar';

	const ej = $derived(ejercicioPorId($page.params.id!));
	const g = $derived(ej ? grupos[ej.grupo] : undefined);
	const diaId = $derived($page.url.searchParams.get('dia'));
	const volver = $derived(diaId ? `/dia/${diaId}` : '/');

	let sets = $state<SetSesion[]>([]);
	let anteriores = $state<SetSesion[]>([]);
	let anterioresFecha = $state<string | null>(null);
	let puntos = $state<MejorSet[]>([]);
	let prCelebrado = $state<PrCelebrado | null>(null);
	// Fecha fija de la sesión activa: evita perder toques si cruzás la medianoche entrenando.
	let fechaSesion = $state(hoyStr());
	let notaTexto = $state('');
	let tieneNota = $state(false);
	let ajustes = $state<Ajustes>(AJUSTES_DEFAULT);
	let cargandoSeries = $state(false);
	let exito = $state<'normal' | 'pr' | null>(null);
	let prExito = $state<MejorSet | null>(null);
	// Video grande solo la primera visita a cada ejercicio; después arranca
	// como miniatura en el header para dejar las series a mano sin scroll.
	let videoGrande = $state(true);

	$effect(() => {
		const key = `gb-video-visto-${$page.params.id!}`;
		videoGrande = !localStorage.getItem(key);
		localStorage.setItem(key, '1');
	});

	// Descanso: la fuente de verdad son timestamps, no un contador — así el tiempo
	// sigue siendo correcto aunque se bloquee la pantalla o la app pase a background.
	let restoSeg = $state(0);
	let avisoFinDescanso = $state(false);
	let descansoInicio: number | null = null;
	let descansoHasta: number | null = null;
	let intId: ReturnType<typeof setInterval> | null = null;
	let avisoId: ReturnType<typeof setTimeout> | null = null;
	let exitoId: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const exId = $page.params.id!;
		const m = ajustes.metricaPr; // recalcula el historial al cambiar de métrica
		const sub = historialObs(exId, m).subscribe((p) => (puntos = p ?? []));
		return () => sub.unsubscribe();
	});

	$effect(() => {
		const exId = $page.params.id!;
		const sub = notaObs(exId).subscribe((n) => {
			notaTexto = n?.texto ?? '';
			tieneNota = !!n?.texto;
		});
		return () => sub.unsubscribe();
	});

	$effect(() => {
		const sub = ajustesObs().subscribe((a) => (ajustes = a));
		return () => sub.unsubscribe();
	});

	// Al volver del background o del bloqueo de pantalla, recalcular el descanso al instante.
	$effect(() => {
		const refrescar = () => recalcDescanso();
		document.addEventListener('visibilitychange', refrescar);
		window.addEventListener('focus', refrescar);
		return () => {
			document.removeEventListener('visibilitychange', refrescar);
			window.removeEventListener('focus', refrescar);
		};
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

	onDestroy(() => {
		if (intId) clearInterval(intId);
		if (avisoId) clearTimeout(avisoId);
		if (exitoId) clearTimeout(exitoId);
	});

	const hechas = $derived(sets.filter((s) => s.hecha).length);
	const completo = $derived(sets.length > 0 && hechas === sets.length);
	const unidad = $derived(ajustes.unidad);
	const sonidoActivo = $derived(ajustes.sonido);
	const metrica = $derived(ajustes.metricaPr);
	const metricaLabel = $derived(metrica === 'e1rm' ? '1RM estimado (1 Repetición Máxima)' : 'peso máximo');
	const otraMetrica = $derived(metrica === 'e1rm' ? 'peso' : 'e1rm');
	const otraLabel = $derived(metrica === 'e1rm' ? 'peso máx.' : '1RM est. (1 rep. máx.)');

	const pr = $derived(puntos.reduce<MejorSet | null>((best, p) => mejorSet(best, p), null));
	const valorOtraPr = $derived(
		pr && pesoEfectivo(pr) != null
			? valorMetrica(pesoEfectivo(pr)!, pr.reps, otraMetrica)
			: null
	);
	const chart = $derived(chartPoints(puntos));
	const ultimoChart = $derived(chart[chart.length - 1]);
	const mejorHoy = $derived(mejorSetLocal(sets, true));
	const mejorPrevio = $derived(
		puntos
			.filter((p) => p.fecha !== fechaSesion)
			.reduce<number | null>((m, p) => (m == null || p.valor > m ? p.valor : m), null)
	);
	const valorCelebrado = $derived(
		prCelebrado && pesoEfectivo(prCelebrado) != null
			? valorMetrica(pesoEfectivo(prCelebrado)!, prCelebrado.reps, metrica)
			: null
	);
	const valorMejorHoy = $derived(mejorHoy ? mejorHoy.valor : null);
	const superado = $derived(
		valorMejorHoy != null &&
			(mejorPrevio == null || valorMejorHoy > mejorPrevio) &&
			(valorCelebrado == null || valorMejorHoy > valorCelebrado)
	);
	const pasoPeso = $derived(ajustes.pasoPeso ?? AJUSTES_DEFAULT.pasoPeso);

	interface ChartPoint {
		x: number;
		y: number;
		valor: number;
		label: string;
	}

	function mejorSetLocal(localSets: SetSesion[], soloHechas: boolean): MejorSet | null {
		return localSets.reduce<MejorSet | null>((best, s) => {
			if (soloHechas && !s.hecha) return best;
			const ef = pesoEfectivo(s);
			if (ef == null) return best;
			return mejorSet(best, {
				peso: s.peso!,
				reps: s.reps,
				esMax: !!s.esMax,
				extraKg: s.extraKg,
				fecha: fechaSesion,
				valor: valorMetrica(ef, s.reps, metrica)
			});
		}, null);
	}

	function formatoNumero(n: number): string {
		return Number.isInteger(n) ? String(n) : n.toFixed(1);
	}

	function formatoSet(set: MejorSet): string {
		const extra = set.esMax && set.extraKg ? ` +${formatoNumero(set.extraKg)}` : '';
		return `${formatoNumero(set.peso)}${extra} ${unidad}${set.reps ? ` × ${set.reps}` : ''}${set.esMax ? ' · MAX' : ''}`;
	}

	/** Resumen de una serie de la última vez, para la columna "Anterior". */
	function formatoAnterior(set: SetSesion | undefined): string | null {
		if (!set || (set.peso == null && set.reps == null)) return null;
		const peso = set.peso != null ? `${formatoNumero(set.peso)} ${unidad}` : '—';
		const reps = set.reps != null ? ` × ${set.reps}` : '';
		return `${peso}${reps}`;
	}

	function fechaCorta(f: string | null): string {
		if (!f) return '';
		const d = new Date(`${f}T00:00:00`);
		return d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
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
		setPeso(diaId!, $page.params.id!, i, peso, fechaSesion);
	}

	function ajustarReps(i: number, delta: number) {
		const actual = sets[i]?.reps ?? 0;
		const siguiente = Math.max(0, actual + delta);
		const reps = siguiente === 0 ? undefined : siguiente;
		if (sets[i]) sets[i].reps = reps;
		setReps(diaId!, $page.params.id!, i, reps, fechaSesion);
	}

	function ajustarExtra(i: number, delta: number) {
		const actual = sets[i]?.extraKg ?? 0;
		const siguiente = redondear(Math.max(0, actual + delta));
		const extra = siguiente === 0 ? undefined : siguiente;
		if (sets[i]) sets[i].extraKg = extra;
		setExtra(diaId!, $page.params.id!, i, extra, fechaSesion);
	}

	function escribirPeso(i: number, el: HTMLInputElement) {
		const n = Number.parseFloat(el.value.replace(',', '.'));
		const peso = Number.isFinite(n) && n > 0 ? redondear(n) : undefined;
		if (sets[i]) sets[i].peso = peso;
		setPeso(diaId!, $page.params.id!, i, peso, fechaSesion);
		el.value = peso != null ? formatoNumero(peso) : '';
	}

	function escribirReps(i: number, el: HTMLInputElement) {
		const n = Number.parseInt(el.value, 10);
		const reps = Number.isFinite(n) && n > 0 ? n : undefined;
		if (sets[i]) sets[i].reps = reps;
		setReps(diaId!, $page.params.id!, i, reps, fechaSesion);
		el.value = reps != null ? String(reps) : '';
	}

	function onToggle(i: number) {
		const yaEstaba = sets[i]?.hecha;
		toggleSet(diaId!, $page.params.id!, i, fechaSesion);
		if (yaEstaba) {
			saltarDescanso();
			return;
		}
		if (sonidoActivo) void sonarSetHecho().catch(() => {});

		const seCompletanTodas = sets.filter((s) => s.hecha).length === sets.length - 1;
		if (!seCompletanTodas) {
			iniciarDescanso(); // recién marcada como hecha → arranca descanso
		}
	}

	async function terminarEjercicio() {
		if (!diaId || exito) return;
		// PR honesto: solo cuentan las series realmente marcadas ✓ (no fabrica nada).
		const mejor = mejorSetLocal(sets, true);
		const valor = mejor ? mejor.valor : null;
		const esPr =
			valor != null &&
			(mejorPrevio == null || valor > mejorPrevio) &&
			(valorCelebrado == null || valor > valorCelebrado);
		saltarDescanso();
		if (esPr && mejor) {
			await marcarPrCelebrado(
				diaId,
				$page.params.id!,
				{ peso: mejor.peso, reps: mejor.reps, esMax: mejor.esMax, extraKg: mejor.extraKg },
				metrica,
				fechaSesion
			);
		}
		exito = esPr ? 'pr' : 'normal';
		prExito = esPr ? mejor : null;
		if (sonidoActivo) void sonarExito(esPr).catch(() => {});
		if ('vibrate' in navigator) navigator.vibrate(esPr ? [120, 70, 180] : 80);
		if (exitoId) clearTimeout(exitoId);
		exitoId = setTimeout(() => goto(volver), esPr ? 2300 : 1200);
	}

	function apagarTimer() {
		saltarDescanso();
		void setTimer(false, ajustes.timer.minutos);
	}

	function cambiarTimer(minutos: number) {
		void setTimer(true, minutos);
		// Si hay un descanso en curso, ajusta su fin en vez de reiniciarlo desde cero.
		if (descansoInicio != null && descansoHasta != null) {
			descansoHasta = descansoInicio + minutos * 60_000;
			recalcDescanso();
		}
	}

	function iniciarDescanso(minutos?: number) {
		if (minutos == null && !ajustes.timer.activo) return;
		if (intId) clearInterval(intId);
		ocultarAvisoFin();
		descansoInicio = Date.now();
		descansoHasta = descansoInicio + (minutos ?? ajustes.timer.minutos) * 60_000;
		restoSeg = Math.ceil((descansoHasta - Date.now()) / 1000);
		intId = setInterval(recalcDescanso, 500);
	}

	function recalcDescanso() {
		if (descansoHasta == null) return;
		const resto = Math.ceil((descansoHasta - Date.now()) / 1000);
		if (resto > 0) {
			restoSeg = resto;
			return;
		}
		// Venció: sonar/vibrar solo si acaba de pasar con la app a la vista — al volver
		// de un bloqueo largo no tiene sentido avisar tarde; queda la señal visual breve.
		const recienVencido = Date.now() - descansoHasta < 3000;
		const visible = document.visibilityState === 'visible';
		limpiarDescanso();
		if (recienVencido && visible) {
			if (sonidoActivo) void sonarDescansoTerminado().catch(() => {});
			if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
		}
		avisoFinDescanso = true;
		if (avisoId) clearTimeout(avisoId);
		avisoId = setTimeout(() => (avisoFinDescanso = false), 2500);
	}

	function limpiarDescanso() {
		if (intId) clearInterval(intId);
		intId = null;
		descansoInicio = null;
		descansoHasta = null;
		restoSeg = 0;
	}

	function ocultarAvisoFin() {
		avisoFinDescanso = false;
		if (avisoId) clearTimeout(avisoId);
		avisoId = null;
	}

	/** Corta el descanso sin señal alguna (Saltar, destildar una serie, terminar ejercicio). */
	function saltarDescanso() {
		limpiarDescanso();
		ocultarAvisoFin();
	}
	function mmss(s: number): string {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${String(sec).padStart(2, '0')}`;
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
			return {
				x,
				y,
				valor,
				label: formatoNumero(valor)
			};
		});
	}

	function chartLine(points: ChartPoint[]): string {
		return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
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
				class="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
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
					{g.emoji} {g.label} · {ej.musculo}
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
			{#if ej.videoUrl}
				<div class="mt-3 flex justify-center">
					<a
						href={ej.videoUrl}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold"
						style="color: rgb({g.glow})"
						aria-label={`Ver video de técnica para ${ej.nombre}`}>▶ Ver técnica</a
					>
				</div>
			{/if}
		{/if}

		{#if !diaId}
			<p
				class="mt-6 rounded-2xl border border-white/10 p-4 text-center text-sm"
				style="color: var(--muted)"
			>
				Abrí este ejercicio desde un día para registrar tus series.
			</p>
		{:else}
			<section class="mt-6 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
				<div class="flex items-start justify-between gap-3">
					<div>
						<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
							Series
						</p>
						<p class="mt-0.5 text-[11px] font-medium uppercase tracking-wider" style="color: var(--muted)">
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
								onclick={() => removeSet(diaId, $page.params.id!, sets.length - 1, fechaSesion)}
								disabled={sets.length <= 1}
								class="grid size-8 touch-manipulation place-items-center rounded-full text-sm font-bold disabled:opacity-35"
								style="color: var(--muted)"
								aria-label="Quitar serie de hoy">−</button
							>
							<span
								class="min-w-11 text-center text-sm font-bold tabular-nums"
								style="color: {completo ? `rgb(${g.glow})` : 'var(--text)'}"
								aria-label={`${hechas} de ${sets.length} series hechas`}>{hechas}/{sets.length}</span
							>
							<button
								onclick={() => addSet(diaId, $page.params.id!, fechaSesion)}
								class="grid size-8 touch-manipulation place-items-center rounded-full text-sm font-bold"
								style="background: rgb({g.glow} / .18); color: rgb({g.glow})"
								aria-label="Agregar serie de hoy">+</button
							>
						</div>
					{/if}
				</div>

				{#if cargandoSeries}
					<p class="mt-3 rounded-xl bg-white/[0.025] p-4 text-center text-sm" style="color: var(--muted)">
						Preparando series…
					</p>
				{:else}
					<div class="mt-3 space-y-2">
						{#each sets as s, i (i)}
							{@const ant = formatoAnterior(anteriores[i])}
							<div class="rounded-xl bg-white/[0.025] p-2.5">
								<div class="flex items-center gap-2">
									<button
										onclick={() => toggleMax(diaId, $page.params.id!, i, fechaSesion)}
										class="grid size-8 shrink-0 place-items-center rounded-full border text-sm font-bold"
										style={s.esMax
											? 'background: rgba(255,157,60,.22); color: #ff9d3c; border-color: rgba(255,157,60,.5)'
											: 'color: var(--muted); border-color: rgba(255,255,255,.16); border-style: dashed'}
										title="Tocá para marcar MAX (placa full)"
										aria-label={`Serie ${i + 1}: ${s.esMax ? 'quitar' : 'marcar'} MAX`}>{s.esMax ? '🔥' : i + 1}</button
									>
									<p class="min-w-0 flex-1 truncate text-[11px] font-medium" style="color: var(--muted)">
										{ant ? `Ant: ${ant}` : ''}
									</p>
									<button
										onclick={() => onToggle(i)}
										class="grid size-11 shrink-0 touch-manipulation place-items-center rounded-full border-2 text-base font-bold transition-colors"
										style={s.hecha
											? 'background: var(--accent); border-color: var(--accent); color: white'
											: 'border-color: rgba(255,255,255,.22); color: transparent'}
										aria-label={`Marcar serie ${i + 1}`}>✓</button
									>
								</div>
								<div class="mt-2 grid grid-cols-2 gap-2">
									<div class="min-w-0">
										<p class="mb-1 text-[11px] font-bold uppercase tracking-wider" style="color: var(--muted)">
											Peso ({unidad})
										</p>
										<div class="flex items-center rounded-lg bg-white/5 p-1">
											<button
												use:pulsar={() => ajustarPeso(i, -pasoPeso)}
												class="grid size-10 shrink-0 touch-manipulation select-none place-items-center rounded-md text-lg font-bold"
												style="background: rgba(255,255,255,.06); color: var(--muted)"
												aria-label={`Bajar ${pasoPeso} ${unidad} en serie ${i + 1}`}>−</button
											>
											<input
												type="text"
												inputmode="decimal"
												value={s.peso != null ? formatoNumero(s.peso) : ''}
												placeholder="—"
												onfocus={(e) => e.currentTarget.select()}
												onchange={(e) => escribirPeso(i, e.currentTarget)}
												onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
												class="w-full min-w-0 bg-transparent text-center text-base font-bold tabular-nums outline-none"
												aria-label={`Peso de la serie ${i + 1} en ${unidad}`}
											/>
											<button
												use:pulsar={() => ajustarPeso(i, pasoPeso)}
												class="grid size-10 shrink-0 touch-manipulation select-none place-items-center rounded-md text-lg font-bold"
												style="background: rgb({g.glow} / .18); color: rgb({g.glow})"
												aria-label={`Subir ${pasoPeso} ${unidad} en serie ${i + 1}`}>+</button
											>
										</div>
									</div>
									<div class="min-w-0">
										<p class="mb-1 text-[11px] font-bold uppercase tracking-wider" style="color: var(--muted)">
											Reps
										</p>
										<div class="flex items-center rounded-lg bg-white/5 p-1">
											<button
												use:pulsar={() => ajustarReps(i, -1)}
												class="grid size-10 shrink-0 touch-manipulation select-none place-items-center rounded-md text-lg font-bold"
												style="background: rgba(255,255,255,.06); color: var(--muted)"
												aria-label={`Bajar reps en serie ${i + 1}`}>−</button
											>
											<input
												type="text"
												inputmode="numeric"
												value={s.reps != null ? String(s.reps) : ''}
												placeholder="—"
												onfocus={(e) => e.currentTarget.select()}
												onchange={(e) => escribirReps(i, e.currentTarget)}
												onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
												class="w-full min-w-0 bg-transparent text-center text-base font-bold tabular-nums outline-none"
												aria-label={`Reps de la serie ${i + 1}`}
											/>
											<button
												use:pulsar={() => ajustarReps(i, 1)}
												class="grid size-10 shrink-0 touch-manipulation select-none place-items-center rounded-md text-lg font-bold"
												style="background: rgb({g.glow} / .18); color: rgb({g.glow})"
												aria-label={`Subir reps en serie ${i + 1}`}>+</button
											>
										</div>
									</div>
								</div>
								{#if s.esMax}
									<div
										class="mt-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1"
										style="background: rgba(255,157,60,.1)"
									>
										<span class="text-[11px] font-bold uppercase tracking-wider" style="color: #ff9d3c">
											🔥 Encima de la placa
										</span>
										<div class="flex items-center gap-1.5">
											<button
												use:pulsar={() => ajustarExtra(i, -pasoPeso)}
												class="grid size-8 touch-manipulation select-none place-items-center rounded-md text-sm font-bold"
												style="background: rgba(255,255,255,.06); color: var(--muted)"
												aria-label={`Bajar ${pasoPeso} ${unidad} encima en serie ${i + 1}`}>−</button
											>
											<span class="min-w-12 text-center text-xs font-bold tabular-nums" style="color: #ff9d3c">
												{s.extraKg ? `+${formatoNumero(s.extraKg)} ${unidad}` : '—'}
											</span>
											<button
												use:pulsar={() => ajustarExtra(i, pasoPeso)}
												class="grid size-8 touch-manipulation select-none place-items-center rounded-md text-sm font-bold"
												style="background: rgba(255,157,60,.18); color: #ff9d3c"
												aria-label={`Subir ${pasoPeso} ${unidad} encima en serie ${i + 1}`}>+</button
											>
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
					<p class="mt-2 text-center text-[10px] font-medium leading-relaxed" style="color: var(--muted)">
						Tocá el N° de serie para marcar 🔥 MAX cuando uses toda la placa de la máquina. Te permitirá registrar Kg extra encima de la pila de placas.
					</p>
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
							class="text-lg font-semibold"
							style="color: var(--muted)"> {unidad}</span
						>
					</p>
					<p class="mt-0.5 text-xs font-medium" style="color: var(--muted)">
						Mejor set: {formatoSet(pr)}
					</p>
					{#if valorOtraPr != null}
						<p class="mt-0.5 text-[11px] font-medium" style="color: var(--muted)">
							≈ {formatoNumero(valorOtraPr)} {unidad} en {otraLabel}
						</p>
					{/if}
					<p class="mt-2.5 text-[11px] leading-relaxed border-t border-white/5 pt-2" style="color: var(--muted)">
						💡 {DESCRIPCION_METRICA[metrica]}
					</p>
					{#if chart.length}
						<svg
							viewBox="0 0 100 28"
							class="mt-3 w-full"
							preserveAspectRatio="none"
							style="height: 46px"
						>
							<polyline
								points={chartLine(chart)}
								fill="none"
								stroke="rgb({g.glow})"
								stroke-width="2"
								vector-effect="non-scaling-stroke"
								stroke-linejoin="round"
								stroke-linecap="round"
							/>
							{#each chart as p, i (`${p.x}-${p.y}`)}
								<circle
									cx={p.x}
									cy={p.y}
									r={i === chart.length - 1 ? 2.4 : 1.7}
									fill={i === chart.length - 1 ? `rgb(${g.glow})` : 'var(--surface)'}
									stroke="rgb({g.glow})"
									stroke-width="1.4"
									vector-effect="non-scaling-stroke"
								/>
							{/each}
						</svg>
						<div class="mt-1 flex items-center justify-between gap-2 text-[11px]" style="color: var(--muted)">
							<span
								>📈 {metricaLabel} · últimas {Math.min(puntos.length, 10)}
								{Math.min(puntos.length, 10) === 1 ? 'sesión' : 'sesiones'}</span
							>
							<span>Último {ultimoChart.label} {unidad}</span>
						</div>
					{/if}
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

			<details class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
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

			<button
				onclick={terminarEjercicio}
				disabled={!!exito}
				class="mt-4 block w-full rounded-2xl py-4 text-center font-bold"
				style="background: {completo ? `rgb(${g.glow})` : 'var(--accent)'}; color: white"
				>{exito ? 'Cerrando…' : completo ? '✓ Volver al día' : '✓ Terminar ejercicio'}</button
			>
		{/if}
	</main>

	{#if exito && g}
		<div
			class="fixed inset-0 z-[60] grid place-items-center px-8"
			style="background: radial-gradient(70% 50% at 50% 42%, rgb({g.glow} / .26), transparent 72%), rgba(8,8,12,.82); backdrop-filter: blur(8px)"
		>
			<div
				transition:fly={{ y: 18, duration: 260 }}
				class="text-center"
				aria-live="polite"
				aria-label={exito === 'pr' ? 'Nuevo PR' : 'Ejercicio terminado'}
			>
				<div
					class="mx-auto grid size-24 place-items-center rounded-full border border-white/15 text-5xl font-extrabold"
					style="background: rgb({g.glow} / .22); color: rgb({g.glow}); box-shadow: 0 0 55px rgb({g.glow} / .25)"
				>
					{exito === 'pr' ? '🏆' : '✓'}
				</div>
				<p class="mt-5 text-2xl font-extrabold">
					{exito === 'pr' ? '¡Nuevo PR!' : 'Ejercicio terminado'}
				</p>
				{#if exito === 'pr' && prExito}
					<p class="mt-2 text-4xl font-extrabold tabular-nums">
						{formatoNumero(prExito.valor)}<span
							class="text-xl font-semibold"
							style="color: var(--muted)"> {unidad}</span
						>
					</p>
					<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
						{metricaLabel} · mejor set {formatoSet(prExito)}
					</p>
				{:else}
					<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
						Volviendo al día…
					</p>
				{/if}
			</div>
		</div>
	{/if}

	{#if (restoSeg > 0 || avisoFinDescanso) && g}
		<div
			transition:fly={{ y: 80, duration: 220 }}
			class="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-md items-center justify-between gap-3 border-t border-white/10 px-5 py-3"
			style="background: color-mix(in oklab, var(--surface) 94%, transparent); backdrop-filter: blur(10px)"
		>
			{#if restoSeg > 0}
				<span class="text-sm font-semibold" style="color: var(--muted)">⏱️ Descanso</span>
				<span class="text-3xl font-extrabold tabular-nums" style="color: rgb({g.glow})"
					>{mmss(restoSeg)}</span
				>
				<button
					onclick={saltarDescanso}
					class="rounded-full px-4 py-1.5 text-sm font-semibold"
					style="background: rgba(255,255,255,.12)">Saltar</button
				>
			{:else}
				<span
					class="mx-auto py-1.5 text-xl font-extrabold"
					style="color: rgb({g.glow})"
					aria-live="polite">✓ Descanso terminado</span
				>
			{/if}
		</div>
	{/if}
{/if}
