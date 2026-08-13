<script lang="ts">
	import { fly } from 'svelte/transition';
	import { dur } from '$lib/motion';
	import { modal } from '$lib/modal';

	const tituloId = 'tecnica-modal-title';
	const cierrePorArrastrePx = 76;

	// El padre lo monta solo cuando el modal está abierto (con embedUrl válido).
	let {
		embedUrl,
		videoUrl,
		nombre,
		glow,
		onClose
	}: {
		embedUrl: string;
		videoUrl: string | undefined;
		nombre: string;
		glow: string;
		onClose: () => void;
	} = $props();

	let inicioY = 0;
	let pointerActivo: number | null = null;
	let arrastrando = $state(false);
	let arrastreY = $state(0);
	let videoInteractivo = $state(false);

	const panelStyle = $derived(
		`background: radial-gradient(140% 100% at 50% 0%, rgb(${glow} / 0.14), transparent 60%), var(--surface); max-height: calc(100dvh - 3rem - env(safe-area-inset-top) - env(safe-area-inset-bottom)); padding-bottom: calc(1.25rem + env(safe-area-inset-bottom)); transform: translate3d(0, ${arrastreY}px, 0); transition: ${arrastrando ? 'none' : 'transform 160ms ease-out'}`
	);

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
			onClose();
		} else {
			arrastreY = 0;
		}
	}

	function terminarArrastreVideo(e: PointerEvent) {
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
			onClose();
		} else {
			arrastreY = 0;
			videoInteractivo = true;
		}
	}

	function cancelarArrastre(e: PointerEvent) {
		if (pointerActivo !== e.pointerId) return;
		arrastrando = false;
		pointerActivo = null;
		arrastreY = 0;
	}
</script>

<div
	use:modal={{ onClose, focoInicial: '[data-tecnica-cerrar]' }}
	class="fixed inset-0 z-[70] flex items-center justify-center px-4 sm:px-5"
	style="padding-top: calc(1.5rem + env(safe-area-inset-top)); padding-bottom: calc(1.5rem + env(safe-area-inset-bottom))"
	role="dialog"
	aria-modal="true"
	aria-labelledby={tituloId}
>
	<button
		class="absolute inset-0"
		style="background: rgb(var(--scrim) / .86); backdrop-filter: blur(8px)"
		aria-label="Cerrar técnica"
		tabindex="-1"
		onclick={onClose}
	></button>
	<div in:fly={{ y: 40, duration: dur(240) }} class="relative mx-auto w-full max-w-2xl">
		<div
			tabindex="-1"
			class="relative w-full overflow-y-auto overscroll-contain rounded-3xl border border-white/10 px-5 pt-3 shadow-2xl outline-none"
			style={panelStyle}
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
			<div class="mb-3 flex items-center justify-between gap-3">
				<div class="min-w-0 flex-1">
					<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
						Técnica
					</p>
					<p id={tituloId} class="truncate text-lg font-bold leading-tight">{nombre}</p>
				</div>
				<button
					data-tecnica-cerrar
					onclick={onClose}
					class="grid size-11 shrink-0 place-items-center rounded-full border border-white/10 text-xl font-bold"
					aria-label="Cerrar técnica">×</button
				>
			</div>
			<div class="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
				<iframe
					src={embedUrl}
					title={`Video de técnica para ${nombre}`}
					class="aspect-video w-full border-0"
					allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
					referrerpolicy="strict-origin-when-cross-origin"
					allowfullscreen
				></iframe>
				{#if !videoInteractivo}
					<button
						class="absolute inset-0 touch-none bg-transparent"
						aria-label="Activar video o arrastrar para cerrar técnica"
						onpointerdown={iniciarArrastre}
						onpointermove={moverArrastre}
						onpointerup={terminarArrastreVideo}
						onpointercancel={cancelarArrastre}
					></button>
				{/if}
			</div>
			{#if videoUrl}
				<a
					href={videoUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="mt-4 inline-flex w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold"
					style="color: rgb({glow})">Abrir en YouTube</a
				>
			{/if}
		</div>
	</div>
</div>
