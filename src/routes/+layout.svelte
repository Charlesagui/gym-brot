<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { seedSiVacio } from '$lib/seed';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import RestBar from '$lib/components/RestBar.svelte';
	import { descanso } from '$lib/descanso.svelte';

	let { children } = $props();

	// Mid-entrenamiento el nav no aporta y ocupa la mejor zona del pulgar:
	// en la pantalla de ejercicio ese espacio es para la barra de descanso.
	const sinNav = $derived($page.url.pathname.startsWith('/ejercicio/'));

	onMount(() => {
		seedSiVacio();
		// Pide almacenamiento persistente: reduce el riesgo de que el navegador
		// (sobre todo iOS) borre los datos locales por presión de espacio.
		void navigator.storage?.persist?.();
		// Restaura un descanso en curso y engancha listeners globales.
		descanso.init();
	});
</script>

<div class="mx-auto min-h-dvh max-w-md {sinNav ? '' : 'pb-20'}">
	{@render children()}
	{#if !sinNav}
		<BottomNav />
	{/if}
</div>

<!-- Barra de descanso global: visible en todas las pantallas mientras corre. -->
<RestBar offsetNav={!sinNav} />
