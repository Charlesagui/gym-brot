<script lang="ts">
	import { fly } from 'svelte/transition';
	import { dur } from '$lib/motion';
	import Icono, { type NombreIcono } from '$lib/components/Icono.svelte';
	import { pie } from '$lib/pie.svelte';

	/**
	 * Aviso corto al pie, con una acción opcional al lado.
	 *
	 * Se usa en dos tiempos para las acciones que borran trabajo: primero avisa qué va a
	 * pasar y espera un segundo toque deliberado —un reinicio no puede salir de un roce—,
	 * y después de hacerlo ofrece deshacer por unos segundos. Es un aviso, no un modal:
	 * no oscurece la pantalla ni bloquea nada, y se va solo si lo ignorás.
	 *
	 * Sin acción es el acuse a secas: la respuesta de la app a algo que hiciste. Va acá y
	 * no dibujado adentro de la tarjeta que disparó la acción, porque una pantalla larga
	 * —Ajustes tiene catorce secciones— deja ese mensaje fuera de vista justo cuando hace
	 * falta. El pie está siempre a la vista y es donde ya está el pulgar.
	 */
	let {
		mensaje,
		detalle,
		accionTexto,
		onAccion,
		onCerrar,
		tono = 'advertencia',
		segundos = 7,
		offsetNav = false
	}: {
		mensaje: string;
		/** Dato secundario que respalda al mensaje (una versión, un contador). Va en mono. */
		detalle?: string;
		/** Sin `accionTexto` y `onAccion` el aviso informa y nada más. */
		accionTexto?: string;
		onAccion?: () => void;
		onCerrar: () => void;
		/**
		 * `exito` confirma que salió bien; `advertencia` pide atención (algo falló o hay
		 * que decidir); `neutro` es para lo que no es ninguna de las dos, como una
		 * cancelación: ponerle un tilde verde a "Importación cancelada" sería festejarla.
		 */
		tono?: 'advertencia' | 'exito' | 'neutro';
		/** 0 se queda hasta que lo cierren. Un error que se va solo es un error que nadie leyó. */
		segundos?: number;
		/** Con barra de navegación abajo el aviso se apoya encima, como la de descanso. */
		offsetNav?: boolean;
	} = $props();

	const conAccion = $derived(accionTexto !== undefined && onAccion !== undefined);
	const acento = $derived(
		tono === 'advertencia' ? 'var(--max)' : tono === 'exito' ? 'var(--exito)' : null
	);
	// El ícono es la segunda señal: el color solo no alcanza, y un emoji no toma el
	// acento ni se alinea con el texto (ver la cabecera de Icono.svelte).
	const icono = $derived<NombreIcono | null>(
		tono === 'advertencia' ? 'aviso' : tono === 'exito' ? 'hecha' : null
	);
	const borde = $derived(acento ? `rgb(${acento} / .45)` : 'rgb(255 255 255 / .14)');

	/**
	 * Un aviso con acción que pide atención es un diálogo: hay algo que contestar. Sin
	 * acción no se contesta nada, y ahí `alertdialog` le miente al lector de pantalla,
	 * que se queda esperando controles que no existen.
	 */
	const rol = $derived(
		tono === 'advertencia' ? (conAccion ? 'alertdialog' : 'alert') : ('status' as const)
	);

	// Mientras este aviso exista, el hueco del pie está tomado: lo que sea persistente
	// —el cartel de versión nueva— espera en vez de montarse encima y comerse los toques.
	$effect(() => pie.tomar());

	// El plazo arranca de nuevo si cambia el aviso: el mismo hueco sirve para los dos pasos.
	$effect(() => {
		mensaje;
		if (segundos <= 0) return;
		const id = setTimeout(onCerrar, segundos * 1000);
		return () => clearTimeout(id);
	});
</script>

<div
	class="fixed inset-x-0 z-[70] mx-auto max-w-md px-5"
	style="bottom: {offsetNav ? 'calc(64px + var(--safe-bottom))' : '0'}; padding-bottom: {offsetNav
		? '0.75rem'
		: 'calc(1rem + var(--safe-bottom))'}"
>
	<div
		transition:fly={{ y: 24, duration: dur(200) }}
		role={rol}
		aria-live={tono === 'advertencia' ? 'assertive' : 'polite'}
		aria-label={detalle ? `${mensaje} ${detalle}` : mensaje}
		class="flex items-center gap-2 rounded-2xl border p-2.5 pl-3.5"
		style="background: var(--surface); border-color: {borde}; box-shadow: 0 12px 32px rgb(0 0 0 / .35)"
	>
		{#if icono && acento}
			<span class="shrink-0" style="color: rgb({acento})">
				<Icono nombre={icono} tamano={18} />
			</span>
		{/if}
		<p class="min-w-0 flex-1 text-xs font-semibold leading-relaxed" style="color: var(--muted)">
			{mensaje}
			{#if detalle}
				<span class="font-mono font-normal">{detalle}</span>
			{/if}
		</p>
		{#if accionTexto && onAccion}
			<button
				onclick={onAccion}
				class="min-h-11 shrink-0 rounded-xl px-3 text-xs font-bold"
				style="background: {acento
					? `rgb(${acento} / .16)`
					: 'rgba(255,255,255,.1)'}; color: {acento ? `rgb(${acento})` : 'var(--muted)'}"
				>{accionTexto}</button
			>
		{/if}
		<button
			onclick={onCerrar}
			class="grid size-11 shrink-0 place-items-center rounded-full"
			style="background: rgba(255,255,255,.06); color: var(--muted)"
			aria-label="Cerrar aviso"><Icono nombre="cerrar" tamano={16} /></button
		>
	</div>
</div>
