<script lang="ts">
	import Icono from '$lib/components/Icono.svelte';
	import RielObjetivo, { type ParadaObjetivo } from '$lib/components/RielObjetivo.svelte';
	import { calibrar, DIAS_VENTANA_MAX, estadoCalibracion, type Adherencia } from '$lib/calibracion';
	import {
		bandas,
		calcularMantenimiento,
		calcularObjetivo,
		macros,
		OPCIONES_OBJETIVO,
		ritmoDeOpcion,
		rotuloObjetivo,
		tonoObjetivo,
		type Mantenimiento,
		type Objetivo,
		type OpcionObjetivo
	} from '$lib/energia';
	import { fraseProteina, frasesPara } from '$lib/frases';
	import { hoyCalendarioLocal } from '$lib/fechas';
	import { AJUSTES_DEFAULT, ajustesObs } from '$lib/extras';
	import { formatoNumero, formatoVolumen } from '$lib/formato';
	import { fromLiveQuery } from '$lib/live';
	import {
		borrarObjetivos,
		guardarObjetivo,
		guardarRevision,
		objetivoAnterior,
		objetivoVigenteObs
	} from '$lib/perfil-energia';
	import { pesosRecientesObs, resumirPesoCorporal } from '$lib/peso-corporal';
	import { gramosAPeso, KG_TO_LB } from '$lib/unidades';

	const ajustes = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	// Ventana acotada: acá alcanza con el peso actual y los cambios de 7 y 30 días.
	// El historial entero vive en /peso, que es donde se necesita.
	// La ventana de calibración llega hasta 56 días; el resumen necesita 45. Se pide la
	// más larga de las dos, una sola vez, y sigue acotada por índice.
	const pesos = fromLiveQuery(pesosRecientesObs(DIAS_VENTANA_MAX + 7), []);
	const objetivo = fromLiveQuery(objetivoVigenteObs(), null);

	const unidad = $derived($ajustes.unidad);
	const resumen = $derived(resumirPesoCorporal($pesos, $ajustes.metaPesoGramos));
	const banda = $derived($objetivo ? bandas($objetivo.tdeeKcal, $objetivo.sepvKcal).banda68 : null);

	// ===== Cambiar de objetivo desde acá =====

	/**
	 * El mantenimiento del objetivo guardado, recompuesto para poder calcular las otras
	 * posiciones del riel.
	 *
	 * El `tdee` se **pisa** con el guardado en vez de recalcularse, y es lo único que hay
	 * que entender de esta función: si el objetivo ya pasó por una revisión, su `tdeeKcal`
	 * es el que salió de la balanza y no el que salió de la fórmula. Recalcular acá tiraría
	 * esa corrección a la basura y devolvería a la persona al número que ya sabemos que
	 * estaba mal. Es el mismo truco que hace `guardarRevision` con `conTdeeMedido`.
	 */
	const mantenimientoVigente = $derived.by<Mantenimiento | null>(() => {
		if (!$objetivo) return null;
		const m = calcularMantenimiento($objetivo.perfil);
		if (m.estado !== 'calculado') return null;
		return { ...m, tdee: $objetivo.tdeeKcal };
	});

	/** Cuál de las cinco posiciones es la que está guardada, si es alguna. */
	const idVigente = $derived(
		OPCIONES_OBJETIVO.find(
			(o) => o.meta === $objetivo?.meta && o.nivel === ($objetivo?.nivel ?? null)
		)?.id ?? null
	);

	/**
	 * Las cinco posiciones, calculadas contra el mantenimiento del objetivo guardado.
	 *
	 * Se ofrecen todas, incluida la dirección contraria a la que está guardada. Hubo una
	 * versión que ofrecía sólo la dirección guardada más mantenimiento, porque la pregunta
	 * de "¿Algo de esto aplica?" no se persistía y la sección no podía saber si a esa
	 * persona el déficit se le había retirado. Esa pregunta ya no existe —se sacó del
	 * asistente— así que la asimetría dejó de tener a qué protegerse: acá se ofrece
	 * exactamente lo mismo que ofrece el paso 4.
	 *
	 * Lo que sigue recortando es el motor y no esta pantalla: bajo IMC 18,5 `calcularObjetivo`
	 * devuelve `bloqueado` para bajar de peso, y el `flatMap` la deja afuera. Esa posición
	 * **no aparece**, ni siquiera apagada — una muesca gris que dice "Déficit agresivo" y no
	 * se deja tocar sigue diciendo "esto existe y vos no llegás", y con calorías eso empuja
	 * para el lado malo. Es la misma decisión que ya toma el paso 4.
	 */
	const posiciones = $derived.by(() => {
		const m = mantenimientoVigente;
		if (!m) return [];
		return OPCIONES_OBJETIVO.map((opcion) => ({
			opcion,
			resultado: calcularObjetivo(m, opcion.meta, ritmoDeOpcion(opcion))
		})).flatMap(({ opcion, resultado }) =>
			resultado.estado === 'calculado' ? [{ opcion, objetivo: resultado }] : []
		);
	});

	/**
	 * La posición que el dedo está mirando, o `null` si está mirando la guardada. Moverse
	 * por el riel no escribe nada: cambia esta variable y nada más.
	 */
	let previsualizado = $state<string | null>(null);

	/** Si el objetivo guardado cambia debajo nuestro, lo que se estaba mirando ya no vale. */
	$effect(() => {
		void $objetivo?.id;
		previsualizado = null;
	});

	/**
	 * Lo que la tarjeta muestra: la posición previsualizada si hay una, y si no la guardada.
	 *
	 * Existe para que la cifra, los macros, el ritmo y la banda salgan todos del mismo lugar.
	 * Sin esto cada uno leería por su cuenta de `$objetivo` o de la previsualización, y la
	 * primera vez que uno se olvidara la pantalla mostraría los macros de un objetivo arriba
	 * de las calorías de otro.
	 */
	const vista = $derived.by(() => {
		if (!$objetivo) return null;
		const guardada = {
			enPrevisualizacion: false,
			opcion: null as OpcionObjetivo | null,
			rotulo: rotuloObjetivo($objetivo.meta, $objetivo.nivel),
			meta: $objetivo.meta,
			objetivoKcal: $objetivo.objetivoKcal,
			ritmoPctSemana: $objetivo.ritmoPctSemana,
			avisos: [] as Objetivo['avisos']
		};
		// Volver con el dedo a la muesca guardada no es previsualizar: es cancelar.
		if (!previsualizado || previsualizado === idVigente) return guardada;
		const p = posiciones.find((x) => x.opcion.id === previsualizado);
		if (!p) return guardada;
		return {
			enPrevisualizacion: true,
			opcion: p.opcion,
			rotulo: rotuloObjetivo(p.opcion.meta, p.opcion.nivel),
			meta: p.opcion.meta,
			objetivoKcal: p.objetivo.objetivoKcal,
			ritmoPctSemana: p.objetivo.ritmoPctSemana,
			avisos: p.objetivo.avisos
		};
	});

	const paradas = $derived<ParadaObjetivo[]>(
		posiciones.map(({ opcion }) => ({
			id: opcion.id,
			corto: opcion.corto,
			tono: tonoObjetivo(opcion.meta, opcion.nivel),
			disponible: true
		}))
	);

	/**
	 * Cuánto te corrés del mantenimiento, en kcal y con signo. Sale de `vista`, así que
	 * mientras el dedo recorre el riel también dice lo de la posición que se está mirando.
	 */
	const diferenciaTexto = $derived.by(() => {
		if (!$objetivo || !vista) return '';
		const delta = vista.objetivoKcal - $objetivo.tdeeKcal;
		const signo = delta > 0 ? '+' : delta < 0 ? '−' : '';
		return `${signo}${formatoVolumen(Math.abs(delta))}`;
	});

	const ritmoTexto = $derived.by(() => {
		if (!$objetivo || !vista) return '';
		const kgSemana = (vista.ritmoPctSemana / 100) * ($objetivo.perfil.pesoGramos / 1000);
		const visible = unidad === 'kg' ? kgSemana : kgSemana * KG_TO_LB;
		const signo = visible > 0 ? '+' : visible < 0 ? '−' : '';
		return `${signo}${Math.abs(visible).toFixed(2).replace('.', ',')}`;
	});

	const revision = $derived(
		$objetivo
			? estadoCalibracion(
					{
						creadoAt: $objetivo.creadoAt,
						meta: $objetivo.meta,
						objetivoKcal: $objetivo.objetivoKcal,
						tdeeKcal: $objetivo.tdeeKcal
					},
					$pesos,
					hoyCalendarioLocal()
				)
			: null
	);

	/**
	 * El mantenimiento del objetivo que esta revisión reemplazó. Es una lectura por
	 * clave primaria y solo cuando hay cadena: alimenta la frase que dice cuánto se
	 * corrigió, que es la prueba concreta de por qué la fórmula sola no alcanzaba.
	 */
	let tdeeAnteriorKcal = $state<number | null>(null);
	$effect(() => {
		const id = $objetivo?.calibradoDe;
		if (!id) {
			tdeeAnteriorKcal = null;
			return;
		}
		void objetivoAnterior(id).then((previo) => (tdeeAnteriorKcal = previo?.tdeeKcal ?? null));
	});

	/**
	 * Predicciones, no consejos: cada una es verificable y ninguna habla de comida.
	 *
	 * Solo la primera queda a la vista y el resto se pliega. La lista viene ordenada por
	 * lo que más le sirve al usuario hoy, así que la primera es la única que puede pedir
	 * una acción —«hace nueve días que no te pesás»—; las que siguen explican, y explicar
	 * abajo de la cifra son doscientos píxeles de prosa que empujaban la pantalla a un
	 * scroll entero.
	 */
	const frases = $derived(
		frasesPara({
			objetivo: $objetivo,
			pesoActualGramos: resumen.actual?.pesoGramos ?? null,
			fechaUltimoPeso: resumen.actual?.fecha ?? null,
			calibracion: revision,
			tdeeAnteriorKcal,
			unidad,
			hoy: hoyCalendarioLocal()
		}).slice(0, 3)
	);

	/**
	 * Los tres macros de la fila, en el orden en que se resuelven en el motor: la proteína
	 * tiene objetivo propio, la grasa sale de un porcentaje con piso y los carbos son lo
	 * que queda. Ese orden es también el de importancia para quien entrena.
	 *
	 * Se derivan del objetivo guardado, no se leen de la fila: `macros()` es función pura
	 * de (peso, kcal, meta) y los tres campos ya están persistidos. Así la sección y el
	 * asistente no pueden mostrar repartos distintos del mismo objetivo.
	 */
	const macrosVisibles = $derived.by(() => {
		if (!$objetivo || !vista) return [];
		// De `vista` y no de `$objetivo`: mientras se recorre el riel los macros son los de
		// la posición que se está mirando, que es justamente lo que se fue a mirar.
		const { proteinaG, grasaG, carbosG } = macros(
			$objetivo.perfil.pesoGramos / 1000,
			vista.objetivoKcal,
			vista.meta
		);
		return [
			{ rotulo: 'Proteína', gramos: proteinaG },
			{ rotulo: 'Grasa', gramos: grasaG },
			{ rotulo: 'Carbos', gramos: carbosG }
		];
	});

	let cambiando = $state(false);
	let errorCambio = $state<string | null>(null);
	/**
	 * El acuse de que el cambio quedó escrito.
	 *
	 * Hace falta porque al confirmar no se ve pasar nada: la cifra, los macros y el rótulo
	 * ya venían mostrando la posición nueva desde que el dedo la tocó, así que lo único que
	 * cambia en pantalla es que los botones se intercambian. Sin una palabra, tocar
	 * "Cambiar a…" se siente igual que no tocarlo.
	 *
	 * Dice lo mismo y se ve igual que el del asistente a propósito: es el mismo hecho.
	 */
	let cambioGuardado = $state(false);

	/**
	 * Guarda la posición que se está mirando como el objetivo nuevo.
	 *
	 * Dos decisiones que no se ven en el código:
	 *
	 * **No usa `calcularYGuardar`,** que sería lo obvio, porque esa función recalcula el
	 * mantenimiento desde el perfil — y con eso perdería el `tdee` corregido con la
	 * balanza. Va por `guardarObjetivo` con el mantenimiento ya recompuesto.
	 *
	 * **`calibradoDe` se hereda, no se apunta al objetivo que reemplaza.** Ese campo
	 * significa "de acá salió el número calibrado", y lo usan el rótulo "revisado con tu
	 * peso" y la frase que dice cuánto se corrigió. Un cambio de objetivo no es una
	 * revisión —nadie se pesó— pero sí conserva el `tdee` que la revisión dejó, así que
	 * apuntar al eslabón viejo mantiene las dos cosas ciertas: el número sigue siendo el
	 * corregido, y la cadena sigue midiendo la corrección contra el mismo origen.
	 */
	async function aplicarCambio() {
		const m = mantenimientoVigente;
		const destino = vista?.opcion;
		if (!$objetivo || !m || !destino) return;
		const posicion = posiciones.find((p) => p.opcion.id === destino.id);
		if (!posicion) return;

		errorCambio = null;
		cambiando = true;
		try {
			await guardarObjetivo({
				perfil: $objetivo.perfil,
				mantenimiento: m,
				objetivo: posicion.objetivo,
				calibradoDe: $objetivo.calibradoDe
			});
			previsualizado = null;
			cambioGuardado = true;
		} catch {
			errorCambio = 'No pudimos guardar el objetivo nuevo. Recargá la app e intentá de nuevo.';
		} finally {
			cambiando = false;
		}
	}

	const COLOR_TONO = {
		neutro: 'var(--muted)',
		aviso: 'rgb(var(--max))',
		exito: 'rgb(var(--exito))'
	} as const;

	let confirmandoBorrado = $state(false);
	let preguntandoAdherencia = $state(false);

	/**
	 * Borra la cadena entera. Borrar solo el vigente dejaría al anterior en su lugar,
	 * y nadie pidió revivir un objetivo de hace tres meses.
	 */
	async function borrar() {
		if (!confirmandoBorrado) {
			confirmandoBorrado = true;
			return;
		}
		try {
			await borrarObjetivos();
		} catch {
			errorRevision = 'No pudimos borrar el objetivo. Recargá la app e intentá de nuevo.';
		} finally {
			confirmandoBorrado = false;
		}
	}
	let revisando = $state(false);
	let errorRevision = $state<string | null>(null);

	const ADHERENCIAS: Array<{ id: Adherencia; rotulo: string }> = [
		{ id: 'casi_todos', rotulo: 'Casi todos los días' },
		{ id: 'la_mayoria', rotulo: 'La mayoría' },
		{ id: 'menos_de_la_mitad', rotulo: 'Menos de la mitad' }
	];

	async function aplicarRevision(adherencia: Adherencia) {
		if (!$objetivo || revision?.estado !== 'listo' || !resumen.actual) return;
		errorRevision = null;
		const ajuste = calibrar($objetivo.tdeeKcal, revision.tdeeMedido, adherencia);
		if (!ajuste) {
			// Con adherencia baja no se toca el número: el dato no dice lo que parece decir.
			preguntandoAdherencia = false;
			errorRevision =
				'Sin haber seguido el objetivo la mayoría de los días, tu peso no dice si la cuenta estaba bien o mal. Dejamos el número como está.';
			return;
		}
		revisando = true;
		try {
			const nuevo = await guardarRevision($objetivo, ajuste.tdeeNuevo, resumen.actual.pesoGramos);
			if (!nuevo) errorRevision = 'No pudimos guardar la revisión. Revisá tus datos.';
			else preguntandoAdherencia = false;
		} catch {
			errorRevision = 'No pudimos guardar la revisión. Recargá la app e intentá de nuevo.';
		} finally {
			revisando = false;
		}
	}

	function kgTexto(kg: number, conSigno = true): string {
		const visible = unidad === 'kg' ? kg : kg * KG_TO_LB;
		const signo = conSigno ? (visible > 0 ? '+' : visible < 0 ? '−' : '') : '';
		return `${signo}${Math.abs(visible).toFixed(2).replace('.', ',')}`;
	}

	function cambio(gramos: number | null): string | null {
		if (gramos == null) return null;
		const visible = gramosAPeso(Math.abs(gramos), unidad);
		if (visible == null) return null;
		const signo = gramos > 0 ? '+' : gramos < 0 ? '−' : '';
		return `${signo}${formatoNumero(visible)} ${unidad}`;
	}
</script>

<main
	class="gb-page glow-bg flex min-h-[calc(100dvh-4rem-env(safe-area-inset-bottom,0px))] flex-col px-4 pb-8 pt-3"
>
	<header class="mb-3 flex min-h-10 items-center justify-between gap-3">
		<h1 class="text-xl font-extrabold">Macros</h1>
	</header>

	<!-- ===== Revisión, cuando hay algo que decir ===== -->
	{#if $objetivo && revision && revision.estado !== 'esperando'}
		<section
			class="gb-foco mb-3 rounded-2xl py-4 pl-5 pr-4"
			style="--foco-color: {revision.estado === 'listo' ? 'var(--exito)' : 'var(--glow)'}"
		>
			<p class="text-[0.6rem] font-bold uppercase tracking-[0.06em]" style="color: var(--muted)">
				{revision.estado === 'listo' ? 'Hora de revisar' : 'Todavía no'}
			</p>

			{#if revision.estado === 'listo'}
				<p class="mt-1 flex items-baseline">
					<span class="cifra text-[3rem]"
						>{kgTexto(revision.cambioKg)}<span class="cifra-u">{unidad}</span></span
					>
				</p>
				<p class="mt-1 text-xs leading-relaxed" style="color: var(--muted)">
					En {revision.dias} días te moviste a {kgTexto(revision.kgPorSemana)}
					{unidad} por semana. Con tu peso real, tu mantenimiento parece estar cerca de {formatoVolumen(
						revision.tdeeMedido
					)} kcal.
				</p>

				{#if preguntandoAdherencia}
					<p class="mt-3 text-sm font-semibold">
						¿Cuántos días de este período apuntaste al objetivo?
					</p>
					<div class="mt-2 flex flex-col gap-2">
						{#each ADHERENCIAS as opcion (opcion.id)}
							<button
								onclick={() => aplicarRevision(opcion.id)}
								disabled={revisando}
								class="min-h-14 rounded-xl px-4 text-left text-sm font-semibold disabled:opacity-50"
								style="background: var(--surface-3)">{opcion.rotulo}</button
							>
						{/each}
					</div>
					<p class="mt-2 text-[0.7rem] leading-relaxed" style="color: var(--muted)">
						Hace falta porque la app no ve lo que comés: sin esto, «no bajaste» y «no seguiste el
						objetivo» son la misma observación.
					</p>
				{:else}
					<button
						onclick={() => (preguntandoAdherencia = true)}
						class="gb-relieve mt-3 min-h-14 w-full rounded-2xl text-base font-bold"
						style="background: var(--accent); color: var(--on-accent)">Revisar con mi peso</button
					>
				{/if}
			{:else if revision.estado === 'sin-senal'}
				<p class="mt-1.5 text-sm leading-relaxed">
					Todavía no puedo distinguir tu tendencia del ruido de la balanza. Vas a
					{kgTexto(revision.kgPorSemana)}
					{unidad} por semana, con un margen de ±{kgTexto(revision.errorKgPorSemana, false)}: el
					margen se come la señal. Pesate unos días más y vuelvo a mirar.
				</p>
			{:else}
				<p class="mt-1.5 text-sm leading-relaxed">
					Van {revision.ventana.pesajes} mediciones en este período y hacen falta al menos {revision.minimo}.
					Cuantos más días te peses, antes puedo corregir el número.
				</p>
			{/if}

			{#if errorRevision}
				<p
					class="mt-3 flex gap-2 rounded-xl border p-3 text-xs leading-relaxed"
					style="border-color: rgb(var(--max) / .35); background: rgb(var(--max) / .08); color: rgb(var(--max))"
				>
					<Icono nombre="aviso" tamano={16} clase="mt-px shrink-0" />
					<span>{errorRevision}</span>
				</p>
			{/if}
		</section>
	{/if}

	<!--
		===== Objetivo y peso, en una sola tarjeta =====

		Eran dos bloques sueltos: la tarjeta del objetivo arriba y la franja de peso abajo,
		anclada al fondo de la pantalla. El anclaje resolvía el pozo muerto pero dejaba la
		franja flotando sola, con un vacío arriba que la desconectaba de todo.

		Ahora son una sola superficie: el peso es el pie de la tarjeta del objetivo, separado
		por una línea. Que vayan juntos además es cierto — el peso no es otro tema, es el dato
		que corrige este objetivo. Estaban separados por accidente de layout, no por sentido.

		Y la tarjeta **no** se estira a llenar la pantalla, que fue el intento anterior. Medido
		en un teléfono de 393 px: el contenido son 461 px y el espacio disponible 692, así que
		estirarla metía 173 px de hueco adentro de la tarjeta (463 px cuando todavía no hay
		objetivo). Eso no elimina el vacío, lo muda de afuera a adentro y encima lo enmarca.
		Con alto natural, lo que queda abajo es fondo de página. Y ese fondo se reparte: `my-auto`
		centra la tarjeta en el aire que sobra, así que en vez de 165 px muertos abajo quedan
		~82 arriba y ~82 abajo. Es margen y no `justify-center` a propósito — cuando el
		contenido pasa de largo, `justify-center` recorta por arriba y el margen automático
		simplemente vale cero.
	-->
	<div
		class="gb-relieve my-auto rounded-2xl border border-white/10"
		style="background: var(--surface)"
	>
		{#if $objetivo}
			<section class="p-4">
				<!--
				El riel manda sobre toda la tarjeta, así que va a la cabeza, igual que en el
				resultado del asistente. Con una sola posición no hay nada que recorrer.
			-->
				{#if paradas.length > 1}
					<div class="mb-3">
						<RielObjetivo
							{paradas}
							valor={previsualizado ?? idVigente ?? ''}
							vibracion={$ajustes.vibracion}
							etiqueta="Cambiar de objetivo"
							onElegir={(id) => {
								previsualizado = id;
								// Volver a recorrer deja atrás el acuse: ya no describe lo que se ve.
								cambioGuardado = false;
							}}
						/>
					</div>
				{/if}

				<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
					<!-- En previsualización el rótulo dice lo que se está mirando, no lo guardado; y
				     "revisado con tu peso" habla del mantenimiento, que no cambia al recorrer. -->
					{vista?.rotulo}{$objetivo.calibradoDe ? ' · revisado con tu peso' : ''}
				</p>
				<p class="mt-1 flex items-baseline">
					<span class="cifra text-[4.2rem]"
						>{formatoVolumen(vista?.objetivoKcal ?? $objetivo.objetivoKcal)}<span class="cifra-u"
							>kcal</span
						></span
					>
				</p>

				<!--
				Los tres macros, y los tres siempre.

				Antes esta fila entera vivía dentro de un `{#if meta !== 'mantener'}`, así que
				quien elegía mantenimiento entraba a una sección llamada Macros y no veía ni uno:
				el asistente le había mostrado su proteína, la fila guardada la tenía, y la
				pantalla la tapaba. Lo único que de verdad no aplica en mantenimiento es el ritmo,
				y ese se esconde solo, más abajo.
			-->
				<div class="mt-4 grid grid-cols-3 gap-2">
					{#each macrosVisibles as macro (macro.rotulo)}
						<div class="min-w-0">
							<p
								class="text-[0.6rem] font-bold uppercase tracking-[0.06em]"
								style="color: var(--muted)"
							>
								{macro.rotulo}
							</p>
							<p class="cifra text-2xl">{macro.gramos}<span class="cifra-u">g</span></p>
						</div>
					{/each}
				</div>

				<!--
				Contra qué se compara, cuánto te corrés y a qué velocidad. En mantenimiento la fila
				entera se va, porque las tres son degeneradas: el objetivo *es* el mantenimiento,
				la diferencia es cero y el ritmo también.

				**La diferencia es la celda que reemplazó al riel de banda**, que dibujaba dónde
				caía el objetivo contra la banda del mantenimiento en 5 px, con una leyenda de tres
				ítems que pesaba más que el dibujo — y que acá vivía todavía peor, porque la frase
				que lo explicaba está plegada adentro de "¿De dónde sale este número?".

				La banda no se perdió: esa misma frase la da con números ("2 de cada 3 personas
				están entre X e Y"), que es más de lo que se podía leer del gráfico.
			-->
				{#if vista?.meta !== 'mantener'}
					<div class="mt-3 grid grid-cols-3 gap-2">
						<div class="min-w-0">
							<p
								class="text-[0.6rem] font-bold uppercase tracking-[0.06em]"
								style="color: var(--muted)"
							>
								Mantenimiento
							</p>
							<p class="cifra text-xl">
								{formatoVolumen($objetivo.tdeeKcal)}<span class="cifra-u">kcal</span>
							</p>
						</div>
						<div class="min-w-0">
							<p
								class="text-[0.6rem] font-bold uppercase tracking-[0.06em]"
								style="color: var(--muted)"
							>
								Diferencia
							</p>
							<p class="cifra text-xl">{diferenciaTexto}<span class="cifra-u">kcal</span></p>
						</div>
						<div class="min-w-0">
							<p
								class="text-[0.6rem] font-bold uppercase tracking-[0.06em]"
								style="color: var(--muted)"
							>
								Ritmo
							</p>
							<p class="cifra text-xl">{ritmoTexto}<span class="cifra-u">{unidad}/sem</span></p>
						</div>
					</div>
				{/if}

				<!--
					Las dos caras del área de acción, apiladas en la misma celda de una grilla.

					No es un `{#if}` que cambia una por otra porque eso hacía saltar la tarjeta:
					medido, previsualizar la estiraba de 519 a 577 px y, como está centrada, la subía
					29 px — o sea el riel se movía abajo del dedo justo mientras lo estabas usando.

					Apiladas, la celda mide lo del más alto y la altura no cambia nunca. La cara que
					no corresponde va con `invisible`, que además la saca del árbol de accesibilidad
					y del orden de tabulación: no es una que está ahí y no se ve, es una que no está.

					El costo, declarado: en el estado normal quedan ~57 px de aire abajo de "Cambiar
					mis datos". Es el precio de que el control no se mueva mientras lo usás.
				-->
				<div class="grid">
					<div
						class="col-start-1 row-start-1 {vista?.enPrevisualizacion ? '' : 'invisible'}"
						aria-hidden={vista?.enPrevisualizacion ? undefined : 'true'}
					>
						<!--
							Previsualizar no escribe nada, y por eso hay un botón: mientras el dedo recorre
							el riel, esta tarjeta muestra un objetivo que la base no tiene. Guardar es un
							acto aparte y con nombre propio.

							Y dice lo que cuesta. Cada objetivo guardado es una fila nueva, y la ventana de
							revisión arranca en su fecha: cambiar de objetivo pone el reloj en cero. Esa es
							la razón de fondo por la que el riel no guarda solo — si lo hiciera, recorrerlo
							reiniciaría la calibración en cada muesca y la sección nunca llegaría a decir
							"hora de revisar".
						-->
						<button
							onclick={aplicarCambio}
							disabled={cambiando}
							class="gb-relieve mt-4 min-h-14 w-full rounded-2xl text-base font-bold disabled:opacity-50"
							style="background: var(--accent); color: var(--on-accent)"
							>Cambiar a {vista?.rotulo}</button
						>
						<button
							onclick={() => (previsualizado = null)}
							class="mt-2 min-h-12 w-full rounded-2xl text-sm font-bold"
							style="background: var(--surface-3); color: var(--text)">Dejar el que tenía</button
						>
						<p class="mt-2 text-[0.7rem] leading-relaxed" style="color: var(--muted)">
							{#if revision?.estado === 'listo'}
								Ojo: tenés una revisión lista con tu peso de estos días. Si cambiás de objetivo
								ahora, esa medición se pierde y la cuenta vuelve a empezar.
							{:else}
								Cambiar de objetivo reinicia la cuenta para revisarlo con tu peso.
							{/if}
						</p>
					</div>

					<div
						class="col-start-1 row-start-1 {vista?.enPrevisualizacion ? 'invisible' : ''}"
						aria-hidden={vista?.enPrevisualizacion ? 'true' : undefined}
					>
						<!--
							El acuse **reemplaza** a la frase, no se apila encima: sumados hacían crecer la
							tarjeta otros ~70 px justo después de guardar, que es el mismo salto que este
							bloque está para evitar. Y es lo correcto de leer igual — recién guardado, lo
							que hay que decir es que se guardó; la predicción vuelve sola en la próxima.
						-->
						{#if cambioGuardado}
							<p
								class="mt-4 flex min-h-14 items-center justify-center gap-2 rounded-2xl text-sm font-bold"
								style="background: rgb(var(--exito) / .14); color: rgb(var(--exito))"
								aria-live="polite"
							>
								<Icono nombre="hecha" tamano={18} />
								Guardado como tu objetivo
							</p>
						{:else if frases[0]}
							<!-- La primera frase queda a la vista: es la única de la lista que puede pedir
							     una acción. Las que siguen explican y viven abajo, plegadas. -->
							<p class="mt-3 text-xs leading-relaxed" style="color: {COLOR_TONO[frases[0].tono]}">
								{frases[0].texto}
							</p>
						{/if}

						<!--
							Antes decía "Cambiar objetivo". El objetivo ahora se cambia con el riel de
							arriba, así que lo que queda atrás de este botón es lo otro: los datos con los
							que se calculó todo.

							Por eso entra en el paso 4 y no en el 1: desde ahí los tres pasos de datos están
							contraídos y se abren de un toque.
						-->
						<a
							href="/herramientas/calorias?paso=4"
							class="mt-4 flex min-h-12 items-center justify-center rounded-2xl text-sm font-bold"
							style="background: var(--surface-3); color: var(--text)">Cambiar mis datos</a
						>
					</div>
				</div>

				{#if errorCambio}
					<p
						class="mt-3 flex gap-2 rounded-xl border p-3 text-xs leading-relaxed"
						style="border-color: rgb(var(--max) / .35); background: rgb(var(--max) / .08); color: rgb(var(--max))"
					>
						<Icono nombre="aviso" tamano={16} clase="mt-px shrink-0" />
						<span>{errorCambio}</span>
					</p>
				{/if}

				<!--
				Todo lo que explica el número, plegado.

				No es prosa de relleno y por eso no se borra: la banda, el porqué de la proteína y
				las predicciones son lo que separa esta sección de una calculadora. Pero son ~200 px
				de texto de 12 px abajo de la cifra, y abiertos empujaban la pantalla a un scroll
				entero. Quien quiere el número lo tiene arriba; quien quiere la razón, la abre.
			-->
				<details class="mt-2 rounded-2xl" style="background: var(--surface-2)">
					<summary
						class="flex min-h-12 cursor-pointer items-center justify-between px-4 text-sm font-bold"
						>¿De dónde sale este número?<Icono
							nombre="info"
							tamano={18}
							clase="shrink-0"
						/></summary
					>
					<div class="px-4 pb-4">
						{#if banda}
							<p class="text-xs leading-relaxed" style="color: var(--muted)">
								Tu mantenimiento estimado es {formatoVolumen($objetivo.tdeeKcal)} kcal. 2 de cada 3 personas
								con tu perfil están entre {formatoVolumen(banda.desde)} y {formatoVolumen(
									banda.hasta
								)}. Es una cuenta, no una medición.
							</p>
						{/if}

						<p class="mt-3 text-xs leading-relaxed" style="color: var(--muted)">
							La proteína es un piso y sale de tu peso: {fraseProteina($objetivo)} La grasa es el 25 %
							de las calorías, con un piso por kilo, y los carbos son lo que queda — son la palanca que
							sostiene el entrenamiento.
						</p>

						{#each frases.slice(1) as frase (frase.id)}
							<p class="mt-3 text-xs leading-relaxed" style="color: {COLOR_TONO[frase.tono]}">
								{frase.texto}
							</p>
						{/each}

						<!-- Acción secundaria, discreta: no compite con nada y se confirma en dos toques. -->
						<button
							onclick={borrar}
							class="mt-4 min-h-11 text-xs font-bold"
							style="color: {confirmandoBorrado ? 'rgb(var(--max))' : 'var(--muted)'}"
							>{confirmandoBorrado ? 'Tocá otra vez para borrarlo' : 'Borrar objetivo'}</button
						>
					</div>
				</details>
			</section>
		{:else}
			<section class="p-4">
				<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
					Objetivo de calorías
				</p>
				<p class="mt-1.5 text-sm leading-relaxed">
					Todavía no calculaste el tuyo. Son cuatro pantallas y usa el peso que ya registrás.
				</p>
				<a
					href="/herramientas/calorias"
					class="gb-relieve mt-4 flex min-h-14 items-center justify-center rounded-2xl text-base font-bold"
					style="background: var(--accent); color: var(--on-accent)">Calcular mi objetivo</a
				>
			</section>
		{/if}

		<!--
			El peso, como pie de la tarjeta y no como tarjeta propia.

			Acá el peso no es el tema: es el dato que corrige el objetivo y la puerta a /peso,
			que es donde vive de verdad. Como tarjeta se llevaba ~190 px —rótulo, cifra de
			2,6 rem, deltas y un botón a ancho completo— para decir tres números y abrir un link.

			Va pegado al final de la tarjeta, con una línea arriba y la superficie un tono más
			clara: se lee como el pie de lo que está arriba y no como una tarjeta huérfana.
		-->
		<a
			href="/peso"
			class="flex min-h-14 items-center gap-3 rounded-b-2xl border-t border-white/10 px-4"
			style="background: var(--surface-2)"
		>
			{#if resumen.actual}
				<span
					class="text-[0.6rem] font-bold uppercase tracking-[0.06em]"
					style="color: var(--muted)">Peso hoy</span
				>
				<span class="cifra shrink-0 text-xl"
					>{formatoNumero(gramosAPeso(resumen.actual.pesoGramos, unidad)!)}<span class="cifra-u"
						>{unidad}</span
					></span
				>
				<span class="ml-auto flex shrink-0 gap-3 text-xs" style="color: var(--muted)">
					{#if cambio(resumen.cambio7DiasGramos)}
						<span>7 d <b style="color: var(--text)">{cambio(resumen.cambio7DiasGramos)}</b></span>
					{/if}
					{#if cambio(resumen.cambio30DiasGramos)}
						<span>30 d <b style="color: var(--text)">{cambio(resumen.cambio30DiasGramos)}</b></span>
					{/if}
				</span>
			{:else}
				<span class="text-sm font-bold">Registrar mi primer peso</span>
				<span class="ml-auto text-xs" style="color: var(--muted)">corrige tu objetivo</span>
			{/if}
		</a>
	</div>
</main>
