<script lang="ts">
	import { fly } from 'svelte/transition';
	import { dur } from '$lib/motion';

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
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<div
	class="fixed inset-0 z-[70] flex flex-col justify-end sm:justify-center sm:px-5"
	role="dialog"
	aria-modal="true"
	aria-label={`Técnica de ${nombre}`}
>
	<button
		class="absolute inset-0"
		style="background: rgb(var(--scrim) / .86); backdrop-filter: blur(8px)"
		aria-label="Cerrar técnica"
		onclick={onClose}
	></button>
	<div
		in:fly={{ y: 40, duration: dur(240) }}
		class="relative mx-auto w-full max-w-2xl rounded-t-3xl border-t border-white/10 px-5 pb-8 pt-3 sm:rounded-3xl sm:border"
		style="background: radial-gradient(140% 100% at 50% 0%, rgb({glow} / 0.14), transparent 60%), var(--surface)"
	>
		<div class="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20"></div>
		<div class="mb-3 flex items-center justify-between gap-3">
			<div class="min-w-0">
				<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
					Técnica
				</p>
				<p class="truncate text-lg font-bold leading-tight">{nombre}</p>
			</div>
			<button
				onclick={onClose}
				class="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 text-xl font-bold"
				aria-label="Cerrar técnica">×</button
			>
		</div>
		<div class="overflow-hidden rounded-2xl border border-white/10 bg-black">
			<iframe
				src={embedUrl}
				title={`Video de técnica para ${nombre}`}
				class="aspect-video w-full"
				allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
				allowfullscreen
			></iframe>
		</div>
		<a
			href={videoUrl}
			target="_blank"
			rel="noreferrer"
			class="mt-4 inline-flex w-full items-center justify-center rounded-2xl border border-white/10 px-4 py-3 text-sm font-bold"
			style="color: rgb({glow})">Abrir en YouTube</a
		>
	</div>
</div>
