<script lang="ts">
	import { page } from '$app/stores';

	// Sin esto, cualquier excepción no atrapada caía en la pantalla de error pelada de
	// SvelteKit: sin estilo, sin forma de volver y sin decir que los datos están a salvo.
	function recargar() {
		location.reload();
	}
</script>

<main class="gb-page glow-bg grid min-h-dvh place-items-center px-5 py-10">
	<section
		class="w-full max-w-md rounded-2xl border border-white/10 p-5"
		style="background: var(--surface)"
	>
		<p class="text-xs font-bold uppercase tracking-[0.22em]" style="color: #ff6b6b">
			Algo se rompió
		</p>
		<h1 class="mt-2 text-2xl font-extrabold leading-tight">
			{$page.status === 404 ? 'Esta pantalla no existe' : 'La app tuvo un error'}
		</h1>
		<p class="mt-3 text-sm leading-relaxed" style="color: var(--muted)">
			Tus entrenamientos siguen guardados en este teléfono: esto es un problema de la pantalla, no
			de tus datos.
		</p>
		{#if $page.error?.message}
			<p
				class="mt-3 rounded-xl bg-white/[0.04] p-3 text-xs leading-relaxed"
				style="color: var(--muted)"
			>
				{$page.error.message}
			</p>
		{/if}
		<a
			href="/"
			class="mt-4 block rounded-2xl py-3 text-center text-sm font-bold"
			style="background: var(--accent); color: var(--on-accent)">Volver al inicio</a
		>
		<button
			onclick={recargar}
			class="mt-2 block w-full rounded-2xl border border-white/10 py-3 text-center text-sm font-bold"
			style="color: var(--muted)">Recargar</button
		>
	</section>
</main>
