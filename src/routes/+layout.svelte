<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { seedSiVacio } from '$lib/seed';

	let { children } = $props();

	onMount(() => {
		seedSiVacio();
	});
</script>

<div class="mx-auto min-h-dvh max-w-md">
	{@render children()}
</div>
