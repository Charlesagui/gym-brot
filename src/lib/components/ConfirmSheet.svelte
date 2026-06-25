<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { dur } from '$lib/motion';

	let {
		titulo,
		mensaje,
		confirmarTexto = 'Confirmar',
		cancelarTexto = 'Cancelar',
		tono = 'danger',
		onConfirm,
		onCancel
	}: {
		titulo: string;
		mensaje: string;
		confirmarTexto?: string;
		cancelarTexto?: string;
		tono?: 'danger' | 'accent';
		onConfirm: () => void | Promise<void>;
		onCancel: () => void;
	} = $props();

	let ocupado = $state(false);

	async function confirmar() {
		if (ocupado) return;
		ocupado = true;
		await onConfirm();
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !ocupado && onCancel()} />

<div class="fixed inset-0 z-[80]">
	<button
		transition:fade={{ duration: dur(140) }}
		onclick={() => !ocupado && onCancel()}
		class="absolute inset-0 w-full"
		style="background: rgb(var(--scrim) / .72)"
		aria-label={cancelarTexto}
	></button>
	<div
		transition:fly={{ y: 220, duration: dur(220) }}
		role="dialog"
		aria-modal="true"
		aria-label={titulo}
		class="absolute inset-x-0 bottom-0 mx-auto max-h-[calc(100dvh-1rem)] max-w-md overflow-y-auto rounded-t-3xl border-t border-white/10 px-5 pt-3 shadow-2xl"
		style="background: var(--surface); padding-bottom: calc(1.25rem + env(safe-area-inset-bottom))"
	>
		<div class="mx-auto h-1 w-10 rounded-full bg-white/15"></div>
		<p class="mt-4 text-lg font-extrabold leading-tight">{titulo}</p>
		<p class="mt-2 text-sm leading-relaxed" style="color: var(--muted)">{mensaje}</p>
		<div class="mt-5 grid grid-cols-2 gap-2">
			<button
				onclick={onCancel}
				disabled={ocupado}
				class="min-h-12 rounded-2xl px-4 text-sm font-bold disabled:opacity-60"
				style="background: rgba(255,255,255,.08); color: var(--muted)"
			>
				{cancelarTexto}
			</button>
			<button
				onclick={confirmar}
				disabled={ocupado}
				class="min-h-12 rounded-2xl px-4 text-sm font-bold disabled:opacity-60"
				style={tono === 'danger'
					? 'background: #ff6b6b; color: white'
					: 'background: var(--accent); color: white'}
			>
				{ocupado ? 'Procesando…' : confirmarTexto}
			</button>
		</div>
	</div>
</div>
