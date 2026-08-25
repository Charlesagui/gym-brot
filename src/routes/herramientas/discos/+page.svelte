<script lang="ts">
	import { browser } from '$app/environment';
	import Stepper from '$lib/components/Stepper.svelte';
	import { calcularDiscos, type CargaBarra } from '$lib/discos';
	import { ajustesObs, AJUSTES_DEFAULT } from '$lib/extras';
	import { fromLiveQuery } from '$lib/live';
	import { leerPeso, sumarPeso } from '$lib/numeros';
	import type { UnidadPeso } from '$lib/unidades';

	interface ConfigUnidad {
		objetivo: number;
		barra: number;
		paso: number;
		barras: number[];
		discos: number[];
	}

	interface PreferenciaDiscos {
		objetivo: number;
		barra: number;
		discos: number[];
	}

	const CONFIG: Record<UnidadPeso, ConfigUnidad> = {
		kg: {
			objetivo: 60,
			barra: 20,
			paso: 2.5,
			barras: [20, 15, 10],
			discos: [25, 20, 15, 10, 5, 2.5, 1.25]
		},
		lb: {
			objetivo: 135,
			barra: 45,
			paso: 5,
			barras: [45, 35, 15],
			discos: [45, 35, 25, 10, 5, 2.5]
		}
	};

	const ajustesStore = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const unidad = $derived($ajustesStore.unidad);
	const config = $derived(CONFIG[unidad]);
	let objetivo = $state<number | undefined>(CONFIG.kg.objetivo);
	let barra = $state<number | undefined>(CONFIG.kg.barra);
	let disponibles = $state<number[]>([...CONFIG.kg.discos]);
	let unidadCargada = $state<UnidadPeso | null>(null);

	const resultado = $derived(
		calcularDiscos(objetivo ?? Number.NaN, barra ?? Number.NaN, disponibles)
	);

	function clave(unidadPreferida: UnidadPeso): string {
		return `gb-calculadora-discos-v1-${unidadPreferida}`;
	}

	function preferenciaValida(
		valor: unknown,
		unidadPreferida: UnidadPeso
	): PreferenciaDiscos | null {
		if (typeof valor !== 'object' || valor === null) return null;
		const candidata = valor as Partial<PreferenciaDiscos>;
		if (
			typeof candidata.objetivo !== 'number' ||
			!Number.isFinite(candidata.objetivo) ||
			candidata.objetivo <= 0 ||
			candidata.objetivo > 2_000 ||
			typeof candidata.barra !== 'number' ||
			!Number.isFinite(candidata.barra) ||
			candidata.barra <= 0 ||
			candidata.barra > 2_000 ||
			!Array.isArray(candidata.discos)
		) {
			return null;
		}

		const permitidos = new Set(CONFIG[unidadPreferida].discos);
		return {
			objetivo: candidata.objetivo,
			barra: candidata.barra,
			discos: [...new Set(candidata.discos.filter((peso) => permitidos.has(peso)))]
		};
	}

	function cargar(unidadPreferida: UnidadPeso) {
		const base = CONFIG[unidadPreferida];
		let guardada: PreferenciaDiscos | null = null;
		try {
			const cruda = localStorage.getItem(clave(unidadPreferida));
			guardada = cruda ? preferenciaValida(JSON.parse(cruda), unidadPreferida) : null;
		} catch {
			// La calculadora sigue siendo usable con los valores iniciales si Storage falla.
		}
		objetivo = guardada?.objetivo ?? base.objetivo;
		barra = guardada?.barra ?? base.barra;
		disponibles = guardada?.discos ?? [...base.discos];
		unidadCargada = unidadPreferida;
	}

	function guardar() {
		if (!browser || unidadCargada !== unidad || objetivo == null || barra == null) return;
		try {
			localStorage.setItem(clave(unidad), JSON.stringify({ objetivo, barra, discos: disponibles }));
		} catch {
			// El resultado actual no depende de que la preferencia pueda persistirse.
		}
	}

	$effect(() => {
		const actual = unidad;
		if (browser && unidadCargada !== actual) cargar(actual);
	});

	function formatoPeso(valor: number): string {
		return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(valor);
	}

	function cambiarObjetivo(delta: number) {
		objetivo = sumarPeso(objetivo, delta);
		guardar();
	}

	function confirmarObjetivo(campo: HTMLInputElement) {
		objetivo = leerPeso(campo.value);
		campo.value = objetivo == null ? '' : formatoPeso(objetivo);
		guardar();
	}

	function confirmarBarra(campo: HTMLInputElement) {
		const nueva = leerPeso(campo.value);
		if (nueva != null) barra = nueva;
		campo.value = barra != null && !config.barras.includes(barra) ? formatoPeso(barra) : '';
		guardar();
	}

	function usarBarra(peso: number) {
		barra = peso;
		guardar();
	}

	function alternarDisco(peso: number) {
		disponibles = disponibles.includes(peso)
			? disponibles.filter((item) => item !== peso)
			: [...disponibles, peso].sort((a, b) => b - a);
		guardar();
	}

	function combinacion(carga: CargaBarra): string {
		if (carga.discos.length === 0) return 'Solo la barra';
		return carga.discos
			.map((disco) =>
				disco.cantidad === 1
					? formatoPeso(disco.peso)
					: `${disco.cantidad}×${formatoPeso(disco.peso)}`
			)
			.join(' + ');
	}
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-4rem)] px-4 pb-3 pt-3">
	<header class="mb-3 flex min-h-10 items-center justify-between gap-3">
		<h1 class="text-xl font-extrabold">Calculadora de discos</h1>
		<span class="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-bold">{unidad}</span>
	</header>

	<section class="rounded-2xl border border-white/10 p-3" style="background: var(--surface)">
		<p class="mb-2 text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
			Peso total
		</p>
		<Stepper
			value={objetivo}
			format={formatoPeso}
			inputmode="decimal"
			step={config.paso}
			glow="124 92 255"
			onStep={cambiarObjetivo}
			onCommit={confirmarObjetivo}
			ariaDown={`Bajar peso objetivo ${config.paso} ${unidad}`}
			ariaUp={`Subir peso objetivo ${config.paso} ${unidad}`}
			ariaInput={`Peso total objetivo en ${unidad}`}
		/>
	</section>

	<section class="mt-3" aria-live="polite" aria-atomic="true">
		{#if objetivo == null || barra == null || resultado.estado === 'invalido'}
			<div
				class="rounded-2xl border border-white/10 p-3 text-sm"
				style="background: var(--surface)"
			>
				Ingresá un peso objetivo y una barra válidos.
			</div>
		{:else if resultado.estado === 'barra-supera'}
			<div
				class="rounded-2xl border p-3"
				style="border-color: rgb(var(--max) / .35); background: rgb(var(--max) / .08)"
			>
				<p class="text-sm font-bold" style="color: rgb(var(--max))">
					La barra supera el peso total
				</p>
			</div>
		{:else if disponibles.length === 0}
			<div
				class="rounded-2xl border border-white/10 p-3 text-sm"
				style="background: var(--surface)"
			>
				Activá al menos un disco.
			</div>
		{:else if resultado.exacta}
			<div
				class="rounded-2xl border p-3 text-center"
				style="border-color: rgb(var(--exito) / .35); background: radial-gradient(100% 100% at 50% 0%, rgb(var(--exito) / .15), transparent), var(--surface)"
			>
				<p
					class="text-[11px] font-bold uppercase tracking-[0.18em]"
					style="color: rgb(var(--exito))"
				>
					Carga exacta · por lado
				</p>
				<p class="mt-1 text-3xl font-extrabold tabular-nums">
					{formatoPeso(resultado.exacta.porLado)} <span class="text-sm">{unidad}</span>
				</p>
				<p class="mt-1 text-sm font-bold tabular-nums" style="color: var(--muted)">
					{combinacion(resultado.exacta)}
				</p>
			</div>
		{:else}
			<div class="rounded-2xl border border-white/10 p-3" style="background: var(--surface)">
				<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
					Sin carga exacta · opciones cercanas
				</p>
				<div class="mt-2 grid grid-cols-2 gap-2">
					{#if resultado.inferior}
						<div class="rounded-xl bg-white/[0.045] p-2.5">
							<p class="text-[10px] font-bold uppercase" style="color: var(--muted)">Menos</p>
							<p class="text-xl font-extrabold">
								{formatoPeso(resultado.inferior.total)} <span class="text-xs">{unidad}</span>
							</p>
							<p class="mt-0.5 truncate text-xs font-bold" style="color: var(--accent-text)">
								Lado: {combinacion(resultado.inferior)}
							</p>
						</div>
					{/if}
					{#if resultado.superior}
						<div class="rounded-xl bg-white/[0.045] p-2.5">
							<p class="text-[10px] font-bold uppercase" style="color: var(--muted)">Más</p>
							<p class="text-xl font-extrabold">
								{formatoPeso(resultado.superior.total)} <span class="text-xs">{unidad}</span>
							</p>
							<p class="mt-0.5 truncate text-xs font-bold" style="color: var(--accent-text)">
								Lado: {combinacion(resultado.superior)}
							</p>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</section>

	<section class="mt-3 rounded-2xl border border-white/10 p-3" style="background: var(--surface)">
		<div class="flex items-center justify-between gap-2">
			<h2 class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">Barra</h2>
			<p class="text-[10px]" style="color: var(--muted)">Tocá una o escribí otra</p>
		</div>
		<div class="mt-2 grid grid-cols-4 gap-2" aria-label="Peso de la barra">
			{#each config.barras as peso}
				<button
					type="button"
					onclick={() => usarBarra(peso)}
					aria-pressed={barra === peso}
					class="min-h-11 rounded-xl border text-sm font-bold"
					style={barra === peso
						? 'border-color: rgb(var(--accent-rgb) / .75); background: rgb(var(--accent-rgb) / .18); color: var(--accent-text)'
						: 'border-color: rgba(255,255,255,.10); background: rgba(255,255,255,.035); color: var(--muted)'}
					>{formatoPeso(peso)}</button
				>
			{/each}
			<input
				type="text"
				inputmode="decimal"
				value={barra != null && !config.barras.includes(barra) ? formatoPeso(barra) : ''}
				placeholder="Otra"
				onchange={(e) => confirmarBarra(e.currentTarget)}
				onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
				class="min-h-11 min-w-0 rounded-xl border border-white/10 bg-white/[0.035] px-1 text-center text-sm font-bold outline-none focus:border-white/30"
				aria-label={`Otro peso de barra en ${unidad}`}
			/>
		</div>

		<h2 class="mt-3 text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
			Discos por lado
		</h2>
		<div class="mt-2 grid grid-cols-4 gap-2">
			{#each config.discos as peso}
				<button
					type="button"
					onclick={() => alternarDisco(peso)}
					aria-pressed={disponibles.includes(peso)}
					class="min-h-11 rounded-xl border px-1 text-sm font-bold"
					style={disponibles.includes(peso)
						? 'border-color: rgb(var(--accent-rgb) / .70); background: rgb(var(--accent-rgb) / .17); color: var(--accent-text)'
						: 'border-color: rgba(255,255,255,.08); background: transparent; color: var(--muted); opacity: .55'}
					>{formatoPeso(peso)}</button
				>
			{/each}
		</div>
	</section>
</main>
