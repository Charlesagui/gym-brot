<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { db, type SetSesion, type Ajustes } from '$lib/db';
	import { ejercicioPorId, grupos } from '$lib/catalog';
	import {
		sesionHoyObs,
		historialObs,
		ensureEjercicio,
		toggleSet,
		toggleMax,
		setPeso,
		setReps,
		addSet,
		removeSet,
		completarEjercicio,
		estimarPr,
		hoyStr,
		type MejorSet
	} from '$lib/sesion';
	import { notaObs, setNota, ajustesObs, setTimer, AJUSTES_DEFAULT } from '$lib/extras';

	const ej = $derived(ejercicioPorId($page.params.id!));
	const g = $derived(ej ? grupos[ej.grupo] : undefined);
	const diaId = $derived($page.url.searchParams.get('dia'));
	const volver = $derived(diaId ? `/dia/${diaId}` : '/');

	let sets = $state<SetSesion[]>([]);
	let puntos = $state<MejorSet[]>([]);
	let notaTexto = $state('');
	let tieneNota = $state(false);
	let ajustes = $state<Ajustes>(AJUSTES_DEFAULT);
	let cargandoSeries = $state(false);
	let exito = $state<'normal' | 'pr' | null>(null);

	// cuenta regresiva de descanso
	let restoSeg = $state(0);
	let intId: ReturnType<typeof setInterval> | null = null;
	let exitoId: ReturnType<typeof setTimeout> | null = null;
	type AudioContextConstructor = new () => AudioContext;
	type AudioWindow = Window &
		typeof globalThis & { webkitAudioContext?: AudioContextConstructor };
	let audioCtx: AudioContext | null = null;

	$effect(() => {
		const exId = $page.params.id!;
		const sub = historialObs(exId).subscribe((p) => (puntos = p ?? []));
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

	$effect(() => {
		const exId = $page.params.id!;
		const dId = diaId;
		let cancelado = false;
		let sub: { unsubscribe: () => void } | undefined;
		if (!dId) {
			sets = [];
			cargandoSeries = false;
			return;
		}
		cargandoSeries = true;
		(async () => {
			const dia = await db.dias.get(dId);
			const item = dia?.ejercicios.find((e) => e.exerciseId === exId);
			await ensureEjercicio(dId, exId, item?.seriesObjetivo ?? 4);
			if (cancelado) return;
			sub = sesionHoyObs(dId).subscribe((s) => {
				if (cancelado) return;
				const e = s?.ejercicios.find((x) => x.exerciseId === exId);
				sets = e ? e.sets : [];
				cargandoSeries = false;
			});
		})().catch(() => {
			if (!cancelado) {
				sets = [];
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
		if (exitoId) clearTimeout(exitoId);
	});

	const hechas = $derived(sets.filter((s) => s.hecha).length);
	const completo = $derived(sets.length > 0 && hechas === sets.length);
	const unidad = $derived(ajustes.unidad);
	const sonidoActivo = $derived(ajustes.sonido);

	const pr = $derived(puntos.reduce<MejorSet | null>((best, p) => mejorSet(best, p), null));
	const chart = $derived(chartPoints(puntos));
	const ultimoChart = $derived(chart[chart.length - 1]);
	const mejorHoy = $derived(mejorSetLocal(sets, true));
	const mejorPrevio = $derived(
		puntos
			.filter((p) => p.fecha !== hoyStr())
			.reduce<number | null>((m, p) => (m == null || valorPr(p) > m ? valorPr(p) : m), null)
	);
	const superado = $derived(
		mejorHoy != null && (mejorPrevio == null || valorPr(mejorHoy) > mejorPrevio)
	);
	const PASO_PESO = 5;

	interface ChartPoint {
		x: number;
		y: number;
		valor: number;
		label: string;
	}

	function valorPr(set: MejorSet): number {
		return set.estimado ?? estimarPr(set.peso, set.reps);
	}

	function mejorSet(a: MejorSet | null, b: MejorSet): MejorSet {
		if (!a) return b;
		if (valorPr(b) > valorPr(a)) return b;
		if (valorPr(b) === valorPr(a) && b.peso > a.peso) return b;
		return a;
	}

	function mejorSetLocal(localSets: SetSesion[], soloHechas: boolean): MejorSet | null {
		return localSets.reduce<MejorSet | null>((best, s) => {
			if (soloHechas && !s.hecha) return best;
			if (s.peso == null) return best;
			return mejorSet(best, {
				peso: s.peso,
				reps: s.reps,
				esMax: !!s.esMax,
				fecha: hoyStr(),
				estimado: estimarPr(s.peso, s.reps)
			});
		}, null);
	}

	function formatoNumero(n: number): string {
		return Number.isInteger(n) ? String(n) : n.toFixed(1);
	}

	function ajustarPeso(i: number, delta: number) {
		const actual = sets[i]?.peso ?? 0;
		const siguiente = Math.max(0, actual + delta);
		const peso = siguiente === 0 ? undefined : siguiente;
		if (sets[i]) sets[i].peso = peso;
		setPeso(diaId!, $page.params.id!, i, peso);
	}

	function ajustarReps(i: number, delta: number) {
		const actual = sets[i]?.reps ?? 0;
		const siguiente = Math.max(0, actual + delta);
		const reps = siguiente === 0 ? undefined : siguiente;
		if (sets[i]) sets[i].reps = reps;
		setReps(diaId!, $page.params.id!, i, reps);
	}

	function onToggle(i: number) {
		const yaEstaba = sets[i]?.hecha;
		toggleSet(diaId!, $page.params.id!, i);
		if (yaEstaba) {
			saltarDescanso();
			return;
		}
		void sonarSetHecho().catch(() => {});
		iniciarDescanso(); // recién marcada como hecha → arranca descanso
	}

	async function terminarEjercicio() {
		if (!diaId || exito) return;
		const mejorAlTerminar = mejorSetLocal(sets, false);
		const esPr =
			mejorAlTerminar != null &&
			(mejorPrevio == null || valorPr(mejorAlTerminar) > mejorPrevio);
		saltarDescanso();
		await completarEjercicio(diaId, $page.params.id!);
		exito = esPr ? 'pr' : 'normal';
		void sonarExito(esPr).catch(() => {});
		if ('vibrate' in navigator) navigator.vibrate(esPr ? [120, 70, 180] : 80);
		if (exitoId) clearTimeout(exitoId);
		exitoId = setTimeout(() => goto(volver), esPr ? 1200 : 850);
	}

	function apagarTimer() {
		saltarDescanso();
		void setTimer(false, ajustes.timer.minutos);
	}

	function cambiarTimer(minutos: number) {
		const descansoActivo = restoSeg > 0;
		void setTimer(true, minutos);
		if (descansoActivo) iniciarDescanso(minutos);
	}

	function iniciarDescanso(minutos?: number) {
		if (minutos == null && !ajustes.timer.activo) return;
		if (intId) clearInterval(intId);
		restoSeg = (minutos ?? ajustes.timer.minutos) * 60;
		intId = setInterval(() => {
			restoSeg -= 1;
			if (restoSeg <= 0) {
				saltarDescanso();
				void sonarDescansoTerminado().catch(() => {});
				if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
			}
		}, 1000);
	}
	function saltarDescanso() {
		if (intId) clearInterval(intId);
		intId = null;
		restoSeg = 0;
	}
	function mmss(s: number): string {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${String(sec).padStart(2, '0')}`;
	}

	function getAudioContext(): AudioContext | null {
		if (typeof window === 'undefined') return null;
		const audioWindow = window as AudioWindow;
		const Ctx = window.AudioContext ?? audioWindow.webkitAudioContext;
		if (!Ctx) return null;
		audioCtx ??= new Ctx();
		return audioCtx;
	}

	function beep(
		ctx: AudioContext,
		start: number,
		freq: number,
		duracion: number,
		volumen = 0.16,
		tipo: OscillatorType = 'sine'
	): void {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = tipo;
		osc.frequency.setValueAtTime(freq, start);
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(volumen, start + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + duracion);
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start(start);
		osc.stop(start + duracion + 0.03);
	}

	async function sonarSetHecho(): Promise<void> {
		if (!sonidoActivo) return;
		const ctx = getAudioContext();
		if (!ctx) return;
		if (ctx.state === 'suspended') await ctx.resume();
		const now = ctx.currentTime;
		beep(ctx, now, 659, 0.13, 0.1, 'triangle');
		beep(ctx, now + 0.06, 880, 0.16, 0.12, 'triangle');
		beep(ctx, now + 0.15, 1175, 0.18, 0.09, 'sine');
	}

	async function sonarExito(esPr: boolean): Promise<void> {
		if (!sonidoActivo) return;
		const ctx = getAudioContext();
		if (!ctx) return;
		if (ctx.state === 'suspended') await ctx.resume();
		const now = ctx.currentTime;
		if (esPr) {
			beep(ctx, now, 659, 0.1, 0.12);
			beep(ctx, now + 0.11, 880, 0.12, 0.14);
			beep(ctx, now + 0.25, 1175, 0.18, 0.16);
			return;
		}
		beep(ctx, now, 523, 0.08, 0.1);
		beep(ctx, now + 0.09, 784, 0.14, 0.13);
	}

	async function sonarDescansoTerminado(): Promise<void> {
		if (!sonidoActivo) return;
		const ctx = getAudioContext();
		if (!ctx) return;
		if (ctx.state === 'suspended') await ctx.resume();
		const now = ctx.currentTime;
		beep(ctx, now, 880, 0.16);
		beep(ctx, now + 0.22, 1175, 0.18);
	}

	function chartPoints(pts: MejorSet[]): ChartPoint[] {
		const u = pts.slice(-10);
		if (u.length < 2) return [];
		const valores = u.map(valorPr);
		const min = Math.min(...valores);
		const max = Math.max(...valores);
		const range = max - min || 1;
		const W = 100;
		const H = 28;
		const pad = 2;
		return u
			.map((p, i) => {
				const x = pad + (i / (u.length - 1)) * (W - 2 * pad);
				const valor = valorPr(p);
				const y = pad + (1 - (valor - min) / range) * (H - 2 * pad);
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
			<h1 class="flex-1 text-lg font-bold leading-tight">{ej.nombre}</h1>
		</header>

		<img
			src={ej.gif}
			alt={ej.nombre}
			class="mx-auto aspect-square w-full max-w-xs rounded-2xl bg-white object-contain"
		/>
		<p class="mt-2 text-center text-sm font-medium" style="color: rgb({g.glow})">
			{g.emoji} {g.label} · {ej.musculo}
		</p>

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
						<p class="mt-0.5 text-[10px] font-medium uppercase tracking-wider" style="color: var(--muted)">
							Sesión actual
						</p>
					</div>
					{#if cargandoSeries}
						<p class="text-xs font-bold" style="color: var(--muted)">Preparando…</p>
					{:else}
						<div class="flex items-center gap-2">
							<p class="text-xs font-bold" style="color: {completo ? `rgb(${g.glow})` : 'var(--muted)'}">
								{hechas}/{sets.length}
							</p>
							<div class="flex items-center rounded-full bg-white/5 p-0.5">
								<button
									onclick={() => removeSet(diaId, $page.params.id!, sets.length - 1)}
									disabled={sets.length <= 1}
									class="grid size-7 place-items-center rounded-full text-sm font-bold disabled:opacity-35"
									style="color: var(--muted)"
									aria-label="Quitar serie de hoy">−</button
								>
								<span class="min-w-6 text-center text-xs font-bold tabular-nums">{sets.length}</span>
								<button
									onclick={() => addSet(diaId, $page.params.id!)}
									class="grid size-7 place-items-center rounded-full text-sm font-bold"
									style="background: rgb({g.glow} / .18); color: rgb({g.glow})"
									aria-label="Agregar serie de hoy">+</button
								>
							</div>
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
							<div class="grid grid-cols-[1.75rem_1fr_2.5rem] items-center gap-2 rounded-xl bg-white/[0.025] p-2">
								<button
									onclick={() => toggleMax(diaId, $page.params.id!, i)}
									class="grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold"
									style={s.esMax
										? 'background: rgba(255,157,60,.22); color: #ff9d3c'
										: 'color: var(--muted)'}
									title="Tocá para marcar MAX (placa full)"
									aria-label={`Serie ${i + 1}: marcar MAX`}>{s.esMax ? '🔥' : i + 1}</button
								>
								<div class="grid min-w-0 grid-cols-2 gap-2">
									<div class="min-w-0">
										<p class="mb-1 text-[10px] font-bold uppercase tracking-wider" style="color: var(--muted)">
											Peso {unidad}
										</p>
										<div class="grid grid-cols-[1.5rem_1fr_1.5rem] items-center rounded-lg bg-white/5 p-1">
											<button
												onclick={() => ajustarPeso(i, -PASO_PESO)}
												class="grid size-6 place-items-center rounded-md text-sm font-bold"
												style="background: rgba(255,255,255,.06); color: var(--muted)"
												aria-label={`Bajar ${PASO_PESO} ${unidad} en serie ${i + 1}`}>−</button
											>
											<span class="min-w-0 text-center text-sm font-bold tabular-nums">
												{s.peso ?? '—'}
											</span>
											<button
												onclick={() => ajustarPeso(i, PASO_PESO)}
												class="grid size-6 place-items-center rounded-md text-sm font-bold"
												style="background: rgb({g.glow} / .18); color: rgb({g.glow})"
												aria-label={`Subir ${PASO_PESO} ${unidad} en serie ${i + 1}`}>+</button
											>
										</div>
									</div>
									<div class="min-w-0">
										<p class="mb-1 text-[10px] font-bold uppercase tracking-wider" style="color: var(--muted)">
											Reps
										</p>
										<div class="grid grid-cols-[1.5rem_1fr_1.5rem] items-center rounded-lg bg-white/5 p-1">
											<button
												onclick={() => ajustarReps(i, -1)}
												class="grid size-6 place-items-center rounded-md text-sm font-bold"
												style="background: rgba(255,255,255,.06); color: var(--muted)"
												aria-label={`Bajar reps en serie ${i + 1}`}>−</button
											>
											<span class="min-w-0 text-center text-sm font-bold tabular-nums">
												{s.reps ?? '—'}
											</span>
											<button
												onclick={() => ajustarReps(i, 1)}
												class="grid size-6 place-items-center rounded-md text-sm font-bold"
												style="background: rgb({g.glow} / .18); color: rgb({g.glow})"
												aria-label={`Subir reps en serie ${i + 1}`}>+</button
											>
										</div>
									</div>
								</div>
								<button
									onclick={() => onToggle(i)}
									class="ml-auto grid size-10 shrink-0 place-items-center rounded-full border-2 text-sm font-bold transition-colors"
									style={s.hecha
										? 'background: var(--accent); border-color: var(--accent); color: white'
										: 'border-color: rgba(255,255,255,.22); color: transparent'}
									aria-label={`Marcar serie ${i + 1}`}>✓</button
								>
							</div>
						{/each}
					</div>

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
							PR estimado
						</p>
						{#if superado}
							<span
								class="rounded-full px-2 py-0.5 text-xs font-bold"
								style="background: rgb({g.glow} / .2); color: rgb({g.glow})">🎉 ¡Nuevo récord!</span
							>
						{/if}
					</div>
					<p class="mt-1 text-3xl font-extrabold">
						🏆 {formatoNumero(valorPr(pr))}<span
							class="text-lg font-semibold"
							style="color: var(--muted)"> {unidad}</span
						>
					</p>
					<p class="mt-0.5 text-xs font-medium" style="color: var(--muted)">
						Mejor set: {pr.peso} {unidad}{#if pr.reps} × {pr.reps}{/if}{#if pr.esMax} · MAX{/if}
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
						<div class="mt-1 flex items-center justify-between gap-2 text-[10px]" style="color: var(--muted)">
							<span>📈 PR estimado · últimas {Math.min(puntos.length, 10)} sesiones</span>
							<span>Último {ultimoChart.label} {unidad}</span>
						</div>
					{/if}
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
				<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
					{exito === 'pr' ? 'Buen set. Quedó guardado.' : 'Volviendo al día…'}
				</p>
			</div>
		</div>
	{/if}

	{#if restoSeg > 0 && g}
		<div
			transition:fly={{ y: 80, duration: 220 }}
			class="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-md items-center justify-between gap-3 border-t border-white/10 px-5 py-3"
			style="background: color-mix(in oklab, var(--surface) 94%, transparent); backdrop-filter: blur(10px)"
		>
			<span class="text-sm font-semibold" style="color: var(--muted)">⏱️ Descanso</span>
			<span class="text-3xl font-extrabold tabular-nums" style="color: rgb({g.glow})"
				>{mmss(restoSeg)}</span
			>
			<button
				onclick={saltarDescanso}
				class="rounded-full px-4 py-1.5 text-sm font-semibold"
				style="background: rgba(255,255,255,.12)">Saltar</button
			>
		</div>
	{/if}
{/if}
