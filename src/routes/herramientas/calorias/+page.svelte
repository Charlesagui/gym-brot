<script lang="ts">
	import { browser } from '$app/environment';
	import Icono from '$lib/components/Icono.svelte';
	import RielBanda from '$lib/components/RielBanda.svelte';
	import RielObjetivo, {
		type ParadaObjetivo,
		type TonoObjetivo
	} from '$lib/components/RielObjetivo.svelte';
	import Stepper from '$lib/components/Stepper.svelte';
	import {
		calcularMantenimiento,
		calcularObjetivo,
		macros,
		restricciones,
		ritmosDisponibles,
		type AvisoEnergia,
		type Condicion,
		type Densidad,
		type Duracion,
		type Ecuacion,
		type Mantenimiento,
		type Meta,
		type MotivoAviso,
		type Objetivo,
		type Ocupacion,
		type BandaPasos,
		type PerfilEnergia
	} from '$lib/energia';
	import { AJUSTES_DEFAULT, ajustesObs } from '$lib/extras';
	import { formatoNumero, formatoVolumen } from '$lib/formato';
	import { fromLiveQuery } from '$lib/live';
	import {
		calcularYGuardar,
		frecuenciaSemanalReciente,
		perfilGuardado,
		pesoRecienteGramos
	} from '$lib/perfil-energia';
	import { gramosAPeso, KG_TO_LB, pesoAGramos } from '$lib/unidades';

	const ajustes = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const unidad = $derived($ajustes.unidad);

	// --- opciones, con el rótulo que se ve y el que resume el paso ya contestado ---
	const ECUACIONES: Array<{ id: Ecuacion; rotulo: string }> = [
		{ id: 'masculina', rotulo: 'Masculina' },
		{ id: 'femenina', rotulo: 'Femenina' },
		{ id: 'promedio', rotulo: 'Promedio de las dos' }
	];
	const OCUPACIONES: Array<{ id: Ocupacion; rotulo: string; corto: string }> = [
		{ id: 'sentado', rotulo: 'Sentado casi todo el día', corto: 'Sentado' },
		{ id: 'mixto', rotulo: 'Mitad sentado, mitad de pie', corto: 'Mixto' },
		{ id: 'activo', rotulo: 'De pie o caminando casi todo el día', corto: 'De pie' },
		{ id: 'fisico', rotulo: 'Trabajo físico con carga', corto: 'Físico' }
	];
	const PASOS: Array<{ id: BandaPasos; rotulo: string }> = [
		{ id: 'menos4k', rotulo: 'Menos de 4.000' },
		{ id: 'de4a7k', rotulo: '4.000 a 7.000' },
		{ id: 'de7a10k', rotulo: '7.000 a 10.000' },
		{ id: 'de10a14k', rotulo: '10.000 a 14.000' },
		{ id: 'mas14k', rotulo: 'Más de 14.000' },
		{ id: 'nose', rotulo: 'No sé' }
	];
	const DURACIONES: Array<{ id: Duracion; rotulo: string; corto: string }> = [
		{ id: 'corta', rotulo: 'Menos de 45 min', corto: '−45 min' },
		{ id: 'media', rotulo: '45 a 75 min', corto: '45–75 min' },
		{ id: 'larga', rotulo: 'Más de 75 min', corto: '+75 min' }
	];
	const DENSIDADES: Array<{ id: Densidad; rotulo: string; corto: string }> = [
		{ id: 'descansos', rotulo: 'Descansos largos entre series pesadas', corto: 'Descansos largos' },
		{ id: 'normal', rotulo: 'Ritmo normal', corto: 'Ritmo normal' },
		{ id: 'circuito', rotulo: 'Casi sin descanso, circuitos', corto: 'Circuitos' }
	];

	/**
	 * Los cinco de siempre. El orden es el de la conversación: bajar, quedarse, subir —
	 * y también el del riel, que por eso puede recorrerlos con el dedo sin reordenar nada.
	 *
	 * `marca` es lo que entra en una muesca de ~60 px. El nombre entero no entra y tampoco
	 * hace falta: arriba de la cifra ya está, y al lector de pantalla le llega por
	 * `aria-label`. El signo es el menos tipográfico (−), el mismo que usa el ritmo.
	 */
	const OBJETIVOS: Array<{
		id: string;
		rotulo: string;
		marca: string;
		meta: Meta;
		nivel: 'moderado' | 'agresivo' | null;
	}> = [
		{
			id: 'bajar-agresivo',
			rotulo: 'Déficit agresivo',
			marca: '−−',
			meta: 'bajar',
			nivel: 'agresivo'
		},
		{
			id: 'bajar-moderado',
			rotulo: 'Déficit moderado',
			marca: '−',
			meta: 'bajar',
			nivel: 'moderado'
		},
		{ id: 'mantener', rotulo: 'Mantenimiento', marca: '=', meta: 'mantener', nivel: null },
		{
			id: 'subir-moderado',
			rotulo: 'Volumen moderado',
			marca: '+',
			meta: 'subir',
			nivel: 'moderado'
		},
		{
			id: 'subir-agresivo',
			rotulo: 'Volumen agresivo',
			marca: '++',
			meta: 'subir',
			nivel: 'agresivo'
		}
	];

	/**
	 * El tono es el nivel, y por eso se deriva en vez de escribirse en la tabla: son la
	 * misma información y dos copias se despegan. Tres tonos y no cinco a propósito —
	 * el color dice cuánto empuja el objetivo, no cuál de los cinco es.
	 */
	function tonoDe(nivel: 'moderado' | 'agresivo' | null): TonoObjetivo {
		if (nivel === null) return 'calmo';
		return nivel === 'moderado' ? 'normal' : 'fuerte';
	}

	const TEXTO_AVISO: Record<MotivoAviso, string> = {
		'sobre-tope-imc':
			'Con tu peso actual este ritmo es más rápido de lo que conviene: vas a perder músculo junto con la grasa.',
		'musculo-y-rendimiento':
			'Un déficit rápido cuesta algo de masa magra y el entrenamiento se siente peor. Sirve por bloques cortos, no como forma de vida.',
		'grasa-de-mas': 'Subir más rápido no te va a hacer ganar más músculo, solo más grasa.'
	};

	// --- estado del asistente ---
	let paso = $state<1 | 2 | 3 | 4>(1);
	let mostrandoResultado = $state(false);
	let guardado = $state(false);
	let errorGuardado = $state<string | null>(null);

	let edad = $state<number | undefined>(30);
	let alturaCm = $state<number | undefined>(170);
	/**
	 * Gramos, como el resto de la app. Antes esto era el número visible más la unidad
	 * leída aparte, y cambiar de kg a lb en Ajustes reinterpretaba el mismo 82: el
	 * mantenimiento pasaba de 2.890 a 2.190 kcal sin que nadie tocara el peso.
	 */
	let pesoGramos = $state<number | undefined>(undefined);
	let ecuacion = $state<Ecuacion>('masculina');
	let ocupacion = $state<Ocupacion>('sentado');
	let bandaPasos = $state<BandaPasos>('de4a7k');
	let sesionesSemana = $state<number | undefined>(3);
	let duracion = $state<Duracion>('media');
	let densidad = $state<Densidad>('normal');
	let objetivoElegido = $state<string>('bajar-moderado');

	/**
	 * Lo declarado no se guarda en ninguna parte: vive en esta variable mientras la
	 * pantalla está abierta y se olvida al salir. Alcanza para decidir qué se ofrece.
	 */
	let condiciones = $state<Condicion[]>([]);

	const CONDICIONES: Array<{ id: Condicion; rotulo: string }> = [
		{ id: 'embarazo', rotulo: 'Estoy embarazada o amamantando' },
		{ id: 'trastorno-alimentario', rotulo: 'Tuve un trastorno alimentario' },
		{ id: 'medica', rotulo: 'Tengo una condición médica o tomo medicación que afecta el peso' }
	];

	const MOTIVO_RECORTE: Record<'embarazo' | 'trastorno-alimentario' | 'imc-bajo', string> = {
		embarazo:
			'Durante el embarazo y la lactancia las necesidades se calculan distinto. La app no propone déficit ni volumen.',
		'trastorno-alimentario': 'Con ese antecedente la app no propone objetivos de déficit.',
		'imc-bajo': 'Con tu peso actual la app no propone déficit.'
	};

	function alternarCondicion(id: Condicion) {
		condiciones = condiciones.includes(id)
			? condiciones.filter((c) => c !== id)
			: [...condiciones, id];
	}

	/** De dónde salió el prellenado, para poder decirlo en pantalla. */
	let pesoDeLaApp = $state(false);
	let frecuenciaDeLaApp = $state(false);
	let prellenadoHecho = $state(false);

	$effect(() => {
		if (!browser || prellenadoHecho) return;
		prellenadoHecho = true;
		void prellenar();
	});

	async function prellenar() {
		const [perfil, gramos, frecuencia] = await Promise.all([
			perfilGuardado(),
			pesoRecienteGramos(),
			frecuenciaSemanalReciente()
		]);
		if (perfil) {
			edad = perfil.edad;
			alturaCm = perfil.alturaCm;
			ecuacion = perfil.ecuacion;
			ocupacion = perfil.ocupacion;
			bandaPasos = perfil.pasos;
			duracion = perfil.duracion;
			densidad = perfil.densidad;
			sesionesSemana = perfil.sesionesSemana;
			pesoGramos = perfil.pesoGramos;
		}
		// Una medición reciente le gana al peso congelado en el objetivo: es más nueva.
		// Sin este orden, quien nunca registró un peso en /peso volvía a encontrar el
		// campo vacío en cada visita, aunque ya hubiera calculado su objetivo.
		if (gramos != null) {
			pesoGramos = gramos;
			pesoDeLaApp = true;
		}
		if (frecuencia > 0) {
			sesionesSemana = frecuencia;
			frecuenciaDeLaApp = true;
		}
	}

	const pesoVisible = $derived(gramosAPeso(pesoGramos, unidad));

	/** Mueve el peso en la unidad visible y lo vuelve a guardar en gramos. */
	function moverPeso(visible: number | undefined) {
		if (visible == null || !Number.isFinite(visible)) return;
		pesoGramos = pesoAGramos(Math.round(visible * 10) / 10, unidad);
		pesoDeLaApp = false;
	}

	const perfil = $derived<PerfilEnergia | null>(
		edad != null && alturaCm != null && pesoGramos != null && sesionesSemana != null
			? {
					edad,
					alturaCm,
					pesoGramos,
					ecuacion,
					ocupacion,
					pasos: bandaPasos,
					sesionesSemana,
					duracion,
					densidad
				}
			: null
	);

	const mantenimiento = $derived(perfil ? calcularMantenimiento(perfil) : null);
	const listo = $derived<Mantenimiento | null>(
		mantenimiento?.estado === 'calculado' ? mantenimiento : null
	);

	/** Los cinco botones ya resueltos: cada uno sabe su número antes de tocarlo. */
	interface Boton {
		id: string;
		rotulo: string;
		marca: string;
		tono: TonoObjetivo;
		meta: Meta;
		objetivo: Objetivo | null;
		aviso: MotivoAviso | null;
		bloqueado: boolean;
		/**
		 * El ritmo canónico del menú, no el que salió del cálculo. Guardar con el
		 * calculado —que viene redondeado por el objetivo en kcal— hacía que el nivel
		 * no coincidiera con la tabla y el objetivo quedara rotulado "a medida".
		 */
		ritmoPedido: number;
	}

	const limites = $derived(listo ? restricciones(listo.imc, condiciones) : null);

	const botones = $derived<Boton[]>(
		listo && limites
			? OBJETIVOS.filter(({ meta }) => limites.metas.includes(meta)).map(
					({ id, rotulo, marca, meta, nivel }) => {
						// Lo que la posición es antes de saber cuánto da: identidad, no resultado.
						const base = { id, rotulo, marca, tono: tonoDe(nivel), meta };

						if (meta === 'mantener') {
							const r = calcularObjetivo(listo, 'mantener', 0);
							return {
								...base,
								objetivo: r.estado === 'calculado' ? r : null,
								aviso: null,
								bloqueado: false,
								ritmoPedido: 0
							};
						}
						const opcion = ritmosDisponibles(meta, listo.imc).find((o) => o.id === nivel);
						if (!opcion)
							return { ...base, objetivo: null, aviso: null, bloqueado: true, ritmoPedido: 0 };
						const r = calcularObjetivo(listo, meta, opcion.pctSemana);
						return {
							...base,
							objetivo: r.estado === 'calculado' ? r : null,
							aviso: opcion.aviso,
							bloqueado: r.estado !== 'calculado',
							ritmoPedido: opcion.pctSemana
						};
					}
				)
			: []
	);

	/**
	 * Si el objetivo elegido deja de estar disponible —bajar de peso con IMC bajo 18,5—
	 * la selección cae en mantenimiento. Dejarla apuntando a un botón inerte muestra un
	 * "Continuar" apagado sin decir por qué.
	 */
	$effect(() => {
		const elegido = botones.find((b) => b.id === objetivoElegido);
		if (botones.length > 0 && (!elegido || elegido.bloqueado)) objetivoElegido = 'mantener';
	});

	const botonElegido = $derived(botones.find((b) => b.id === objetivoElegido) ?? null);
	const objetivo = $derived(botonElegido?.objetivo ?? null);

	/** El canto del paso abierto: naranja cuando lo elegido merece advertencia. */
	const focoColor = $derived(paso === 4 && botonElegido?.aviso ? 'var(--max)' : 'var(--glow)');

	/**
	 * Las mismas cinco posiciones, en la forma que come el riel. Es una vista de `botones`
	 * y no una lista propia: si una posición se retira porque lo declarado la retira, se
	 * retira del riel en el mismo momento y por la misma razón.
	 */
	const paradas = $derived<ParadaObjetivo[]>(
		botones.map(({ id, rotulo, marca, tono, bloqueado }) => ({
			id,
			rotulo,
			marca,
			tono,
			disponible: !bloqueado
		}))
	);

	/**
	 * Moverse por el riel del resultado.
	 *
	 * Lo único que agrega sobre asignar la elección es apagar el acuse de guardado: sin
	 * esto, quien guarda y después desliza se queda mirando "Guardado como tu objetivo"
	 * arriba de un objetivo que no guardó. El cartel diría la verdad sobre el estado de la
	 * base y una mentira sobre lo que está en pantalla, que es lo que la persona lee.
	 */
	function elegirEnResultado(id: string) {
		objetivoElegido = id;
		guardado = false;
		errorGuardado = null;
	}

	// --- resúmenes de los pasos ya contestados ---
	const resumen = $derived([
		`${edad ?? '—'} a · ${alturaCm ?? '—'} cm · ${pesoVisible != null ? formatoNumero(pesoVisible) : '—'} ${unidad}`,
		`${OCUPACIONES.find((o) => o.id === ocupacion)?.corto} · ${PASOS.find((p) => p.id === bandaPasos)?.rotulo} pasos`,
		`${sesionesSemana ?? '—'} por semana · ${DURACIONES.find((d) => d.id === duracion)?.corto} · ${DENSIDADES.find((d) => d.id === densidad)?.corto}`,
		botonElegido?.rotulo ?? '—'
	]);

	const PENDIENTES = [
		'',
		'Tu día — trabajo y pasos',
		'Tu entrenamiento — cuánto y cómo',
		'Tu objetivo — bajar, mantener o subir'
	];
	const TITULOS = ['Vos', 'Tu día', 'Tu entrenamiento', 'Tu objetivo'];

	function pasoEntero(valor: number | undefined, delta: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, Math.round((valor ?? min) + delta)));
	}

	function leerEntero(texto: string, min: number, max: number): number | undefined {
		const n = Number.parseInt(texto.replace(/[^\d]/g, ''), 10);
		if (!Number.isFinite(n)) return undefined;
		return Math.min(max, Math.max(min, n));
	}

	function avanzar() {
		if (paso < 4) paso = (paso + 1) as 1 | 2 | 3 | 4;
		else mostrandoResultado = true;
	}

	function abrir(n: 1 | 2 | 3 | 4) {
		mostrandoResultado = false;
		guardado = false;
		paso = n;
	}

	async function guardar() {
		if (!perfil || !botonElegido?.objetivo) return;
		errorGuardado = null;
		try {
			// El ritmo del menú, no el que devolvió el cálculo: es el mismo con el que se
			// armó el botón que el usuario tocó.
			const fila = await calcularYGuardar(perfil, botonElegido.meta, botonElegido.ritmoPedido);
			guardado = fila != null;
			if (!fila)
				errorGuardado = 'No pudimos guardar el objetivo. Revisá los datos e intentá de nuevo.';
		} catch {
			errorGuardado = 'No pudimos guardar el objetivo. Recargá la app e intentá de nuevo.';
		}
	}

	/** El ritmo en la unidad visible, con dos decimales: 0,4 kg/sem redondea de más. */
	const ritmoVisible = $derived(
		objetivo ? (unidad === 'kg' ? objetivo.kgPorSemana : objetivo.kgPorSemana * KG_TO_LB) : 0
	);
	const ritmoTexto = $derived(
		`${ritmoVisible > 0 ? '+' : ritmoVisible < 0 ? '−' : ''}${Math.abs(ritmoVisible).toFixed(2).replace('.', ',')}`
	);

	/**
	 * Los tres macros del objetivo elegido, en el orden en que los resuelve el motor.
	 * Salen de la misma función que usa la sección: si divergieran, el reparto que
	 * guardás y el que después ves en Macros no serían el mismo.
	 */
	const macrosVisibles = $derived.by(() => {
		if (!objetivo || !listo) return [];
		const { proteinaG, grasaG, carbosG } = macros(listo.kg, objetivo.objetivoKcal, objetivo.meta);
		return [
			{ rotulo: 'Proteína', gramos: proteinaG },
			{ rotulo: 'Grasa', gramos: grasaG },
			{ rotulo: 'Carbos', gramos: carbosG }
		];
	});

	/** Solo los avisos que le sirven a la persona; el resto es diagnóstico interno. */
	const avisosVisibles = $derived<AvisoEnergia[]>(
		(objetivo?.avisos ?? [])
			.concat(listo?.avisos ?? [])
			.filter((a) => a.tipo !== 'contraste-divergente' && a.tipo !== 'ajuste-recortado')
			// `ritmo-sobre-tope` y el nivel `sobre-tope-imc` son la misma observación contada
			// dos veces: el motor la emite cuando el ritmo pasa el tope por IMC, y
			// `ritmosDisponibles` marca esa misma opción. Con los ritmos de hoy sólo puede
			// pasarle al agresivo —el tope mínimo es 0,5 y el moderado pide exactamente
			// 0,5—, pero el filtro no se apoya en esa aritmética: pregunta si la advertencia
			// del nivel ya la está diciendo. Si mañana el moderado se pasa del tope, el
			// aviso del motor aparece solo, que es lo que corresponde.
			.filter((a) => !(a.tipo === 'ritmo-sobre-tope' && botonElegido?.aviso === 'sobre-tope-imc'))
	);

	function textoAvisoObjetivo(aviso: AvisoEnergia): string {
		switch (aviso.tipo) {
			case 'ritmo-sobre-tope':
				return TEXTO_AVISO['sobre-tope-imc'];
			case 'piso-ingesta':
				return `Subimos el objetivo hasta ${formatoVolumen(aviso.piso)} kcal: por debajo de tu metabolismo en reposo la app no propone nada.`;
			case 'disponibilidad-energetica':
				return 'Este objetivo queda por debajo de la energía que tu cuerpo necesita para sostener el entrenamiento que hacés. Podés elegirlo, pero no es lo que te recomiendo.';
			case 'pal-fuera-de-rango':
				return 'Tu nivel de actividad está por encima de lo que cubren estas ecuaciones. El número es una estimación gruesa; la balanza lo va a corregir.';
			default:
				return '';
		}
	}
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-4rem)] px-4 pb-8 pt-3">
	<header class="mb-3 flex min-h-10 items-center justify-between gap-3">
		<h1 class="text-xl font-extrabold">Tu objetivo</h1>
		{#if !mostrandoResultado}
			<span class="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-bold">{paso} de 4</span>
		{/if}
	</header>

	{#if mostrandoResultado && objetivo && listo}
		<!-- ===== Resultado: una sola cifra manda ===== -->
		<section
			class="gb-relieve rounded-2xl border border-white/10 p-4"
			style="background: var(--surface)"
			aria-live="polite"
		>
			<!--
				El riel manda sobre toda la tarjeta, así que va a la cabeza.

				Va acá y no en el paso 4: allá los cinco botones muestran sus cinco kcal juntas
				y eso es comparar, que es lo que hace falta para decidir. Acá hay un objetivo
				solo y abajo cuelga todo lo que cuesta —macros, ritmo, dónde cae contra tu
				mantenimiento, qué advertencia trae—, y eso los cinco botones no lo pueden
				mostrar. El riel no repite la comparación: deja recorrer las consecuencias.

				Con una sola posición no hay nada que recorrer: pasa con embarazo, donde sólo
				queda mantenimiento, y ahí un selector de una tecla es un adorno.
			-->
			{#if paradas.length > 1}
				<div class="mb-3">
					<RielObjetivo
						{paradas}
						valor={objetivoElegido}
						vibracion={$ajustes.vibracion}
						etiqueta="Cambiar de objetivo"
						onElegir={elegirEnResultado}
					/>
				</div>
			{/if}

			<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
				{botonElegido?.rotulo}
			</p>
			<!-- Sin salto de línea entre la cifra y su unidad: el espacio del código llega al
			     DOM y la app las pega en todas las demás pantallas. -->
			<p class="mt-1 flex items-baseline">
				<span class="cifra text-[4.2rem]"
					>{formatoVolumen(objetivo.objetivoKcal)}<span class="cifra-u">kcal</span></span
				>
			</p>

			<!-- La banda va como riel, no como gráfico: no puede competir con la cifra.
			     El componente es el mismo que usa la sección: dos copias del riel eran dos
			     leyendas que mantener, y la de acá no tenía ninguna. -->
			<div class="mt-3">
				<RielBanda tdee={listo.tdee} sepv={listo.sepv} objetivoKcal={objetivo.objetivoKcal} />
			</div>

			<!-- Los tres macros, en el orden en que los resuelve el motor. -->
			<div class="mt-4 grid grid-cols-3 gap-2">
				{#each macrosVisibles as macro (macro.rotulo)}
					<div class="min-w-0">
						<p
							class="text-[0.6rem] font-bold uppercase tracking-[0.14em]"
							style="color: var(--muted)"
						>
							{macro.rotulo}
						</p>
						<p class="cifra text-2xl">{macro.gramos}<span class="cifra-u">g</span></p>
					</div>
				{/each}
			</div>

			{#if botonElegido?.meta !== 'mantener'}
				<div class="mt-3 grid grid-cols-2 gap-2">
					<div class="min-w-0">
						<p
							class="text-[0.6rem] font-bold uppercase tracking-[0.14em]"
							style="color: var(--muted)"
						>
							Mantenimiento
						</p>
						<p class="cifra text-2xl">
							{formatoVolumen(listo.tdee)}<span class="cifra-u">kcal</span>
						</p>
					</div>
					<div class="min-w-0">
						<p
							class="text-[0.6rem] font-bold uppercase tracking-[0.14em]"
							style="color: var(--muted)"
						>
							Ritmo
						</p>
						<p class="cifra text-2xl">{ritmoTexto}<span class="cifra-u">{unidad}/sem</span></p>
					</div>
				</div>
			{/if}

			<p class="mt-3 text-xs leading-relaxed" style="color: var(--muted)">
				Tu mantenimiento estimado es {formatoVolumen(listo.tdee)} kcal. Con esta ecuación, 2 de cada 3
				personas con tu perfil están entre {formatoVolumen(listo.banda68.desde)} y {formatoVolumen(
					listo.banda68.hasta
				)}. Es una cuenta, no una medición: tu balanza la va a cerrar mejor que cualquier fórmula.
			</p>
		</section>

		<!--
			La advertencia del nivel, que hasta acá vivía sólo en el paso 4.

			Ahí alcanzaba: al agresivo se llegaba tocando su botón, con el texto naranja
			abajo, y recién después se tocaba "Ver mi objetivo". El riel abrió un camino que
			no pasa por esa pantalla — se entra en moderado y se sale en agresivo sin haber
			visto nunca por qué el agresivo cuesta algo. Un objetivo que trae advertencia
			tiene que traerla en las dos pantallas donde se lo puede elegir.

			No entra en `avisosVisibles` porque no es de la misma familia: aquéllos son
			`AvisoEnergia` que el motor emite sobre el número (pisos, recortes, umbrales), y
			éste es una propiedad del ritmo que se eligió. Comparten la forma, no el origen.
		-->
		{#if botonElegido?.aviso}
			<p
				class="mt-3 flex gap-2 rounded-xl border p-3 text-xs leading-relaxed"
				style="border-color: rgb(var(--max) / .35); background: rgb(var(--max) / .08); color: rgb(var(--max))"
			>
				<Icono nombre="aviso" tamano={16} clase="mt-px shrink-0" />
				<span>{TEXTO_AVISO[botonElegido.aviso]}</span>
			</p>
		{/if}

		{#each avisosVisibles as aviso (aviso.tipo)}
			{#if textoAvisoObjetivo(aviso)}
				<p
					class="mt-3 flex gap-2 rounded-xl border p-3 text-xs leading-relaxed"
					style="border-color: rgb(var(--max) / .35); background: rgb(var(--max) / .08); color: rgb(var(--max))"
				>
					<Icono nombre="aviso" tamano={16} clase="mt-px shrink-0" />
					<span>{textoAvisoObjetivo(aviso)}</span>
				</p>
			{/if}
		{/each}

		{#if limites?.consultar}
			<p
				class="mt-3 flex gap-2 rounded-xl border p-3 text-xs leading-relaxed"
				style="border-color: rgb(var(--max) / .35); background: rgb(var(--max) / .08); color: rgb(var(--max))"
			>
				<Icono nombre="aviso" tamano={16} clase="mt-px shrink-0" />
				<span
					>Por lo que marcaste, este número no debería aplicarse sin hablarlo antes con un
					profesional que conozca tu caso.</span
				>
			</p>
		{/if}

		<p class="mt-3 text-[0.7rem] leading-relaxed" style="color: var(--muted)">
			Es una estimación estadística, no una indicación médica ni un plan nutricional. Si tenés una
			condición de salud, tomás medicación o estás en tratamiento, consultá antes de aplicarlo.
		</p>

		{#if errorGuardado}
			<p class="mt-3 text-xs font-bold" style="color: rgb(var(--max))">{errorGuardado}</p>
		{/if}

		<div class="mt-4 flex flex-col gap-2">
			{#if guardado}
				<p
					class="flex min-h-14 items-center justify-center gap-2 rounded-2xl text-sm font-bold"
					style="background: rgb(var(--exito) / .14); color: rgb(var(--exito))"
					aria-live="polite"
				>
					<Icono nombre="hecha" tamano={18} />
					Guardado como tu objetivo
				</p>
			{:else}
				<button
					onclick={guardar}
					class="gb-relieve min-h-14 rounded-2xl text-base font-bold"
					style="background: var(--accent); color: var(--on-accent)">Guardar como objetivo</button
				>
			{/if}
			<button
				onclick={() => abrir(4)}
				class="min-h-12 rounded-2xl text-sm font-bold"
				style="background: var(--surface-3); color: var(--text)">Cambiar objetivo</button
			>
		</div>
	{:else}
		<!-- ===== Asistente: uno abierto, los contestados contraídos ===== -->
		<ol class="flex list-none flex-col gap-2">
			{#each [1, 2, 3, 4] as n (n)}
				<li>
					{#if n < paso}
						<button
							onclick={() => abrir(n as 1 | 2 | 3 | 4)}
							class="flex w-full items-baseline justify-between gap-3 rounded-2xl px-4 py-3 text-left"
							style="background: var(--surface-2)"
						>
							<span
								class="shrink-0 text-[0.6rem] font-bold uppercase tracking-[0.14em]"
								style="color: var(--muted)">{TITULOS[n - 1]}</span
							>
							<span class="min-w-0 truncate text-sm font-semibold">{resumen[n - 1]}</span>
						</button>
					{:else if n === paso}
						<section class="gb-foco rounded-2xl py-4 pl-5 pr-4" style="--foco-color: {focoColor}">
							<h2
								class="text-[0.6rem] font-bold uppercase tracking-[0.14em]"
								style="color: var(--muted)"
							>
								{TITULOS[n - 1]}
							</h2>

							{#if n === 1}
								<div class="mt-3 flex flex-col gap-3">
									<div>
										<p class="mb-1 text-xs font-semibold" style="color: var(--muted)">Edad</p>
										<Stepper
											value={edad}
											format={(v) => `${v}`}
											inputmode="numeric"
											step={1}
											glow="124 92 255"
											onStep={(d) => (edad = pasoEntero(edad, d, 18, 90))}
											onCommit={(el) => {
												edad = leerEntero(el.value, 18, 90) ?? edad;
												el.value = `${edad ?? ''}`;
											}}
											ariaDown="Bajar un año"
											ariaUp="Subir un año"
											ariaInput="Edad en años"
										/>
									</div>
									<div>
										<p class="mb-1 text-xs font-semibold" style="color: var(--muted)">
											Altura en cm
										</p>
										<Stepper
											value={alturaCm}
											format={(v) => `${v}`}
											inputmode="numeric"
											step={1}
											glow="124 92 255"
											onStep={(d) => (alturaCm = pasoEntero(alturaCm, d, 130, 220))}
											onCommit={(el) => {
												alturaCm = leerEntero(el.value, 130, 220) ?? alturaCm;
												el.value = `${alturaCm ?? ''}`;
											}}
											ariaDown="Bajar un centímetro"
											ariaUp="Subir un centímetro"
											ariaInput="Altura en centímetros"
										/>
									</div>
									<div>
										<p class="mb-1 text-xs font-semibold" style="color: var(--muted)">
											Peso en {unidad}
											{#if pesoDeLaApp}<span style="color: var(--accent-text)">
													· promedio de tu última semana</span
												>{/if}
										</p>
										<Stepper
											value={pesoVisible}
											format={(v) => formatoNumero(v)}
											inputmode="decimal"
											step={0.5}
											glow="124 92 255"
											onStep={(d) => moverPeso((pesoVisible ?? 70) + d)}
											onCommit={(el) => {
												moverPeso(Number.parseFloat(el.value.replace(',', '.')));
												el.value = pesoVisible != null ? formatoNumero(pesoVisible) : '';
											}}
											ariaDown={`Bajar medio ${unidad}`}
											ariaUp={`Subir medio ${unidad}`}
											ariaInput={`Peso corporal en ${unidad}`}
										/>
									</div>
									<div>
										<p class="mb-1 text-xs font-semibold" style="color: var(--muted)">
											Versión de la ecuación
										</p>
										<div class="flex flex-col gap-2">
											{#each ECUACIONES as opcion (opcion.id)}
												<button
													onclick={() => (ecuacion = opcion.id)}
													aria-pressed={ecuacion === opcion.id}
													class="min-h-14 rounded-xl px-4 text-left text-sm font-semibold {ecuacion ===
													opcion.id
														? 'gb-opcion-elegida'
														: 'gb-opcion'}">{opcion.rotulo}</button
												>
											{/each}
										</div>
										<p class="mt-2 text-[0.7rem] leading-relaxed" style="color: var(--muted)">
											Las ecuaciones publicadas existen solo en estas dos versiones. Si ninguna
											encaja con tu situación, elegí la que corresponda a tu composición actual o el
											promedio: de todas formas esto se calibra con tu peso.
										</p>
									</div>
								</div>
							{:else if n === 2}
								<div class="mt-3 flex flex-col gap-3">
									<div>
										<p class="mb-1 text-xs font-semibold" style="color: var(--muted)">
											¿Cómo es tu día típico?
										</p>
										<div class="flex flex-col gap-2">
											{#each OCUPACIONES as opcion (opcion.id)}
												<button
													onclick={() => (ocupacion = opcion.id)}
													aria-pressed={ocupacion === opcion.id}
													class="min-h-14 rounded-xl px-4 text-left text-sm font-semibold {ocupacion ===
													opcion.id
														? 'gb-opcion-elegida'
														: 'gb-opcion'}">{opcion.rotulo}</button
												>
											{/each}
										</div>
									</div>
									<div>
										<p class="mb-1 text-xs font-semibold" style="color: var(--muted)">
											Pasos en un día típico sin gimnasio
										</p>
										<div class="flex flex-wrap gap-2">
											{#each PASOS as opcion (opcion.id)}
												<button
													onclick={() => (bandaPasos = opcion.id)}
													aria-pressed={bandaPasos === opcion.id}
													class="min-h-14 flex-1 basis-[46%] rounded-xl px-3 text-sm font-semibold {bandaPasos ===
													opcion.id
														? 'gb-opcion-elegida'
														: 'gb-opcion'}">{opcion.rotulo}</button
												>
											{/each}
										</div>
										<p class="mt-2 text-[0.7rem] leading-relaxed" style="color: var(--muted)">
											Los pasos del gimnasio no cuentan acá: el entrenamiento se pregunta aparte y
											sumarlo dos veces infla el número.
										</p>
									</div>
								</div>
							{:else if n === 3}
								<div class="mt-3 flex flex-col gap-3">
									<div>
										<p class="mb-1 text-xs font-semibold" style="color: var(--muted)">
											Entrenos por semana
											{#if frecuenciaDeLaApp}<span style="color: var(--accent-text)">
													· según tu último mes</span
												>{/if}
										</p>
										<Stepper
											value={sesionesSemana}
											format={(v) => formatoNumero(v)}
											inputmode="decimal"
											step={0.5}
											glow="124 92 255"
											onStep={(d) => {
												sesionesSemana = Math.min(14, Math.max(0, (sesionesSemana ?? 0) + d));
												frecuenciaDeLaApp = false;
											}}
											onCommit={(el) => {
												const n2 = Number.parseFloat(el.value.replace(',', '.'));
												if (Number.isFinite(n2)) {
													sesionesSemana = Math.min(14, Math.max(0, Math.round(n2 * 2) / 2));
													frecuenciaDeLaApp = false;
												}
												el.value = sesionesSemana != null ? formatoNumero(sesionesSemana) : '';
											}}
											ariaDown="Bajar medio entrenamiento"
											ariaUp="Subir medio entrenamiento"
											ariaInput="Entrenamientos por semana"
										/>
									</div>
									<div>
										<p class="mb-1 text-xs font-semibold" style="color: var(--muted)">
											¿Cuánto dura una sesión?
										</p>
										<div class="flex gap-2">
											{#each DURACIONES as opcion (opcion.id)}
												<button
													onclick={() => (duracion = opcion.id)}
													aria-pressed={duracion === opcion.id}
													class="min-h-14 flex-1 rounded-xl px-2 text-sm font-semibold {duracion ===
													opcion.id
														? 'gb-opcion-elegida'
														: 'gb-opcion'}">{opcion.corto}</button
												>
											{/each}
										</div>
									</div>
									<div>
										<p class="mb-1 text-xs font-semibold" style="color: var(--muted)">
											¿Cómo entrenás?
										</p>
										<div class="flex flex-col gap-2">
											{#each DENSIDADES as opcion (opcion.id)}
												<button
													onclick={() => (densidad = opcion.id)}
													aria-pressed={densidad === opcion.id}
													class="min-h-14 rounded-xl px-4 text-left text-sm font-semibold {densidad ===
													opcion.id
														? 'gb-opcion-elegida'
														: 'gb-opcion'}">{opcion.rotulo}</button
												>
											{/each}
										</div>
										<p class="mt-2 text-[0.7rem] leading-relaxed" style="color: var(--muted)">
											Lo que cambia el gasto es cuánto tiempo estás moviéndote, no cuánto pesa la
											barra.
										</p>
									</div>
								</div>
							{:else}
								<div class="mt-3 flex flex-col gap-2">
									{#if mantenimiento?.estado === 'invalido'}
										<p class="rounded-xl p-3 text-sm" style="background: var(--surface-3)">
											{mantenimiento.motivo === 'menor-de-edad'
												? 'Esta herramienta está pensada para adultos. Las necesidades durante el crecimiento se calculan distinto.'
												: 'Revisá los datos de los pasos anteriores: hay un valor fuera de rango.'}
										</p>
									{:else}
										{#each botones as boton (boton.id)}
											<button
												onclick={() => (objetivoElegido = boton.id)}
												aria-pressed={objetivoElegido === boton.id}
												disabled={boton.bloqueado}
												class="flex min-h-16 items-center justify-between gap-3 rounded-xl px-4 text-left disabled:opacity-40 {objetivoElegido ===
												boton.id
													? 'gb-opcion-elegida'
													: 'gb-opcion'}"
												style={boton.aviso ? '--opcion-color: var(--max)' : ''}
											>
												<span class="flex min-w-0 items-center gap-2">
													<span class="truncate text-sm font-bold">{boton.rotulo}</span>
													{#if boton.aviso}
														<Icono nombre="aviso" tamano={15} clase="shrink-0" />
													{/if}
												</span>
												{#if boton.objetivo}
													<span class="cifra shrink-0 text-[1.4rem]"
														>{formatoVolumen(boton.objetivo.objetivoKcal)}<span class="cifra-u"
															>kcal</span
														></span
													>
												{:else}
													<span class="shrink-0 text-xs" style="color: var(--muted)"
														>no disponible</span
													>
												{/if}
											</button>
										{/each}
										{#if limites?.motivo}
											<p
												class="rounded-xl p-3 text-xs leading-relaxed"
												style="background: var(--surface-2); color: var(--muted)"
											>
												{MOTIVO_RECORTE[limites.motivo]}
											</p>
										{/if}
										{#if botonElegido?.aviso}
											<p
												class="flex gap-2 rounded-xl border p-3 text-xs leading-relaxed"
												style="border-color: rgb(var(--max) / .35); background: rgb(var(--max) / .08); color: rgb(var(--max))"
											>
												<Icono nombre="aviso" tamano={16} clase="mt-px shrink-0" />
												<span>{TEXTO_AVISO[botonElegido.aviso]}</span>
											</p>
										{/if}
									{/if}

									<details class="mt-1 rounded-xl" style="background: var(--surface-2)">
										<summary
											class="flex min-h-14 cursor-pointer items-center px-4 text-sm font-semibold"
											>¿Algo de esto aplica?</summary
										>
										<div class="flex flex-col gap-2 px-3 pb-3">
											{#each CONDICIONES as condicion (condicion.id)}
												<button
													onclick={() => alternarCondicion(condicion.id)}
													aria-pressed={condiciones.includes(condicion.id)}
													class="min-h-14 rounded-xl px-4 text-left text-sm font-semibold {condiciones.includes(
														condicion.id
													)
														? 'gb-opcion-elegida'
														: 'gb-opcion'}">{condicion.rotulo}</button
												>
											{/each}
											<p class="text-[0.7rem] leading-relaxed" style="color: var(--muted)">
												No se guarda: la app lo usa para decidir qué ofrecerte y lo olvida al salir.
											</p>
										</div>
									</details>
								</div>
							{/if}

							<button
								onclick={avanzar}
								disabled={paso === 4 && !objetivo}
								class="gb-relieve mt-4 min-h-14 w-full rounded-2xl text-base font-bold disabled:opacity-40"
								style="background: var(--accent); color: var(--on-accent)"
							>
								{paso === 4 ? 'Ver mi objetivo' : 'Continuar'}
							</button>
						</section>
					{:else}
						<p class="rounded-2xl px-4 py-3 text-sm" style="color: var(--muted)">
							{PENDIENTES[n - 1]}
						</p>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</main>
