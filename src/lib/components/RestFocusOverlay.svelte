<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { descanso } from '$lib/descanso.svelte';
	import { dur } from '$lib/motion';
	import { modal } from '$lib/modal';
	import RuedaTiempo from './RuedaTiempo.svelte';
	import Icono from './Icono.svelte';
	import { ajustesObs, AJUSTES_DEFAULT, setDescansoEjercicio } from '$lib/extras';
	import { fromLiveQuery } from '$lib/live';
	import { RUEDA_DESCANSO, segundosAMinutos } from '$lib/descanso-preset';

	const ajustes = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	/** La rueda solo aparece si la pedís: el descanso normal no necesita que la toques. */
	let mostrarRueda = $state(false);
	/** Un guardado que falló. La duración de ESTA vez ya se aplicó igual. */
	let errorGuardado = $state<string | null>(null);
	/**
	 * La duración según la rueda mientras la estás girando, o `null` si no la estás
	 * tocando. Sin esto la rueda mostraba un valor que se mueve solo y el número se caía
	 * debajo del dedo: cinco detents de +15 no daban +75.
	 */
	let duracionElegida = $state<number | null>(null);
	const segundosRueda = $derived(duracionElegida ?? descanso.duracionSeg);

	/**
	 * La rueda dice cuánto DURA el descanso, y eso se guarda en el ejercicio.
	 *
	 * Antes editaba lo que faltaba y no persistía nada: era el único lugar donde se podía
	 * cambiar el descanso mientras descansabas, pero al día siguiente arrancabas de cero.
	 * Ahora se elige acá —donde el número está a la vista— y queda. Estirar "un poco más"
	 * es otra cosa y tiene su propio botón (`+30 s`), que no toca la duración elegida.
	 */
	function girarDuracion(segundos: number) {
		duracionElegida = segundos;
	}

	async function soltarDuracion(segundos: number) {
		duracionElegida = null;
		errorGuardado = null;
		descanso.ajustarFin(segundosAMinutos(segundos));
		// El descanso es global: se guarda en el ejercicio que lo arrancó, no en el que
		// esté abierto en pantalla, que puede ser otro (o ninguno).
		const exerciseId = descanso.registrada?.exerciseId;
		if (!exerciseId) return;
		try {
			await setDescansoEjercicio(exerciseId, segundosAMinutos(segundos));
		} catch {
			errorGuardado = 'Se aplicó a este descanso, pero no se pudo guardar para el ejercicio.';
		}
	}

	const RADIO = 44;
	const CIRCUNFERENCIA = 2 * Math.PI * RADIO;
	const activo = $derived(descanso.restoSeg > 0 || descanso.vencido);
	const progreso = $derived(
		descanso.vencido
			? 1
			: descanso.totalSeg > 0
				? Math.min(1, Math.max(0, (descanso.totalSeg - descanso.restoSeg) / descanso.totalSeg))
				: 0
	);
	const dashOffset = $derived(CIRCUNFERENCIA * (1 - progreso));

	/**
	 * El descanso corre en todas las pantallas, así que este botón se puede tocar desde
	 * el día o desde el historial. Antes sólo avisaba, y quien escuchaba era la pantalla
	 * de ejercicio: fuera de ella el botón no hacía nada. Ahora vuelve a la fila.
	 */
	function irACorregir() {
		const registrada = descanso.registrada;
		descanso.pedirCorreccion();
		if (!registrada) return;
		// Sólo navegar si hace falta. Un goto estando ya en la pantalla correcta cambia los
		// parámetros de la URL, la sesión se vuelve a cargar y la fila desaparece justo
		// mientras se le busca el foco: el botón parecía no hacer nada, igual que antes.
		const ruta = $page.url.pathname.replace(/\/$/, '');
		const enSuPantalla =
			ruta === `/ejercicio/${registrada.exerciseId}` && $page.url.searchParams.has('dia');
		if (!enSuPantalla) void goto(registrada.href);
	}

	let arrastrando = $state(false);
	let inicioY = 0;
	let dragY = $state(0);

	function mmss(s: number): string {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${String(sec).padStart(2, '0')}`;
	}

	function empezarArrastre(event: PointerEvent) {
		if (!activo) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		// Un arrastre que arranca sobre un botón le roba el click: `setPointerCapture`
		// en el panel hace que el `pointerup` se retargetee al panel, y el navegador
		// dispara el `click` ahí y no en el botón. Con esto, Minimizar, Saltar descanso
		// y Listo quedaban muertos y la única salida del descanso a pantalla completa
		// era el gesto de arrastrar hacia abajo.
		// La rueda es un gesto de arrastre propio: si el panel se lo lleva, girar cierra
		// el descanso en vez de cambiarlo.
		if ((event.target as Element | null)?.closest('button, [data-sin-arrastre]')) return;
		arrastrando = true;
		inicioY = event.clientY;
		dragY = 0;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function moverArrastre(event: PointerEvent) {
		if (!arrastrando) return;
		dragY = Math.max(0, event.clientY - inicioY);
	}

	function terminarArrastre() {
		if (!arrastrando) return;
		const umbral = Math.min(150, window.innerHeight * 0.22);
		arrastrando = false;
		if (dragY >= umbral) {
			descanso.minimizarFocus();
			dragY = 0;
			return;
		}
		dragY = 0;
	}
</script>

{#if descanso.focusAbierto && activo}
	<div
		use:modal={{
			onClose: () => descanso.minimizarFocus(),
			focoInicial: '[data-modal-inicial]'
		}}
		transition:fade={{ duration: dur(140) }}
		class="fixed inset-0 z-[70]"
		style="background: rgb(var(--scrim) / {0.72 - Math.min(dragY / 900, 0.28)})"
	>
		<div
			transition:fly={{ y: 28, duration: dur(220) }}
			role="dialog"
			aria-modal="true"
			aria-label="Descanso"
			tabindex="-1"
			onpointerdown={empezarArrastre}
			onpointermove={moverArrastre}
			onpointerup={terminarArrastre}
			onpointercancel={terminarArrastre}
			class="rest-focus-panel mx-auto flex min-h-dvh max-w-md touch-none flex-col px-5 pb-6"
			style="padding-top: calc(1rem + var(--safe-top)); --rest-glow: {descanso.glow}; transform: translate3d(0, {dragY}px, 0) scale({1 -
				Math.min(dragY / 2200, 0.035)}); opacity: {1 -
				Math.min(dragY / 420, 0.42)}; transition: {arrastrando
				? 'none'
				: 'transform 180ms ease, opacity 180ms ease'}; background: radial-gradient(96% 48% at 50% -4%, rgb(var(--rest-glow) / .34), transparent 72%), linear-gradient(180deg, rgb(var(--rest-glow) / .08), transparent 42%), var(--bg)"
		>
			<div
				class="rest-focus-handle mx-auto h-1.5 w-12 rounded-full bg-white/25"
				aria-hidden="true"
			></div>

			<div
				class="rest-focus-main flex flex-1 flex-col items-center justify-center py-8 text-center"
			>
				<p class="text-xs font-extrabold uppercase tracking-[0.28em]" style="color: var(--muted)">
					{descanso.vencido ? 'Descanso terminado' : 'Descanso'}
				</p>

				<!--
					El anillo y la rueda son el mismo círculo con dos trabajos: mostrar cuánto
					falta y cambiarlo. Se turnan; los dos juntos eran dos relojes iguales, uno
					arriba del otro, y empujaban los botones de salida fuera de la pantalla.
				-->
				{#if mostrarRueda && !descanso.vencido}
					<div class="mt-8 flex flex-col items-center gap-4" data-sin-arrastre>
						<RuedaTiempo
							segundos={segundosRueda}
							min={RUEDA_DESCANSO.min}
							max={RUEDA_DESCANSO.max}
							paso={RUEDA_DESCANSO.paso}
							glow={descanso.glow}
							vibracion={$ajustes.vibracion ?? true}
							etiqueta="Duración del descanso de este ejercicio"
							onCambio={girarDuracion}
							onFin={soltarDuracion}
						/>
						<p class="max-w-[16rem] text-balance text-xs" style="color: var(--muted)">
							{#if errorGuardado}
								{errorGuardado}
							{:else}
								Queda guardado como el descanso de este ejercicio.
							{/if}
						</p>
						<button
							onclick={() => (mostrarRueda = false)}
							class="min-h-11 rounded-full px-5 text-sm font-bold"
							style="background: rgba(255,255,255,.08); color: var(--muted)">Listo</button
						>
					</div>
				{:else}
					<div
						class="rest-focus-ring relative mt-8 grid size-72 max-h-[42dvh] max-w-[72vw] place-items-center"
					>
						<svg
							viewBox="0 0 100 100"
							class="absolute inset-0 size-full -rotate-90"
							aria-hidden="true"
						>
							<circle
								cx="50"
								cy="50"
								r={RADIO}
								fill="none"
								stroke="rgba(255,255,255,.09)"
								stroke-width="5"
							/>
							<circle
								cx="50"
								cy="50"
								r={RADIO}
								fill="none"
								stroke="rgb(var(--rest-glow))"
								stroke-linecap="round"
								stroke-width="5"
								stroke-dasharray={CIRCUNFERENCIA}
								stroke-dashoffset={dashOffset}
							/>
						</svg>

						<div aria-live="polite">
							{#if descanso.vencido}
								<p
									class="rest-focus-done text-5xl font-black leading-none"
									style="color: rgb(var(--rest-glow))"
								>
									A la serie
								</p>
								<p class="rest-focus-over cifra mt-4 text-5xl">
									+{mmss(descanso.vencidoSeg)}
								</p>
							{:else}
								<p class="rest-focus-time cifra text-[5.5rem]">
									{mmss(descanso.restoSeg)}
								</p>
							{/if}
						</div>
					</div>

					{#if !descanso.vencido}
						<!--
							Dos cosas distintas, dos controles: "+30 s" estira ESTE descanso y no se
							guarda; la rueda fija cuánto dura el del ejercicio y sí. Antes las hacía la
							misma rueda, así que no había forma de decir cuál de las dos querías.
						-->
						<div class="mt-6 flex items-center gap-2">
							<button
								onclick={() => descanso.estirar(30)}
								class="flex min-h-11 items-center gap-1.5 rounded-full border border-white/10 px-4 text-sm font-bold"
								style="background: rgba(255,255,255,.05); color: var(--muted)"
								aria-label="Sumar 30 segundos a este descanso">+30 s</button
							>
							<button
								onclick={() => (mostrarRueda = true)}
								class="flex min-h-11 items-center gap-2 rounded-full border border-white/10 px-4 text-sm font-bold"
								style="background: rgba(255,255,255,.05); color: var(--muted)"
								aria-label="Elegir cuánto dura el descanso de este ejercicio"
							>
								<Icono nombre="rueda" tamano={16} /> Duración
							</button>
						</div>
					{/if}
				{/if}

				{#if descanso.siguiente}
					<p
						class="rest-focus-next mt-7 max-w-[18rem] text-balance text-base font-semibold leading-snug"
						style="color: var(--muted)"
					>
						{descanso.siguiente}
					</p>
				{/if}

				{#if descanso.registrada}
					<!-- El descanso tapa la lista justo cuando el peso recién tipeado todavía no
					     se verificó: acá se lee, y con un toque se vuelve a la fila a corregirlo. -->
					<button
						onclick={() => irACorregir()}
						class="rest-focus-done-set mt-5 flex max-w-full items-center gap-2.5 rounded-2xl border border-white/10 px-4 py-2.5 text-left"
						style="background: rgba(255,255,255,.05)"
					>
						<span style="color: rgb(var(--exito))"><Icono nombre="hecha" tamano={16} /></span>
						<span class="min-w-0">
							<span class="block truncate text-sm font-bold">{descanso.registrada.texto}</span>
							<span class="block text-[11px] font-semibold" style="color: var(--muted)"
								>Tocá para corregir</span
							>
						</span>
					</button>
				{/if}
			</div>

			<div class="rest-focus-actions grid gap-3" style="padding-bottom: var(--safe-bottom)">
				{#if descanso.vencido}
					<button
						data-modal-inicial
						onclick={() => descanso.atender()}
						class="min-h-14 rounded-2xl px-5 text-base font-black"
						style="background: rgb(var(--rest-glow)); color: var(--on-bright)">Listo</button
					>
				{:else}
					<button
						data-modal-inicial
						onclick={() => descanso.minimizarFocus()}
						class="min-h-14 rounded-2xl px-5 text-base font-black"
						style="background: rgb(var(--rest-glow)); color: var(--on-bright)">Minimizar</button
					>
				{/if}
				<button
					onclick={() => descanso.saltar()}
					class="min-h-12 rounded-2xl px-5 text-sm font-bold"
					style="background: rgba(255,255,255,.09); color: var(--muted)">Saltar descanso</button
				>
			</div>
		</div>
	</div>
{/if}

<style>
	@media (orientation: landscape) and (max-height: 520px) {
		.rest-focus-panel {
			display: grid;
			grid-template-columns: minmax(13rem, 0.9fr) minmax(15rem, 1fr);
			grid-template-rows: auto 1fr;
			column-gap: 1rem;
			max-width: min(100vw, 56rem);
			min-height: 100dvh;
			padding: 0.75rem 1rem !important;
		}

		.rest-focus-handle {
			grid-column: 1 / -1;
		}

		.rest-focus-main {
			grid-column: 1;
			padding-block: 0.25rem !important;
		}

		.rest-focus-ring {
			width: min(46dvh, 13rem) !important;
			height: min(46dvh, 13rem) !important;
			max-width: none;
			max-height: none;
			margin-top: 0.75rem !important;
		}

		.rest-focus-time {
			font-size: clamp(2.75rem, 12dvh, 4.5rem) !important;
		}

		.rest-focus-done {
			font-size: clamp(1.8rem, 8dvh, 3rem) !important;
		}

		.rest-focus-over {
			margin-top: 0.5rem !important;
			font-size: clamp(1.5rem, 7dvh, 2.5rem) !important;
		}

		.rest-focus-next {
			margin-top: 0.75rem !important;
			max-width: 17rem;
			font-size: 0.875rem;
		}

		.rest-focus-done-set {
			margin-top: 0.6rem !important;
			padding-block: 0.4rem !important;
		}

		.rest-focus-actions {
			grid-column: 2;
			align-self: center;
			padding-bottom: 0 !important;
		}

		.rest-focus-actions button {
			min-height: 3rem !important;
			border-radius: 1rem !important;
		}
	}

	@media (orientation: landscape) and (max-height: 380px) {
		.rest-focus-panel {
			grid-template-columns: minmax(10rem, 0.7fr) minmax(14rem, 1fr);
			column-gap: 0.75rem;
			padding-block: 0.5rem !important;
		}

		.rest-focus-ring {
			width: min(42dvh, 10rem) !important;
			height: min(42dvh, 10rem) !important;
		}

		.rest-focus-next {
			margin-top: 0.5rem !important;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		[role='dialog'] {
			transition: none !important;
		}
	}
</style>
