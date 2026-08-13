<script lang="ts">
	// Ráfaga breve y decorativa (trofeo de PR, día terminado). No transporta información:
	// bajo movimiento reducido simplemente no se renderiza, sin ocultar nada del resto.
	import { untrack } from 'svelte';
	import { menosMovimiento } from '$lib/motion';

	let { color = '124 92 255', cantidad = 12 }: { color?: string; cantidad?: number } = $props();

	const reducido = menosMovimiento();
	// Se computa una sola vez al montar: cada celebración crea una instancia nueva,
	// no hay reactividad que seguir durante su ciclo de vida breve.
	const cantidadInicial = untrack(() => cantidad);
	const particulas = reducido
		? []
		: Array.from({ length: cantidadInicial }, (_, i) => {
				const angulo = (i / cantidadInicial) * Math.PI * 2 + (i % 2 === 0 ? 0.18 : -0.12);
				const distancia = 60 + ((i * 37) % 46);
				return {
					dx: Math.round(Math.cos(angulo) * distancia),
					dy: Math.round(Math.sin(angulo) * distancia),
					delay: (i % 5) * 16,
					size: i % 3 === 0 ? 7 : 5,
					redondo: i % 2 === 0
				};
			});
</script>

{#if particulas.length > 0}
	<div class="gb-particulas" aria-hidden="true">
		{#each particulas as p, i (i)}
			<span
				class="gb-particula {p.redondo ? 'gb-particula--redonda' : ''}"
				style="--dx: {p.dx}px; --dy: {p.dy}px; animation-delay: {p.delay}ms; width: {p.size}px; height: {p.size}px; background: rgb({color})"
			></span>
		{/each}
	</div>
{/if}

<style>
	.gb-particulas {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: visible;
	}
	.gb-particula {
		position: absolute;
		top: 50%;
		left: 50%;
		border-radius: 2px;
		opacity: 0;
		animation: gb-particula-fly 820ms var(--ease-out) forwards;
	}
	.gb-particula--redonda {
		border-radius: 999px;
	}
	@keyframes gb-particula-fly {
		0% {
			transform: translate(-50%, -50%) scale(0.6);
			opacity: 1;
		}
		65% {
			opacity: 1;
		}
		100% {
			transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.3);
			opacity: 0;
		}
	}
</style>
