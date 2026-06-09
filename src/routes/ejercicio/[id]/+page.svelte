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

	// cuenta regresiva de descanso
	let restoSeg = $state(0);
	let intId: ReturnType<typeof setInterval> | null = null;
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
	});

	const hechas = $derived(sets.filter((s) => s.hecha).length);
	const completo = $derived(sets.length > 0 && hechas === sets.length);
	const unidad = $derived(ajustes.unidad);

	const pr = $derived(
		puntos.reduce<MejorSet | null>((best, p) => (!best || p.peso > best.peso ? p : best), null)
	);
	const mejorHoy = $derived(
		sets.reduce<number | null>(
			(m, s) => (s.hecha && s.peso != null && (m == null || s.peso > m) ? s.peso : m),
			null
		)
	);
	const mejorPrevio = $derived(
		puntos
			.filter((p) => p.fecha !== hoyStr())
			.reduce<number | null>((m, p) => (m == null || p.peso > m ? p.peso : m), null)
	);
	const superado = $derived(mejorHoy != null && (mejorPrevio == null || mejorHoy > mejorPrevio));
	const PASO_PESO = 5;

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
		void prepararAudio().catch(() => {});
		iniciarDescanso(); // recién marcada como hecha → arranca descanso
	}

	async function terminarEjercicio() {
		if (!diaId) return;
		saltarDescanso();
		await completarEjercicio(diaId, $page.params.id!);
		goto(volver);
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

	async function prepararAudio(): Promise<void> {
		const ctx = getAudioContext();
		if (ctx?.state === 'suspended') await ctx.resume();
	}

	function beep(ctx: AudioContext, start: number, freq: number, duracion: number): void {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = 'sine';
		osc.frequency.setValueAtTime(freq, start);
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + duracion);
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start(start);
		osc.stop(start + duracion + 0.03);
	}

	async function sonarDescansoTerminado(): Promise<void> {
		const ctx = getAudioContext();
		if (!ctx) return;
		if (ctx.state === 'suspended') await ctx.resume();
		const now = ctx.currentTime;
		beep(ctx, now, 880, 0.16);
		beep(ctx, now + 0.22, 1175, 0.18);
	}

	function spark(pts: MejorSet[]): string {
		const u = pts.slice(-10);
		if (u.length < 2) return '';
		const ps = u.map((p) => p.peso);
		const min = Math.min(...ps);
		const max = Math.max(...ps);
		const range = max - min || 1;
		const W = 100;
		const H = 28;
		const pad = 2;
		return u
			.map((p, i) => {
				const x = pad + (i / (u.length - 1)) * (W - 2 * pad);
				const y = pad + (1 - (p.peso - min) / range) * (H - 2 * pad);
				return `${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
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
				<div class="flex items-center justify-between">
					<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
						Series
					</p>
					<p class="text-xs font-bold" style="color: {completo ? `rgb(${g.glow})` : 'var(--muted)'}">
						{#if cargandoSeries}Preparando…{:else}{hechas}/{sets.length} hechas{/if}
					</p>
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

					<div class="mt-3 grid grid-cols-2 gap-2">
						<button
							onclick={() => addSet(diaId, $page.params.id!)}
							class="rounded-lg border border-dashed border-white/20 py-2 text-sm"
							style="color: var(--muted)">+ serie</button
						>
						<button
							onclick={() => removeSet(diaId, $page.params.id!, sets.length - 1)}
							disabled={sets.length <= 1}
							class="rounded-lg border border-dashed border-white/20 py-2 text-sm disabled:opacity-35"
							style="color: #ff6b6b">− serie</button
						>
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
							Récord (PR)
						</p>
						{#if superado}
							<span
								class="rounded-full px-2 py-0.5 text-xs font-bold"
								style="background: rgb({g.glow} / .2); color: rgb({g.glow})">🎉 ¡Nuevo récord!</span
							>
						{/if}
					</div>
					<p class="mt-1 text-3xl font-extrabold">
						🏆 {pr.peso}<span class="text-lg font-semibold" style="color: var(--muted)"> {unidad}</span>
						{#if pr.reps}<span class="text-lg font-semibold" style="color: var(--muted)">
								× {pr.reps}</span
							>{/if}
						{#if pr.esMax}🔥{/if}
					</p>
					{#if spark(puntos)}
						<svg
							viewBox="0 0 100 28"
							class="mt-3 w-full"
							preserveAspectRatio="none"
							style="height: 46px"
						>
							<polyline
								points={spark(puntos)}
								fill="none"
								stroke="rgb({g.glow})"
								stroke-width="2"
								vector-effect="non-scaling-stroke"
								stroke-linejoin="round"
								stroke-linecap="round"
							/>
						</svg>
						<p class="mt-1 text-[10px]" style="color: var(--muted)">
							📈 Progreso · últimas {Math.min(puntos.length, 10)} sesiones
						</p>
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
				class="mt-4 block w-full rounded-2xl py-4 text-center font-bold"
				style="background: {completo ? `rgb(${g.glow})` : 'var(--accent)'}; color: white"
				>{completo ? '✓ Volver al día' : '✓ Terminar ejercicio'}</button
			>
		{/if}
	</main>

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
