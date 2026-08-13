<script lang="ts">
	import { page } from '$app/stores';
	import { fly } from 'svelte/transition';
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db';
	import {
		buscarEjercicios,
		catalogo,
		ejercicioPorId,
		grupos,
		type Grupo,
		type Ejercicio
	} from '$lib/catalog';
	import { agregarEjercicio, quitarEjercicio } from '$lib/dias';
	import { demostracionActiva, reproducirEnVista } from '$lib/video';
	import { dur } from '$lib/motion';
	import { estadoLiveQuery } from '$lib/live';
	import ConfirmSheet from '$lib/components/ConfirmSheet.svelte';
	import { reportarErrorDatos } from '$lib/errores-datos';
	import { modal } from '$lib/modal';

	const diaId = $derived($page.params.id!);
	const fechaSesion = $derived($page.url.searchParams.get('fecha'));
	const volver = $derived(`/dia/${diaId}${fechaSesion ? `?fecha=${fechaSesion}` : ''}`);
	const cierrePorArrastrePx = 76;

	const diaStore = $derived(
		estadoLiveQuery(
			liveQuery(() => db.dias.get(diaId)),
			undefined
		)
	);
	const consultaDia = $derived($diaStore);
	const diaActual = $derived(consultaDia.valor);
	const yaEn = $derived(new Set(diaActual?.ejercicios.map((e) => e.exerciseId) ?? []));

	let q = $state('');
	let filtro = $state<Grupo | 'todos'>('todos');
	let filtroInicialAplicado = $state(false);
	const gruposList: Grupo[] = ['piernas', 'pecho', 'espalda', 'hombros', 'brazos', 'core'];
	let confirmacion = $state<{
		titulo: string;
		mensaje: string;
		confirmarTexto: string;
		onConfirm: () => void | Promise<void>;
	} | null>(null);

	const grupoSugerido = $derived.by<Grupo | 'todos'>(() => {
		const dia = diaActual;
		if (!dia?.ejercicios.length) return 'todos';
		const conteo = new Map<Grupo, number>();
		for (const item of dia.ejercicios) {
			const e = ejercicioPorId(item.exerciseId);
			if (!e) continue;
			conteo.set(e.grupo, (conteo.get(e.grupo) ?? 0) + 1);
		}
		let mejor: Grupo | 'todos' = 'todos';
		let max = 0;
		for (const g of gruposList) {
			const n = conteo.get(g) ?? 0;
			if (n > max) {
				mejor = g;
				max = n;
			}
		}
		return mejor;
	});

	$effect(() => {
		if (filtroInicialAplicado || !diaActual) return;
		if (grupoSugerido !== 'todos') filtro = grupoSugerido;
		filtroInicialAplicado = true;
	});

	// Buscar mira todo el catálogo: el filtro de grupo queda en suspenso mientras hay
	// término, y los chips lo muestran así en vez de mentir con uno resaltado.
	const buscando = $derived(q.trim() !== '');
	const filtroVisible = $derived<Grupo | 'todos'>(buscando ? 'todos' : filtro);

	// Con término buscamos en todo el catálogo (por índice normalizado, ver catalog.ts);
	// sin término manda el filtro de grupo.
	const filtrados = $derived.by(() =>
		buscando
			? buscarEjercicios(q)
			: filtro === 'todos'
				? catalogo
				: catalogo.filter((e) => e.grupo === filtro)
	);

	// El catálogo tiene 962 ejercicios: montarlos todos es un <video> y un
	// IntersectionObserver por fila. Se renderiza de a tandas y el contador vuelve a
	// cero cada vez que cambia lo que se está mirando.
	const POR_TANDA = 40;
	let visibles = $state(POR_TANDA);
	$effect(() => {
		q;
		filtro;
		visibles = POR_TANDA;
	});
	const mostrados = $derived(filtrados.slice(0, visibles));

	async function toggle(e: Ejercicio, cerrarDespues = false) {
		if (yaEn.has(e.id)) {
			// Quitar pierde las series objetivo configuradas: que no pase por un mistap.
			confirmacion = {
				titulo: 'Quitar ejercicio',
				mensaje: `Vas a quitar "${e.nombre}" de este día. Si lo volvés a agregar, puede perder su configuración de series objetivo.`,
				confirmarTexto: 'Quitar',
				onConfirm: async () => {
					await quitarEjercicio(diaId, e.id);
					confirmacion = null;
					if (cerrarDespues) cerrarPreview();
				}
			};
		} else {
			try {
				await agregarEjercicio(diaId, e.id);
				if (cerrarDespues) cerrarPreview();
			} catch (error) {
				reportarErrorDatos('No se pudo agregar el ejercicio. Intentá de nuevo.', error);
			}
		}
	}

	let preview = $state<Ejercicio | null>(null);
	let inicioY = 0;
	let pointerActivo: number | null = null;
	let arrastrando = $state(false);
	let arrastreY = $state(0);

	function cerrarPreview() {
		preview = null;
		arrastrando = false;
		pointerActivo = null;
		arrastreY = 0;
	}

	function iniciarArrastre(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		pointerActivo = e.pointerId;
		inicioY = e.clientY;
		arrastreY = 0;
		arrastrando = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		if (e.cancelable) e.preventDefault();
	}

	function moverArrastre(e: PointerEvent) {
		if (!arrastrando || pointerActivo !== e.pointerId) return;
		arrastreY = e.clientY - inicioY;
		if (e.cancelable) e.preventDefault();
	}

	function terminarArrastre(e: PointerEvent) {
		if (!arrastrando || pointerActivo !== e.pointerId) return;
		const debeCerrar = Math.abs(arrastreY) >= cierrePorArrastrePx;
		arrastrando = false;
		pointerActivo = null;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			// El navegador puede liberar la captura antes si cambia el foco.
		}
		if (debeCerrar) {
			cerrarPreview();
		} else {
			arrastreY = 0;
		}
	}

	function cancelarArrastre(e: PointerEvent) {
		if (pointerActivo !== e.pointerId) return;
		arrastrando = false;
		pointerActivo = null;
		arrastreY = 0;
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && cerrarPreview()} />

<main class="gb-page glow-bg min-h-dvh px-5 pb-12 pt-6">
	<header class="mb-4 flex items-center gap-3">
		<a
			href={volver}
			class="grid size-11 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
			aria-label="Volver">←</a
		>
		<h1 class="flex-1 text-xl font-bold">Agregar ejercicio</h1>
	</header>

	{#if consultaDia.estado === 'cargando'}
		<p class="py-8 text-center text-sm" style="color: var(--muted)">Cargando rutina…</p>
	{:else if consultaDia.estado === 'error'}
		<section
			class="rounded-2xl border border-red-400/25 bg-red-400/10 p-4 text-center"
			role="alert"
		>
			<p class="text-sm font-semibold" style="color: #ff9b9b">No se pudo cargar esta rutina.</p>
			<p class="mt-1 text-xs leading-relaxed" style="color: var(--muted)">
				No agregamos ni quitamos ejercicios. Recargá para volver a intentarlo.
			</p>
			<button
				onclick={() => location.reload()}
				class="mt-3 min-h-11 rounded-xl px-4 text-sm font-bold"
				style="background: rgba(255,255,255,.1); color: white">Reintentar</button
			>
		</section>
	{:else if !diaActual}
		<p class="py-8 text-center text-sm" style="color: var(--muted)">
			Esta rutina ya no existe. Volvé para elegir otra.
		</p>
	{:else}
		<input
			bind:value={q}
			placeholder="Buscar…"
			class="mb-3 w-full rounded-xl bg-white/5 px-4 py-2.5 outline-none"
		/>

		<div class="gb-filter-row mb-4 flex flex-wrap gap-2">
			<button
				onclick={() => ((filtro = 'todos'), (q = ''))}
				class="min-h-11 rounded-full px-3.5 py-2 text-xs font-semibold"
				aria-pressed={filtroVisible === 'todos'}
				style={filtroVisible === 'todos'
					? 'background: var(--accent); color: var(--on-accent)'
					: 'background: rgba(255,255,255,.06); color: var(--muted)'}>Todos</button
			>
			{#each gruposList as gKey (gKey)}
				{@const g = grupos[gKey]}
				<button
					onclick={() => ((filtro = gKey), (q = ''))}
					class="min-h-11 rounded-full px-3.5 py-2 text-xs font-semibold"
					aria-pressed={filtroVisible === gKey}
					style={filtroVisible === gKey
						? `background: rgb(${g.glow}); color: #000`
						: 'background: rgba(255,255,255,.06); color: var(--muted)'}>{g.emoji} {g.label}</button
				>
			{/each}
		</div>
		{#if buscando}
			<p class="-mt-2 mb-3 px-1 text-[11px]" style="color: var(--muted)">
				Buscando en todos los grupos · {filtrados.length}
				{filtrados.length === 1 ? 'resultado' : 'resultados'}
			</p>
		{/if}

		<div class="gb-landscape-catalog space-y-2.5">
			{#each mostrados as e (e.id)}
				{@const g = grupos[e.grupo]}
				{@const added = yaEn.has(e.id)}
				<div
					class="flex w-full items-center gap-2 rounded-2xl border p-2.5 transition"
					style="border-color: {added
						? `rgb(${g.glow} / .6)`
						: 'rgba(255,255,255,.1)'}; background: var(--surface)"
				>
					<button
						onclick={() => (preview = e)}
						class="flex min-w-0 flex-1 items-center gap-3 text-left"
						aria-label={`Ver ${e.nombre} en grande`}
					>
						<video
							use:reproducirEnVista={e.demoVideo}
							class="gb-thumb-frame size-14 shrink-0 rounded-xl object-contain"
							aria-label={e.nombre}
							loop
							muted
							playsinline
							preload="none"
						></video>
						<div class="min-w-0 flex-1">
							<p class="gb-line-clamp-2 text-sm font-semibold leading-tight">{e.nombre}</p>
							<p class="mt-0.5 truncate text-xs font-medium" style="color: rgb({g.glow})">
								{g.emoji}
								{g.label} · {e.musculo}
							</p>
						</div>
					</button>
					<button
						onclick={() => void toggle(e)}
						class="grid size-11 shrink-0 place-items-center rounded-full text-lg font-bold transition"
						style={added
							? `background: rgb(${g.glow}); color: #000`
							: 'background: rgba(255,255,255,.1); color: white'}
						aria-label={added ? `Quitar ${e.nombre}` : `Agregar ${e.nombre}`}
						>{added ? '✓' : '+'}</button
					>
				</div>
			{/each}

			{#if filtrados.length > visibles}
				<button
					onclick={() => (visibles += POR_TANDA)}
					class="min-h-12 w-full rounded-2xl border border-white/10 py-3 text-sm font-semibold"
					style="background: var(--surface); color: var(--muted)"
				>
					Ver más ({filtrados.length - visibles} restantes)
				</button>
			{/if}

			{#if filtrados.length === 0}
				<p class="py-8 text-center text-sm" style="color: var(--muted)">
					Nada coincide con tu búsqueda.
				</p>
			{/if}
		</div>
	{/if}
</main>

{#if preview}
	{@const p = preview}
	{@const g = grupos[p.grupo]}
	{@const added = yaEn.has(p.id)}
	<div
		use:modal={{ onClose: cerrarPreview, focoInicial: '[data-modal-inicial]' }}
		class="fixed inset-0 z-[60] flex items-center justify-center px-4"
		style="padding-top: calc(1.5rem + env(safe-area-inset-top)); padding-bottom: calc(1.5rem + env(safe-area-inset-bottom))"
		role="dialog"
		aria-modal="true"
		aria-label={`Vista previa de ${p.nombre}`}
	>
		<button
			class="absolute inset-0"
			style="background: rgb(var(--scrim) / .82); backdrop-filter: blur(6px)"
			aria-label="Cerrar vista previa"
			tabindex="-1"
			onclick={cerrarPreview}
		></button>
		<div in:fly={{ y: 40, duration: dur(240) }} class="relative mx-auto w-full max-w-sm">
			<div
				class="relative w-full overflow-y-auto overscroll-contain rounded-3xl border border-white/10 px-5 pt-3 shadow-2xl"
				style="background: radial-gradient(140% 100% at 50% 0%, rgb({g.glow} / 0.14), transparent 60%), var(--surface); max-height: calc(100dvh - 3rem - env(safe-area-inset-top) - env(safe-area-inset-bottom)); padding-bottom: calc(1.25rem + env(safe-area-inset-bottom)); transform: translate3d(0, {arrastreY}px, 0); transition: {arrastrando
					? 'none'
					: 'transform 160ms ease-out'}"
			>
				<div
					class="-mx-2 mb-2 flex h-8 touch-none select-none items-center justify-center"
					aria-hidden="true"
					onpointerdown={iniciarArrastre}
					onpointermove={moverArrastre}
					onpointerup={terminarArrastre}
					onpointercancel={cancelarArrastre}
				>
					<div class="h-1 w-10 rounded-full bg-white/25"></div>
				</div>
				<div class="mb-3 flex items-start justify-between gap-3">
					<div class="min-w-0 flex-1">
						<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
							Vista previa
						</p>
						<p class="truncate text-lg font-bold leading-tight">{p.nombre}</p>
					</div>
					<button
						data-modal-inicial
						onclick={cerrarPreview}
						class="grid size-11 shrink-0 place-items-center rounded-full border border-white/10 text-xl font-bold"
						aria-label="Cerrar vista previa">×</button
					>
				</div>
				<div class="gb-demo-frame" style="--frame-glow: {g.glow}">
					<video
						use:demostracionActiva={p.demoVideo}
						class="gb-media-ivory mx-auto aspect-square w-full max-w-xs rounded-2xl object-contain"
						aria-label={p.nombre}
						autoplay
						loop
						muted
						playsinline
						preload="auto"
						onpointerdown={iniciarArrastre}
						onpointermove={moverArrastre}
						onpointerup={terminarArrastre}
						onpointercancel={cancelarArrastre}
					></video>
				</div>
				<p class="mt-3 text-center text-sm font-medium" style="color: rgb({g.glow})">
					{g.emoji}
					{g.label} · {p.musculo}
				</p>
				<button
					onclick={() => {
						void toggle(p, true);
					}}
					class="mt-5 w-full rounded-2xl py-3.5 text-base font-bold transition"
					style={added
						? 'background: rgba(255,255,255,.08); color: var(--muted)'
						: `background: rgb(${g.glow}); color: #000`}
				>
					{added ? '✓ Quitar del día' : '+ Agregar al día'}
				</button>
			</div>
		</div>
	</div>
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
