<script lang="ts">
	import { vibrar } from '$lib/vibracion';

	/**
	 * Rueda rotatoria para elegir un tiempo, tipo click wheel.
	 *
	 * Por qué acá y no en el peso: el descanso ya es redondo (el anillo que se vacía),
	 * el rango es corto, el paso es grueso y elegir "un toque más" es explorar, no
	 * apuntar. Cargar el peso de una serie, en cambio, compite contra un solo toque y
	 * pierde — para eso están los chips de memoria y el ±.
	 *
	 * El gesto es rotación relativa: importa cuánto giraste desde el punto anterior, no
	 * dónde tocaste. Así se puede girar cerca del borde (más preciso) o cerca del
	 * centro, y arrancar el giro en cualquier parte del anillo.
	 */
	let {
		segundos,
		min = 15,
		max = 600,
		paso = 15,
		glow,
		etiqueta = 'Tiempo',
		vibracion = true,
		onCambio
	}: {
		segundos: number;
		min?: number;
		max?: number;
		paso?: number;
		glow: string;
		etiqueta?: string;
		vibracion?: boolean;
		onCambio: (segundos: number) => void;
	} = $props();

	/** Cuántos grados de giro cuesta un paso. 18° = 20 pasos por vuelta completa. */
	const GRADOS_POR_PASO = 18;
	/** 40 marcas: uno de cada cinco es una raya larga, como el dial de un cronómetro. */
	const MARCAS = Array.from({ length: 40 }, (_, i) => ({ angulo: i * 9, mayor: i % 5 === 0 }));

	let nodo: HTMLDivElement | undefined;
	let giro = $state(0);
	let sobra = 0;
	let anguloPrevio: number | null = null;
	let agarrada = $state(false);

	const texto = $derived(reloj(segundos));

	function reloj(total: number): string {
		const minutos = Math.floor(total / 60);
		return `${minutos}:${String(total % 60).padStart(2, '0')}`;
	}

	function hablado(total: number): string {
		const minutos = Math.floor(total / 60);
		const resto = total % 60;
		if (minutos === 0) return `${resto} segundos`;
		if (resto === 0) return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;
		return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} ${resto} segundos`;
	}

	function mover(pasos: number) {
		const nuevo = Math.min(max, Math.max(min, segundos + pasos * paso));
		if (nuevo === segundos) return;
		onCambio(nuevo);
		vibrar(6, vibracion);
	}

	function anguloDe(evento: PointerEvent): number {
		if (!nodo) return 0;
		const caja = nodo.getBoundingClientRect();
		const dx = evento.clientX - (caja.left + caja.width / 2);
		const dy = evento.clientY - (caja.top + caja.height / 2);
		return (Math.atan2(dy, dx) * 180) / Math.PI;
	}

	function alApretar(evento: PointerEvent) {
		if (evento.pointerType === 'mouse' && evento.button !== 0) return;
		nodo?.setPointerCapture(evento.pointerId);
		anguloPrevio = anguloDe(evento);
		sobra = 0;
		agarrada = true;
	}

	function alMover(evento: PointerEvent) {
		if (anguloPrevio === null) return;
		const actual = anguloDe(evento);
		let delta = actual - anguloPrevio;
		// Cruzar el eje salta de +180 a −180: sin esto, se leería como una vuelta entera.
		if (delta > 180) delta -= 360;
		if (delta < -180) delta += 360;
		anguloPrevio = actual;
		giro += delta;
		sobra += delta;
		while (Math.abs(sobra) >= GRADOS_POR_PASO) {
			const signo = sobra > 0 ? 1 : -1;
			mover(signo);
			sobra -= signo * GRADOS_POR_PASO;
		}
	}

	function alSoltar(evento: PointerEvent) {
		if (anguloPrevio === null) return;
		anguloPrevio = null;
		agarrada = false;
		if (nodo?.hasPointerCapture(evento.pointerId)) nodo.releasePointerCapture(evento.pointerId);
	}

	function alTeclado(evento: KeyboardEvent) {
		const finos: Record<string, number> = {
			ArrowUp: 1,
			ArrowRight: 1,
			ArrowDown: -1,
			ArrowLeft: -1
		};
		const gruesos: Record<string, number> = { PageUp: 4, PageDown: -4 };
		const pasos = finos[evento.key] ?? gruesos[evento.key];
		if (pasos === undefined) return;
		evento.preventDefault();
		giro += pasos * GRADOS_POR_PASO;
		mover(pasos);
	}
</script>

<div
	bind:this={nodo}
	class="gb-rueda"
	class:gb-rueda--agarrada={agarrada}
	style="--rueda-glow: {glow}"
	role="slider"
	tabindex="0"
	aria-label={etiqueta}
	aria-valuemin={min}
	aria-valuemax={max}
	aria-valuenow={segundos}
	aria-valuetext={hablado(segundos)}
	onpointerdown={alApretar}
	onpointermove={alMover}
	onpointerup={alSoltar}
	onpointercancel={alSoltar}
	onkeydown={alTeclado}
>
	<svg viewBox="0 0 200 200" aria-hidden="true">
		<g style="transform: rotate({giro}deg); transform-origin: 100px 100px">
			{#each MARCAS as marca (marca.angulo)}
				<line
					x1="100"
					y1={marca.mayor ? 9 : 12}
					x2="100"
					y2={marca.mayor ? 20 : 18}
					stroke={marca.mayor ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.22)'}
					stroke-width={marca.mayor ? 2.5 : 1.5}
					stroke-linecap="round"
					transform={`rotate(${marca.angulo} 100 100)`}
				/>
			{/each}
		</g>
	</svg>
	<span class="gb-rueda-aguja" aria-hidden="true"></span>
	<span class="gb-rueda-nucleo">
		<span class="cifra text-[2.6rem]">{texto}</span>
	</span>
</div>

<style>
	.gb-rueda {
		position: relative;
		display: grid;
		place-items: center;
		width: min(15rem, 68vw);
		aspect-ratio: 1;
		border-radius: 50%;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		background:
			radial-gradient(58% 58% at 50% 40%, rgba(255, 255, 255, 0.06), transparent 70%),
			conic-gradient(from 210deg, #191925, #24243a 25%, #131320 55%, #22223a 78%, #191925);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.14),
			inset 0 0 0 1px rgba(255, 255, 255, 0.06),
			0 16px 36px rgba(0, 0, 0, 0.55);
	}

	.gb-rueda--agarrada {
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.16),
			inset 0 0 0 1px rgb(var(--rueda-glow) / 0.4),
			0 16px 40px rgba(0, 0, 0, 0.6),
			0 0 36px rgb(var(--rueda-glow) / 0.2);
	}

	.gb-rueda svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	/* La aguja fija marca el "acá estás": el que gira es el anillo de marcas. */
	.gb-rueda-aguja {
		position: absolute;
		top: 3%;
		left: 50%;
		width: 3px;
		height: 8%;
		margin-left: -1.5px;
		border-radius: 2px;
		background: rgb(var(--rueda-glow));
		box-shadow: 0 0 12px rgb(var(--rueda-glow) / 0.8);
	}

	.gb-rueda-nucleo {
		display: grid;
		place-items: center;
		width: 60%;
		aspect-ratio: 1;
		border-radius: 50%;
		background: linear-gradient(180deg, #15151f, #0c0c14);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.1),
			0 8px 20px rgba(0, 0, 0, 0.6);
	}
</style>
