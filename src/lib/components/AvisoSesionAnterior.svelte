<script lang="ts">
	/**
	 * "Tu entrenamiento no se borró: está en el día de al lado."
	 *
	 * Aparece cuando la sesión que se está mirando está vacía y hay trabajo de esta misma
	 * rutina escrito hace un rato en otra fecha. Es el caso de cruzar la medianoche
	 * entrenando (o volver a la app con la URL clavada en otro día): la pantalla se abre
	 * en blanco, con los pesos prellenados y ningún tilde, y se lee como una pérdida.
	 *
	 * Se apaga solo: en cuanto se marca una serie de hoy, la sesión deja de estar vacía.
	 */
	import Icono from '$lib/components/Icono.svelte';
	import { fechaCorta } from '$lib/formato';
	import type { SesionReciente } from '$lib/sesion';

	let { aviso, href }: { aviso: SesionReciente; href: string } = $props();

	const series = $derived(`${aviso.seriesHechas} ${aviso.seriesHechas === 1 ? 'serie' : 'series'}`);
</script>

<section
	class="mt-4 rounded-2xl border p-4"
	style="border-color: rgb(var(--max) / .35); background: rgb(var(--max) / .08)"
	role="status"
>
	<p class="flex items-center gap-2 text-sm font-bold" style="color: rgb(var(--max))">
		<Icono nombre="info" tamano={16} /> Tu entrenamiento del {fechaCorta(aviso.fecha)} sigue ahí
	</p>
	<p class="mt-1.5 text-xs leading-relaxed" style="color: var(--muted)">
		Marcaste {series} en esta rutina el {fechaCorta(aviso.fecha)} y quedaron guardadas. Esto de acá es
		un día nuevo y vacío: no se borró nada.
	</p>
	<a
		{href}
		class="mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold"
		style="background: rgb(var(--max)); color: #14110a"
	>
		Seguir ese entrenamiento
	</a>
</section>
