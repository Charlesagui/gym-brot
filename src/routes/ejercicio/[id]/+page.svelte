<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
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
		hoyStr,
		type MejorSet
	} from '$lib/sesion';
	import { notaObs, setNota, ajustesObs, setTimer, AJUSTES_DEFAULT } from '$lib/extras';

	const ej = $derived(ejercicioPorId($page.params.id));
	const g = $derived(ej ? grupos[ej.grupo] : undefined);
	const diaId = $derived($page.url.searchParams.get('dia'));
	const volver = $derived(diaId ? `/dia/${diaId}` : '/');

	let sets = $state<SetSesion[]>([]);
	let puntos = $state<MejorSet[]>([]);
	let notaTexto = $state('');
	let tieneNota = $state(false);
	let ajustes = $state<Ajustes>(AJUSTES_DEFAULT);

	// cuenta regresiva de descanso
	let restoSeg = $state(0);
	let intId: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		const exId = $page.params.id;
		const dId = diaId;
		if (!dId) {
			sets = [];
			return;
		}
		const sub = sesionHoyObs(dId).subscribe((s) => {
			const e = s?.ejercicios.find((x) => x.exerciseId === exId);
			sets = e ? e.sets : [];
		});
		return () => sub.unsubscribe();
	});

	$effect(() => {
		const exId = $page.params.id;
		const sub = historialObs(exId).subscribe((p) => (puntos = p ?? []));
		return () => sub.unsubscribe();
	});

	$effect(() => {
		const exId = $page.params.id;
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

	onMount(async () => {
		const exId = $page.params.id;
		if (!diaId) return;
		const dia = await db.dias.get(diaId);
		const item = dia?.ejercicios.find((e) => e.exerciseId === exId);
		await ensureEjercicio(diaId, exId, item?.seriesObjetivo ?? 4);
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
			(m, s) => (s.peso != null && (m == null || s.peso > m) ? s.peso : m),
			null
		)
	);
	const mejorPrevio = $derived(
		puntos
			.filter((p) => p.fecha !== hoyStr())
			.reduce<number | null>((m, p) => (m == null || p.peso > m ? p.peso : m), null)
	);
	const superado = $derived(mejorHoy != null && (mejorPrevio == null || mejorHoy > mejorPrevio));

	function num(v: string): number | undefined {
		const n = parseFloat(v.replace(',', '.'));
		return isNaN(n) ? undefined : n;
	}

	function onToggle(i: number) {
		const yaEstaba = sets[i]?.hecha;
		toggleSet(diaId!, $page.params.id, i);
		if (!yaEstaba) iniciarDescanso(); // recién marcada como hecha → arranca descanso
	}

	function iniciarDescanso() {
		if (!ajustes.timer.activo) return;
		if (intId) clearInterval(intId);
		restoSeg = ajustes.timer.minutos * 60;
		intId = setInterval(() => {
			restoSeg -= 1;
			if (restoSeg <= 0) {
				saltarDescanso();
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
						{hechas}/{sets.length} hechas
					</p>
				</div>

				<div class="mt-3 space-y-2">
					{#each sets as s, i (i)}
						<div class="flex items-center gap-2">
							<button
								onclick={() => toggleMax(diaId, $page.params.id, i)}
								class="grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold"
								style={s.esMax
									? 'background: rgba(255,157,60,.22); color: #ff9d3c'
									: 'color: var(--muted)'}
								title="Tocá para marcar MAX (placa full)"
								aria-label={`Serie ${i + 1}: marcar MAX`}>{s.esMax ? '🔥' : i + 1}</button
							>
							<input
								type="number"
								inputmode="decimal"
								value={s.peso ?? ''}
								placeholder="—"
								onchange={(e) => setPeso(diaId, $page.params.id, i, num(e.currentTarget.value))}
								class="w-14 rounded-lg bg-white/5 px-2 py-2 text-center font-semibold outline-none"
							/>
							<span class="text-sm" style="color: var(--muted)">{unidad} ×</span>
							<input
								type="number"
								inputmode="numeric"
								value={s.reps ?? ''}
								placeholder="—"
								onchange={(e) => setReps(diaId, $page.params.id, i, num(e.currentTarget.value))}
								class="w-12 rounded-lg bg-white/5 px-2 py-2 text-center font-semibold outline-none"
							/>
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

				<button
					onclick={() => addSet(diaId, $page.params.id)}
					class="mt-3 w-full rounded-lg border border-dashed border-white/20 py-2 text-sm"
					style="color: var(--muted)">+ serie</button
				>

				<div class="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-3">
					<span class="mr-1 text-xs font-semibold" style="color: var(--muted)">⏱️ Descanso</span>
					<button
						onclick={() => setTimer(false, ajustes.timer.minutos)}
						class="rounded-full px-2.5 py-1 text-xs font-semibold"
						style={!ajustes.timer.activo
							? 'background: var(--accent); color: white'
							: 'background: rgba(255,255,255,.06); color: var(--muted)'}>Off</button
					>
					{#each [1, 2, 3, 4, 5] as m (m)}
						<button
							onclick={() => setTimer(true, m)}
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
					onblur={() => setNota($page.params.id, notaTexto)}
					placeholder="Ej: asiento en posición 4, agarre cerrado…"
					rows="3"
					class="mt-2 w-full resize-none rounded-lg bg-white/5 p-3 text-sm outline-none"
				></textarea>
			</details>

			<a
				href={volver}
				class="mt-4 block rounded-2xl py-4 text-center font-bold"
				style="background: {completo ? `rgb(${g.glow})` : 'var(--accent)'}; color: white"
				>{completo ? '✓ ¡Completado!' : '✓ Terminar ejercicio'}</a
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
