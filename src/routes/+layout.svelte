<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { beforeNavigate, onNavigate } from '$app/navigation';
	import { useRegisterSW } from 'virtual:pwa-register/svelte';
	import { abrirBase, completarNombresSnapshotFaltantes, db, onDbBloqueada } from '$lib/db';
	import { asegurarPersistencia } from '$lib/persistencia';
	import { descargarJSON, nombreBackup } from '$lib/descarga';
	import { rescatarDatosCrudos, RescateVacioError, resumenRescate } from '$lib/rescate';
	import { seedSiVacio } from '$lib/seed';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import Icono from '$lib/components/Icono.svelte';
	import RestBar from '$lib/components/RestBar.svelte';
	import ToastAccion from '$lib/components/ToastAccion.svelte';
	import { deshacer } from '$lib/deshacer.svelte';
	import { pie } from '$lib/pie.svelte';
	import RestFocusOverlay from '$lib/components/RestFocusOverlay.svelte';
	import { descanso } from '$lib/descanso.svelte';
	import { hoy } from '$lib/hoy.svelte';
	import { errorDatos } from '$lib/errores-datos';
	import { menosMovimiento } from '$lib/motion';
	import { iniciarPresion } from '$lib/presion';
	import { limpiarArrastreHuerfano } from '$lib/dnd-safety';
	import { modoOrden } from '$lib/modo-orden.svelte';
	import { escucharReemplazosDatos } from '$lib/revision-datos';
	import {
		buscadorDeVersion,
		consumirActualizacion,
		marcarActualizacion
	} from '$lib/actualizacion';

	let { children } = $props();

	/**
	 * Entrenar es la ruta de ejercicio CON `?dia=`. Sin ese parámetro la misma ruta es
	 * la vista de progreso que se abre desde el historial: ahí no hay serie que
	 * proteger, no hay barra de descanso ocupando la franja del pulgar, y esconder el
	 * nav sólo dejaba la pantalla sin su salida cómoda.
	 */
	const enSesion = (url: URL) =>
		url.pathname.startsWith('/ejercicio/') && url.searchParams.has('dia');

	// Transición breve y espacial entre pantallas (View Transitions nativas: sin
	// librería). Sin soporte del navegador o con movimiento reducido, no hace nada y
	// SvelteKit navega como siempre — nunca bloquea ni retrasa el registro rápido.
	onNavigate((navigation) => {
		// El gesto de "volver" del sistema puede robarse un arrastre de reordenar a
		// mitad de camino: sin esto, la tarjeta arrastrada quedaba flotando en la
		// pantalla siguiente (ver $lib/dnd-safety).
		limpiarArrastreHuerfano();
		// Cambiar de pantalla es el otro momento tranquilo para buscar versión nueva:
		// sin esto, quien usa la app sin mandarla nunca al fondo dependía solo del
		// intervalo de 30 min. Va antes de los `return` de abajo para que corra igual
		// sin View Transitions, y no demora la navegación (no se espera nada).
		// `entrenando` mira todavía la pantalla vieja acá, así que el destino se
		// descarta aparte: entrar a un ejercicio no debe arrancar una descarga.
		if (!navigation.to || !enSesion(navigation.to.url)) buscarVersionNueva();
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
	const sinNav = $derived(enSesion($page.url));

	// Actualización de la app: el service worker nuevo queda esperando y avisamos acá.
	// Nunca durante el entrenamiento — recargar a mitad de una serie es justo lo que
	// el manifiesto pide no hacer; el aviso espera a que salgas del ejercicio.
	/**
	 * El service worker nuevo puede activarse sin que lo pidamos en ESTA pantalla: alcanza
	 * con que otro cliente —la app instalada y una pestaña del navegador conviven, es la
	 * situación que describe "Gym-brot está abierto dos veces"— toque "Actualizar" para que
	 * tome el control de todos a la vez. Esconder el aviso mientras entrenás no frena esa
	 * recarga, y por eso el `controllerchange` de más abajo se escucha SIEMPRE: apoyarse
	 * en el listener de vite-plugin-pwa no alcanzaba, porque el plugin lo engancha recién
	 * cuando le llega su evento `waiting`, que es justo el que puede no llegar nunca.
	 */
	let recargaPendiente = $state(false);
	/**
	 * Que haya versión esperando lo dice `buscadorDeVersion`, no el `needRefresh` del
	 * plugin: ese se prende desde un evento de workbox-window que deja de llegar a partir
	 * de la segunda versión detectada en la misma página, y era el motivo de que Ajustes
	 * prometiera un botón "Actualizar" que nunca aparecía (ver $lib/actualizacion).
	 */
	let hayVersion = $state(false);
	let dejarDeMirarVersion: (() => void) | undefined;
	useRegisterSW({
		onRegisteredSW(_url, registro) {
			buscadorDeVersion.registrar(registro);
			hayVersion = buscadorDeVersion.hayVersionLista;
			dejarDeMirarVersion = buscadorDeVersion.alQuedarLista(() => (hayVersion = true));
		},
		// Definirlo es lo que evita el `location.reload()` propio del plugin. Decidimos acá.
		onNeedReload: () => tomarElControl()
	});
	const entrenando = $derived(sinNav || descanso.restoSeg > 0 || descanso.vencido);
	let actualizando = $state(false);

	/**
	 * El service worker nuevo tomó el control. Puede venir de nuestro botón, de otra
	 * pestaña o de la app instalada conviviendo con el navegador: en todos los casos esta
	 * pantalla quedó con código viejo bajo un precache que ya no lo tiene, así que la
	 * recarga no es opcional. Escucharlo siempre —y no sólo cuando el plugin nos avisa—
	 * es lo que evita quedar en ese estado en silencio.
	 */
	function tomarElControl() {
		// La marca va antes de cualquier salida: del otro lado de la recarga es lo único
		// que queda para saber que esto fue una actualización y no un refresh cualquiera.
		marcarActualizacion(__APP_COMMIT__);
		if (entrenando) recargaPendiente = true;
		else location.reload();
	}

	/**
	 * El acuse de que salió bien. Actualizar terminaba en una recarga muda: apretabas,
	 * la pantalla parpadeaba y no había forma de saber si había pasado algo. Se muestra
	 * sólo si el commit CAMBIÓ de verdad — una recarga que trajo lo mismo no es un logro.
	 */
	const SEG_ACUSE_VERSION = 5;
	let versionNueva = $state<string | null>(null);

	// Soltaste el ejercicio y acusaste recibo del descanso: recién ahí la recarga no
	// interrumpe nada. Si estabas navegando, `beforeNavigate` ya se ocupó antes que esto.
	$effect(() => {
		if (recargaPendiente && !entrenando) location.reload();
	});

	/**
	 * Mientras la recarga espera, esta pantalla corre el código viejo pero ya la controla el
	 * service worker nuevo, que borró del precache los chunks del build anterior. Una
	 * navegación client-side los pediría y el fallback SPA los devolvería como HTML, que es
	 * justo lo que rompe la carga del módulo. Por eso salir va con navegación dura: trae el
	 * build nuevo entero de una vez.
	 */
	beforeNavigate((navegacion) => {
		if (!recargaPendiente || !navegacion.to) return;
		navegacion.cancel();
		location.href = navegacion.to.url.href;
	});

	// Sin esto el navegador solo busca versión nueva al registrar el service worker,
	// o sea al cargar la página: en la app instalada, que no se cierra nunca, un
	// deploy podía tardar días en aparecer. Buscar acá NO activa nada — deja el
	// service worker nuevo esperando, y aplicarlo sigue siendo un acto explícito
	// (el cartel, o el botón de Ajustes), así que es seguro aunque estés entrenando.
	const INTERVALO_CHEQUEO_MS = 30 * 60_000;

	function buscarVersionNueva() {
		// Entrenando no chequeamos: el aviso está tapado igual y la instalación se
		// baja el shell nuevo justo donde la conexión del gym menos ayuda.
		// El piso entre chequeos, la falta de red y los rechazos los maneja el buscador;
		// acá no hay nada que hacer con el resultado salvo esperar al próximo.
		if (entrenando) return;
		void buscadorDeVersion.buscar();
	}

	/**
	 * Tope para que el botón no quede girando si el service worker nunca contesta el
	 * SKIP_WAITING. Recargar entonces no arregla nada por sí solo, pero es la única
	 * salida que le queda al usuario y es preferible a un botón muerto.
	 */
	const TOPE_APLICAR_MS = 6000;

	function actualizar() {
		if (actualizando) return;
		actualizando = true;
		if (!buscadorDeVersion.aplicar()) {
			actualizando = false;
			return;
		}
		// La recarga la dispara `controllerchange`; acá sólo queda el piso de seguridad.
		// Si en esos segundos arrancaste a entrenar, el piso no pisa: `tomarElControl`
		// ya dejó la recarga esperando y el manifiesto manda sobre el tope.
		setTimeout(() => {
			if (!entrenando && !recargaPendiente) location.reload();
		}, TOPE_APLICAR_MS);
	}

	/**
	 * Ajustes pide actualizar sin saber si es momento: es el layout el que sabe. Si estás
	 * entrenando el pedido no se pierde ni manda a buscar ningún botón — queda anotado y
	 * se cumple solo apenas la pantalla se libera.
	 */
	let aplicarAlSalir = $state(false);
	$effect(() => {
		if (aplicarAlSalir && hayVersion && !entrenando) {
			aplicarAlSalir = false;
			actualizar();
		}
	});
	let dbError = $state<string | null>(null);
	/**
	 * La base existe pero es MÁS NUEVA que este código (VersionError): pasa cuando la
	 * app instalada quedó con el shell viejo cacheado y otra pestaña ya migró. Los datos
	 * están intactos, así que esta pantalla no ofrece borrar nada — sólo actualizar.
	 */
	let dbDesactualizada = $state(false);
	/**
	 * La base abrió bien pero un paso posterior (sembrar ejemplos, completar nombres)
	 * falló. Es degradación, no pérdida: se avisa sin bloquear y sin ofrecer borrar.
	 */
	let avisoArranque = $state<string | null>(null);
	// La base abrió y sembró: recién acá montamos las pantallas. Así toda la carga
	// pasa por un único estado recuperable y ninguna pantalla puede quedar colgada
	// con su propio spinner si la apertura se traba.
	let dbLista = $state(false);
	// El hueco de abajo se reserva sólo cuando el nav se dibuja de verdad (mismo
	// predicado que su `{#if}`). Antes la reserva miraba únicamente `sinNav`, así que
	// las pantallas de error y de carga —que no muestran nav— arrastraban 5rem de vacío
	// al final, y con el área segura pasaban a arrastrar 5rem + el inset.
	const conNav = $derived(!sinNav && dbLista && !dbError);
	// Reordenando, la barra se esconde pero el espacio sigue reservado (`conNav`): ahí
	// va la salida del modo. Sus cuatro destinos, siempre a la vista y más cerca del
	// pulgar que el "Terminar orden" del final de la lista, eran la forma más fácil de
	// salir del día sin querer justo después de acomodar el orden. Ver $lib/modo-orden.
	const navVisible = $derived(conNav && !modoOrden.abierto);
	// Apertura demorada (suele ser pasajero): aviso suave dentro de la carga.
	let dbLenta = $state(false);
	// Apertura BLOQUEADA: otra pestaña/ventana o la app instalada tiene tomada la
	// conexión (o iOS no despierta IndexedDB tras background). Sin esto, el
	// `await db.open()` espera para siempre y deja un "Cargando…" mudo y sin salida.
	let dbBloqueada = $state(false);
	let confirmarReinicioDatos = $state(false);
	let reiniciandoDatos = $state(false);
	/**
	 * Antes de poder borrar hay que haber INTENTADO rescatar.
	 *
	 * La pantalla de arranque fallido ofrecía borrar todo y ella misma avisaba que desde
	 * ahí no se podía exportar un backup: la única salida era también la única sin
	 * retorno. Ahora la salida destructiva no existe hasta que la persona probó la
	 * lectura de rescate, que en la mayoría de estos fallos —esquema, migración a
	 * medias, base más nueva— devuelve el historial entero.
	 */
	let rescateIntentado = $state(false);
	let rescatando = $state(false);
	let rescateMensaje = $state<string | null>(null);
	let rescateVacio = $state(false);

	function recargar() {
		location.reload();
	}

	async function rescatarDatos() {
		rescatando = true;
		rescateMensaje = null;
		try {
			const rescate = await rescatarDatosCrudos();
			rescateIntentado = true;
			rescateVacio = rescate.total === 0;
			if (rescate.total === 0) {
				rescateMensaje = 'La base abrió, pero está vacía: no hay nada que rescatar.';
				return;
			}
			descargarJSON(rescate.json, nombreBackup('gym-brot-rescate'));
			rescateMensaje = `⬇️ Descarga iniciada con ${resumenRescate(rescate.filas)}. Comprobá que el archivo esté en Descargas antes de seguir: se restaura desde Ajustes → Restaurar backup.`;
		} catch (error) {
			// Que el rescate falle NO puede dejar a la persona encerrada: se marca como
			// intentado igual, con el motivo a la vista, y recién ahí aparece el borrado.
			rescateIntentado = true;
			rescateVacio = error instanceof RescateVacioError;
			rescateMensaje =
				error instanceof RescateVacioError
					? 'No hay ninguna base de Gym-brot en este navegador: no hay nada que rescatar ni que borrar.'
					: `No se pudo leer nada para rescatar: ${
							error instanceof Error ? error.message : 'error desconocido'
						}`;
		} finally {
			rescatando = false;
		}
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
		// El plazo lo lleva el propio aviso: dos relojes para lo mismo se desincronizan.
		const anterior = consumirActualizacion();
		if (anterior && anterior !== __APP_COMMIT__) versionNueva = __APP_COMMIT__;
		// "Hoy" pasa a ser un dato vivo para toda la app. No depende de la base: las
		// pantallas que escriben tienen que enterarse del cambio de día aunque el arranque
		// haya quedado degradado.
		hoy.init();
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
		// El listener de `controllerchange` del plugin sólo se engancha si antes llegó su
		// evento `waiting`, que es justo lo que puede no llegar: sin este, un service
		// worker que toma el control desde otra pestaña dejaba esta pantalla con código
		// viejo y chunks borrados del precache, sin recargar nunca. `habiaControlador`
		// descarta el primer registro, donde el cambio de controlador no es novedad.
		const sw = navigator.serviceWorker;
		const habiaControlador = Boolean(sw?.controller);
		const alCambiarControlador = () => {
			if (habiaControlador) tomarElControl();
		};
		sw?.addEventListener('controllerchange', alCambiarControlador);
		const dejarDeAtenderPedidos = buscadorDeVersion.alPedirAplicar(() => {
			if (entrenando) aplicarAlSalir = true;
			else actualizar();
		});
		return () => {
			dejarDeAtenderPedidos();
			sw?.removeEventListener('controllerchange', alCambiarControlador);
			dejarDeMirarVersion?.();
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
			// PASO 1 — abrir, insistiendo: en iOS la primera apertura después del background
			// puede fallar y andar perfecto un instante después (ver `abrirBase`). Es el
			// ÚNICO fallo que puede justificar una pantalla con opción destructiva, así que
			// no se llega ahí por un hipo.
			try {
				await abrirBase();
			} catch (error) {
				clearTimeout(lentaId);
				clearTimeout(bloqueoId);
				dbLenta = false;
				// Los datos son más nuevos que este código: están enteros y hay que
				// actualizar la app, no borrarlos.
				if (error instanceof Error && error.name === 'VersionError') dbDesactualizada = true;
				else
					dbError =
						error instanceof Error
							? error.message
							: 'El navegador no permitió abrir la base de datos local.';
				return;
			}
			clearTimeout(lentaId);
			clearTimeout(bloqueoId);
			dbLenta = false;
			dbBloqueada = false;

			// PASO 2 — de acá en adelante la base ABRIÓ y el historial está entero. Sembrar
			// ejemplos y completar nombres son mejoras, no requisitos: si fallan (chunk del
			// catálogo caído a mitad de un deploy, cuota llena durante el `modify`) la app
			// arranca igual y degradada. Antes compartían el `try` de la apertura, así que
			// un backfill fallido mostraba "No pude abrir tus datos locales" y ofrecía
			// borrarlos — la única ruta de pérdida total que la app tenía por sí misma.
			try {
				await seedSiVacio();
			} catch (error) {
				console.error('seed inicial', error);
				avisoArranque = 'No pude crear las rutinas de ejemplo. Tus datos están intactos.';
			}
			try {
				// Después del seed: así la fila de ajustes ya existe y el backfill puede
				// dejar marcado que corrió, en vez de repetir el barrido en cada arranque.
				await completarNombresSnapshotFaltantes();
			} catch (error) {
				console.error('backfill de nombres', error);
				avisoArranque =
					'Algunos ejercicios viejos pueden verse como "archivados" hasta la próxima vez que abras la app. Tu historial está completo.';
			}
			// Pide almacenamiento persistente y GUARDA el veredicto: si el navegador no lo
			// concede (iOS sin instalar es el caso normal) puede borrar los datos solo, y
			// las pantallas de backup tienen que poder decirlo. Descartar la respuesta era
			// dejar a la app parada sobre almacenamiento efímero sin que nadie se entere.
			void asegurarPersistencia();
			// Restaura un descanso en curso y engancha listeners globales.
			try {
				descanso.init();
			} catch (error) {
				console.error('init del descanso', error);
			}
			dbLista = true;
		})();
		return () => {
			clearTimeout(lentaId);
			clearTimeout(bloqueoId);
		};
	});
</script>

<!--
	El hueco que se le reserva al nav es su alto REAL: 64 px de contenido más el área
	segura. Con `pb-20` fijo, en iPhone el nav (64 px + 34) se comía los últimos 18 px de
	la página — en `/herramientas/discos`, que casi no tiene padding propio, eso es una
	fila de botones debajo de la barra.
-->
<div
	class="gb-shell mx-auto min-h-dvh max-w-md"
	style={conNav ? 'padding-bottom: var(--gb-nav)' : ''}
>
	{#if dbError}
		<main
			class="gb-page glow-bg grid min-h-dvh place-items-center px-5 pb-10"
			style="--gb-pt: 2.5rem"
		>
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
				<!--
					Rescatar va ANTES que borrar, y borrar no existe hasta haber rescatado.
					La mayoría de los fallos de apertura no son corrupción sino la máquina de
					esquema de Dexie, y ahí los datos se leen enteros abriendo IndexedDB crudo.
				-->
				<button
					onclick={() => void rescatarDatos()}
					disabled={rescatando}
					class="mt-2 block w-full rounded-2xl border py-3 text-center text-sm font-bold disabled:opacity-50"
					style="border-color: rgb(var(--max) / .4); color: rgb(var(--max))"
					>{rescatando
						? 'Leyendo tus datos…'
						: rescateIntentado
							? 'Volver a intentar el rescate'
							: 'Descargar copia de rescate'}</button
				>
				{#if rescateMensaje}
					<p
						class="mt-2 rounded-xl bg-white/[0.04] p-3 text-xs leading-relaxed"
						style="color: var(--muted)"
						role="status"
					>
						{rescateMensaje}
					</p>
				{:else}
					<p class="mt-2 text-center text-xs leading-relaxed" style="color: var(--muted)">
						Lee el almacenamiento sin pasar por la app y te lo baja como backup. Probá esto antes
						que cualquier otra cosa.
					</p>
				{/if}
				{#if rescateIntentado && !rescateVacio}
					<button
						onclick={() => void reiniciarDatosLocales()}
						disabled={reiniciandoDatos}
						class="mt-4 block w-full rounded-2xl border border-white/10 py-3 text-center text-sm font-bold disabled:opacity-50"
						style="color: #ff6b6b"
						>{confirmarReinicioDatos
							? reiniciandoDatos
								? 'Reiniciando…'
								: 'Confirmar: borrar datos locales'
							: 'Reiniciar almacenamiento local'}</button
					>
					{#if confirmarReinicioDatos}
						<p class="mt-2 text-center text-xs leading-relaxed" style="color: #ff9b9b">
							Esto borra <b>todo</b> tu historial de este navegador y no se puede deshacer. Hacelo solo
							si ya bajaste la copia de rescate y la viste en Descargas: después vas a poder restaurarla
							desde Ajustes.
						</p>
					{/if}
				{/if}
			</section>
		</main>
	{:else if dbDesactualizada}
		<main
			class="gb-page glow-bg grid min-h-dvh place-items-center px-5 pb-10"
			style="--gb-pt: 2.5rem"
		>
			<section
				class="w-full rounded-2xl border border-white/10 p-5"
				style="background: var(--surface)"
			>
				<p class="text-xs font-bold uppercase tracking-[0.22em]" style="color: var(--accent-text)">
					Versión vieja
				</p>
				<h1 class="mt-2 text-2xl font-extrabold leading-tight">
					Esta copia de Gym-brot quedó atrás
				</h1>
				<p class="mt-3 text-sm leading-relaxed" style="color: var(--muted)">
					Tus datos están <b>intactos</b> — de hecho son más nuevos que esta versión de la app. Suele
					pasar cuando la app instalada tiene una versión vieja guardada y el navegador ya se actualizó.
					Cerrá Gym-brot del todo y volvé a abrirlo para tomar la versión nueva.
				</p>
				<button
					onclick={recargar}
					class="mt-4 block w-full rounded-2xl py-3 text-center text-sm font-bold"
					style="background: var(--accent); color: var(--on-accent)">Recargar</button
				>
			</section>
		</main>
	{:else if dbBloqueada}
		<main
			class="gb-page glow-bg grid min-h-dvh place-items-center px-5 pb-10"
			style="--gb-pt: 2.5rem"
		>
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
		<main class="gb-page glow-bg min-h-dvh px-5 pb-10 text-center" style="--gb-pt: 2.5rem">
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
	{#if navVisible}
		<BottomNav />
	{/if}
</div>

<!-- Arranque degradado: la base abrió y el historial está entero, pero un paso
     opcional falló. Se avisa sin bloquear y sin ofrecer nada destructivo. -->
{#if avisoArranque && dbLista}
	<div
		class="fixed inset-x-0 top-0 z-[88] mx-auto max-w-md px-5"
		style="padding-top: calc(1rem + var(--safe-top))"
		role="status"
	>
		<div
			class="flex items-start gap-3 rounded-2xl border border-white/10 p-3 shadow-2xl"
			style="background: var(--surface)"
		>
			<span class="mt-0.5 shrink-0" style="color: var(--muted)">
				<Icono nombre="backup" tamano={20} />
			</span>
			<p class="min-w-0 flex-1 text-xs leading-relaxed" style="color: var(--muted)">
				{avisoArranque}
			</p>
			<button
				onclick={() => (avisoArranque = null)}
				class="grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold"
				style="color: var(--muted)"
				aria-label="Cerrar aviso">✕</button
			>
		</div>
	</div>
{/if}

<!-- Barra de descanso global: visible en todas las pantallas mientras corre. -->
{#if dbLista && !dbError}
	<RestFocusOverlay />
	<RestBar offsetNav={!sinNav} />
{/if}

<!--
	El deshacer va global y no en cada pantalla: "Terminar con N series" navega apenas
	termina, así que una barra montada en la pantalla del ejercicio se iba junto con ella
	y la acción más destructiva quedaba siendo la única sin vuelta atrás.
-->
{#if deshacer.activo}
	<ToastAccion
		mensaje={deshacer.mensaje}
		accionTexto="Deshacer"
		tono="exito"
		segundos={9}
		offsetNav={!sinNav}
		onAccion={() => deshacer.deshacer()}
		onCerrar={() => deshacer.descartar()}
	/>
{/if}

{#if $errorDatos}
	<div
		class="fixed inset-x-0 top-0 z-[90] mx-auto max-w-md px-5"
		style="padding-top: calc(1rem + var(--safe-top))"
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

<!--
	Actualización aplicada. Usa el mismo aviso al pie que el resto de los acuses de la
	app: la respuesta aparece donde el pulgar ya está, y el tilde verde con el hash es
	la prueba de que el commit cambió de verdad. Se va solo — es un acuse, no algo que
	haya que atender.
-->
{#if versionNueva}
	<ToastAccion
		mensaje="Gym-brot está actualizado."
		detalle="Versión {versionNueva}"
		tono="exito"
		segundos={SEG_ACUSE_VERSION}
		offsetNav={!sinNav}
		onCerrar={() => (versionNueva = null)}
	/>
{/if}

<!--
	Cualquier aviso al pie ocupa este mismo hueco, y este cartel es el único persistente:
	espera su turno en vez de montarse encima. Antes sólo cedía ante el acuse de "está
	actualizado", así que tapaba a los demás y —al ir en z-85 contra el z-70 del aviso—
	les comía los toques. Ver $lib/pie.
-->
{#if hayVersion && !entrenando && dbLista && !pie.ocupado}
	<div
		class="fixed inset-x-0 z-[85] mx-auto max-w-md px-5"
		style="bottom: calc(72px + var(--safe-bottom))"
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
