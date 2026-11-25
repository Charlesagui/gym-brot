<script lang="ts">
	/**
	 * "Tus entrenamientos pueden perderse": el riesgo del almacenamiento, en la portada.
	 *
	 * Una usuaria contaba que "a veces no se guardan los datos" y el código no perdía
	 * nada: lo más probable es abrir la app desde lugares distintos (cada navegador y la
	 * app instalada tienen su propia base) o que el navegador la vacíe solo. Ese aviso ya
	 * existía, pero sólo en Historial y Ajustes, donde no mira quien entra a entrenar.
	 *
	 * Cuándo aparece y con qué variante lo decide `avisoAlmacenamiento` (puro, con tests).
	 * Se cierra con la X por una semana.
	 */
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import Icono from '$lib/components/Icono.svelte';
	import { diasDesde } from '$lib/extras';
	import { dur } from '$lib/motion';
	import { persistencia } from '$lib/persistencia';
	import {
		avisoAlmacenamiento,
		instruccionesInstalar,
		plataformaDe,
		type Plataforma
	} from '$lib/aviso-almacenamiento';
	import {
		abiertaInstalada,
		instaladaRecien,
		pedidoInstalacion,
		type PedidoInstalacion
	} from '$lib/instalacion';
	import { avisoAlmacenamientoCerradoAt, cerrarAvisoAlmacenamiento } from '$lib/preferencias-ui';

	let { ultimoBackup }: { ultimoBackup?: string } = $props();

	// Se lee en el navegador recién montado: antes no hay `matchMedia` ni user agent.
	let entorno = $state<{ instalada: boolean; tactil: boolean; plataforma: Plataforma } | null>(
		null
	);
	let cerradoAt = $state<string | null>(null);
	let pasosVisibles = $state(false);
	let instalando = $state(false);
	let rechazada = $state(false);

	onMount(() => {
		cerradoAt = avisoAlmacenamientoCerradoAt();
		entorno = {
			instalada: abiertaInstalada(),
			tactil: window.matchMedia?.('(pointer: coarse)').matches ?? false,
			plataforma: plataformaDe(navigator.userAgent, navigator.maxTouchPoints)
		};
	});

	const aviso = $derived(
		entorno ? avisoAlmacenamiento({ ...entorno, persistencia: $persistencia, cerradoAt }) : null
	);

	const backup = $derived(
		ultimoBackup
			? `Tu última copia es de hace ${diasDesde(ultimoBackup)} días.`
			: 'Todavía no guardaste ninguna copia.'
	);

	function cerrar() {
		cerrarAvisoAlmacenamiento();
		cerradoAt = avisoAlmacenamientoCerradoAt() ?? new Date().toISOString();
	}

	async function instalar(pedido: PedidoInstalacion) {
		instalando = true;
		rechazada = false;
		try {
			await pedido.prompt();
			const { outcome } = await pedido.userChoice;
			// El pedido se usa una sola vez: si lo rechazó, quedan los pasos a mano.
			pedidoInstalacion.set(null);
			if (outcome === 'accepted') instaladaRecien.set(true);
			else rechazada = true;
		} catch {
			pedidoInstalacion.set(null);
			rechazada = true;
		} finally {
			instalando = false;
		}
	}
</script>

{#if aviso}
	<section
		transition:slide={{ duration: dur(200) }}
		class="relative mb-6 rounded-2xl border p-4 pr-12"
		style="border-color: rgb(var(--max) / .35); background: rgb(var(--max) / .08)"
		role="status"
		aria-live="polite"
	>
		<button
			onclick={cerrar}
			class="absolute right-1 top-1 grid size-11 place-items-center"
			style="color: var(--muted)"
			aria-label="Cerrar este aviso por una semana"
		>
			<Icono nombre="cerrar" tamano={18} />
		</button>

		{#if aviso.tipo === 'navegador'}
			{#if $instaladaRecien}
				<p class="flex items-center gap-2 text-sm font-bold" style="color: var(--accent-text)">
					<Icono nombre="hecha" tamano={16} /> Gym-brot quedó instalada
				</p>
				<p class="mt-1.5 text-xs leading-relaxed" style="color: var(--muted)">
					Abrila desde el ícono de tu pantalla de inicio y usá siempre esa. Lo que cargues acá, en
					el navegador, no aparece allá.
				</p>
			{:else}
				<p class="flex items-center gap-2 text-sm font-bold" style="color: rgb(var(--max))">
					<Icono nombre="aviso" tamano={16} /> Tus entrenamientos pueden perderse
				</p>
				<p class="mt-1.5 text-xs leading-relaxed" style="color: var(--muted)">
					Estás usando Gym-brot desde el navegador. Cada navegador y la app instalada guardan los
					datos por separado: si un día la abrís desde un link y otro desde el ícono, vas a ver
					entrenamientos distintos. Instalala y abrila siempre desde el ícono.
					{#if aviso.plataforma === 'ios'}
						En iPhone, además, Safari borra los datos después de unos días sin abrir la app.
					{/if}
				</p>
				{#if $pedidoInstalacion}
					{@const pedido = $pedidoInstalacion}
					<button
						onclick={() => void instalar(pedido)}
						disabled={instalando}
						aria-busy={instalando}
						class="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold disabled:opacity-60"
						style="background: rgb(var(--max)); color: #14110a"
					>
						<Icono nombre="backup" tamano={16} />
						{instalando ? 'Instalando…' : 'Instalar Gym-brot'}
					</button>
				{:else}
					<button
						onclick={() => (pasosVisibles = !pasosVisibles)}
						aria-expanded={pasosVisibles}
						class="mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold"
						style="background: rgb(var(--max)); color: #14110a"
					>
						{pasosVisibles ? 'Ocultar los pasos' : 'Ver cómo instalarla'}
					</button>
					{#if rechazada}
						<p class="mt-2 text-xs leading-relaxed" style="color: var(--muted)">
							No se instaló. Podés hacerlo cuando quieras con estos pasos.
						</p>
					{/if}
					{#if pasosVisibles || rechazada}
						<p
							transition:slide={{ duration: dur(160) }}
							class="mt-2 text-xs font-semibold leading-relaxed"
						>
							{instruccionesInstalar(aviso.plataforma)}
						</p>
					{/if}
				{/if}
			{/if}
		{:else}
			<p class="flex items-center gap-2 text-sm font-bold" style="color: rgb(var(--max))">
				<Icono nombre="aviso" tamano={16} /> Este teléfono puede borrar tus datos
			</p>
			<p class="mt-1.5 text-xs leading-relaxed" style="color: var(--muted)">
				El navegador no se comprometió a conservarlos. Guardá una copia de seguridad para no perder
				tu historial. {backup}
			</p>
			<a
				href="/ajustes"
				class="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold"
				style="background: rgb(var(--max)); color: #14110a"
			>
				<Icono nombre="backup" tamano={16} /> Guardar copia
			</a>
		{/if}
	</section>
{/if}
