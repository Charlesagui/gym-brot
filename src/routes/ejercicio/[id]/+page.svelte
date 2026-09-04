<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { liveQuery } from 'dexie';
	import { db, type Dia, type Sesion, type SetSesion, type PrCelebrado } from '$lib/db';
	import { ejercicioPorId, grupos } from '$lib/catalog';
	import {
		historialObs,
		ejercicioSesionObs,
		prepararEjercicioSesion,
		setsEjercicioSesion,
		setSerieHecha,
		toggleMax,
		setPeso,
		setReps,
		setRir,
		setExtra,
		addSet,
		removeSet,
		cerrarEjercicioConLoHecho,
		reiniciarEjercicio,
		registrarPrSiSupera,
		pesoEfectivo,
		valorMetrica,
		valorSet,
		mejorSet,
		DESCRIPCION_METRICA,
		hoyStr,
		sesionId,
		sesionRecienteDe,
		type InstantaneaSesion,
		type MejorSet,
		type PrGanado,
		type ResultadoMutacion,
		type SesionReciente
	} from '$lib/sesion';
	import {
		mejorSetDeSeries,
		metricaConfigurada,
		serieCompleta,
		type MetricaEfectiva,
		type ModoPr
	} from '$lib/sesion-reglas';
	import {
		notaObs,
		setNota,
		ajustesObs,
		setDescansoEjercicio,
		setMetricaPrEjercicio,
		AJUSTES_DEFAULT
	} from '$lib/extras';
	import {
		descansoEfectivo,
		descansoPersonalizado,
		etiquetaDescanso,
		relojDescanso
	} from '$lib/descanso-preset';
	import Icono from '$lib/components/Icono.svelte';
	import HojaDescanso from '$lib/components/HojaDescanso.svelte';
	import { sonarSetHecho, sonarExito } from '$lib/audio';
	import { vibrar } from '$lib/vibracion';
	import { descanso } from '$lib/descanso.svelte';
	import { deshacer } from '$lib/deshacer.svelte';
	import { WakeLockSeguro } from '$lib/wake-lock';
	import { dur, menosMovimiento, DUR_BASE, DUR_SLOW } from '$lib/motion';
	import { fromLiveQuery } from '$lib/live';
	import { hoy } from '$lib/hoy.svelte';
	import { formatoNumero, formatoSet, fechaCorta, resumenSeries } from '$lib/formato';
	import { fechaSesionDesdeUrl } from '$lib/fechas';
	import { youtubeEmbedUrl } from '$lib/youtube';
	import {
		etiquetaProximaSerie,
		metricaEfectivaEjercicio,
		metricaLabelEjercicio,
		modoEjercicioActivo,
		proximoEjercicioPendiente,
		unidadValorEjercicio
	} from '$lib/ejercicio-activo';
	import { leerPeso, leerReps, sumarPeso, sumarReps } from '$lib/numeros';
	import { pasoPesoEfectivo } from '$lib/paso-peso';
	import { demostracionActiva } from '$lib/video';
	import {
		debeMostrarHintMax,
		debeMostrarHintTimer,
		demoGrande,
		ocultarHintMax,
		ocultarHintTimer,
		setDemoGrande
	} from '$lib/preferencias-ui';
	import SetRow from '$lib/components/SetRow.svelte';
	import MiniChart from '$lib/components/MiniChart.svelte';
	import CelebracionOverlay from '$lib/components/CelebracionOverlay.svelte';
	import CelebracionParticulas from '$lib/components/CelebracionParticulas.svelte';
	import TecnicaModal from '$lib/components/TecnicaModal.svelte';
	import ToastAccion from '$lib/components/ToastAccion.svelte';
	import AvisoSesionAnterior from '$lib/components/AvisoSesionAnterior.svelte';
	import { gramosAPeso, pesoAGramos } from '$lib/unidades';

	const ej = $derived(ejercicioPorId($page.params.id!));
	const g = $derived(ej ? grupos[ej.grupo] : undefined);
	const diaId = $derived($page.url.searchParams.get('dia'));
	/**
	 * A qué sesión escribe esta pantalla cuando la URL no lo dice. Se congela al abrir a
	 * propósito: la sesión que empezaste es la que seguís editando, y que la medianoche te
	 * mueva de sesión a mitad de una serie sería peor que el problema que resuelve.
	 *
	 * Ojo: esto NO es "qué día es hoy". Para eso está `hoy`, que sí es vivo. Confundir las
	 * dos cosas en una sola constante es lo que hacía que, cruzando la medianoche, la app
	 * siguiera escribiendo en la sesión de ayer sin decirlo.
	 */
	const fechaApertura = hoyStr();
	const fechaSolicitada = $derived(
		fechaSesionDesdeUrl($page.url.searchParams.get('fecha'), fechaApertura, hoy.valor)
	);
	const fechaUrlInvalida = $derived(fechaSolicitada == null);
	// `desde`: día desde el que se abrió la vista de progreso (para volver a entrenar).
	const desde = $derived($page.url.searchParams.get('desde'));
	const volver = $derived(
		diaId
			? `/dia/${diaId}?fecha=${fechaSolicitada ?? ''}`
			: desde
				? `/ejercicio/${$page.params.id}?dia=${desde}&fecha=${fechaSolicitada ?? fechaApertura}`
				: '/historial'
	);

	// El progreso completo arrastra layerchart + d3 (el chunk más grande de la app) y
	// solo se ve en modo consulta (sin ?dia=): entrenar no tiene por qué pagar esa
	// descarga ni ese parseo en el camino crítico.
	let Progreso = $state<typeof import('$lib/components/ProgresoEjercicio.svelte').default | null>(
		null
	);
	let errorProgreso = $state(false);
	let intentoProgreso = $state(0);
	$effect(() => {
		intentoProgreso;
		if (diaId || Progreso) return;
		let vivo = true;
		errorProgreso = false;
		void import('$lib/components/ProgresoEjercicio.svelte')
			.then((m) => {
				if (vivo) Progreso = m.default;
			})
			.catch(() => {
				if (vivo) errorProgreso = true;
			});
		return () => {
			vivo = false;
		};
	});

	let sets = $state<SetSesion[]>([]);
	let anteriores = $state<SetSesion[]>([]);
	let anterioresFecha = $state<string | null>(null);
	let prCelebrado = $state<PrCelebrado | null>(null);
	// Fecha fija transportada por la URL: evita mezclar sesiones al cruzar medianoche.
	const fechaSesion = $derived(fechaSolicitada ?? fechaApertura);
	let notaTexto = $state('');
	let tieneNota = $state(false);
	let notaPendiente = $state<{ exerciseId: string; texto: string } | null>(null);
	let notaGuardandoExerciseId = $state<string | null>(null);
	let notaId: ReturnType<typeof setTimeout> | null = null;
	let cargandoSeries = $state(false);
	let ejercicioNoDisponible = $state<'rutina-no-disponible' | 'fecha-futura' | null>(null);
	let exito = $state<'normal' | 'pr' | 'parcial' | null>(null);
	let prExito = $state<PrGanado | null>(null);
	// Flash de PR no bloqueante: celebra el récord en el instante en que se gana,
	// sin esperar a "Terminar" (así no se pierde si salís con ←).
	let prFlash = $state<PrGanado | null>(null);
	let prFlashId: ReturnType<typeof setTimeout> | null = null;
	// El gif de demostración arranca grande en cada ejercicio; se puede achicar a
	// miniatura en el header tocándolo, pero al cambiar de ejercicio vuelve a grande.
	let videoGrande = $state(true);
	let tecnicaAbierta = $state(false);
	let tecnicaHistoryActiva = false;
	// Una escritura que falla no puede pasar desapercibida: los datos viven solo acá.
	let errorGuardado = $state<string | null>(null);
	let avisoSerie = $state<string | null>(null);
	// Cada serie acepta una sola intención mientras IndexedDB confirma el resultado.
	// Esto evita que un doble toque convierta un "marcar" en "desmarcar".
	let seriesPendientes = $state<Set<number>>(new Set());
	// Acuse visual breve tras CONFIRMAR el guardado de una serie marcada (no al desmarcar).
	let filasFlash = $state<Set<number>>(new Set());
	let flashIds = new Map<number, ReturnType<typeof setTimeout>>();
	// El contador "hechas/total" hace un pop corto cuando cambia.
	let contadorPop = $state(false);
	let contadorPopId: ReturnType<typeof setTimeout> | null = null;
	let restoId: ReturnType<typeof setTimeout> | null = null;
	/**
	 * Reiniciar es lo único acá que borra trabajo de un toque, así que va en dos tiempos:
	 * el botón arma el aviso y el aviso es el que reinicia. Después queda unos segundos
	 * con "Deshacer", que devuelve la instantánea entera.
	 */
	let toast = $state<{
		mensaje: string;
		accionTexto: string;
		onAccion: () => void | Promise<void>;
	} | null>(null);

	$effect(() => {
		$page.params.id; // dep: reinicia "grande" al cambiar de ejercicio
		// Entrenando la demo arranca chica: en grande son 402 px que empujan la serie en
		// curso abajo del pliegue. En modo consulta arranca grande, que es a lo que se entra.
		videoGrande = demoGrande(!!diaId);
		// Todo lo de abajo pertenece al ejercicio que dejamos atrás. "Siguiente" navega a
		// esta misma ruta con otro id sin destruir el componente, así que sin este barrido
		// llegabas al ejercicio nuevo con una fila ajena desplegada y, peor, con el cartel
		// rojo de "ingresá las repeticiones de la serie 2" del ejercicio anterior.
		filaAbierta = null;
		hechasDesplegadas = false;
		avisoSerie = null;
		hojaDescanso = false;
		propioAntesDeApagar = null;
		mostrarQueMide = false;
		toast = null;
		// El pop del contador es para un toque en ESTE ejercicio, no para el salto de
		// "hechas" que trae cargar uno nuevo.
		hechasPrevias = null;
		// La celebración es del ejercicio anterior: "Siguiente" navega a esta misma
		// ruta con otro id sin destruir el componente, así que si no se apaga acá
		// queda encendida sobre el ejercicio nuevo. Y como `destinoCierre` apuntaba
		// a la URL a la que justo se llegó, el toque de "continuar" hacía goto() al
		// lugar donde ya se está: no navegaba a ningún lado y quedaba trabada.
		if (exitoId) clearTimeout(exitoId);
		exitoId = null;
		exito = null;
		prExito = null;
	});

	function setVideoGrande(valor: boolean) {
		videoGrande = valor;
		setDemoGrande(valor, !!diaId);
	}

	// Hint de MAX: solo en máquinas de placas, las primeras 3 visitas o hasta "Entendido".
	let mostrarHintMax = $state(false);
	// Hint para activar el descanso: una sola vez, al marcar una serie con el timer apagado.
	let mostrarHintTimer = $state(false);

	$effect(() => {
		mostrarHintMax = !!ej?.maquinaPlacas && debeMostrarHintMax();
	});

	function entendidoHintMax() {
		ocultarHintMax();
		mostrarHintMax = false;
	}

	// El descanso ahora es un store global (sobrevive navegar entre pantallas).
	let exitoId: ReturnType<typeof setTimeout> | null = null;

	// Ajustes, historial (PR) y nota como stores legibles con `$` (ver $lib/live).
	const ajustesStore = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const ajustes = $derived($ajustesStore);
	/**
	 * Las preferencias que disparan trabajo se derivan de a UNA, y lo que las consume lee
	 * el escalar y nunca `ajustes` entero.
	 *
	 * `ajustesObs()` es un liveQuery que normaliza: cada emisión es un objeto NUEVO aunque
	 * no haya cambiado ningún campo. Un efecto que lee `ajustes.unidad` depende del objeto,
	 * así que se re-corría con CUALQUIER preferencia que se guardara —y guardar el descanso
	 * con la rueda escribe una vez por gesto. Cada re-corrida volvía a poner
	 * `cargandoSeries`, así que la lista de series se colapsaba a "Preparando…" y la tarjeta
	 * de récord se desmontaba mientras el dedo giraba. Derivando el escalar, la igualdad de
	 * Svelte corta la propagación cuando el valor no cambió.
	 */
	const unidad = $derived(ajustes.unidad);
	const metrica = $derived(metricaConfigurada(ajustes, $page.params.id!));
	const pantallaEncendida = $derived(ajustes.ejercicioPantallaEncendida);
	// El historial se recalcula al cambiar de ejercicio o de métrica; el `$` re-suscribe solo.
	const historial = $derived(
		fromLiveQuery(historialObs($page.params.id!, metrica, unidad), [] as MejorSet[])
	);
	const puntos = $derived($historial);
	const notaStore = $derived(fromLiveQuery(notaObs($page.params.id!), undefined));

	/**
	 * Rutina y sesión del día, solo para saber qué ejercicio viene después. Terminar
	 * uno devolvía siempre a la lista del día: con siete ejercicios son siete viajes de
	 * ida y vuelta. El orden ya estaba en la base; faltaba usarlo para navegar.
	 */
	const contextoDia = $derived(
		fromLiveQuery(
			liveQuery(async (): Promise<{ dia?: Dia; sesion?: Sesion }> => {
				if (!diaId || !fechaSolicitada) return {};
				const [dia, sesion] = await Promise.all([
					db.dias.get(diaId),
					db.sesiones.get(sesionId(diaId, fechaSolicitada))
				]);
				return { dia, sesion };
			}),
			{} as { dia?: Dia; sesion?: Sesion }
		)
	);
	const proximo = $derived(
		diaId
			? proximoEjercicioPendiente(
					$contextoDia.dia,
					$contextoDia.sesion,
					$page.params.id!,
					(id) => ejercicioPorId(id)?.nombre
				)
			: null
	);
	const hrefProximo = $derived(
		proximo ? `/ejercicio/${proximo.exerciseId}?dia=${diaId}&fecha=${fechaSesion}` : null
	);

	/**
	 * Si la sesión que estás editando es la de hoy DE VERDAD, contra el reloj vivo y no
	 * contra el que había cuando se montó la pantalla. Cruzando la medianoche entrenando,
	 * esto pasa a false solo y aparece el cartel: seguís escribiendo donde empezaste, pero
	 * sabiendo que ya es otro día.
	 */
	const esDeHoy = $derived(fechaSesion === hoy.valor);
	/**
	 * Hoy no se marcó ni se saltó nada: la pantalla se ve igual a una recién empezada.
	 *
	 * Exige que la rutina ya haya llegado. Sin eso, "todavía no cargó" y "hoy está vacío"
	 * son el mismo valor, y el aviso naranja parpadeaba un cuadro sobre un día con trabajo.
	 */
	const sinTrabajoHoy = $derived(
		!!$contextoDia.dia &&
			(!$contextoDia.sesion ||
				$contextoDia.sesion.ejercicios.every((e) => !e.saltado && !e.sets.some(serieCompleta)))
	);
	const recienteStore = $derived(
		fromLiveQuery(
			liveQuery(async (): Promise<SesionReciente | null> => {
				if (!diaId) return null;
				return sesionRecienteDe(diaId, $page.params.id!, hoy.valor);
			}),
			null as SesionReciente | null
		)
	);
	/**
	 * El otro lado de la deriva de fecha: llegaste a una pantalla vacía y hay trabajo tuyo
	 * de hace un rato en otra fecha. Se apaga solo en cuanto marcás una serie de hoy.
	 */
	const sesionAnterior = $derived(esDeHoy && sinTrabajoHoy ? $recienteStore : null);
	const hrefSesionAnterior = $derived(
		sesionAnterior
			? sesionAnterior.tieneEjercicio
				? `/ejercicio/${$page.params.id}?dia=${diaId}&fecha=${sesionAnterior.fecha}`
				: `/dia/${diaId}?fecha=${sesionAnterior.fecha}`
			: ''
	);
	$effect(() => {
		const exerciseId = $page.params.id!;
		// Una escritura demorada de esta misma nota no puede volver el textarea a la
		// versión anterior justo mientras la persona sigue tipeando.
		if (notaPendiente?.exerciseId === exerciseId || notaGuardandoExerciseId === exerciseId) return;
		notaTexto = $notaStore?.texto ?? '';
		tieneNota = !!$notaStore?.texto;
	});

	$effect(() => {
		const exId = $page.params.id!;
		const dId = diaId;
		let cancelado = false;
		let sub: { unsubscribe: () => void } | undefined;
		if (!dId || !ej || !fechaSolicitada) {
			sets = [];
			anteriores = [];
			anterioresFecha = null;
			prCelebrado = null;
			cargandoSeries = false;
			ejercicioNoDisponible = null;
			return;
		}
		const fecha = fechaSolicitada;
		cargandoSeries = true;
		ejercicioNoDisponible = null;
		anteriores = [];
		anterioresFecha = null;
		(async () => {
			const preparacion = await prepararEjercicioSesion(dId, exId, fecha, unidad);
			if (cancelado) return;
			if (!preparacion.disponible) {
				sets = [];
				prCelebrado = null;
				cargandoSeries = false;
				ejercicioNoDisponible = preparacion.motivo;
				return;
			}
			anteriores = preparacion.anteriores;
			anterioresFecha = preparacion.anterioresFecha;
			const clave = claveEscritura(exId, fecha);
			sub = ejercicioSesionObs(dId, exId, fecha, unidad).subscribe((estado) => {
				if (cancelado) return;
				prCelebrado = estado.prCelebrado;
				cargandoSeries = false;
				// Con escrituras en vuelo el resultado que llega puede ser anterior al
				// último toque: pisar `sets` acá hacía saltar el número hacia atrás y el
				// toque siguiente componía desde el valor viejo. Mientras haya toques sin
				// confirmar manda lo local; al drenar, la base vuelve a ser la verdad.
				// Solo cuentan los toques de ESTE ejercicio: los del anterior no tienen por
				// qué callar la primera lectura del que se acaba de abrir.
				if (enVuelo(clave) > 0) return;
				sets = estado.sets;
			});
		})().catch((error: unknown) => {
			if (!cancelado) {
				sets = [];
				prCelebrado = null;
				cargandoSeries = false;
				errorGuardado = 'No se pudo cargar el entrenamiento. Volvé a intentarlo.';
				console.error('No se pudo cargar el entrenamiento', error);
			}
		});
		return () => {
			cancelado = true;
			sub?.unsubscribe();
		};
	});

	/**
	 * Entrenar es la única pantalla donde el teléfono queda quieto minutos entre serie y
	 * serie: se apagaba solo y había que desbloquearlo con las manos ocupadas. El
	 * descanso ya sostenía la pantalla; ahora la sostiene el ejercicio entero.
	 *
	 * Solo en modo entrenar (`?dia=`): mirar el progreso de un ejercicio no justifica
	 * gastar batería. Si el navegador no lo permite, `WakeLockSeguro` no rompe nada.
	 */
	const pantallaEjercicio = new WakeLockSeguro();
	$effect(() => {
		if (!diaId || !pantallaEncendida) return;
		void pantallaEjercicio.activar();
		return () => pantallaEjercicio.desactivar();
	});

	onMount(() => {
		function cerrarTecnicaConBack() {
			if (!tecnicaAbierta || !tecnicaHistoryActiva) return;
			tecnicaHistoryActiva = false;
			tecnicaAbierta = false;
		}

		window.addEventListener('popstate', cerrarTecnicaConBack);
		return () => window.removeEventListener('popstate', cerrarTecnicaConBack);
	});

	onDestroy(() => {
		if (exitoId) clearTimeout(exitoId);
		if (prFlashId) clearTimeout(prFlashId);
		if (notaId) clearTimeout(notaId);
		if (contadorPopId) clearTimeout(contadorPopId);
		if (restoId) clearTimeout(restoId);
		for (const id of flashIds.values()) clearTimeout(id);
		void guardarNotaPendiente();
	});

	const hechas = $derived(sets.filter(serieCompleta).length);
	let hechasPrevias: number | null = null;
	$effect(() => {
		const actuales = hechas;
		if (hechasPrevias === null) {
			hechasPrevias = actuales;
			return;
		}
		if (actuales === hechasPrevias) return;
		hechasPrevias = actuales;
		contadorPop = false;
		requestAnimationFrame(() => {
			contadorPop = true;
			if (contadorPopId) clearTimeout(contadorPopId);
			contadorPopId = setTimeout(() => (contadorPop = false), DUR_BASE);
		});
	});
	const completo = $derived(sets.length > 0 && sets.every(serieCompleta));
	// Los logros tienen su propio canal: la alarma de descanso es funcional y esto
	// es celebratorio, así que se puede querer una sin la otra.
	const sonidoActivo = $derived(ajustes.sonido && ajustes.sonidoLogros);
	const vibracionActiva = $derived(ajustes.vibracion ?? true);
	const metricaOverride = $derived(ajustes.metricasPrEjercicio?.[$page.params.id!]);
	const modo = $derived<ModoPr>(modoEjercicioActivo(puntos, sets));
	const metricaEfectiva = $derived<MetricaEfectiva>(metricaEfectivaEjercicio(modo, metrica));
	const metricaLabel = $derived(metricaLabelEjercicio(modo, metrica));
	// Unidad del valor del PR: en modo reps el número son repeticiones, no kg/lb.
	const unidadValor = $derived(unidadValorEjercicio(modo, unidad));
	const otraMetrica = $derived(metrica === 'e1rm' ? 'peso' : 'e1rm');
	const otraLabel = $derived(metrica === 'e1rm' ? 'peso máx.' : '1RM est. (1 rep. máx.)');
	const tecnicaEmbedUrl = $derived(ej?.videoUrl ? youtubeEmbedUrl(ej.videoUrl) : null);

	const pr = $derived(puntos.reduce<MejorSet | null>((best, p) => mejorSet(best, p), null));
	// Equivalencia en la otra métrica: solo tiene sentido cuando el PR es por peso.
	const valorOtraPr = $derived(
		modo === 'peso' && pr && pesoEfectivo(pr, unidad) != null
			? valorMetrica(pesoEfectivo(pr, unidad)!, pr.reps, otraMetrica)
			: null
	);
	const mejorHoy = $derived(mejorSetDeSeries(sets, fechaSesion, metrica, undefined, modo, unidad));
	// "Previo" = todo menos la sesión actual: si hiciste este ejercicio hoy en otra
	// rutina, ese valor también cuenta (mismo criterio que recalcularPrCelebrado).
	const mejorPrevio = $derived(
		puntos
			.filter((p) => !diaId || p.sesionId !== sesionId(diaId, fechaSesion))
			.reduce<number | null>((m, p) => (m == null || p.valor > m ? p.valor : m), null)
	);
	const valorCelebrado = $derived(
		prCelebrado ? valorSet(prCelebrado, metrica, modo, unidad) : null
	);
	const valorMejorHoy = $derived(mejorHoy ? mejorHoy.valor : null);
	const superado = $derived(
		valorMejorHoy != null &&
			(mejorPrevio == null || valorMejorHoy > mejorPrevio) &&
			(valorCelebrado == null || valorMejorHoy > valorCelebrado)
	);
	// Descanso: el del ejercicio manda sobre el general (ver $lib/descanso-preset).
	const descansoEj = $derived(descansoEfectivo(ej?.id, ajustes));
	const descansoPropio = $derived(descansoPersonalizado(ej?.id, ajustes));
	let hojaDescanso = $state(false);
	/**
	 * El último descanso propio que tuvo este ejercicio antes de apagarlo.
	 *
	 * Apagar se guarda como un `0`, que pisa el valor que había: sin esto, apagar y volver
	 * a encender se llevaba puesto el descanso de 3:30 que habías elegido y te devolvía al
	 * general. Vive en la pantalla porque es memoria de un gesto, no una preferencia.
	 */
	let propioAntesDeApagar = $state<number | null>(null);
	/** La explicación de la métrica y la equivalencia: útiles una vez, no en cada serie. */
	let mostrarQueMide = $state(false);
	/**
	 * Qué fila está abierta además de la que estás haciendo. Vive acá y no en cada fila
	 * para que abrir una cierre la anterior: con el estado adentro de `SetRow` podían
	 * quedar tres desplegadas a la vez y ninguna forma de saberlo desde afuera.
	 */
	let filaAbierta = $state<number | null>(null);
	const pasoPeso = $derived(
		ej ? pasoPesoEfectivo(ej, ajustes) : (ajustes.pasoPeso ?? AJUSTES_DEFAULT.pasoPeso)
	);
	const itemRutina = $derived(
		$contextoDia.dia?.ejercicios.find((item) => item.exerciseId === $page.params.id!)
	);
	// Sin PR ni serie previa: es la primera vez con este ejercicio → hint de peso inicial.
	/**
	 * La serie en curso es la primera sin hacer: es la única que se muestra abierta,
	 * con relieve y con el color del grupo. Las hechas se contraen a un renglón y las
	 * que faltan quedan cerradas detrás de ella.
	 */
	const indiceActiva = $derived(sets.findIndex((serie) => !serie.hecha));

	/**
	 * La lista tiene siempre las mismas tres zonas: lo que hiciste, lo que estás haciendo y
	 * lo que falta. Las hechas viven todas juntas en un renglón que se abre tocándolo.
	 *
	 * El intento anterior dejaba dos filas a la vista y agrupaba el resto, para que corregir
	 * una serie recién hecha siguiera costando un toque. En la práctica producía un
	 * agrupador que no se disparaba nunca en una rutina de 3 series —el default— y que en
	 * una de 4 aparecía en un solo estado para agrupar una sola serie. Peor: al terminar el
	 * ejercicio `indiceActiva` pasa a -1 y el grupo se apagaba entero, así que el momento
	 * con más filas era justo el único sin agrupar (con 12 series, 540 px de golpe).
	 *
	 * Agrupar siempre y desde la primera cuesta un toque más para corregir, y a cambio no
	 * hay ningún estado que haya que explicar.
	 */
	let hechasDesplegadas = $state(false);
	/** Terminado el ejercicio no queda activa (-1) y las hechas son todas. */
	const hechasAgrupadas = $derived(indiceActiva === -1 ? sets.length : indiceActiva);
	const hechasOcultas = $derived(hechasDesplegadas ? 0 : hechasAgrupadas);
	/**
	 * Vista previa de las cargas (ver `resumenSeries`). Lo que se repite se nombra una vez
	 * y lo que varía queda en lista, con la unidad pegada a la carga: el renglón decía
	 * "60×10 · 62.5×10 · 65×8" sin decir en ningún lado cuál de los dos números era el
	 * peso. Del resto, se muestran las ÚLTIMAS con un "+N" adelante, porque la pregunta
	 * que se hace uno mirando el renglón es si la carga se sostuvo hasta acá.
	 */
	/*
	 * Tres, no cuatro. Cuatro pares —"60×10 · 62,5×10 · 65×8 · 65×6"— son ocho cifras y
	 * tres separadores en un renglón de 18 px que además trunca: se leen como un número
	 * largo. Con la factorización, el caso común imprime uno solo y esto sólo actúa en
	 * la escalera, que es justo donde amontonaba.
	 */
	const RESUMEN_MAX = 3;
	const resumenHechas = $derived(resumenSeries(sets.slice(0, hechasAgrupadas), RESUMEN_MAX));
	const conteoHechas = $derived(
		`${hechasAgrupadas} ${hechasAgrupadas === 1 ? 'serie hecha' : 'series hechas'}`
	);
	/**
	 * El renglón resume; su nombre accesible no puede resumir, o las series se pierden para
	 * quien lo escucha. Y arranca con el mismo verbo que se ve, que es lo que necesita el
	 * control por voz para encontrarlo.
	 */
	const etiquetaGrupoHechas = $derived(
		hechasDesplegadas
			? `Ocultar ${conteoHechas}`
			: `Ver todas: ${conteoHechas}: ${sets
					.slice(0, hechasAgrupadas)
					.map((serie, indice) => `serie ${indice + 1}, ${formatoSet(serie, unidad)}`)
					.join('; ')}`
	);
	$effect(() => {
		// Volver del descanso a corregir apunta a un índice que puede haber quedado guardado
		// en el renglón: sin esto el foco viaja a una fila que no está en pantalla.
		if (filaAbierta != null && filaAbierta < hechasAgrupadas) hechasDesplegadas = true;
	});
	/** Con todo hecho el cierre queda fijo al pie: el contenido tiene que dejarle lugar. */
	const barraFija = $derived(completo && descanso.restoSeg === 0 && !descanso.vencido);
	const sinHistorial = $derived(!cargandoSeries && puntos.length === 0 && anteriores.length === 0);

	function abrirTecnica() {
		if (tecnicaEmbedUrl) {
			tecnicaAbierta = true;
			if (!tecnicaHistoryActiva) {
				const estadoActual =
					history.state && typeof history.state === 'object' ? history.state : {};
				history.pushState({ ...estadoActual, gbTecnica: true }, '', window.location.href);
				tecnicaHistoryActiva = true;
			}
		} else if (ej?.videoUrl) window.open(ej.videoUrl, '_blank', 'noopener,noreferrer');
	}

	function cerrarTecnica() {
		if (!tecnicaAbierta) return;
		tecnicaAbierta = false;
		if (tecnicaHistoryActiva) {
			tecnicaHistoryActiva = false;
			history.back();
		}
	}

	/**
	 * Toques pendientes de confirmar en la base, contados POR ejercicio y fecha. Mientras
	 * haya alguno, la suscripción de ESE ejercicio no pisa `sets` (ver el subscribe).
	 *
	 * La cuenta va por clave y no en un contador único porque "Siguiente" navega a esta
	 * misma ruta con otro id **sin destruir el componente**: un toque todavía en vuelo del
	 * ejercicio anterior hacía descartar la primera emisión del ejercicio nuevo, y como esa
	 * emisión no se repite, la lista quedaba mostrando las series del ejercicio que
	 * acabábamos de dejar.
	 */
	const escriturasPorClave = new Map<string, number>();

	function claveEscritura(exerciseId: string, fecha: string): string {
		return `${exerciseId}|${fecha}`;
	}

	function enVuelo(clave: string): number {
		return escriturasPorClave.get(clave) ?? 0;
	}

	function sumarEnVuelo(clave: string, delta: number): void {
		const total = enVuelo(clave) + delta;
		if (total > 0) escriturasPorClave.set(clave, total);
		else escriturasPorClave.delete(clave);
	}

	/**
	 * Vuelve a poner en pantalla lo que realmente hay en la base. Si una escritura falla,
	 * el valor optimista queda visible y el liveQuery no emite nada (en la base no cambió
	 * nada): sin esto la pantalla muestra para siempre un peso que nunca se guardó.
	 */
	async function resincronizar() {
		const dId = diaId;
		const exId = $page.params.id!;
		const fecha = fechaSesion;
		if (!dId) return;
		try {
			const setsPersistidos = await setsEjercicioSesion(dId, exId, fecha, unidad);
			// Mientras leíamos pudo entrar otro toque o haberse cambiado de pantalla: en
			// cualquiera de los dos casos esta lectura ya quedó vieja y pisar sería peor.
			if (enVuelo(claveEscritura(exId, fecha)) > 0 || diaId !== dId || $page.params.id !== exId)
				return;
			sets = setsPersistidos;
		} catch {
			// Si tampoco se puede leer, el banner de error ya está en pantalla.
		}
	}

	/**
	 * Toda escritura de serie pasa por acá, y ninguna puede quedar sin acuse.
	 *
	 * Un rechazo es el caso fácil. El difícil es `encontrada: false`: la transacción
	 * corrió bien pero no había dónde escribir (la sesión apunta a otra fecha, el
	 * ejercicio ya no está en ella, la serie se quitó desde otro lado). Eso antes era un
	 * `return` mudo con la promesa resolviendo OK, así que la pantalla se quedaba
	 * mostrando un peso que no existía en ningún lado hasta salir y volver a entrar.
	 */
	function escribir(operacion: Promise<ResultadoMutacion>) {
		// La clave se toma acá, sincrónicamente: toda escritura pertenece al ejercicio que
		// estaba en pantalla cuando se tocó, aunque confirme después de haber navegado.
		const clave = claveEscritura($page.params.id!, fechaSesion);
		sumarEnVuelo(clave, 1);
		let desincronizada = false;
		void operacion
			.then((resultado) => {
				if (resultado.encontrada) return;
				errorGuardado =
					'Esa serie ya no está en la sesión. Volvimos a mostrar lo que hay guardado.';
				desincronizada = true;
			})
			.catch((e: unknown) => {
				errorGuardado = e instanceof Error ? e.message : 'No se pudo guardar la serie.';
				desincronizada = true;
			})
			.finally(() => {
				sumarEnVuelo(clave, -1);
				// Con toques todavía en vuelo, resincronizar pisaría un cambio que sí se va a
				// guardar: el último en drenar se hace cargo.
				if (desincronizada && enVuelo(clave) === 0) void resincronizar();
			});
	}

	function guardarDatoSecundario(operacion: Promise<unknown>, mensaje: string) {
		void operacion.catch((error: unknown) => {
			console.error(mensaje, error);
			errorGuardado = `${mensaje} Intentá de nuevo.`;
		});
	}

	function programarGuardadoNota(texto: string) {
		const exerciseId = $page.params.id!;
		notaTexto = texto;
		tieneNota = !!texto.trim();
		notaPendiente = { exerciseId, texto };
		if (notaId) clearTimeout(notaId);
		notaId = setTimeout(() => void guardarNotaPendiente(), 500);
	}

	/** Guarda en serie y vacía antes de ir a segundo plano; nunca escribe en otro ejercicio al navegar. */
	async function guardarNotaPendiente() {
		if (notaId) clearTimeout(notaId);
		notaId = null;
		if (notaGuardandoExerciseId || !notaPendiente) return;
		const pendiente = notaPendiente;
		notaPendiente = null;
		notaGuardandoExerciseId = pendiente.exerciseId;
		try {
			await setNota(pendiente.exerciseId, pendiente.texto);
		} catch (error) {
			errorGuardado = `No se pudo guardar la nota. ${
				error instanceof Error ? error.message : 'Intentá de nuevo.'
			}`;
		} finally {
			notaGuardandoExerciseId = null;
			if (notaPendiente) void guardarNotaPendiente();
		}
	}

	function falloAlRegistrarPr(error: unknown): null {
		console.error('No se pudo actualizar el PR', error);
		errorGuardado = 'La serie quedó guardada, pero no se pudo actualizar el PR. Intentá de nuevo.';
		return null;
	}

	function ajustarPeso(i: number, delta: number) {
		const peso = sumarPeso(sets[i]?.peso, delta);
		if (sets[i]) sets[i].peso = peso;
		escribir(setPeso(diaId!, $page.params.id!, i, peso, fechaSesion, unidad));
	}

	function ajustarReps(i: number, delta: number) {
		const reps = sumarReps(sets[i]?.reps, delta);
		if (sets[i]) {
			sets[i].reps = reps;
			if (reps == null) sets[i].hecha = false;
		}
		if (reps != null) avisoSerie = null;
		escribir(setReps(diaId!, $page.params.id!, i, reps, fechaSesion));
	}

	function ajustarExtra(i: number, delta: number) {
		const extra = sumarPeso(sets[i]?.extraKg, delta);
		if (sets[i]) sets[i].extraKg = extra;
		escribir(setExtra(diaId!, $page.params.id!, i, extra, fechaSesion, unidad));
	}

	function guardarRir(i: number, rir?: number) {
		if (sets[i]) sets[i].rir = rir;
		escribir(setRir(diaId!, $page.params.id!, i, rir, fechaSesion));
	}

	/** Chips de memoria: fija la carga de la vez pasada (o un paso arriba/abajo). */
	function ponerPeso(i: number, peso: number) {
		if (sets[i]) sets[i].peso = peso;
		escribir(setPeso(diaId!, $page.params.id!, i, peso, fechaSesion, unidad));
	}

	function escribirPeso(i: number, el: HTMLInputElement) {
		const peso = leerPeso(el.value);
		if (sets[i]) sets[i].peso = peso;
		escribir(setPeso(diaId!, $page.params.id!, i, peso, fechaSesion, unidad));
		el.value = peso != null ? formatoNumero(peso) : '';
	}

	/**
	 * Quita una serie concreta. El − del contador sigue llamando acá con la última, pero
	 * ahora cada fila puede pedir la suya: antes, para borrar la serie 2 de cuatro había
	 * que borrar la 4, la 3 y la 2 y volver a cargar dos.
	 */
	function quitarSerie(i = sets.length - 1) {
		if (!diaId || sets.length <= 1 || !sets[i]) return;
		// Quitar una serie hecha borra un registro real, así que se avisa qué se lleva.
		toast = {
			mensaje: sets[i].hecha
				? `La serie ${i + 1} está marcada como hecha. Al quitarla se recalculan el progreso y el PR.`
				: `Se quita la serie ${i + 1} de este ejercicio.`,
			accionTexto: 'Quitar',
			onAccion: () => void hacerQuitarSerie(i)
		};
	}

	async function hacerQuitarSerie(i: number) {
		if (!diaId) return;
		toast = null;
		if (filaAbierta === i) filaAbierta = null;
		let instantanea: InstantaneaSesion | null;
		try {
			instantanea = await removeSet(diaId, $page.params.id!, i, fechaSesion);
		} catch (error) {
			errorGuardado = error instanceof Error ? error.message : 'No se pudo quitar la serie.';
			return;
		}
		if (!instantanea) return;
		await resincronizar();
		deshacer.ofrecer(`Serie ${i + 1} quitada.`, diaId, fechaSesion, instantanea);
	}

	/**
	 * "Hice tres de las cuatro y estoy listo". Quita las series sin marcar para que el
	 * ejercicio quede completo con lo que de verdad se hizo.
	 *
	 * Sin esto, destildar o abandonar una serie del medio dejaba el día imposible de
	 * cerrar —`marcarDiaTerminado` exige cada ejercicio hecho o saltado— y la única salida
	 * era saltar el ejercicio entero, que miente sobre las series que sí hiciste.
	 */
	/** Primer tiempo: el botón no reinicia, avisa. Reinicia el aviso. */
	function pedirReinicio() {
		if (!diaId || hechas === 0) return;
		toast = {
			mensaje: `Se desmarcan las ${hechas} ${hechas === 1 ? 'serie hecha' : 'series hechas'} de este ejercicio. El peso y las reps quedan como referencia.`,
			accionTexto: 'Reiniciar',
			onAccion: hacerReinicio
		};
	}

	async function hacerReinicio() {
		if (!diaId) return;
		toast = null;
		descanso.saltar();
		let instantanea: InstantaneaSesion | null;
		try {
			instantanea = await reiniciarEjercicio(diaId, $page.params.id!, fechaSesion);
		} catch (error) {
			errorGuardado = error instanceof Error ? error.message : 'No se pudo reiniciar el ejercicio.';
			return;
		}
		if (!instantanea) return;
		await resincronizar();
		filaAbierta = null;
		deshacer.ofrecer('Ejercicio reiniciado.', diaId, fechaSesion, instantanea);
	}

	function terminarConLoHecho(destino?: string) {
		if (!diaId || hechas === 0 || completo) return;
		const pendientes = sets.length - hechas;
		toast = {
			mensaje: `Se quitan las ${pendientes} ${pendientes === 1 ? 'serie que quedó' : 'series que quedaron'} sin marcar. Lo que hiciste no se toca.`,
			accionTexto: 'Terminar',
			onAccion: () => void hacerCierreParcial(destino)
		};
	}

	async function hacerCierreParcial(destino?: string) {
		if (!diaId) return;
		toast = null;
		const quedan = hechas;
		let resultado: Awaited<ReturnType<typeof cerrarEjercicioConLoHecho>>;
		try {
			resultado = await cerrarEjercicioConLoHecho(diaId, $page.params.id!, fechaSesion);
		} catch (error) {
			errorGuardado = error instanceof Error ? error.message : 'No se pudo cerrar el ejercicio.';
			return;
		}
		if (!resultado.cerrado) {
			errorGuardado = 'No quedó ninguna serie hecha para cerrar el ejercicio.';
			return;
		}
		// El ofrecimiento va ANTES de navegar y vive fuera de esta pantalla: si no, se iba
		// con ella y la acción que borra filas quedaba siendo la única sin vuelta atrás.
		if (resultado.instantanea)
			deshacer.ofrecer(
				`Ejercicio terminado con ${quedan} ${quedan === 1 ? 'serie' : 'series'}.`,
				diaId,
				fechaSesion,
				resultado.instantanea
			);
		// `terminarEjercicio` lee `completo` y `mejorHoy` de los sets locales: hay que traer
		// los persistidos antes, o celebra un cierre parcial que ya dejó de serlo.
		await resincronizar();
		await terminarEjercicio(destino);
	}

	function escribirReps(i: number, el: HTMLInputElement) {
		const reps = leerReps(el.value);
		if (sets[i]) {
			sets[i].reps = reps;
			if (reps == null) sets[i].hecha = false;
		}
		if (reps != null) avisoSerie = null;
		escribir(setReps(diaId!, $page.params.id!, i, reps, fechaSesion));
		el.value = reps != null ? String(reps) : '';
	}

	function marcarFlash(i: number) {
		const previo = flashIds.get(i);
		if (previo) clearTimeout(previo);
		// Reinicia la animación aunque ya estuviera corriendo (toques rápidos consecutivos).
		filasFlash.delete(i);
		filasFlash = new Set(filasFlash);
		requestAnimationFrame(() => {
			filasFlash = new Set(filasFlash).add(i);
			flashIds.set(
				i,
				setTimeout(() => {
					filasFlash.delete(i);
					filasFlash = new Set(filasFlash);
					flashIds.delete(i);
				}, DUR_SLOW)
			);
		});
	}

	async function onToggle(i: number) {
		if (seriesPendientes.has(i)) return;
		const actual = sets[i];
		if (!actual) return;
		const objetivo = !actual.hecha;
		if (objetivo && actual.reps == null) {
			avisoSerie = `Ingresá las repeticiones de la serie ${i + 1} antes de marcarla.`;
			requestAnimationFrame(() =>
				document
					.querySelector<HTMLInputElement>(`[aria-label="Reps de la serie ${i + 1}"]`)
					?.focus({ preventScroll: true })
			);
			return;
		}
		avisoSerie = null;
		// Marcar cierra lo que hubiera abierto a mano: el foco pasa a la serie siguiente.
		// Desmarcar es lo contrario —vas a rehacer esa serie—, así que queda desplegada.
		filaAbierta = objetivo ? null : i;
		// Antes de cualquier await: iOS exige gesto vivo para desbloquear el audio y
		// para pedir el permiso de notificaciones.
		if (objetivo && descansoEj.activo) descanso.prepararDesdeGesto();
		// Respuesta óptima al toque: el check se ve marcado ya, antes de que confirme la base.
		// Si la escritura falla, se revierte más abajo junto con el aviso de error.
		sets[i].hecha = objetivo;
		seriesPendientes = new Set(seriesPendientes).add(i);
		let resultado: Awaited<ReturnType<typeof setSerieHecha>> | undefined;
		try {
			resultado = await setSerieHecha(diaId!, $page.params.id!, i, objetivo, fechaSesion, metrica);
		} catch (e) {
			if (sets[i]) sets[i].hecha = !objetivo;
			errorGuardado = e instanceof Error ? e.message : 'No se pudo guardar la serie.';
			return;
		} finally {
			const pendientes = new Set(seriesPendientes);
			pendientes.delete(i);
			seriesPendientes = pendientes;
		}
		if (!resultado?.encontrada) {
			if (sets[i]) sets[i].hecha = !objetivo;
			errorGuardado = 'La serie ya no existe. Se actualizó la pantalla.';
			return;
		}
		if (sets[i]) sets[i].hecha = resultado.hecha ?? sets[i].hecha;
		if (!resultado.cambio) return;
		if (!resultado.hecha) {
			// Desmarcar es sobrio: sin glow, sin sonido, sin demora antes de saltar el descanso.
			descanso.saltar();
			return;
		}

		// Recién confirmado por la base: ahora sí se celebra el microfeedback de la fila.
		marcarFlash(i);

		// ¿Esta serie acaba de marcar un PR? La decisión la toma la base adentro de la
		// transacción: acá los derivados pueden venir de un liveQuery que todavía no
		// emitió, y con el dato viejo el mismo récord se celebraba dos veces.
		const nuevoPr = await registrarPrSiSupera(
			diaId!,
			$page.params.id!,
			i,
			metrica,
			fechaSesion,
			unidad
		).catch(falloAlRegistrarPr);
		if (nuevoPr) {
			celebrarPrFlash(nuevoPr);
		} else {
			if (sonidoActivo) void sonarSetHecho().catch(() => {});
			// Háptica breve: el switch de silencio de iOS puede mutear el audio, la vibra no.
			vibrar(20, vibracionActiva);
		}

		if (resultado.ejercicioCompleto) {
			mostrarHintTimer = false;
			descanso.saltar();
		} else if (descansoEj.activo) {
			// El check y el glow de la fila necesitan un instante para percibirse antes
			// de que el descanso tape la pantalla con su propia barra.
			if (restoId) clearTimeout(restoId);
			// Se congela acá lo que quedó guardado: el overlay lo muestra para que el
			// peso recién tipeado pueda verificarse sin desarmar el descanso.
			const registrada = {
				texto: `Serie ${i + 1} · ${formatoSet(sets[i]!, unidad)}`,
				setIndex: i,
				exerciseId: $page.params.id!,
				href: `/ejercicio/${$page.params.id}?dia=${diaId}&fecha=${fechaSesion}`
			};
			const minutos = descansoEj.minutos;
			restoId = setTimeout(() => {
				descanso.iniciar(
					minutos,
					g?.glow ?? '124 92 255',
					etiquetaProximaSerie(sets, i, ej?.nombre ?? ''),
					registrada
				);
			}, 220);
		} else if (debeMostrarHintTimer()) {
			// Timer apagado: sugerir activarlo (una sola vez) para que avise cuándo volver.
			mostrarHintTimer = true;
		}
	}

	function activarDescansoDesdeHint() {
		// Mismo camino que el interruptor: "activar" tiene que significar una sola cosa.
		encenderDescanso();
		descartarHintTimer();
	}

	/**
	 * El usuario tocó "corregir" en el descanso: vuelve a la fila de esa serie y le
	 * pone el foco en las reps, que es donde suele estar el error.
	 */
	$effect(() => {
		const pedido = descanso.correccionPedida;
		if (pedido === 0) return;
		const registrada = untrack(() => descanso.registrada);
		const indice = registrada?.setIndex;
		// El descanso es global: el pedido puede haber salido de otro ejercicio (o de otra
		// pantalla). Sin este filtro, entrar a cualquier ejercicio con un pedido viejo
		// abría y enfocaba la fila de ese índice acá, que no es la serie de nadie.
		if (indice == null || registrada?.exerciseId !== $page.params.id) return;
		// La serie ya está hecha, así que su fila está contraída: hay que abrirla antes
		// de buscarle el campo de reps.
		filaAbierta = indice;
		// Plazo en milisegundos y no en cuadros: lo que se espera es que termine la
		// transición del overlay, y con el teléfono ocupado 40 cuadros pueden ser una
		// fracción de ese tiempo. Contando cuadros, el foco se rendía antes de tiempo.
		const limite = performance.now() + 1500;
		let frame = 0;
		const enfocarFila = () => {
			const campo = document.querySelector<HTMLInputElement>(
				`[aria-label="Reps de la serie ${indice + 1}"]`
			);
			// El overlay se va con transición y, hasta que termina, `modal` mantiene el
			// fondo `inert`: un focus() sobre la fila se descarta en silencio. Se reintenta
			// por frame hasta que la fila vuelve a ser enfocable.
			if (campo && !campo.closest('[inert]')) {
				campo.scrollIntoView({ block: 'center', behavior: menosMovimiento() ? 'auto' : 'smooth' });
				campo.focus({ preventScroll: true });
				// El acuse va acá y no arriba: `correccionAtendida` toca la misma señal de la que
				// depende este efecto, así que reiniciarlo antes de tiempo cancelaba —vía teardown—
				// el requestAnimationFrame que justamente iba a poner este foco.
				descanso.correccionAtendida();
				return;
			}
			if (performance.now() < limite) frame = requestAnimationFrame(enfocarFila);
			else descanso.correccionAtendida();
		};
		frame = requestAnimationFrame(enfocarFila);
		return () => cancelAnimationFrame(frame);
	});

	function descartarHintTimer() {
		ocultarHintTimer();
		mostrarHintTimer = false;
	}

	/** Recompensa especial inmediata por PR: no bloquea el registro (pointer-events-none). */
	function celebrarPrFlash(mejor: PrGanado) {
		prFlash = mejor;
		if (sonidoActivo) void sonarExito(true).catch(() => {});
		vibrar([120, 70, 180], vibracionActiva);
		if (prFlashId) clearTimeout(prFlashId);
		prFlashId = setTimeout(() => (prFlash = null), 1700);
	}

	/** A dónde se va al cerrar: al siguiente ejercicio si lo hay, o de vuelta al día. */
	let destinoCierre = $state('');

	/** Cerrar con el toque: no esperar los 2,3 s de la fanfarria si ya la viste. */
	function cerrarCelebracion() {
		if (!exito) return;
		if (exitoId) clearTimeout(exitoId);
		exitoId = null;
		goto(destinoCierre || volver);
	}

	async function terminarEjercicio(destino?: string) {
		if (!diaId || exito) return;
		descanso.saltar();
		if (prFlashId) clearTimeout(prFlashId);
		prFlash = null;
		destinoCierre = destino ?? volver;
		// Sin series hechas no hay nada que celebrar: salida directa y en silencio.
		if (hechas === 0) {
			goto(destinoCierre);
			return;
		}
		// PR honesto: solo cuentan las series realmente marcadas ✓ (no fabrica nada).
		// Igual que al marcar, quien decide es la transacción; acá solo se elige qué
		// serie proponer (la mejor hecha bajo la métrica vigente).
		const mejor = mejorHoy;
		const candidato = mejor?.setIndex;
		const ganado =
			candidato != null
				? await registrarPrSiSupera(
						diaId,
						$page.params.id!,
						candidato,
						metrica,
						fechaSesion,
						unidad
					).catch(falloAlRegistrarPr)
				: null;
		const esPr = ganado != null;
		// La fanfarria es para el ejercicio completo (o PR); cierre parcial = sobrio.
		exito = esPr ? 'pr' : completo ? 'normal' : 'parcial';
		prExito = ganado;
		if (exito !== 'parcial') {
			if (sonidoActivo) void sonarExito(esPr).catch(() => {});
			vibrar(esPr ? [120, 70, 180] : 80, vibracionActiva);
		}
		if (exitoId) clearTimeout(exitoId);
		exitoId = setTimeout(
			() => goto(destinoCierre || volver),
			esPr ? 2300 : exito === 'parcial' ? 900 : 1200
		);
	}

	/** Sin descanso en ESTE ejercicio (0), sin tocar el de los demás. */
	function apagarDescansoEjercicio() {
		if (!ej) return;
		// Se recuerda antes de pisarlo con el 0, para que volver a encender no cueste
		// reelegir el valor (ver `propioAntesDeApagar`).
		propioAntesDeApagar = descansoPropio != null && descansoPropio > 0 ? descansoPropio : null;
		descanso.saltar();
		guardarDatoSecundario(
			setDescansoEjercicio(ej.id, 0),
			'No se pudo guardar el descanso del ejercicio.'
		);
	}

	/** Sin valor propio: este ejercicio vuelve a seguir el descanso general. */
	function descansoAutomatico() {
		if (!ej) return;
		propioAntesDeApagar = null;
		guardarDatoSecundario(
			setDescansoEjercicio(ej.id),
			'No se pudo guardar el descanso del ejercicio.'
		);
		if (ajustes.timer.activo) descanso.ajustarFin(ajustes.timer.minutos);
		else descanso.saltar();
	}

	function cambiarDescansoEjercicio(minutos: number) {
		if (!ej) return;
		guardarDatoSecundario(
			setDescansoEjercicio(ej.id, minutos),
			'No se pudo guardar el descanso del ejercicio.'
		);
		// Si hay un descanso en curso, ajusta su fin en vez de reiniciarlo desde cero.
		descanso.ajustarFin(minutos);
	}

	/**
	 * Encender vuelve al último valor propio si lo había; si no, deja que el ejercicio
	 * siga al general —que es su estado natural— y sólo escribe un valor propio cuando el
	 * general está apagado y no habría nada que seguir.
	 */
	function encenderDescanso() {
		if (!ej) return;
		if (propioAntesDeApagar != null) cambiarDescansoEjercicio(propioAntesDeApagar);
		else if (ajustes.timer.activo) descansoAutomatico();
		else cambiarDescansoEjercicio(ajustes.timer.minutos || 2);
		propioAntesDeApagar = null;
	}

	/** El interruptor de la fila. */
	function alternarDescanso() {
		if (descansoEj.activo) apagarDescansoEjercicio();
		else encenderDescanso();
	}

	/** Soltó la rueda de la hoja: recién ahora el valor es una decisión y se guarda. */
	function elegirDescanso(minutos: number) {
		propioAntesDeApagar = null;
		cambiarDescansoEjercicio(minutos);
	}
</script>

<svelte:document
	onvisibilitychange={() => {
		if (document.visibilityState === 'hidden') void guardarNotaPendiente();
	}}
/>

{#if !ej || !g}
	<main class="glow-bg grid min-h-dvh place-items-center px-5">
		<section
			class="w-full max-w-sm rounded-2xl border border-dashed border-white/15 p-5 text-center"
		>
			<p class="text-sm font-bold">Ejercicio no encontrado</p>
			<p class="mt-1 text-xs leading-relaxed" style="color: var(--muted)">
				Pudo haber sido eliminado del catálogo. Su historial guardado no fue modificado y esta URL
				no puede crear series nuevas.
			</p>
			<div class="mt-4 grid grid-cols-2 gap-2">
				<a
					href={diaId ? volver : '/'}
					class="grid min-h-11 place-items-center rounded-xl border border-white/10 px-3 text-sm font-bold"
				>
					{diaId ? 'Volver al día' : 'Ir a rutinas'}
				</a>
				<a
					href="/historial"
					class="grid min-h-11 place-items-center rounded-xl px-3 text-sm font-bold"
					style="background: var(--accent); color: var(--on-accent)"
				>
					Ver historial
				</a>
			</div>
		</section>
	</main>
{:else}
	<main
		class="gb-page gb-page--exercise px-5 pb-28 {diaId
			? 'min-h-dvh gb-page--training'
			: 'min-h-[calc(100dvh-var(--gb-nav))]'}"
		style="background: radial-gradient(85% 42% at 50% 0%, rgb({g.glow} / 0.20), transparent 72%), var(--bg)"
	>
		<div class={diaId ? 'gb-exercise-layout' : ''}>
			<div class="gb-exercise-intro">
				<header class="gb-exercise-header mb-4 flex items-center gap-3">
					<a
						href={volver}
						class="grid size-11 shrink-0 place-items-center rounded-full border border-white/10"
						aria-label="Volver"><Icono nombre="volver" /></a
					>
					{#if !videoGrande}
						<button
							onclick={() => setVideoGrande(true)}
							class="gb-thumb-frame shrink-0 overflow-hidden rounded-xl"
							aria-label="Ver demostración en grande"
						>
							<video
								use:demostracionActiva={ej.demoVideo}
								class="size-12 object-contain"
								autoplay
								loop
								muted
								playsinline
								preload="metadata"
							></video>
						</button>
					{/if}
					<div class="min-w-0 flex-1">
						<h1 class="text-lg font-bold leading-tight">{ej.nombre}</h1>
						<p class="mt-0.5 text-xs font-medium" style="color: rgb({g.glow})">
							{g.emoji}
							{g.label} · {ej.musculo}
						</p>
					</div>
				</header>

				{#if videoGrande}
					<button
						onclick={() => setVideoGrande(false)}
						class="gb-exercise-demo gb-demo-frame block w-full"
						style="--frame-glow: {g.glow}"
						aria-label="Achicar demostración"
					>
						<video
							use:demostracionActiva={ej.demoVideo}
							class="gb-exercise-demo-video gb-media-ivory mx-auto aspect-square w-full max-w-xs rounded-2xl object-contain"
							aria-label={ej.nombre}
							autoplay
							loop
							muted
							playsinline
							preload="auto"
						></video>
					</button>
				{/if}

				{#if ej.videoUrl}
					<div class="mt-3 flex justify-center">
						<button
							onclick={abrirTecnica}
							class="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold"
							style="color: rgb({g.glow})"
							aria-label={`Ver video de técnica para ${ej.nombre}`}
							><Icono nombre="tecnica" tamano={16} /> Ver técnica</button
						>
					</div>
				{/if}
			</div>

			{#if fechaUrlInvalida}
				<section
					class="mt-6 rounded-2xl border border-dashed border-white/15 p-5 text-center"
					role="alert"
				>
					<p class="text-sm font-bold">La fecha de esta sesión no es válida</p>
					<p class="mt-1 text-xs leading-relaxed" style="color: var(--muted)">
						No se creó ni modificó ningún entrenamiento.
					</p>
					<a
						href={diaId ? `/ejercicio/${$page.params.id}?dia=${diaId}` : '/historial'}
						class="mt-4 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold"
						style="background: var(--accent); color: var(--on-accent)"
					>
						{diaId ? 'Abrir la sesión de hoy' : 'Volver al historial'}
					</a>
				</section>
			{:else if ejercicioNoDisponible}
				<section
					class="mt-6 rounded-2xl border border-dashed border-white/15 p-5 text-center"
					style="background: var(--surface)"
					role="alert"
				>
					<!-- El motivo lo decide el dominio: la pantalla no lo adivina. Decir "ya no
					     está en la rutina" cuando en realidad la fecha era futura sería inventar. -->
					<p class="text-sm font-bold">
						{ejercicioNoDisponible === 'fecha-futura'
							? 'Todavía no entrenaste ese día'
							: 'Este ejercicio ya no está en la rutina'}
					</p>
					<p class="mt-1 text-xs leading-relaxed" style="color: var(--muted)">
						{ejercicioNoDisponible === 'fecha-futura'
							? 'Esa fecha no llegó: no se creó ninguna sesión. Volvé al día para entrenar hoy.'
							: 'No se creó ninguna sesión nueva. Volvé al día para elegir otro ejercicio.'}
					</p>
					<a
						href={volver}
						class="mt-4 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold"
						style="background: var(--accent); color: var(--on-accent)"
					>
						Volver al día
					</a>
				</section>
			{:else if !diaId}
				<!-- Sin ?dia= no se entrena: vista de consulta con el progreso completo. -->
				<section
					class="mt-6 rounded-2xl border border-white/10 p-4"
					style="background: var(--surface)"
				>
					<div class="flex items-start justify-between gap-3">
						<div>
							<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
								Métrica de PR
							</p>
							<p class="mt-1 text-sm font-bold">
								{modo === 'reps'
									? 'Repeticiones máximas'
									: metrica === 'e1rm'
										? '1RM estimado'
										: 'Peso máximo'}
							</p>
						</div>
						{#if modo !== 'reps'}<span
								class="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold"
								style="color: var(--muted)"
								>{metricaOverride ? 'Personalizada' : 'Usa Ajustes'}</span
							>{/if}
					</div>
					{#if modo === 'reps'}
						<p class="mt-2 text-xs leading-relaxed" style="color: var(--muted)">
							{DESCRIPCION_METRICA.reps}
						</p>
					{:else}
						<div
							class="mt-3 grid grid-cols-3 gap-2"
							aria-label="Métrica de récord para este ejercicio"
						>
							<button
								type="button"
								onclick={() => void setMetricaPrEjercicio($page.params.id!)}
								aria-pressed={!metricaOverride}
								class="min-h-11 rounded-xl px-2 text-xs font-bold"
								style={!metricaOverride
									? 'background: var(--accent); color: var(--on-accent)'
									: 'background: rgba(255,255,255,.06); color: var(--muted)'}>General</button
							>
							<button
								type="button"
								onclick={() => void setMetricaPrEjercicio($page.params.id!, 'peso')}
								aria-pressed={metricaOverride === 'peso'}
								class="min-h-11 rounded-xl px-2 text-xs font-bold"
								style={metricaOverride === 'peso'
									? 'background: var(--accent); color: var(--on-accent)'
									: 'background: rgba(255,255,255,.06); color: var(--muted)'}>Peso máx.</button
							>
							<button
								type="button"
								onclick={() => void setMetricaPrEjercicio($page.params.id!, 'e1rm')}
								aria-pressed={metricaOverride === 'e1rm'}
								class="min-h-11 rounded-xl px-2 text-xs font-bold"
								style={metricaOverride === 'e1rm'
									? 'background: var(--accent); color: var(--on-accent)'
									: 'background: rgba(255,255,255,.06); color: var(--muted)'}>1RM est.</button
							>
						</div>
						<p class="mt-2 text-xs leading-relaxed" style="color: var(--muted)">
							{DESCRIPCION_METRICA[metrica]}
						</p>
					{/if}
				</section>
				{#if Progreso}
					<Progreso
						exerciseId={$page.params.id!}
						glow={g.glow}
						{unidad}
						{metrica}
						{pasoPeso}
						maquinaPlacas={!!ej.maquinaPlacas}
						modoEsfuerzo={ajustes.modoEsfuerzo ?? 'off'}
					/>
				{:else if errorProgreso}
					<div
						class="mt-6 rounded-2xl border border-white/10 p-4 text-center text-sm"
						style="color: var(--muted)"
					>
						<p>No se pudo cargar el progreso.</p>
						<button
							onclick={() => (intentoProgreso += 1)}
							class="mt-3 min-h-11 rounded-xl px-4 font-bold"
							style="background: rgb({g.glow} / .18); color: rgb({g.glow})">Reintentar</button
						>
					</div>
				{:else}
					<p class="mt-6 text-center text-sm" style="color: var(--muted)">Cargando progreso…</p>
				{/if}
			{:else}
				<div class="gb-exercise-work {barraFija ? 'pb-36' : ''}">
					{#if !esDeHoy}
						<!--
							Desde el historial se puede volver a entrenar un día pasado: hay que decirlo.
							Y se compara contra el reloj VIVO, no contra el de cuando se abrió la
							pantalla: cruzando la medianoche entrenando, este cartel es lo único que
							avisa que la sesión que seguís llenando ya no es la de hoy.
						-->
						<p
							class="mt-4 rounded-xl px-3 py-2.5 text-xs font-semibold"
							style="background: rgb(var(--max) / .1); color: rgb(var(--max))"
						>
							Estás editando el entrenamiento del {fechaCorta(fechaSesion)}, no el de hoy.
						</p>
					{:else if sesionAnterior}
						<AvisoSesionAnterior aviso={sesionAnterior} href={hrefSesionAnterior} />
					{/if}
					<section
						class="mt-6 rounded-2xl border border-white/10 p-4"
						style="background: var(--surface)"
					>
						<div class="flex items-start justify-between gap-3">
							<div>
								<p
									class="text-xs font-semibold uppercase tracking-wider"
									style="color: var(--muted)"
								>
									Series
									{#if ej.maquinaPlacas && !mostrarHintMax}
										<button
											onclick={() => (mostrarHintMax = true)}
											class="ml-1 inline-grid size-11 place-items-center align-middle"
											style="color: var(--muted)"
											aria-label="Qué es MAX"><Icono nombre="info" tamano={16} /></button
										>
									{/if}
								</p>
								<!--
									La unidad vive acá y no en cada renglón: repetida cuatro veces se comía
									30 px por fila y el dato de la lista es el número, no cómo se llama.
									En los ejercicios sin carga no se nombra, porque no habría qué medir.
								-->
								<p
									class="mt-0.5 text-[11px] font-medium uppercase tracking-wider"
									style="color: var(--muted)"
								>
									Sesión actual{modo === 'reps' ? '' : ` · ${unidad}`}
								</p>
								{#if anterioresFecha}
									<p class="mt-0.5 text-[11px] font-medium" style="color: var(--muted)">
										Última vez · {fechaCorta(anterioresFecha)}
									</p>
								{/if}
							</div>
							{#if cargandoSeries}
								<p class="text-xs font-bold" style="color: var(--muted)">Preparando…</p>
							{:else}
								<!-- Un solo control: hechas/total adentro del stepper de series de hoy -->
								<div class="flex items-center rounded-full bg-white/5 p-0.5">
									<button
										onclick={() => quitarSerie()}
										disabled={sets.length <= 1}
										class="grid size-11 touch-manipulation place-items-center rounded-full text-sm font-bold disabled:opacity-35"
										style="color: var(--muted)"
										aria-label="Quitar la última serie de hoy">−</button
									>
									<span
										class="min-w-11 text-center text-sm font-bold tabular-nums {contadorPop
											? 'gb-pop'
											: ''}"
										style="color: {completo ? `rgb(${g.glow})` : 'var(--text)'}"
										aria-label={`${hechas} de ${sets.length} series hechas`}
										>{hechas}/{sets.length}</span
									>
									<button
										onclick={() => escribir(addSet(diaId, $page.params.id!, fechaSesion))}
										class="grid size-11 touch-manipulation place-items-center rounded-full text-sm font-bold"
										style="background: rgb({g.glow} / .18); color: rgb({g.glow})"
										aria-label="Agregar serie de hoy">+</button
									>
								</div>
							{/if}
						</div>
						{#if cargandoSeries}
							<p
								class="mt-3 rounded-xl bg-white/[0.025] p-4 text-center text-sm"
								style="color: var(--muted)"
							>
								Preparando series…
							</p>
						{:else}
							{#if avisoSerie}
								<p
									class="mt-3 rounded-xl px-3 py-2.5 text-xs font-semibold leading-relaxed"
									style="background: rgb(var(--max) / .1); color: rgb(var(--max))"
									role="alert"
								>
									{avisoSerie}
								</p>
							{/if}
							<!-- 10 px entre renglones: con 8 y ocho series hechas la lista se apelmaza. -->
							<div class="mt-3 space-y-2.5">
								{#if hechasAgrupadas > 0}
									<!--
										Lo hecho, en un renglón: la primera de las tres zonas fijas de la lista. Manda la
										cifra —las cargas— y el conteo va abajo y chico; el rótulo es lo que menos
										información lleva y antes era lo más brillante del renglón.
										Se abre tocándolo, y el texto de la derecha dice cuál de las dos cosas hace.
									-->
									<button
										type="button"
										onclick={() => (hechasDesplegadas = !hechasDesplegadas)}
										aria-expanded={hechasDesplegadas}
										class="gb-relieve-suave flex min-h-14 w-full flex-col justify-center gap-1 rounded-xl px-3 py-2.5 text-left"
										style="background: rgb(var(--exito) / .07); border: 1px solid rgb(var(--exito) / .2)"
										aria-label={etiquetaGrupoHechas}
									>
										<!--
											El conteo y el verbo comparten el primer renglón para que la cifra se
											quede con el segundo entero. Compartiendo línea con "Ver todas" le
											quedaban 150 px y cuatro series se cortaban en "+1 · 62,5×10 · 6…":
											el resumen truncado no resume nada.
										-->
										<span class="flex w-full items-center gap-2">
											<span class="shrink-0" style="color: rgb(var(--exito))" aria-hidden="true">
												<Icono nombre="hecha" tamano={18} />
											</span>
											<span
												class="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wider"
												style="color: rgb(var(--exito))">{conteoHechas}</span
											>
											<span
												class="flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider"
												style="color: var(--muted)"
											>
												{hechasDesplegadas ? 'Ocultar' : 'Ver todas'}
												<span
													class="gb-caret {hechasDesplegadas ? 'gb-caret--abierto' : ''}"
													aria-hidden="true"><Icono nombre="desplegar" tamano={14} /></span
												>
											</span>
										</span>
										{#if !hechasDesplegadas}
											<!--
												Sin marca de que el resumen viene cortado. Hubo un "+1 ·" y después un
												"…", y ninguno de los dos se entendía: el "+" choca de frente con el
												delta de las filas de abajo, donde "+2,5" son los kilos que subiste. Con
												el conteo arriba ("5 series hechas") y tres pares a la vista, que hay más
												se deduce solo, y el renglón se queda con las cifras y nada más.
											-->
											<span
												class="cifra gb-resumen-series w-full truncate text-lg"
												style="color: #c2c6d6"
												aria-hidden="true"
												>{resumenHechas.inicio}{#if resumenHechas.unidad}<span
														class="cifra-u cifra-u--fila"
														>{resumenHechas.unidad === 'peso' ? unidad : 'reps'}</span
													>{/if}{resumenHechas.resto}</span
											>
										{/if}
									</button>
								{/if}
								{#each sets as s, i (i)}
									{#if i >= hechasOcultas}
										<SetRow
											set={s}
											index={i}
											anterior={anteriores[i]}
											maquinaPlacas={!!ej.maquinaPlacas}
											glow={g.glow}
											{unidad}
											{pasoPeso}
											activa={i === indiceActiva}
											abierta={i === filaAbierta}
											pendiente={seriesPendientes.has(i)}
											flash={filasFlash.has(i)}
											onToggle={() => onToggle(i)}
											onToggleMax={() =>
												escribir(toggleMax(diaId, $page.params.id!, i, fechaSesion))}
											onAjustarPeso={(d) => ajustarPeso(i, d)}
											onPonerPeso={(peso) => ponerPeso(i, peso)}
											onEscribirPeso={(el) => escribirPeso(i, el)}
											onAjustarReps={(d) => ajustarReps(i, d)}
											onEscribirReps={(el) => escribirReps(i, el)}
											onAjustarExtra={(d) => ajustarExtra(i, d)}
											modoEsfuerzo={ajustes.modoEsfuerzo}
											onSetRir={(rir) => guardarRir(i, rir)}
											onAbrir={() => (filaAbierta = i)}
											onCerrar={() => (filaAbierta = null)}
											onQuitar={() => quitarSerie(i)}
											puedeQuitar={sets.length > 1}
										/>
									{/if}
								{/each}
							</div>
							{#if completo}
								<!--
									El momento exacto del arrepentimiento: recién terminaste y querés una más, o
									una de las que marcaste estaba mal. Las dos cosas se podían hacer, pero nada
									en pantalla lo decía: el ✓ verde de la fila lee como estado, no como botón.
								-->
								<p
									class="mt-2 rounded-xl border border-white/5 p-2.5 text-xs leading-relaxed"
									style="background: var(--surface-2); color: var(--muted)"
								>
									Ejercicio completo. ¿Va una más? Tocá <b style="color: rgb({g.glow})">+</b>. ¿Te
									equivocaste en una? Tocá esa serie para corregirla o desmarcarla.
								</p>
							{/if}
							{#if sinHistorial}
								<!--
									Es un consejo, no una alarma: va en superficie neutra. Con el color del
									grupo, en pecho (255 122 92) y piernas (255 111 174) el cartel se leía como
									una advertencia roja por decir algo que no tiene nada de malo.
								-->
								<div
									class="mt-2 flex items-start gap-2 rounded-xl border border-white/5 p-2.5"
									style="background: var(--surface-2)"
								>
									<Icono nombre="consejo" tamano={16} clase="mt-0.5 shrink-0" />
									<p class="flex-1 text-xs leading-relaxed" style="color: var(--muted)">
										Todavía no hay series completadas para este ejercicio. Empezá con un peso que te
										deje hacer ~12 repeticiones cómodas y ajustá la próxima.
									</p>
								</div>
							{/if}
							{#if mostrarHintMax}
								<div
									class="mt-2 flex items-start gap-2 rounded-xl p-2.5"
									style="background: rgb(var(--max) / .08)"
								>
									<Icono nombre="consejo" tamano={16} clase="mt-0.5 shrink-0" />
									<p class="flex-1 text-xs leading-relaxed" style="color: var(--muted)">
										¿Llegaste al tope de la pila de placas? Marcá <b style="color: rgb(var(--max))"
											>MAX</b
										> en esa serie y anotá los kg extra que pongas encima.
									</p>
									<button
										onclick={entendidoHintMax}
										class="min-h-11 shrink-0 px-2 text-xs font-bold"
										style="color: rgb(var(--max))">Entendido</button
									>
								</div>
							{/if}
						{/if}

						<!--
							El descanso, en un renglón: un interruptor y el valor.

							Eran ocho botones en dos filas (Auto, Off y cuatro atajos, más "Otro" y la
							rueda que se desplegaba abajo): 145 px fijos de la tarjeta de entrenar —450
							con la rueda abierta— para un valor que se elige una vez y no se vuelve a
							tocar. Los atajos se fueron porque la rueda los cubre a todos, y "Auto" dejó
							de ser un botón porque es el estado en el que ya está un ejercicio al que
							nunca le elegiste nada; volver a él vive en la hoja.

							El lugar natural para decidir cuánto descansar es mientras descansás, así
							que la misma rueda está en el descanso a pantalla completa y lo que elijas
							ahí queda guardado acá.
						-->
						<div class="gb-rest-presets mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
							<span
								class="flex shrink-0 items-center gap-1.5 text-xs font-semibold"
								style="color: var(--muted)"
							>
								<Icono nombre="descanso" tamano={15} /> Descanso
							</span>
							<span class="flex-1"></span>
							{#if descansoEj.activo}
								<!-- El estado va en el rótulo, no sólo en la posición de la perilla. -->
								<button
									onclick={() => (hojaDescanso = true)}
									class="flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-bold tabular-nums"
									style="background: rgba(255,255,255,.06)"
									aria-label={`Cambiar el descanso de este ejercicio, hoy de ${etiquetaDescanso(
										descansoEj.minutos
									)}`}
								>
									{relojDescanso(descansoEj.minutos)}
									<Icono nombre="rueda" tamano={14} />
								</button>
							{:else}
								<span class="text-xs font-semibold" style="color: var(--muted)">Sin descanso</span>
							{/if}
							<button
								role="switch"
								aria-checked={descansoEj.activo}
								onclick={alternarDescanso}
								class="gb-switch shrink-0"
								class:gb-switch--on={descansoEj.activo}
								style="--switch-glow: {g.glow}"
								aria-label="Descanso en este ejercicio"
							>
								<span class="gb-switch-via" aria-hidden="true"
									><span class="gb-switch-perilla"></span></span
								>
							</button>
						</div>
						{#if mostrarHintTimer}
							<div
								class="mt-2 flex items-center gap-2 rounded-xl border border-white/5 p-2.5"
								style="background: var(--surface-2)"
							>
								<Icono nombre="consejo" tamano={16} clase="shrink-0" />
								<p class="flex-1 text-xs leading-relaxed" style="color: var(--muted)">
									¿Activar el descanso? Te avisa cuándo volver a la serie.
								</p>
								<button
									onclick={activarDescansoDesdeHint}
									class="min-h-11 shrink-0 rounded-full px-3 text-xs font-bold"
									style="background: var(--accent); color: var(--on-accent)">Activar</button
								>
								<button
									onclick={descartarHintTimer}
									class="min-h-11 shrink-0 px-2 text-xs font-bold"
									style="color: var(--muted)">Ahora no</button
								>
							</div>
						{/if}
					</section>

					{#if pr}
						<section
							class="mt-3 rounded-2xl border border-white/10 p-4"
							style="background: var(--surface)"
						>
							<!--
								Tres cosas a la vista: qué récord es, cuánto, y de qué serie salió. La
								explicación de la métrica y la equivalencia con la otra son útiles una vez
								y estorban en todas las demás: viven detrás de "¿Qué mide?".
							-->
							<div class="flex items-center justify-between gap-2">
								<p
									class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider"
									style="color: var(--muted)"
								>
									<Icono nombre="record" tamano={14} /> Récord · {metricaLabel}
								</p>
								{#if superado}
									<span
										class="rounded-full px-2 py-0.5 text-xs font-bold"
										style="background: rgb({g.glow} / .2); color: rgb({g.glow})">Nuevo</span
									>
								{/if}
							</div>
							<p class="cifra mt-1.5 text-[3.4rem]">
								{formatoNumero(pr.valor)}<span class="cifra-u">{unidadValor}</span>
							</p>
							<p
								class="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs"
								style="color: var(--muted)"
							>
								<span class="cifra text-lg" style="color: var(--text)"
									>{formatoSet(pr, unidad)}</span
								>
								<span>· {fechaCorta(pr.fecha)}</span>
							</p>
							<MiniChart {puntos} glow={g.glow} {metricaLabel} unidad={unidadValor} />
							<div class="mt-1 flex items-center justify-between gap-2">
								<button
									type="button"
									onclick={() => (mostrarQueMide = !mostrarQueMide)}
									aria-expanded={mostrarQueMide}
									class="min-h-11 text-[11px] font-bold uppercase tracking-wider"
									style="color: var(--muted)">{mostrarQueMide ? 'Ocultar' : '¿Qué mide?'}</button
								>
								<!-- Link discreto: la operación manda, el progreso completo se consulta aparte. -->
								<a
									href={`/ejercicio/${$page.params.id}?desde=${diaId}&fecha=${fechaSesion}`}
									class="min-h-11 text-xs font-bold leading-[2.75rem]"
									style="color: rgb({g.glow})">Progreso completo →</a
								>
							</div>
							{#if mostrarQueMide}
								<p
									class="border-t border-white/5 pt-2 text-[11px] leading-relaxed"
									style="color: var(--muted)"
								>
									{DESCRIPCION_METRICA[metricaEfectiva]}{#if valorOtraPr != null}
										Ese mismo set equivale a ≈ {formatoNumero(valorOtraPr)}
										{unidad} como {otraLabel}.{/if}
								</p>
							{/if}
						</section>
					{:else if !cargandoSeries}
						<section
							class="mt-3 rounded-2xl border border-dashed border-white/15 p-4 text-center"
							style="background: var(--surface)"
						>
							<div class="flex justify-center" style="color: var(--muted)">
								<Icono nombre="record" tamano={26} />
							</div>
							<p class="mt-1 text-sm font-semibold">Todavía sin PR</p>
							<p class="mt-0.5 text-xs" style="color: var(--muted)">
								Marcá una serie como hecha para registrar tu primer récord de {metricaLabel}.
							</p>
						</section>
					{/if}

					<details
						class="mt-3 rounded-2xl border border-white/10 px-4 py-2"
						style="background: var(--surface)"
					>
						<summary
							class="flex min-h-11 cursor-pointer items-center text-sm font-medium"
							style="color: var(--muted)"
						>
							<Icono nombre="notas" tamano={17} clase="mr-2" /> Notas
							{#if tieneNota}<span class="ml-1.5" style="color: rgb({g.glow})">●</span>{/if}
						</summary>
						<textarea
							bind:value={notaTexto}
							oninput={(evento) => programarGuardadoNota(evento.currentTarget.value)}
							onblur={() => void guardarNotaPendiente()}
							placeholder="Ej: asiento en posición 4, agarre cerrado…"
							rows="3"
							class="mt-2 w-full resize-none rounded-lg bg-white/5 p-3 text-sm outline-none"
						></textarea>
					</details>

					{#if barraFija}
						<!-- Con todo hecho, el cierre queda fijo al alcance del pulgar. Si queda
						     algo pendiente en la rutina, el primario encadena directo con eso:
						     volver a la lista para buscar el siguiente era un viaje por ejercicio. -->
						<div
							transition:fly={{ y: 40, duration: dur(200) }}
							class="gb-exercise-finish-bar fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-5 pt-6"
							style="padding-bottom: calc(1.25rem + var(--safe-bottom)); background: linear-gradient(transparent, rgb(var(--scrim) / .92) 55%)"
						>
							{#if proximo && hrefProximo}
								<button
									onclick={() => terminarEjercicio(hrefProximo)}
									disabled={!!exito}
									class="block w-full rounded-2xl px-4 py-4 text-center font-bold"
									style="background: rgb({g.glow}); color: var(--on-bright)"
								>
									{#if exito}
										Cerrando…
									{:else}
										<span class="block truncate">Siguiente: {proximo.nombre} →</span>
									{/if}
								</button>
								<button
									onclick={() => terminarEjercicio()}
									disabled={!!exito}
									class="mt-2 block w-full rounded-2xl py-3 text-center text-sm font-bold"
									style="background: rgba(255,255,255,.08); color: var(--muted)"
									>Volver al día</button
								>
							{:else}
								<button
									onclick={() => terminarEjercicio()}
									disabled={!!exito}
									class="block w-full rounded-2xl py-4 text-center font-bold"
									style="background: rgb({g.glow}); color: var(--on-bright)"
									>{exito ? 'Cerrando…' : '✓ Volver al día'}</button
								>
							{/if}
						</div>
					{:else}
						<!--
							"Terminar ejercicio" con series sin marcar no terminaba nada: navegaba, y el
							día te recibía con "Faltan 1 ejercicio". Ahora el rótulo dice lo que hace, y
							cerrar de verdad con menos series es una acción propia y explícita.
						-->
						{#if hechas > 0}
							<button
								onclick={() => terminarConLoHecho()}
								disabled={!!exito}
								class="mt-4 block w-full rounded-2xl py-4 text-center font-bold"
								style="background: var(--accent); color: var(--on-accent)"
								>{exito
									? 'Cerrando…'
									: `Terminar con ${hechas} ${hechas === 1 ? 'serie' : 'series'}`}</button
							>
						{/if}
						<button
							onclick={() => terminarEjercicio()}
							disabled={!!exito}
							class="{hechas > 0
								? 'mt-2'
								: 'mt-4'} block w-full rounded-2xl py-4 text-center font-bold"
							style={hechas > 0
								? 'border: 1px solid rgba(255,255,255,.1); color: var(--muted)'
								: 'background: var(--accent); color: var(--on-accent)'}
							>{exito ? 'Cerrando…' : 'Volver al día'}</button
						>
						{#if proximo && hrefProximo && hechas > 0}
							<button
								onclick={() => terminarConLoHecho(hrefProximo)}
								disabled={!!exito}
								class="mt-2 block w-full rounded-2xl border border-white/10 px-4 py-3 text-center text-sm font-bold"
								style="color: rgb({g.glow})"
							>
								<span class="block truncate">Terminar y seguir: {proximo.nombre} →</span>
							</button>
						{/if}
					{/if}

					{#if hechas > 0}
						<!--
							Volver a empezar existe, pero no compite: sin fondo, sin borde y al final de
							todo. Un toque no reinicia nada —arma el aviso, y el aviso es el que reinicia—,
							porque es la única acción de esta pantalla que borra trabajo de una.
						-->
						<button
							onclick={pedirReinicio}
							disabled={!!exito}
							class="mt-3 block w-full py-2 text-center text-xs font-semibold"
							style="color: var(--muted)"
							aria-label="Reiniciar este ejercicio">Reiniciar ejercicio</button
						>
					{/if}
				</div>
			{/if}
		</div>
	</main>

	{#if hojaDescanso}
		<HojaDescanso
			minutos={descansoEj.minutos}
			glow={g.glow}
			vibracion={vibracionActiva}
			tieneValorPropio={descansoPropio != null}
			generalMinutos={ajustes.timer.minutos}
			generalActivo={ajustes.timer.activo}
			onElegir={elegirDescanso}
			onSeguirGeneral={() => {
				descansoAutomatico();
				hojaDescanso = false;
			}}
			onCerrar={() => (hojaDescanso = false)}
		/>
	{/if}

	{#if tecnicaAbierta && tecnicaEmbedUrl}
		<TecnicaModal
			embedUrl={tecnicaEmbedUrl}
			videoUrl={ej.videoUrl}
			nombre={ej.nombre}
			glow={g.glow}
			onClose={cerrarTecnica}
		/>
	{/if}

	{#if exito && g}
		<CelebracionOverlay
			{exito}
			{prExito}
			glow={g.glow}
			unidad={unidadValor}
			{metricaLabel}
			{hechas}
			total={sets.length}
			onClose={cerrarCelebracion}
		/>
	{/if}

	{#if prFlash && g}
		<!-- Flash de PR: brillo celebratorio que deja seguir registrando debajo. -->
		<div
			class="pointer-events-none fixed inset-0 z-[60] grid place-items-center px-8"
			style="background: radial-gradient(70% 50% at 50% 42%, rgb({g.glow} / .26), transparent 72%)"
		>
			<div
				transition:fly={{ y: 18, duration: dur(240) }}
				class="text-center"
				aria-live="polite"
				aria-label="Nuevo PR"
			>
				<div class="relative mx-auto grid size-24 place-items-center">
					<div class="gb-shockwave" style="--shock-color: {g.glow}"></div>
					<CelebracionParticulas color={g.glow} cantidad={14} />
					<div
						class="relative grid size-24 place-items-center rounded-full border border-white/15 text-5xl font-extrabold"
						style="background: rgb({g.glow} / .22); color: rgb({g.glow}); box-shadow: 0 0 55px rgb({g.glow} / .25)"
					>
						🏆
					</div>
				</div>
				<p class="mt-5 text-2xl font-extrabold">¡Nuevo PR!</p>
				<p class="mt-2 text-4xl font-extrabold tabular-nums">
					{formatoNumero(prFlash.valor)}<span
						class="ml-1 text-xl font-semibold"
						style="color: var(--muted)"
					>
						{unidadValor}</span
					>
				</p>
				<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
					{metricaLabel} · {formatoSet(prFlash, unidad)}
				</p>
				<!--
					De dónde venías. Es la mitad que le faltaba a la celebración: "130" sin el 127,5
					de al lado no dice si rompiste la marca por diez kilos o por medio.

					Sólo aparece si hay récord anterior. Cuando falta puede ser tu primer récord del
					ejercicio o un PR viejo de antes de que se guardara este dato, y como desde acá
					no se distinguen, la pantalla calla en vez de arriesgar un "primer récord" falso.
				-->
				{#if prFlash.previo}
					<p class="mt-1.5 text-sm font-semibold tabular-nums" style="color: rgb({g.glow} / .85)">
						Venías de {formatoNumero(prFlash.previo.valor)}
						{unidadValor}
					</p>
				{/if}
			</div>
		</div>
	{/if}

	{#if errorGuardado}
		<div
			class="fixed inset-x-0 bottom-0 z-[90] mx-auto max-w-md px-5"
			style="padding-bottom: calc(1rem + var(--safe-bottom))"
			role="alert"
		>
			<div
				class="flex items-center gap-3 rounded-2xl border p-3.5"
				style="background: var(--surface); border-color: rgba(255,107,107,.5)"
			>
				<span class="text-lg" aria-hidden="true">⚠️</span>
				<p class="min-w-0 flex-1 text-xs leading-relaxed" style="color: var(--muted)">
					No se pudo guardar. Revisá el espacio del teléfono y probá de nuevo.
					<span class="block opacity-70">{errorGuardado}</span>
				</p>
				<button
					onclick={() => (errorGuardado = null)}
					class="grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold"
					style="background: rgba(255,255,255,.08)"
					aria-label="Cerrar aviso">✕</button
				>
			</div>
		</div>
	{/if}

	{#if toast}
		<ToastAccion
			mensaje={toast.mensaje}
			accionTexto={toast.accionTexto}
			onAccion={toast.onAccion}
			onCerrar={() => (toast = null)}
		/>
	{/if}
{/if}
