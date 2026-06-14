<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { descanso } from '$lib/descanso.svelte';
	import { dur } from '$lib/motion';

	const RADIO = 44;
	const CIRCUNFERENCIA = 2 * Math.PI * RADIO;
	const activo = $derived(descanso.restoSeg > 0 || descanso.vencido);
	const progreso = $derived(
		descanso.vencido
			? 1
			: descanso.totalSeg > 0
				? Math.min(1, Math.max(0, (descanso.totalSeg - descanso.restoSeg) / descanso.totalSeg))
				: 0
	);
	const dashOffset = $derived(CIRCUNFERENCIA * (1 - progreso));

	let arrastrando = $state(false);
	let inicioY = 0;
	let dragY = $state(0);

	function mmss(s: number): string {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${String(sec).padStart(2, '0')}`;
	}

	function empezarArrastre(event: PointerEvent) {
		if (!activo) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		arrastrando = true;
		inicioY = event.clientY;
		dragY = 0;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function moverArrastre(event: PointerEvent) {
		if (!arrastrando) return;
		dragY = Math.max(0, event.clientY - inicioY);
	}

	function terminarArrastre() {
		if (!arrastrando) return;
		const umbral = Math.min(150, window.innerHeight * 0.22);
		arrastrando = false;
		if (dragY >= umbral) {
			descanso.minimizarFocus();
			dragY = 0;
			return;
		}
		dragY = 0;
	}
</script>

{#if descanso.focusAbierto && activo}
	<div
		transition:fade={{ duration: dur(140) }}
		class="fixed inset-0 z-[70]"
		style="background: rgb(var(--scrim) / {0.72 - Math.min(dragY / 900, 0.28)})"
	>
		<div
			transition:fly={{ y: 28, duration: dur(220) }}
			role="dialog"
			aria-modal="true"
			aria-label="Descanso"
			tabindex="-1"
			onpointerdown={empezarArrastre}
			onpointermove={moverArrastre}
			onpointerup={terminarArrastre}
			onpointercancel={terminarArrastre}
			class="mx-auto flex min-h-dvh max-w-md touch-none flex-col px-5 pb-6 pt-4"
			style="--rest-glow: {descanso.glow}; transform: translate3d(0, {dragY}px, 0) scale({1 -
				Math.min(dragY / 2200, 0.035)}); opacity: {1 -
				Math.min(dragY / 420, 0.42)}; transition: {arrastrando
				? 'none'
				: 'transform 180ms ease, opacity 180ms ease'}; background: radial-gradient(96% 48% at 50% -4%, rgb(var(--rest-glow) / .34), transparent 72%), linear-gradient(180deg, rgb(var(--rest-glow) / .08), transparent 42%), var(--bg)"
		>
			<div class="mx-auto h-1.5 w-12 rounded-full bg-white/25" aria-hidden="true"></div>

			<div class="flex flex-1 flex-col items-center justify-center py-8 text-center">
				<p class="text-xs font-extrabold uppercase tracking-[0.28em]" style="color: var(--muted)">
					{descanso.vencido ? 'Descanso terminado' : 'Descanso'}
				</p>

				<div class="relative mt-8 grid size-72 max-h-[42dvh] max-w-[72vw] place-items-center">
					<svg viewBox="0 0 100 100" class="absolute inset-0 size-full -rotate-90" aria-hidden="true">
						<circle
							cx="50"
							cy="50"
							r={RADIO}
							fill="none"
							stroke="rgba(255,255,255,.09)"
							stroke-width="5"
						/>
						<circle
							cx="50"
							cy="50"
							r={RADIO}
							fill="none"
							stroke="rgb(var(--rest-glow))"
							stroke-linecap="round"
							stroke-width="5"
							stroke-dasharray={CIRCUNFERENCIA}
							stroke-dashoffset={dashOffset}
						/>
					</svg>

					<div aria-live="polite">
						{#if descanso.vencido}
							<p class="text-5xl font-black leading-none" style="color: rgb(var(--rest-glow))">
								A la serie
							</p>
							<p class="mt-4 text-4xl font-black tabular-nums">+{mmss(descanso.vencidoSeg)}</p>
						{:else}
							<p class="text-7xl font-black leading-none tracking-normal tabular-nums">
								{mmss(descanso.restoSeg)}
							</p>
						{/if}
					</div>
				</div>

				{#if descanso.siguiente}
					<p
						class="mt-7 max-w-[18rem] text-balance text-base font-semibold leading-snug"
						style="color: var(--muted)"
					>
						{descanso.siguiente}
					</p>
				{/if}
			</div>

			<div class="grid gap-3" style="padding-bottom: env(safe-area-inset-bottom)">
				{#if descanso.vencido}
					<button
						onclick={() => descanso.atender()}
						class="min-h-14 rounded-2xl px-5 text-base font-black"
						style="background: rgb(var(--rest-glow)); color: white">Listo</button
					>
				{:else}
					<button
						onclick={() => descanso.minimizarFocus()}
						class="min-h-14 rounded-2xl px-5 text-base font-black"
						style="background: rgb(var(--rest-glow)); color: white">Minimizar</button
					>
				{/if}
				<button
					onclick={() => descanso.saltar()}
					class="min-h-12 rounded-2xl px-5 text-sm font-bold"
					style="background: rgba(255,255,255,.09); color: var(--muted)">Saltar descanso</button
				>
			</div>
		</div>
	</div>
{/if}

<style>
	@media (prefers-reduced-motion: reduce) {
		[role='dialog'] {
			transition: none !important;
		}
	}
</style>
