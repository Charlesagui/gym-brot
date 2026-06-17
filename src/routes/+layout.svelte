<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { db } from '$lib/db';
	import { seedSiVacio } from '$lib/seed';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import RestBar from '$lib/components/RestBar.svelte';
	import RestFocusOverlay from '$lib/components/RestFocusOverlay.svelte';
	import { descanso } from '$lib/descanso.svelte';

	let { children } = $props();

	// Mid-entrenamiento el nav no aporta y ocupa la mejor zona del pulgar:
	// en la pantalla de ejercicio ese espacio es para la barra de descanso.
	const sinNav = $derived($page.url.pathname.startsWith('/ejercicio/'));
	let dbError = $state<string | null>(null);
	// Apertura demorada (típico: otra pestaña vieja bloquea la migración del
	// esquema): avisar con la solución en vez de dejar un "Cargando…" mudo.
	let dbLenta = $state(false);

	onMount(() => {
		const lentaId = setTimeout(() => (dbLenta = true), 4000);
		(async () => {
			try {
				await db.open();
				clearTimeout(lentaId);
				dbLenta = false;
				await seedSiVacio();
				// Pide almacenamiento persistente: reduce el riesgo de que el navegador
				// (sobre todo iOS) borre los datos locales por presión de espacio.
				void navigator.storage?.persist?.();
				// Restaura un descanso en curso y engancha listeners globales.
				descanso.init();
			} catch (error) {
				clearTimeout(lentaId);
				dbLenta = false;
				dbError =
					error instanceof Error
						? error.message
						: 'El navegador no permitió abrir la base de datos local.';
			}
		})();
		return () => clearTimeout(lentaId);
	});
</script>

<div class="gb-shell mx-auto min-h-dvh max-w-md {sinNav ? '' : 'pb-20'}">
	{#if dbError}
		<main class="gb-page glow-bg grid min-h-dvh place-items-center px-5 py-10">
			<section
				class="w-full rounded-2xl border border-white/10 p-5"
				style="background: var(--surface)"
			>
				<p class="text-xs font-bold uppercase tracking-[0.22em]" style="color: #ff6b6b">
					Almacenamiento bloqueado
				</p>
				<h1 class="mt-2 text-2xl font-extrabold leading-tight">No pude abrir tus datos locales</h1>
				<p class="mt-3 text-sm leading-relaxed" style="color: var(--muted)">
					Gym-brot guarda tus entrenamientos solo en este dispositivo. Puede pasar en modo privado,
					con almacenamiento lleno o si IndexedDB quedo corrupto. Tus datos no se suben a ningun
					servidor.
				</p>
				<p
					class="mt-3 rounded-xl bg-white/[0.04] p-3 text-xs leading-relaxed"
					style="color: var(--muted)"
				>
					{dbError}
				</p>
				<a
					href="/ajustes"
					class="mt-4 block rounded-2xl py-3 text-center text-sm font-bold"
					style="background: var(--accent); color: white">Ir a Ajustes</a
				>
			</section>
		</main>
	{:else}
		{@render children()}
	{/if}
	{#if !sinNav && !dbError}
		<BottomNav />
	{/if}
</div>

<!-- Barra de descanso global: visible en todas las pantallas mientras corre. -->
{#if !dbError}
	<RestFocusOverlay />
	<RestBar offsetNav={!sinNav} />
{/if}

{#if dbLenta && !dbError}
	<div class="fixed inset-x-0 top-0 z-[80] mx-auto max-w-md px-5 pt-3">
		<p
			class="rounded-2xl border border-white/10 p-3.5 text-xs leading-relaxed shadow-xl"
			style="background: var(--surface); color: var(--muted)"
		>
			⏳ Tus datos están tardando en abrir. Suele pasar cuando Gym-brot quedó abierto en otra
			pestaña o ventana con una versión vieja: cerralas todas, dejá una sola y recargá.
		</p>
	</div>
{/if}
