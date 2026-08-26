<script lang="ts">
	import { browser } from '$app/environment';
	import BarraCargada from '$lib/components/BarraCargada.svelte';
	import CintaPeso from '$lib/components/CintaPeso.svelte';
	import { colorDisco } from '$lib/discos-color';
	import Icono from '$lib/components/Icono.svelte';
	import { calcularDiscos, type CargaBarra } from '$lib/discos';
	import { ajustesObs, AJUSTES_DEFAULT } from '$lib/extras';
	import { fromLiveQuery } from '$lib/live';
	import { leerPeso } from '$lib/numeros';
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

	/** El disco mas grande que tenes: fija la escala del dibujo y marca el tope de la pila. */
	const pesoMaxDisco = $derived(
		disponibles.length > 0 ? Math.max(...disponibles) : Math.max(...config.discos)
	);

	interface OpcionCercana {
		carga: CargaBarra;
		lado: 'menos' | 'mas';
	}

	/**
	 * Sin carga exacta habia dos tarjetas gemelas compitiendo y ninguna cifra mandaba.
	 * La opcion mas cerca del objetivo pasa a ser la respuesta, y la otra queda como
	 * alternativa. Ante empate gana la de abajo: pasarse de peso no es lo mismo que
	 * quedarse corto.
	 */
	const cercanas = $derived.by<{
		principal: OpcionCercana;
		alternativa: OpcionCercana | null;
	} | null>(() => {
		if (resultado.estado !== 'calculado') return null;
		const menos: OpcionCercana | null = resultado.inferior
			? { carga: resultado.inferior, lado: 'menos' }
			: null;
		const mas: OpcionCercana | null = resultado.superior
			? { carga: resultado.superior, lado: 'mas' }
			: null;
		if (!menos) return mas ? { principal: mas, alternativa: null } : null;
		if (!mas) return { principal: menos, alternativa: null };
		const distancia = (o: OpcionCercana) => Math.abs(resultado.objetivo - o.carga.total);
		return distancia(mas) < distancia(menos)
			? { principal: mas, alternativa: menos }
			: { principal: menos, alternativa: mas };
	});

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

	/** Tope del objetivo, alineado con el que valida `calcularDiscos`. */
	const MAX_OBJETIVO = 2_000;

	function fijarObjetivo(nuevo: number) {
		objetivo = nuevo;
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

	/** Solo la lista de discos: quien la muestra decide con qué rótulo la presenta. */
	function combinacion(carga: CargaBarra): string {
		return carga.discos
			.map((disco) =>
				disco.cantidad === 1
					? formatoPeso(disco.peso)
					: `${disco.cantidad}×${formatoPeso(disco.peso)}`
			)
			.join(' + ');
	}
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-5rem)] px-4 pb-1 pt-2">
	<header class="mb-1.5 flex min-h-8 items-center justify-between gap-3">
		<h1 class="text-lg font-extrabold">Calculadora de discos</h1>
		<!-- La unidad no se cambia aca: el chip lleva al unico lugar donde se cambia. -->
		<a
			href="/ajustes"
			class="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-bold"
			style="color: var(--muted)"
			aria-label={`Unidad ${unidad}. Cambiar en Ajustes`}>{unidad}</a
		>
	</header>

	<section class="rounded-2xl border border-white/10 p-2.5" style="background: var(--surface)">
		<p class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--muted)">
			Peso total en {unidad}
		</p>
		<!--
			La cifra sigue siendo un campo: para saltar de 60 a 180 escribirlo gana, y la
			cinta es para explorar lo que hay alrededor. El teclado numérico está a un
			toque, y el barrido a cero.
		-->
		<input
			type="text"
			inputmode="decimal"
			value={objetivo != null ? formatoPeso(objetivo) : ''}
			placeholder="—"
			onfocus={(e) => e.currentTarget.select()}
			onchange={(e) => confirmarObjetivo(e.currentTarget)}
			onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
			class="cifra w-full rounded-xl bg-white/[0.035] text-center text-[2.6rem] outline-none focus:bg-white/[0.08]"
			aria-label={`Peso total objetivo en ${unidad}`}
		/>
		<CintaPeso
			valor={objetivo ?? config.objetivo}
			min={config.paso}
			max={MAX_OBJETIVO}
			paso={config.paso}
			formato={formatoPeso}
			{unidad}
			onCambio={fijarObjetivo}
			vibracion={$ajustesStore.vibracion ?? true}
			etiqueta={`Peso total objetivo en ${unidad}`}
		/>
	</section>

	<section class="mt-2" aria-live="polite" aria-atomic="true">
		{#if objetivo == null || barra == null || resultado.estado === 'invalido'}
			<div
				class="rounded-2xl border border-white/10 p-3 text-sm"
				style="background: var(--surface)"
			>
				Ingresá un peso objetivo y una barra válidos.
			</div>
		{:else if resultado.estado === 'barra-supera'}
			<div
				class="flex items-center gap-2 rounded-2xl border p-3"
				style="border-color: rgb(var(--max) / .35); background: rgb(var(--max) / .08); color: rgb(var(--max))"
			>
				<Icono nombre="aviso" tamano={18} clase="shrink-0" />
				<p class="text-sm font-bold">La barra supera el peso total</p>
			</div>
		{:else if disponibles.length === 0}
			<div
				class="rounded-2xl border border-white/10 p-3 text-sm"
				style="background: var(--surface)"
			>
				Activá al menos un disco.
			</div>
		{:else if resultado.exacta}
			<!--
				La tarjeta no se tine: los dos estados usan el mismo fondo neutro.
				Antes el exacto iba en verde y el aproximado en violeta, pero el violeta es el
				acento de toda la pantalla —la aguja de la cinta, "menos que el objetivo", los
				botones— asi que no se leia "no es exacta" sino "tarjeta normal". Colorear un
				solo estado partia la simetria, y el manifiesto pide el color en el canto o el
				anillo, no de lavado sobre toda la superficie. Queda el relieve, que es lo que
				distingue la respuesta del resto; el estado lo dicen el rotulo y la cifra.
			-->
			<div class="gb-resultado rounded-2xl p-3 text-center">
				<p
					class="text-[11px] font-bold uppercase tracking-[0.18em]"
					style="color: rgb(var(--exito))"
				>
					Carga exacta · por lado
				</p>
				<p class="cifra mt-1 text-[2.9rem]">
					{formatoPeso(resultado.exacta.porLado)}<span class="cifra-u">{unidad}</span>
				</p>
				<BarraCargada carga={resultado.exacta} {pesoMaxDisco} formato={formatoPeso} {unidad} />
				<!--
					El peso de la barra se dice aca y no dentro del dibujo: el disco se identifica
					solo —tiene su color y su numero encima—, la barra no tenia quien la nombrara.
					Va pegado al renglon que ya estaba y no en uno nuevo, que la pantalla entra
					justa en 727 px, y en el orden en que se carga: primero la barra, despues lo
					que le colgas.
				-->
				<p class="mt-1 text-sm font-bold" style="color: var(--muted)">
					{#if resultado.exacta.discos.length === 0}
						Solo la barra de <span class="cifra" style="color: var(--text)"
							>{formatoPeso(resultado.barra)}</span
						>
					{:else}
						Barra <span class="cifra" style="color: var(--text)"
							>{formatoPeso(resultado.barra)}</span
						>
						· Discos:
						<span class="cifra text-lg" style="color: var(--text)"
							>{combinacion(resultado.exacta)}</span
						>
					{/if}
				</p>
			</div>
		{:else if cercanas}
			<div class="gb-resultado rounded-2xl p-3 text-center">
				<p class="text-[11px] font-bold uppercase tracking-[0.18em]" style="color: var(--muted)">
					Sin carga exacta · lo más cerca
				</p>
				<p class="cifra mt-1 text-[2.9rem]">
					{formatoPeso(cercanas.principal.carga.total)}<span class="cifra-u">{unidad}</span>
				</p>
				<p class="text-xs font-bold" style="color: var(--accent-text)">
					{cercanas.principal.lado === 'menos' ? 'Menos que el objetivo' : 'Más que el objetivo'}
				</p>
				<BarraCargada
					carga={cercanas.principal.carga}
					{pesoMaxDisco}
					formato={formatoPeso}
					{unidad}
				/>
				<p class="mt-1 text-sm font-bold" style="color: var(--muted)">
					{#if cercanas.principal.carga.discos.length === 0}
						Solo la barra de <span class="cifra" style="color: var(--text)"
							>{formatoPeso(resultado.barra)}</span
						>
					{:else}
						Barra <span class="cifra" style="color: var(--text)"
							>{formatoPeso(resultado.barra)}</span
						>
						· Por lado:
						<span class="cifra text-lg" style="color: var(--text)"
							>{combinacion(cercanas.principal.carga)}</span
						>
					{/if}
				</p>

				{#if cercanas.alternativa}
					<!-- La otra opción existe, pero no compite con la cifra que manda. -->
					<div
						class="mt-2 flex flex-wrap items-baseline justify-center gap-x-2 rounded-xl px-2 py-1"
						style="background: var(--surface-2)"
					>
						<span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--muted)"
							>{cercanas.alternativa.lado === 'menos' ? 'O menos' : 'O más'}</span
						>
						<span class="cifra text-xl"
							>{formatoPeso(cercanas.alternativa.carga.total)}<span class="cifra-u">{unidad}</span
							></span
						>
						<span class="cifra text-sm" style="color: var(--muted)"
							>{cercanas.alternativa.carga.discos.length === 0
								? 'solo la barra'
								: combinacion(cercanas.alternativa.carga)}</span
						>
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<section class="mt-2 rounded-2xl border border-white/10 p-2.5" style="background: var(--surface)">
		<h2 class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">Barra</h2>
		<div class="mt-1.5 grid grid-cols-4 gap-1.5" role="group" aria-label="Peso de la barra">
			{#each config.barras as peso}
				<button
					type="button"
					onclick={() => usarBarra(peso)}
					aria-pressed={barra === peso}
					class="gb-relieve cifra min-h-11 rounded-xl border text-xl"
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
				class="gb-relieve cifra min-h-11 min-w-0 rounded-xl border border-white/10 bg-white/[0.035] px-1 text-center text-xl outline-none placeholder:text-xs placeholder:font-bold focus:border-white/30"
				aria-label={`Otro peso de barra en ${unidad}`}
			/>
		</div>

		<!--
			"Discos por lado" se leía como cuántos discos vas a usar, cuando en realidad es
			qué pesos de disco hay en el gimnasio. La cantidad la resuelve el cálculo; acá
			sólo se marca cuáles existen.
		-->
		<h2 class="mt-2 text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
			Pesos de disco que tenés
		</h2>
		<div class="mt-1.5 grid grid-cols-7 gap-1">
			{#each config.discos as peso}
				{@const tengo = disponibles.includes(peso)}
				{@const color = colorDisco(peso, unidad)}
				<!--
					Cada botón es la placa que representa, con su color: el mismo que vas a ver
					en el dibujo y el mismo que tiene el disco en el rack. El que no tenés queda
					como ranura vacía —contorno punteado, sin relleno ni relieve—, que se lee
					"no lo tengo" donde el 55% de opacidad se leía "no anda".
				-->
				<button
					type="button"
					onclick={() => alternarDisco(peso)}
					aria-pressed={tengo}
					class="cifra min-h-11 rounded-xl border px-0.5 text-base {tengo ? 'gb-relieve' : ''}"
					style={tengo
						? `border-color: rgb(${color}); background: rgb(${color}); color: var(--on-bright)`
						: `border-style: dashed; border-color: rgb(${color} / .45); background: transparent; color: rgb(${color} / .8)`}
					>{formatoPeso(peso)}</button
				>
			{/each}
		</div>
	</section>
</main>

<style>
	/*
	 * El relieve de `.gb-foco` sin su color. Ese primitivo lo comparten las filas de
	 * serie, donde `--foco-color` es el glow del grupo muscular y por eso dice de que
	 * ejercicio se trata; aca se le estaba pidiendo que dijera un estado, que es otra
	 * cosa. La tarjeta se queda con el bisel de arriba y la sombra de abajo, que es lo
	 * que la separa del fondo, y con un anillo neutro en vez de uno teñido.
	 */
	.gb-resultado {
		background: var(--surface-3);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.12),
			inset 0 0 0 1px rgba(255, 255, 255, 0.08),
			0 10px 26px rgba(0, 0, 0, 0.4);
	}
</style>
