<script lang="ts">
	import { fly } from 'svelte/transition';
	import { dur } from '$lib/motion';

	/**
	 * Aviso corto al pie con UNA acción al lado.
	 *
	 * Se usa en dos tiempos para las acciones que borran trabajo: primero avisa qué va a
	 * pasar y espera un segundo toque deliberado —un reinicio no puede salir de un roce—,
	 * y después de hacerlo ofrece deshacer por unos segundos. Es un aviso, no un modal:
	 * no oscurece la pantalla ni bloquea nada, y se va solo si lo ignorás.
	 */
	let {
		mensaje,
		accionTexto,
		onAccion,
		onCerrar,
		tono = 'advertencia',
		segundos = 7,
		offsetNav = false
	}: {
		mensaje: string;
		accionTexto: string;
		onAccion: () => void;
		onCerrar: () => void;
		/** `advertencia` pregunta antes de romper; `exito` confirma y ofrece la vuelta atrás. */
		tono?: 'advertencia' | 'exito';
		segundos?: number;
		/** Con barra de navegación abajo el aviso se apoya encima, como la de descanso. */
		offsetNav?: boolean;
	} = $props();

	const color = $derived(tono === 'advertencia' ? 'var(--max)' : 'var(--exito)');

	// El plazo arranca de nuevo si cambia el aviso: el mismo hueco sirve para los dos pasos.
	$effect(() => {
		mensaje;
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
		role={tono === 'advertencia' ? 'alertdialog' : 'status'}
		aria-live={tono === 'advertencia' ? 'assertive' : 'polite'}
		aria-label={mensaje}
		class="flex items-center gap-2 rounded-2xl border p-2.5 pl-3.5"
		style="background: var(--surface); border-color: rgb({color} / .45); box-shadow: 0 12px 32px rgb(0 0 0 / .35)"
	>
		<p class="min-w-0 flex-1 text-xs font-semibold leading-relaxed" style="color: var(--muted)">
			{mensaje}
		</p>
		<button
			onclick={onAccion}
			class="min-h-11 shrink-0 rounded-xl px-3 text-xs font-bold"
			style="background: rgb({color} / .16); color: rgb({color})">{accionTexto}</button
		>
		<button
			onclick={onCerrar}
			class="grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold"
			style="background: rgba(255,255,255,.06); color: var(--muted)"
			aria-label="Cerrar aviso">✕</button
		>
	</div>
</div>
