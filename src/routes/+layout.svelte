<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { seedSiVacio } from '$lib/seed';
	import BottomNav from '$lib/components/BottomNav.svelte';

	let { children } = $props();

	// Mid-entrenamiento el nav no aporta y ocupa la mejor zona del pulgar:
	// en la pantalla de ejercicio ese espacio es para la barra de descanso.
	const sinNav = $derived($page.url.pathname.startsWith('/ejercicio/'));

	onMount(() => {
		seedSiVacio();
	});
</script>

<div class="mx-auto min-h-dvh max-w-md {sinNav ? '' : 'pb-20'}">
	{@render children()}
	{#if !sinNav}
		<BottomNav />
	{/if}
</div>
