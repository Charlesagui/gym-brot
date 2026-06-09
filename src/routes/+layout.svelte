<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { seedSiVacio } from '$lib/seed';
	import BottomNav from '$lib/components/BottomNav.svelte';

	let { children } = $props();

	onMount(() => {
		seedSiVacio();
	});
</script>

<div class="mx-auto min-h-dvh max-w-md pb-20">
	{@render children()}
	<BottomNav />
</div>
