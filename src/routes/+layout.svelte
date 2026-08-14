<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { onNavigate } from '$app/navigation';
	import { useRegisterSW } from 'virtual:pwa-register/svelte';
	import { db, onDbBloqueada } from '$lib/db';
	import { seedSiVacio } from '$lib/seed';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import RestBar from '$lib/components/RestBar.svelte';
	import RestFocusOverlay from '$lib/components/RestFocusOverlay.svelte';
	import { descanso } from '$lib/descanso.svelte';
	import { errorDatos } from '$lib/errores-datos';
	import { menosMovimiento } from '$lib/motion';
	import { iniciarPresion } from '$lib/presion';
	import { limpiarArrastreHuerfano } from '$lib/dnd-safety';
	import { escucharReemplazosDatos } from '$lib/revision-datos';

	let { children } = $props();

	// Transición breve y espacial entre pantallas (View Transitions nativas: sin
	// librería). Sin soporte del navegador o con movimiento reducido, no hace nada y
	// SvelteKit navega como siempre — nunca bloquea ni retrasa el registro rápido.
	onNavigate((navigation) => {
		// El gesto de "volver" del sistema puede robarse un arrastre de reordenar a
		// mitad de camino: sin esto, la tarjeta arrastrada quedaba flotando en la
		// pantalla siguiente (ver $lib/dnd-safety).
		limpiarArrastreHuerfano();
		if (!document.startViewTransition || menosMovimiento()) return;
		if (navigation.to?.url.pathname === navigation.from?.url.pathname) return;
		// Volver (atrás del navegador) invierte el sentido del deslizamiento.
		const esVuelta = navigation.type === 'popstate' && (navigation.delta ?? 0) < 0;
		document.documentElement.dataset.gbNavDir = esVuelta ? 'back' : 'forward';
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	// Mid-entrenamiento el nav no aporta y ocupa la mejor zona del pulgar:
	// en la pantalla de ejercicio ese espacio es para la barra de descanso.
	const sinNav = $derived($page.url.pathname.startsWith('/ejercicio/'));

	// Actualización de la app: el service worker nuevo queda esperando y avisamos acá.
	// Nunca durante el entrenamiento — recargar a mitad de una serie es justo lo que
	// el manifiesto pide no hacer; el aviso espera a que salgas del ejercicio.
	let registroSW: ServiceWorkerRegistration | undefined;
	const { needRefresh, updateServiceWorker } = useRegisterSW({
		onRegisteredSW(_url, registro) {
			registroSW = registro;
		}
	});
	const entrenando = $derived(sinNav || descanso.restoSeg > 0 || descanso.vencido);
	let actualizando = $state(false);

	// Sin esto el navegador solo busca versión nueva al registrar el service worker,
	// o sea al cargar la página: en la app instalada, que no se cierra nunca, un
	// deploy podía tardar días en aparecer. Buscar acá NO activa nada — deja el
	// service worker nuevo esperando y el cambio de versión sigue dependiendo del
	// botón "Actualizar", así que es seguro aunque estés a mitad de una serie.
	const ESPERA_MIN_CHEQUEO_MS = 60_000;
	const INTERVALO_CHEQUEO_MS = 30 * 60_000;
	let ultimoChequeo = 0;

	function buscarVersionNueva() {
		// Entrenando no chequeamos: el aviso está tapado igual y la instalación se
		// baja el shell nuevo justo donde la conexión del gym menos ayuda.
		if (!registroSW || entrenando || navigator.onLine === false) return;
		// Volver al frente varias veces seguidas no debe disparar una request cada vez.
		const ahora = Date.now();
		if (ahora - ultimoChequeo < ESPERA_MIN_CHEQUEO_MS) return;
		ultimoChequeo = ahora;
		// Sin red o con el sw.js caído update() rechaza; no hay nada que hacer salvo
		// esperar al próximo chequeo.
		void registroSW.update().catch(() => {});
	}

	async function actualizar() {
		actualizando = true;
		try {
			await updateServiceWorker();
		} finally {
			actualizando = false;
		}
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
	let confirmarReinicioDatos = $state(false);
	let reiniciandoDatos = $state(false);

	function recargar() {
		location.reload();
	}

	async function reiniciarDatosLocales() {
		if (!confirmarReinicioDatos) {
			confirmarReinicioDatos = true;
			return;
		}
		reiniciandoDatos = true;
		try {
			db.close();
			await db.delete();
			location.reload();
		} catch (error) {
			dbError = `No pude reiniciar el almacenamiento: ${
				error instanceof Error ? error.message : 'error desconocido'
			}`;
			reiniciandoDatos = false;
		}
	}

	onMount(() => {
		// Acuse de presión para toda la app, con un solo listener delegado.
		const dejarDePresionar = iniciarPresion();
		const dejarDeEscucharReemplazos = escucharReemplazosDatos(() => location.reload());
		// El swipe de "volver" del sistema puede abortarse a mitad de camino sin
		// disparar ninguna navegación: touchcancel/pointercancel es la única señal
		// que llega en ese caso (ver $lib/dnd-safety).
		window.addEventListener('touchcancel', limpiarArrastreHuerfano, true);
		window.addEventListener('pointercancel', limpiarArrastreHuerfano, true);
		// Volver a la app es el momento útil: pusheás, la abrís y ya se entera. El
		// intervalo largo es solo para la sesión que queda horas abierta.
		const alVolverAlFrente = () => {
			if (document.visibilityState === 'visible') buscarVersionNueva();
		};
		document.addEventListener('visibilitychange', alVolverAlFrente);
		const chequeoId = setInterval(buscarVersionNueva, INTERVALO_CHEQUEO_MS);
		return () => {
			dejarDePresionar();
			dejarDeEscucharReemplazos();
			window.removeEventListener('touchcancel', limpiarArrastreHuerfano, true);
			window.removeEventListener('pointercancel', limpiarArrastreHuerfano, true);
			document.removeEventListener('visibilitychange', alVolverAlFrente);
			clearInterval(chequeoId);
		};
	});

	onMount(() => {
		const lentaId = setTimeout(() => (dbLenta = true), 4000);
		// Si a los 10s no abrió ni falló, casi siempre está bloqueada por otra
		// conexión: ofrecemos salida en vez de seguir esperando indefinidamente.
		const bloqueoId = setTimeout(() => {
			if (!dbLista && !dbError) dbBloqueada = true;
		}, 10000);

		onDbBloqueada(() => {
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
					style="background: var(--accent); color: var(--on-accent)">Recargar</button
				>
				<button
					onclick={() => void reiniciarDatosLocales()}
					disabled={reiniciandoDatos}
					class="mt-2 block w-full rounded-2xl border border-white/10 py-3 text-center text-sm font-bold disabled:opacity-50"
					style="color: #ff6b6b"
					>{confirmarReinicioDatos
						? reiniciandoDatos
							? 'Reiniciando…'
							: 'Confirmar: borrar datos locales'
						: 'Reiniciar almacenamiento local'}</button
				>
				{#if confirmarReinicioDatos}
					<p class="mt-2 text-center text-xs leading-relaxed" style="color: var(--muted)">
						Esto borra los datos de este navegador. Después podés restaurar un backup desde Ajustes.
					</p>
				{/if}
			</section>
		</main>
	{:else if dbBloqueada}
		<main class="gb-page glow-bg grid min-h-dvh place-items-center px-5 py-10">
			<section
				class="w-full rounded-2xl border border-white/10 p-5"
				style="background: var(--surface)"
			>
				<p class="text-xs font-bold uppercase tracking-[0.22em]" style="color: var(--accent-text)">
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
					style="background: var(--accent); color: var(--on-accent)">Recargar</button
				>
			</section>
		</main>
	{:else if !dbLista}
		<main class="gb-page glow-bg min-h-dvh px-5 py-10 text-center">
			<div class="mx-auto w-full max-w-md">
				<!-- Esqueleto con la silueta de la portada: la espera se lee como carga
				     en curso y no como una pantalla que se quedó trabada. -->
				<div class="gb-skeleton mx-auto h-8 w-40 rounded-full" aria-hidden="true"></div>
				<div class="mt-7 space-y-3" aria-hidden="true">
					<div class="gb-skeleton h-24 rounded-2xl"></div>
					<div class="gb-skeleton h-20 rounded-2xl"></div>
					<div class="gb-skeleton h-20 rounded-2xl"></div>
				</div>
				<p class="mt-6 text-sm" style="color: var(--muted)" role="status">Cargando tus datos…</p>
				{#if dbLenta}
					<p class="mx-auto mt-3 max-w-xs text-xs leading-relaxed" style="color: var(--muted)">
						⏳ Está tardando más de lo normal. Si tenés Gym-brot abierto en otra pestaña o como app
						instalada, cerrá las otras y recargá.
					</p>
					<button
						onclick={recargar}
						class="mx-auto mt-4 block rounded-2xl border border-white/10 px-5 py-2.5 text-sm font-bold"
						style="color: var(--accent-text)">Recargar</button
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

{#if $errorDatos}
	<div
		class="fixed inset-x-0 top-0 z-[90] mx-auto max-w-md px-5"
		style="padding-top: calc(1rem + env(safe-area-inset-top))"
		role="alert"
	>
		<div
			class="flex items-start gap-3 rounded-2xl border p-3 shadow-2xl"
			style="background: var(--surface); border-color: rgb(255 107 107 / .35)"
		>
			<span class="mt-0.5 text-lg" aria-hidden="true">⚠️</span>
			<div class="min-w-0 flex-1">
				<p class="text-sm font-bold" style="color: #ff6b6b">El cambio no se guardó</p>
				<p class="mt-0.5 text-xs leading-relaxed" style="color: var(--muted)">
					{$errorDatos}
				</p>
			</div>
			<button
				onclick={() => errorDatos.set(null)}
				class="grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold"
				style="color: var(--muted)"
				aria-label="Cerrar aviso">✕</button
			>
		</div>
	</div>
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
				class="min-h-11 shrink-0 rounded-full px-4 text-sm font-bold disabled:opacity-60"
				style="background: var(--accent); color: var(--on-accent)"
				>{actualizando ? 'Actualizando…' : 'Actualizar'}</button
			>
		</div>
	</div>
{/if}
