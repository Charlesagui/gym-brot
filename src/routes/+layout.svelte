<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { useRegisterSW } from 'virtual:pwa-register/svelte';
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

	// Actualización de la app: el service worker nuevo queda esperando y avisamos acá.
	// Nunca durante el entrenamiento — recargar a mitad de una serie es justo lo que
	// el manifiesto pide no hacer; el aviso espera a que salgas del ejercicio.
	const { needRefresh, updateServiceWorker } = useRegisterSW();
	const entrenando = $derived(sinNav || descanso.restoSeg > 0 || descanso.vencido);
	let actualizando = $state(false);

	async function actualizar() {
		actualizando = true;
		await updateServiceWorker();
	}
	let dbError = $state<string | null>(null);
	// La base abrió y sembró: recién acá montamos las pantallas. Así toda la carga
	// pasa por un único estado recuperable y ninguna pantalla puede quedar colgada
	// con su propio spinner si la apertura se traba.
	let dbLista = $state(false);
	// Apertura demorada (suele ser pasajero): aviso suave dentro de la carga.
	let dbLenta = $state(false);
	// Apertura BLOQUEADA: otra pestaña/ventana o la app instalada tiene tomada la
	// conexión (o iOS no despierta IndexedDB tras background). Sin esto, el
	// `await db.open()` espera para siempre y deja un "Cargando…" mudo y sin salida.
	let dbBloqueada = $state(false);

	function recargar() {
		location.reload();
	}

	onMount(() => {
		const lentaId = setTimeout(() => (dbLenta = true), 4000);
		// Si a los 10s no abrió ni falló, casi siempre está bloqueada por otra
		// conexión: ofrecemos salida en vez de seguir esperando indefinidamente.
		const bloqueoId = setTimeout(() => {
			if (!dbLista && !dbError) dbBloqueada = true;
		}, 10000);

		// Dexie avisa explícitamente cuando otra conexión impide abrir/migrar.
		db.on('blocked', () => {
			if (!dbLista && !dbError) dbBloqueada = true;
		});

		(async () => {
			try {
				await db.open();
				clearTimeout(lentaId);
				clearTimeout(bloqueoId);
				dbLenta = false;
				dbBloqueada = false;
				await seedSiVacio();
				// Pide almacenamiento persistente: reduce el riesgo de que el navegador
				// (sobre todo iOS) borre los datos locales por presión de espacio.
				void navigator.storage?.persist?.();
				// Restaura un descanso en curso y engancha listeners globales.
				descanso.init();
				dbLista = true;
			} catch (error) {
				clearTimeout(lentaId);
				clearTimeout(bloqueoId);
				dbLenta = false;
				dbError =
					error instanceof Error
						? error.message
						: 'El navegador no permitió abrir la base de datos local.';
			}
		})();
		return () => {
			clearTimeout(lentaId);
			clearTimeout(bloqueoId);
		};
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
				<button
					onclick={recargar}
					class="mt-4 block w-full rounded-2xl py-3 text-center text-sm font-bold"
					style="background: var(--accent); color: white">Recargar</button
				>
				<a
					href="/ajustes"
					class="mt-2 block rounded-2xl border border-white/10 py-3 text-center text-sm font-bold"
					style="color: var(--muted)">Ir a Ajustes</a
				>
			</section>
		</main>
	{:else if dbBloqueada}
		<main class="gb-page glow-bg grid min-h-dvh place-items-center px-5 py-10">
			<section
				class="w-full rounded-2xl border border-white/10 p-5"
				style="background: var(--surface)"
			>
				<p class="text-xs font-bold uppercase tracking-[0.22em]" style="color: var(--accent)">
					Datos en uso en otro lado
				</p>
				<h1 class="mt-2 text-2xl font-extrabold leading-tight">Gym-brot está abierto dos veces</h1>
				<p class="mt-3 text-sm leading-relaxed" style="color: var(--muted)">
					Tus datos locales no pueden abrirse en dos lugares a la vez. Suele pasar si tenés la app
					instalada <b>y</b> también abierta en el navegador, o en varias pestañas. Cerrá las otras y
					recargá esta.
				</p>
				<button
					onclick={recargar}
					class="mt-4 block w-full rounded-2xl py-3 text-center text-sm font-bold"
					style="background: var(--accent); color: white">Recargar</button
				>
			</section>
		</main>
	{:else if !dbLista}
		<main class="gb-page glow-bg grid min-h-dvh place-items-center px-5 py-10 text-center">
			<div>
				<p class="text-sm" style="color: var(--muted)">Cargando tus datos…</p>
				{#if dbLenta}
					<p class="mx-auto mt-3 max-w-xs text-xs leading-relaxed" style="color: var(--muted)">
						⏳ Está tardando más de lo normal. Si tenés Gym-brot abierto en otra pestaña o como app
						instalada, cerrá las otras y recargá.
					</p>
					<button
						onclick={recargar}
						class="mx-auto mt-4 block rounded-2xl border border-white/10 px-5 py-2.5 text-sm font-bold"
						style="color: var(--accent)">Recargar</button
					>
				{/if}
			</div>
		</main>
	{:else}
		{@render children()}
	{/if}
	{#if !sinNav && dbLista && !dbError}
		<BottomNav />
	{/if}
</div>

<!-- Barra de descanso global: visible en todas las pantallas mientras corre. -->
{#if dbLista && !dbError}
	<RestFocusOverlay />
	<RestBar offsetNav={!sinNav} />
{/if}

{#if $needRefresh && !entrenando && dbLista}
	<div
		class="fixed inset-x-0 z-[85] mx-auto max-w-md px-5"
		style="bottom: calc(72px + env(safe-area-inset-bottom))"
		role="status"
	>
		<div
			class="flex items-center gap-3 rounded-2xl border border-white/10 p-3"
			style="background: var(--surface)"
		>
			<span class="text-lg" aria-hidden="true">✨</span>
			<p class="min-w-0 flex-1 text-xs leading-relaxed" style="color: var(--muted)">
				Hay una versión nueva de Gym-brot.
			</p>
			<button
				onclick={actualizar}
				disabled={actualizando}
				class="min-h-10 shrink-0 rounded-full px-4 text-sm font-bold disabled:opacity-60"
				style="background: var(--accent); color: white"
				>{actualizando ? 'Actualizando…' : 'Actualizar'}</button
			>
		</div>
	</div>
{/if}
