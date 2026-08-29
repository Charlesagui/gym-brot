<script lang="ts">
	import { GEOMETRIA_CUERPO } from '$lib/body-geometry';
	import Icono from '$lib/components/Icono.svelte';
	import { formatoNumero } from '$lib/formato';
	import { estadoLiveQuery } from '$lib/live';
	import { musculoMasCercano, type CajaMuscular } from '$lib/mapa-tactil';
	import { COLORES_INTENSIDAD } from '$lib/escala-intensidad';
	import {
		colorCarga,
		crearDistribucionMuscular,
		desdeDistribucion,
		distribucionMuscularObs,
		ETIQUETAS_CARGA,
		MUSCULOS,
		ROTULOS_CARGA,
		porSemana,
		type DistribucionMuscular,
		type MusculoMapa
	} from '$lib/musculos';
	import { vibrar } from '$lib/vibracion';

	let { hoy, vibracion = true }: { hoy: string; vibracion?: boolean } = $props();
	let semanas = $state<1 | 4 | 12>(4);
	let soloDuras = $state(false);
	let seleccionado = $state<MusculoMapa | null>(null);
	/** Zona bajo el dedo mientras dura el toque: el acuse de presión del dibujo. */
	let presionado = $state<MusculoMapa | null>(null);

	/**
	 * Último resultado bueno. Deliberadamente FUERA de `$state`: lo lee el `$derived` de
	 * acá abajo y lo escribe el `$effect` que observa la consulta, así que hacerlo
	 * reactivo cerraría el ciclo.
	 *
	 * Existe porque cambiar de período crea un store nuevo, y su valor inicial era la
	 * distribución vacía: durante el frame que tarda IndexedDB el cuerpo se apagaba
	 * entero y la lista afirmaba "No hay series completadas para este período". Un cero
	 * falso dura poco, pero sigue siendo un cero falso. Ahora se sostiene el dibujo
	 * anterior con `aria-busy`, que es lo que de verdad está pasando.
	 */
	let ultima: DistribucionMuscular | null = null;

	/**
	 * El período y el filtro se pisan con lo que la persona acaba de tocar: si el rótulo
	 * dijera "4 semanas" con el botón de 1 semana ya encendido, el control y el texto se
	 * contradirían. Las cifras siguen siendo las del cálculo anterior por un frame — por
	 * eso la sección va marcada como ocupada mientras dura.
	 */
	const inicial = $derived.by(() => {
		// A una `let` que se asigna desde otro closure TypeScript no le estrecha el tipo:
		// hay que copiarla a una const para que el `null` quede descartado de verdad.
		const previa = ultima;
		return previa
			? { ...previa, semanas, soloDuras, hasta: hoy, desde: desdeDistribucion(hoy, semanas) }
			: crearDistribucionMuscular([], hoy, semanas, soloDuras);
	});
	const store = $derived(
		estadoLiveQuery(distribucionMuscularObs(hoy, semanas, soloDuras), inicial)
	);
	const consulta = $derived($store);
	const distribucion = $derived(consulta.valor);
	const recalculando = $derived(consulta.estado === 'cargando');
	$effect(() => {
		if (consulta.estado === 'listo') ultima = consulta.valor;
	});

	const porMusculo = $derived(new Map(distribucion.cargas.map((carga) => [carga.musculo, carga])));
	const geometriaAMusculo = new Map(
		(Object.entries(MUSCULOS) as [MusculoMapa, (typeof MUSCULOS)[MusculoMapa]][]).map(
			([musculo, datos]) => [datos.geometria, musculo]
		)
	);

	/** El relleno de una zona: el escalón en el que cayó, no una opacidad. */
	function relleno(musculo: MusculoMapa): string {
		return colorCarga(porMusculo.get(musculo)?.seriesEstimadas ?? 0, semanas);
	}

	/** Toda cifra del mapa va en la misma unidad que pinta el dibujo. */
	function semanal(valor: number | undefined): string {
		return formatoNumero(porSemana(valor ?? 0, semanas));
	}

	/** "1 serie por semana", pero "0,4 series por semana": el singular es sólo el 1 exacto. */
	function plural(valor: number | undefined): string {
		return porSemana(valor ?? 0, semanas) === 1 ? 'serie' : 'series';
	}

	/**
	 * Tocar SELECCIONA; no alterna. Con el radio de perdón del toque, dos toques
	 * seguidos cerca del mismo músculo son lo más común del mundo, y con alternancia el
	 * segundo cerraba el detalle: exactamente la sensación de "lo toco y no hace nada"
	 * que este dibujo ya daba de sobra. Para cerrarlo está el botón, o tocar afuera.
	 */
	function activar(musculo: MusculoMapa) {
		seleccionado = musculo;
	}

	function etiqueta(musculo: MusculoMapa): string {
		const carga = porMusculo.get(musculo);
		return `${MUSCULOS[musculo].label}: ${semanal(carga?.seriesEstimadas)} ${plural(carga?.seriesEstimadas)} por semana`;
	}

	/** Cuánto puede errarle el dedo a una zona y que igual cuente, en píxeles de pantalla. */
	const RADIO_PX = 22;
	/** Movimiento que convierte el toque en scroll (mismo umbral que $lib/presion). */
	const TOLERANCIA_PX = 12;
	/** Tic háptico de toque, igual que el acuse de presión global. */
	const TIC_MS = 8;

	/**
	 * El dibujo se toca por acá y no con un `onclick` por zona.
	 *
	 * Dos motivos. Uno: las zonas son diminutas —el trapecio mide 12×8 px en un teléfono
	 * y la app pide 44— así que el toque necesita un radio de perdón, y eso hay que
	 * resolverlo a nivel del SVG entero (ver $lib/mapa-tactil). Dos: marcar cada `<g>`
	 * como `role="button"` las metía en la primitiva de presión global, que les aplicaba
	 * `transform: scale(.955)`; en SVG esa escala se toma desde el centro del viewBox, no
	 * del músculo, así que la zona se corría varios píxeles al apretarla. Se tocaba una
	 * cosa y se movía otra.
	 *
	 * El toque se confirma al soltar y sólo si el dedo no se fue de paseo, para que
	 * arrancar un scroll sobre el cuerpo no seleccione nada.
	 */
	function tacto(svg: SVGSVGElement) {
		let cajas: CajaMuscular<MusculoMapa>[] | null = null;
		let puntero: number | null = null;
		let candidato: MusculoMapa | null = null;
		let desdeX = 0;
		let desdeY = 0;

		/** Las cajas son unidades del viewBox: no dependen del tamaño en pantalla. */
		function medir(): CajaMuscular<MusculoMapa>[] {
			const medidas: CajaMuscular<MusculoMapa>[] = [];
			for (const grupo of svg.querySelectorAll<SVGGElement>('[data-musculo]')) {
				const musculo = grupo.dataset.musculo as MusculoMapa;
				for (const trazo of grupo.querySelectorAll<SVGPathElement>('path')) {
					try {
						const caja = trazo.getBBox();
						medidas.push({
							musculo,
							x0: caja.x,
							y0: caja.y,
							x1: caja.x + caja.width,
							y1: caja.y + caja.height
						});
					} catch {
						// Sin getBBox (o con el dibujo todavía sin renderizar) queda sólo el
						// acierto directo, que es el comportamiento de antes: nada empeora.
					}
				}
			}
			return medidas;
		}

		function resolver(evento: PointerEvent): MusculoMapa | null {
			const directo =
				evento.target instanceof Element ? evento.target.closest('[data-musculo]') : null;
			const musculo = directo instanceof SVGElement ? directo.dataset.musculo : undefined;
			if (musculo) return musculo as MusculoMapa;
			const matriz = svg.getScreenCTM();
			if (!matriz) return null;
			cajas ??= medir();
			const punto = new DOMPoint(evento.clientX, evento.clientY).matrixTransform(matriz.inverse());
			// matriz.a son píxeles de pantalla por unidad del viewBox.
			return musculoMasCercano(punto.x, punto.y, cajas, RADIO_PX / (matriz.a || 1));
		}

		function cancelar() {
			puntero = null;
			candidato = null;
			presionado = null;
		}

		function apretar(evento: PointerEvent) {
			if (puntero !== null || !evento.isPrimary) return;
			if (evento.pointerType === 'mouse' && evento.button !== 0) return;
			puntero = evento.pointerId;
			desdeX = evento.clientX;
			desdeY = evento.clientY;
			candidato = resolver(evento);
			presionado = candidato;
		}

		function mover(evento: PointerEvent) {
			if (evento.pointerId !== puntero) return;
			if (
				Math.abs(evento.clientX - desdeX) > TOLERANCIA_PX ||
				Math.abs(evento.clientY - desdeY) > TOLERANCIA_PX
			)
				cancelar();
		}

		function soltar(evento: PointerEvent) {
			if (evento.pointerId !== puntero) return;
			const elegido = candidato;
			cancelar();
			if (elegido) {
				activar(elegido);
				vibrar(TIC_MS, vibracion);
			} else {
				// Tocar el vacío alrededor del cuerpo cierra el detalle: es el gesto que
				// todo el mundo prueba antes de buscar un botón.
				seleccionado = null;
			}
		}

		// Fuera del SVG a propósito: con el dedo apoyado, `pointerup` y el scroll llegan
		// al documento y no al dibujo. Pasivos y en captura, como el acuse global.
		const opciones = { capture: true, passive: true } as const;
		svg.addEventListener('pointerdown', apretar, opciones);
		document.addEventListener('pointermove', mover, opciones);
		document.addEventListener('pointerup', soltar, opciones);
		document.addEventListener('pointercancel', cancelar, opciones);
		document.addEventListener('scroll', cancelar, opciones);

		return {
			destroy() {
				cancelar();
				svg.removeEventListener('pointerdown', apretar, opciones);
				document.removeEventListener('pointermove', mover, opciones);
				document.removeEventListener('pointerup', soltar, opciones);
				document.removeEventListener('pointercancel', cancelar, opciones);
				document.removeEventListener('scroll', cancelar, opciones);
			}
		};
	}
</script>

<!--
	El dibujo primero.

	Es lo que la persona viene a ver, y hasta acá entraba último: título, subtítulo de
	ponderación, selector de período, filtro de RIR y un descargo sobre la silueta le
	ganaban de mano 398 px, más de lo que mide el cuerpo entero (344 px). En un teléfono
	de 664 px de alto había que scrollear 142 px para verlo completo.

	Ahora arriba del dibujo sólo queda lo que lo encabeza —qué es y sobre cuántas series
	está calculado—, los controles bajan a después (se ajustan mirando el resultado, no
	antes) y toda la letra chica se junta en un solo pie.
-->
<section
	class="rounded-2xl border border-white/10 p-4"
	style="background: var(--surface)"
	aria-labelledby="titulo-mapa-corporal"
	aria-busy={recalculando}
>
	<div class="flex items-start justify-between gap-3">
		<h2 id="titulo-mapa-corporal" class="text-sm font-bold">Distribución estimada de series</h2>
		<!-- El "en el mapa" aparece sólo cuando hay series que el dibujo no puede
		     representar, y no es cosmético: sin él este número se leería como el total del
		     período y no lo es. Así el encabezado nunca afirma de más, y la explicación
		     completa puede vivir abajo sin dejar un hueco de verdad en el medio. -->
		<p class="shrink-0 text-right text-xs font-semibold" style="color: var(--muted)">
			{distribucion.seriesConsideradas}
			{distribucion.soloDuras ? 'series duras' : 'series'}{distribucion.seriesSinRepresentacion > 0
				? ' en el mapa'
				: ''}<br />{semanas === 1 ? '7 días' : `${semanas} semanas`}
		</p>
	</div>

	{#if consulta.estado === 'error'}
		<p class="mt-4 rounded-xl bg-red-400/10 p-3 text-xs" style="color: #ff9b9b" role="alert">
			No se pudo calcular el mapa. Tus sesiones no fueron modificadas.
		</p>
	{:else}
		<div class="mt-3 grid grid-cols-2 gap-2">
			{#each ['front', 'back'] as lado (lado)}
				{@const cuerpo = GEOMETRIA_CUERPO[lado as 'front' | 'back']}
				<div>
					<p
						class="text-center text-[11px] font-bold uppercase tracking-wider"
						style="color: var(--muted)"
					>
						{lado === 'front' ? 'Frente' : 'Espalda'}
					</p>
					<!--
						`role="img"`: el dibujo es una sola imagen para el lector de pantalla y el
						camino accesible es la lista "Detalle equivalente" de abajo, con sus
						blancos de 44 px. Antes cada zona era un `role="button"` con `tabindex="-1"`:
						24 paradas que repetían la lista una por una, con blancos de 28×7 px.
					-->
					<svg
						use:tacto
						viewBox={cuerpo.viewBox}
						class="mx-auto h-auto max-h-[25rem] w-full"
						role="img"
						aria-label={`Cuerpo de ${lado === 'front' ? 'frente' : 'espalda'}: intensidad por músculo. El detalle en cifras está en la lista Detalle equivalente.`}
					>
						{#each cuerpo.zones as zona (zona.slug)}
							{@const musculo = geometriaAMusculo.get(zona.slug)}
							{#if musculo}
								<g
									data-musculo={musculo}
									class="zona"
									class:presionada={presionado === musculo}
									class:seleccionada={seleccionado === musculo}
								>
									<title>{etiqueta(musculo)}</title>
									{#each zona.paths as path}
										<path d={path} style={`fill: ${relleno(musculo)}`} />
									{/each}
								</g>
							{:else}
								<g aria-hidden="true">
									{#each zona.paths as path}
										<path d={path} style="fill: rgba(255,255,255,.035)" />
									{/each}
								</g>
							{/if}
						{/each}
					</svg>
				</div>
			{/each}
		</div>

		<!--
			La leyenda, fija y pegada al dibujo.

			Antes vivía DENTRO del hueco del detalle, así que desaparecía al seleccionar un
			músculo: la referencia de qué significa cada color se iba justo en el momento en
			que alguien estaba mirando un color y preguntándose qué significaba. Y era un
			gradiente continuo con los dos extremos rotulados, que decía dónde empieza y dónde
			termina la escala pero no dónde caen los saltos.
		-->
		<div
			class="mt-2 flex items-center gap-2"
			role="img"
			aria-label={`Escala del color, en series estimadas por semana: ${ETIQUETAS_CARGA.join('; ')}.`}
		>
			<div class="flex flex-1 gap-1">
				{#each COLORES_INTENSIDAD as color, nivel (nivel)}
					<div class="flex-1">
						<div class="h-3 rounded-[3px]" style={`background: ${color}`}></div>
						<p class="cifra mt-1 text-center text-[10px]" style="color: var(--muted)">
							{ROTULOS_CARGA[nivel]}
						</p>
					</div>
				{/each}
			</div>
			<p class="w-[5.5rem] shrink-0 text-[10px] leading-tight" style="color: var(--muted)">
				series por semana
			</p>
		</div>

		<!--
			El detalle ocupa su lugar esté abierto o cerrado.

			Antes aparecía y desaparecía, y al hacerlo empujaba 62 px los botones de período
			que están justo abajo: se tocaba un músculo y el botón al que ibas se te movía de
			abajo del dedo. Ahora el hueco está siempre, y cuando no hay nada elegido lo ocupa
			la única instrucción que el dibujo necesita: que se toca.

			Y el hueco mide lo que mide el detalle MÁS ALTO, no lo que mide uno cualquiera. La
			reserva de 84 px alcanzaba para el contenido de entonces: medido a 320 px, el detalle
			abierto pedía 97 px con un nombre corto y 117 con "Espalda alta y dorsales", así que
			el empujón que este comentario dice haber sacado seguía ahí, más chico. Dos cambios lo
			cierran: el botón de cerrar sale del flujo —abajo— y con los renglones sin envolver el
			peor caso baja a 100,5 px, que es lo que reserva el `min-h`. El e2e "el hueco del
			detalle aguanta el nombre más largo" lo fija contra el nombre más largo del catálogo.
		-->
		<div
			class="relative mt-2 flex min-h-[6.5rem] items-center rounded-xl border border-white/10 bg-white/[0.045] p-3"
			aria-live="polite"
		>
			{#if seleccionado}
				{@const carga = porMusculo.get(seleccionado)}
				<!-- Tres renglones cortos y no uno largo: a 320 px el renglón único envolvía en
				     tres líneas y el hueco reservado dejaba de alcanzar. La cifra manda, el
				     desglose va abajo y en menor jerarquía. -->
				<div class="min-w-0 flex-1">
					<!-- `pr-12` en el título y no `gap` en la fila: el botón está fuera del flujo,
					     así que sólo le roba ancho al renglón que tiene al lado. Los otros dos usan
					     los 224 px completos, que es lo que evita que envuelvan a 320 px. -->
					<p class="pr-12 text-sm font-bold">{MUSCULOS[seleccionado].label}</p>
					<p class="mt-0.5 text-xs" style="color: var(--muted)">
						<span class="cifra">{semanal(carga?.seriesEstimadas)}</span>
						{plural(carga?.seriesEstimadas)} por semana
					</p>
					<p class="text-[11px]" style="color: var(--muted)">
						{semanal(carga?.seriesPrimarias)} principales · {semanal(carga?.seriesSecundarias)} secundarias
					</p>
				</div>
				<button
					type="button"
					onclick={() => (seleccionado = null)}
					aria-label={`Cerrar detalle de ${MUSCULOS[seleccionado].label}`}
					class="absolute right-1.5 top-1.5 grid size-11 shrink-0 place-items-center rounded-xl"
					style="background: rgba(255,255,255,.06); color: var(--muted)"
				>
					<Icono nombre="cerrar" tamano={18} />
				</button>
			{:else}
				<!-- La leyenda se mudó acá arriba, a un lugar fijo. Este hueco vuelve a ser sólo
				     lo que ya era: la única instrucción que el dibujo necesita, ocupando el
				     espacio que el detalle va a usar para que nada salte al abrirlo.

				     Centrada: sin la leyenda debajo, un renglón solo pegado a la izquierda de una
				     caja de 84 px de alto se lee como un hueco que quedó sin llenar. Centrado se
				     lee como lo que es, un cartel esperando que toques algo. -->
				<p class="min-w-0 flex-1 text-center text-xs" style="color: var(--muted)">
					Tocá un músculo del dibujo o de la lista.
				</p>
			{/if}
		</div>

		{#if distribucion.seriesSinRepresentacion > 0}
			<!-- Series reales que el dibujo no puede representar (ejercicio archivado o sin
			     músculo mapeado). Se dicen igual: el encabezado ya avisa con "en el mapa" que
			     su número no es el total, y acá se explica por qué y adónde fueron a parar. -->
			<p class="mt-2 rounded-xl bg-white/[0.035] px-3 py-2 text-[11px]" style="color: var(--muted)">
				{distribucion.seriesSinRepresentacion}
				{distribucion.seriesSinRepresentacion === 1 ? 'serie más' : 'series más'} del período no
				{distribucion.seriesSinRepresentacion === 1 ? 'entra' : 'entran'} en el mapa: su ejercicio no
				tiene músculos asignados. Sí {distribucion.seriesSinRepresentacion === 1
					? 'cuenta'
					: 'cuentan'} en el historial.
			</p>
		{/if}

		<!-- Los controles, después del dibujo: se ajusta el período mirando el resultado,
		     no antes de tenerlo. Con relieve porque son grandes y hay que verlos apretables. -->
		<div class="mt-3 grid grid-cols-3 gap-2" aria-label="Período del mapa corporal">
			{#each [{ valor: 1, label: '1 semana' }, { valor: 4, label: '4 semanas' }, { valor: 12, label: '12 semanas' }] as opcion (opcion.valor)}
				<button
					type="button"
					onclick={() => (semanas = opcion.valor as 1 | 4 | 12)}
					aria-pressed={semanas === opcion.valor}
					class="gb-relieve min-h-11 rounded-xl px-2 text-xs font-bold"
					style={semanas === opcion.valor
						? 'background: rgb(var(--exito) / .2); color: rgb(var(--exito))'
						: 'background: rgba(255,255,255,.05); color: var(--muted)'}>{opcion.label}</button
				>
			{/each}
		</div>

		{#if distribucion.puedeFiltrarDuras || soloDuras}
			<label
				class="mt-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl bg-white/[0.035] px-3"
			>
				<input type="checkbox" bind:checked={soloDuras} class="size-4 accent-[rgb(var(--exito))]" />
				<span class="text-xs font-semibold">Sólo series duras (RIR 0–2)</span>
				<span class="ml-auto text-[11px]" style="color: var(--muted)">
					RIR en {Math.round(distribucion.coberturaRir * 100)}%
				</span>
			</label>
		{/if}
	{/if}

	<div class="mt-4 border-t border-white/10 pt-3">
		<div class="flex items-baseline justify-between gap-2">
			<h3 class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
				Detalle equivalente
			</h3>
			<!-- La cifra de cada fila es la misma que pinta el dibujo, y ninguna de las dos
			     puede quedar sin unidad: en 12 semanas, 11 por semana y 132 en el período
			     son el mismo trabajo y se leen distinto. -->
			<span class="shrink-0 text-[10px]" style="color: var(--muted)">series por semana</span>
		</div>
		{#if distribucion.cargas.length}
			<ol class="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
				{#each distribucion.cargas as carga (carga.musculo)}
					<li>
						<button
							type="button"
							onclick={() => activar(carga.musculo)}
							aria-pressed={seleccionado === carga.musculo}
							class="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left"
							style={seleccionado === carga.musculo
								? 'background: rgb(var(--exito) / .14)'
								: 'background: rgba(255,255,255,.025)'}
						>
							<span class="min-w-0 flex-1 text-xs font-semibold">{carga.label}</span>
							<strong class="cifra text-sm" style="color: rgb(var(--exito))">
								{semanal(carga.seriesEstimadas)}
							</strong>
						</button>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="py-4 text-center text-xs" style="color: var(--muted)">
				No hay series completadas para este período{soloDuras ? ' con RIR 0–2' : ''}.
			</p>
		{/if}
	</div>

	<!-- Toda la letra chica junta, al pie. Antes eran tres textos separados que decían
	     partes del mismo descargo —la ponderación arriba del dibujo, la silueta en el
	     medio y el alcance abajo—, y entre los tres empujaban el cuerpo 132 px hacia
	     abajo. No se sacó ninguna afirmación: se las juntó donde se leen las notas. -->
	<p class="mt-3 text-[10px] leading-relaxed" style="color: var(--muted)">
		1 serie al músculo principal y 0,4 a cada secundario, sólo sobre series completadas. El color es
		una escala fija de cinco escalones —{ETIQUETAS_CARGA.join(', ')}— y el período sólo cambia sobre
		cuánto tiempo se promedia, así que el mismo ritmo semanal pinta igual en 1, 4 o 12 semanas.
		Estima distribución, no mide fatiga, recuperación ni activación médica. Silueta anatómica única,
		no personalizada por sexo o género. Geometría MuscleMap © 2026 Melih Colpan, MIT.
	</p>
</section>

<style>
	g path {
		/*
		 * Un píxel y no dos, con un poco más de tinta para compensar.
		 *
		 * El borde no escala con el dibujo, así que su costo lo paga cada trazo según lo
		 * fino que sea, y varios son finísimos: medidos trazo por trazo en un teléfono, el
		 * tríceps de espalda tiene uno de 4 px de grosor, los oblicuos de 4,3 y el serrato
		 * de 5,3. Con 2 px de borde —1 px visible de cada lado— el contorno era un tercio
		 * de la altura de esas formas, y siendo más claro que todo lo demás las lavaba:
		 * el serrato y los oblicuos se leían como un enrejado blanco en vez de como
		 * músculos, y el color que los tenía que describir quedaba de relleno.
		 *
		 * No se resolvió marcando "zonas finas" porque no existen: el grosor va de 4 a
		 * 34 px en un continuo, y hay trazos finos DENTRO de zonas gruesas —los aductores
		 * del frente tienen uno de 6,6 px y otros de 17,7—, así que cualquier corte por
		 * zona dejaba afuera justo los casos que lo motivaban.
		 *
		 * Sacarlo del todo tampoco: sin borde, los músculos sin entrenar se pierden contra
		 * la tarjeta —su relleno está a 1,16:1 del fondo, el contorno es lo único que los
		 * dibuja— y dos trazos vecinos del mismo escalón se funden en una mancha sola.
		 * Con 1 px a 0,14 el borde emite un 30 % menos de luz que antes y las dos cosas
		 * que hacía se siguen viendo.
		 */
		stroke: rgba(255, 255, 255, 0.14);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
		/*
		 * El borde se pinta ANTES del relleno, así que sólo se ve su mitad de afuera.
		 * Con el orden normal, el borde de 6 px del músculo elegido se comía 3 px de
		 * cada lado de una forma que en un teléfono mide 20: el cuádriceps elegido
		 * quedaba blanco con una astilla verde adentro. Ahora el relleno queda entero
		 * y el borde crece hacia afuera, que es lo que un contorno tiene que hacer.
		 */
		paint-order: stroke;
	}
	g.zona {
		cursor: pointer;
	}
	/* El acuse de presión: el músculo se enciende mientras el dedo está apoyado, antes
	   de saber si el gesto termina en toque o en scroll. */
	/*
	 * Anchos chicos a propósito. Un músculo son varios trazos —el cuádriceps son seis— y
	 * cada uno lleva su propio borde, así que los bordes de los trazos vecinos se tocan y
	 * rellenan de blanco los huecos que los separan: con 7 px, la pierna elegida dejaba de
	 * leerse como músculo y pasaba a ser un resplandor.
	 *
	 * Con 4 pasaba lo mismo, sólo que en los músculos finos y por eso costaba verlo: los
	 * oblicuos elegidos —trazos de 4,3 px— quedaban blancos enteros, sin nada de relleno
	 * adentro. Bajados a 3 y 2 el contorno sigue mandando sobre el borde en reposo, que es
	 * 1, y en la mayoría de los músculos el color vuelve a verse dentro del contorno.
	 *
	 * En los más finos —oblicuos y serrato, doce y seis trazos de 4 a 5 px— sigue tapando
	 * casi todo, y ningún ancho que se note en el resto del cuerpo lo evita: el contorno
	 * va por trazo y esos músculos son un peine de trazos. Para resolverlo de verdad
	 * habría que contornear el GRUPO y no cada trazo (un filtro `feMorphology` sobre el
	 * `<g>`), que es bastante más máquina para un caso de dos músculos. Mientras tanto el
	 * estado no depende sólo del contorno: al elegir se abre el detalle con el nombre y la
	 * cifra, y la fila de la lista queda marcada.
	 */
	g.zona.presionada path {
		stroke: rgba(255, 255, 255, 0.5);
		stroke-width: 2;
	}
	g.zona.seleccionada path {
		stroke: white;
		stroke-width: 3;
	}
	/* Sólo con mouse: en un teléfono el `:hover` se queda pegado después del toque y
	   dejaba un segundo músculo con pinta de elegido. */
	@media (hover: hover) and (pointer: fine) {
		g.zona:hover path {
			stroke: rgba(255, 255, 255, 0.55);
			stroke-width: 3;
		}
	}
	@media (prefers-reduced-motion: no-preference) {
		g.zona path {
			/* `--dur-med` no existe: era una variable inventada, y una `var()` rota anula
			   toda la declaración. El dibujo no animaba nada, ni el relleno al cambiar de
			   período ni el borde al elegir un músculo. */
			transition:
				fill var(--dur-base) var(--ease-out),
				stroke var(--dur-fast) var(--ease-out),
				stroke-width var(--dur-fast) var(--ease-out);
		}
	}
</style>
