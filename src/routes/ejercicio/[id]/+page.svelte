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
		registrarPrSiSupera,
		pesoEfectivo,
		valorMetrica,
		valorSet,
		mejorSet,
		DESCRIPCION_METRICA,
		hoyStr,
		sesionId,
		type MejorSet
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
		PRESETS_DESCANSO,
		RUEDA_DESCANSO,
		descansoEfectivo,
		descansoEnSegundos,
		descansoPersonalizado,
		etiquetaCortaDescanso,
		etiquetaDescanso,
		segundosAMinutos
	} from '$lib/descanso-preset';
	import Icono from '$lib/components/Icono.svelte';
	import RuedaTiempo from '$lib/components/RuedaTiempo.svelte';
	import { sonarSetHecho, sonarExito } from '$lib/audio';
	import { vibrar } from '$lib/vibracion';
	import { descanso } from '$lib/descanso.svelte';
	import { WakeLockSeguro } from '$lib/wake-lock';
	import { dur, menosMovimiento, DUR_BASE, DUR_SLOW } from '$lib/motion';
	import { fromLiveQuery } from '$lib/live';
	import { formatoNumero, formatoSet, fechaCorta } from '$lib/formato';
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
	import ConfirmSheet from '$lib/components/ConfirmSheet.svelte';
	import { decidirRecomendacionDoble, setProgresionDoble } from '$lib/dias';
	import { evaluarDobleProgresion } from '$lib/progresion';
	import { gramosAPeso, pesoAGramos } from '$lib/unidades';

	const ej = $derived(ejercicioPorId($page.params.id!));
	const g = $derived(ej ? grupos[ej.grupo] : undefined);
	const diaId = $derived($page.url.searchParams.get('dia'));
	const fechaApertura = hoyStr();
	const fechaSolicitada = $derived(
		fechaSesionDesdeUrl($page.url.searchParams.get('fecha'), fechaApertura)
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
	let ejercicioNoDisponible = $state(false);
	let exito = $state<'normal' | 'pr' | 'parcial' | null>(null);
	let prExito = $state<MejorSet | null>(null);
	// Flash de PR no bloqueante: celebra el récord en el instante en que se gana,
	// sin esperar a "Terminar" (así no se pierde si salís con ←).
	let prFlash = $state<MejorSet | null>(null);
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
	let confirmacion = $state<{
		titulo: string;
		mensaje: string;
		confirmarTexto: string;
		onConfirm: () => void | Promise<void>;
	} | null>(null);

	$effect(() => {
		$page.params.id; // dep: reinicia "grande" al cambiar de ejercicio
		videoGrande = demoGrande();
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
		setDemoGrande(valor);
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
	// El historial se recalcula al cambiar de ejercicio o de métrica; el `$` re-suscribe solo.
	const historial = $derived(
		fromLiveQuery(
			historialObs($page.params.id!, metricaConfigurada(ajustes, $page.params.id!), ajustes.unidad),
			[] as MejorSet[]
		)
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
			ejercicioNoDisponible = false;
			return;
		}
		const fecha = fechaSolicitada;
		cargandoSeries = true;
		ejercicioNoDisponible = false;
		anteriores = [];
		anterioresFecha = null;
		(async () => {
			const preparacion = await prepararEjercicioSesion(dId, exId, fecha, ajustes.unidad);
			if (cancelado) return;
			if (!preparacion.disponible) {
				sets = [];
				prCelebrado = null;
				cargandoSeries = false;
				ejercicioNoDisponible = true;
				return;
			}
			anteriores = preparacion.anteriores;
			anterioresFecha = preparacion.anterioresFecha;
			sub = ejercicioSesionObs(dId, exId, fecha, ajustes.unidad).subscribe((estado) => {
				if (cancelado) return;
				prCelebrado = estado.prCelebrado;
				cargandoSeries = false;
				// Con escrituras en vuelo el resultado que llega puede ser anterior al
				// último toque: pisar `sets` acá hacía saltar el número hacia atrás y el
				// toque siguiente componía desde el valor viejo. Mientras haya toques sin
				// confirmar manda lo local; al drenar, la base vuelve a ser la verdad.
				if (escriturasEnVuelo > 0) return;
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
		if (!diaId || !ajustes.ejercicioPantallaEncendida) return;
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
	const unidad = $derived(ajustes.unidad);
	// Los logros tienen su propio canal: la alarma de descanso es funcional y esto
	// es celebratorio, así que se puede querer una sin la otra.
	const sonidoActivo = $derived(ajustes.sonido && ajustes.sonidoLogros);
	const vibracionActiva = $derived(ajustes.vibracion ?? true);
	const metrica = $derived(metricaConfigurada(ajustes, $page.params.id!));
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
	let mostrarRuedaDescanso = $state(false);
	/** La explicación de la métrica y la equivalencia: útiles una vez, no en cada serie. */
	let mostrarQueMide = $state(false);
	/** Fila que el descanso pidió abrir para corregir (índice de la serie). */
	let correccionIndice = $state<number | null>(null);
	let segundosRueda = $state(90);
	/** Un descanso propio que no es ninguno de los cuatro atajos: lo eligió la rueda. */
	const descansoDeRueda = $derived(
		descansoPropio != null &&
			descansoPropio > 0 &&
			!PRESETS_DESCANSO.includes(descansoPropio as (typeof PRESETS_DESCANSO)[number])
	);
	const pasoPeso = $derived(
		ej ? pasoPesoEfectivo(ej, ajustes) : (ajustes.pasoPeso ?? AJUSTES_DEFAULT.pasoPeso)
	);
	const itemRutina = $derived(
		$contextoDia.dia?.ejercicios.find((item) => item.exerciseId === $page.params.id!)
	);
	const progresion = $derived(itemRutina?.progresion);
	const evaluacionProgresion = $derived(
		evaluarDobleProgresion(
			progresion,
			sets,
			sesionId(diaId ?? '', fechaSesion),
			pesoAGramos(pasoPeso, unidad) ?? 0,
			unidad
		)
	);
	// Sin PR ni serie previa: es la primera vez con este ejercicio → hint de peso inicial.
	/**
	 * La serie en curso es la primera sin hacer: es la única que se muestra abierta,
	 * con relieve y con el color del grupo. Las hechas se contraen a un renglón y las
	 * que faltan quedan cerradas detrás de ella.
	 */
	const indiceActiva = $derived(sets.findIndex((serie) => !serie.hecha));
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
	 * Toques pendientes de confirmar en la base. Mientras haya alguno, la suscripción
	 * no pisa `sets` (ver el comentario en el subscribe).
	 */
	let escriturasEnVuelo = 0;

	/**
	 * Vuelve a poner en pantalla lo que realmente hay en la base. Si una escritura falla,
	 * el valor optimista queda visible y el liveQuery no emite nada (en la base no cambió
	 * nada): sin esto la pantalla muestra para siempre un peso que nunca se guardó.
	 */
	async function resincronizar() {
		const dId = diaId;
		const exId = $page.params.id!;
		if (!dId) return;
		try {
			const setsPersistidos = await setsEjercicioSesion(dId, exId, fechaSesion, unidad);
			// Mientras leíamos pudo entrar otro toque o haberse cambiado de pantalla: en
			// cualquiera de los dos casos esta lectura ya quedó vieja y pisar sería peor.
			if (escriturasEnVuelo > 0 || diaId !== dId || $page.params.id !== exId) return;
			sets = setsPersistidos;
		} catch {
			// Si tampoco se puede leer, el banner de error ya está en pantalla.
		}
	}

	function escribir(operacion: Promise<unknown>) {
		escriturasEnVuelo++;
		let fallo = false;
		void operacion
			.catch((e: unknown) => {
				errorGuardado = e instanceof Error ? e.message : 'No se pudo guardar la serie.';
				fallo = true;
			})
			.finally(() => {
				escriturasEnVuelo--;
				// Con toques todavía en vuelo, resincronizar pisaría un cambio que sí se va a
				// guardar: el último en drenar se hace cargo.
				if (fallo && escriturasEnVuelo === 0) void resincronizar();
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

	function configurarProgresion(activa: boolean) {
		if (!diaId) return;
		guardarDatoSecundario(
			setProgresionDoble(
				diaId,
				$page.params.id!,
				activa
					? {
							activa: true,
							repsMin: progresion?.repsMin ?? 8,
							repsMax: progresion?.repsMax ?? 12,
							incrementoGramos: progresion?.incrementoGramos
						}
					: undefined
			),
			'No se pudo guardar la progresión.'
		);
	}

	function ajustarRangoProgresion(campo: 'repsMin' | 'repsMax', delta: number) {
		if (!diaId || !progresion) return;
		let repsMin = progresion.repsMin;
		let repsMax = progresion.repsMax;
		if (campo === 'repsMin') repsMin = Math.max(1, Math.min(repsMax, repsMin + delta));
		else repsMax = Math.max(repsMin, Math.min(30, repsMax + delta));
		guardarDatoSecundario(
			setProgresionDoble(diaId, $page.params.id!, {
				activa: true,
				repsMin,
				repsMax,
				incrementoGramos: progresion.incrementoGramos
			}),
			'No se pudo guardar el rango de progresión.'
		);
	}

	function decidirProgresion(decision: 'aceptada' | 'pospuesta' | 'descartada') {
		if (!diaId || !evaluacionProgresion.recomendacion) return;
		guardarDatoSecundario(
			decidirRecomendacionDoble(
				diaId,
				$page.params.id!,
				evaluacionProgresion.recomendacion,
				decision
			),
			'No se pudo guardar la decisión de progresión.'
		);
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

	function quitarSerie() {
		if (!diaId || sets.length <= 1) return;
		const ultima = sets[sets.length - 1];
		// No borrar un registro real con un mistap: la serie hecha pide confirmación.
		if (ultima?.hecha) {
			confirmacion = {
				titulo: 'Quitar serie hecha',
				mensaje: `La serie ${sets.length} ya está marcada como hecha. Si la quitás, se recalcula el progreso y el PR de este ejercicio.`,
				confirmarTexto: 'Quitar',
				onConfirm: async () => {
					await removeSet(diaId, $page.params.id!, sets.length - 1, fechaSesion);
					confirmacion = null;
				}
			};
			return;
		}
		escribir(removeSet(diaId, $page.params.id!, sets.length - 1, fechaSesion));
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
				setIndex: i
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
		cambiarDescansoEjercicio(ajustes.timer.minutos || 2);
		descartarHintTimer();
	}

	/**
	 * El usuario tocó "corregir" en el descanso: vuelve a la fila de esa serie y le
	 * pone el foco en las reps, que es donde suele estar el error.
	 */
	$effect(() => {
		const pedido = descanso.correccionPedida;
		if (pedido === 0) return;
		const indice = untrack(() => descanso.registrada?.setIndex);
		if (indice == null) return;
		// La serie ya está hecha, así que su fila está contraída: hay que abrirla antes
		// de buscarle el campo de reps.
		correccionIndice = indice;
		let intentos = 0;
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
				return;
			}
			if (++intentos < 40) frame = requestAnimationFrame(enfocarFila);
		};
		frame = requestAnimationFrame(enfocarFila);
		return () => cancelAnimationFrame(frame);
	});

	function descartarHintTimer() {
		ocultarHintTimer();
		mostrarHintTimer = false;
	}

	/** Recompensa especial inmediata por PR: no bloquea el registro (pointer-events-none). */
	function celebrarPrFlash(mejor: MejorSet) {
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
		descanso.saltar();
		guardarDatoSecundario(
			setDescansoEjercicio(ej.id, 0),
			'No se pudo guardar el descanso del ejercicio.'
		);
	}

	/** Sin valor propio: este ejercicio vuelve a seguir el descanso general. */
	function descansoAutomatico() {
		if (!ej) return;
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
	 * "Otro": la rueda para cualquier descanso de 15 s a 10 min. Arranca en el valor
	 * que hoy está en uso, así girar es corregir y no empezar de cero.
	 */
	function alternarRuedaDescanso() {
		if (!mostrarRuedaDescanso) segundosRueda = descansoEnSegundos(descansoEj.minutos);
		mostrarRuedaDescanso = !mostrarRuedaDescanso;
	}

	function girarDescanso(segundos: number) {
		segundosRueda = segundos;
		cambiarDescansoEjercicio(segundosAMinutos(segundos));
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
		class="gb-page gb-page--exercise min-h-dvh px-5 pb-28 pt-6 {diaId ? 'gb-page--training' : ''}"
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
					<p class="text-sm font-bold">Este ejercicio ya no está en la rutina</p>
					<p class="mt-1 text-xs leading-relaxed" style="color: var(--muted)">
						No se creó ninguna sesión nueva. Volvé al día para elegir otro ejercicio.
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
						unidad={ajustes.unidad}
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
				<div class="gb-exercise-work">
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
								<p
									class="mt-0.5 text-[11px] font-medium uppercase tracking-wider"
									style="color: var(--muted)"
								>
									Sesión actual
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
										onclick={quitarSerie}
										disabled={sets.length <= 1}
										class="grid size-11 touch-manipulation place-items-center rounded-full text-sm font-bold disabled:opacity-35"
										style="color: var(--muted)"
										aria-label="Quitar serie de hoy">−</button
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
							<div class="mt-3 space-y-2">
								{#each sets as s, i (i)}
									<SetRow
										set={s}
										index={i}
										anterior={anteriores[i]}
										maquinaPlacas={!!ej.maquinaPlacas}
										glow={g.glow}
										{unidad}
										{pasoPeso}
										activa={i === indiceActiva}
										abrirParaCorregir={i === correccionIndice}
										pendiente={seriesPendientes.has(i)}
										flash={filasFlash.has(i)}
										onToggle={() => onToggle(i)}
										onToggleMax={() => escribir(toggleMax(diaId, $page.params.id!, i, fechaSesion))}
										onAjustarPeso={(d) => ajustarPeso(i, d)}
										onPonerPeso={(peso) => ponerPeso(i, peso)}
										onEscribirPeso={(el) => escribirPeso(i, el)}
										onAjustarReps={(d) => ajustarReps(i, d)}
										onEscribirReps={(el) => escribirReps(i, el)}
										onAjustarExtra={(d) => ajustarExtra(i, d)}
										modoEsfuerzo={ajustes.modoEsfuerzo}
										onSetRir={(rir) => guardarRir(i, rir)}
									/>
								{/each}
							</div>
							{#if sinHistorial}
								<div
									class="mt-2 flex items-start gap-2 rounded-xl p-2.5"
									style="background: rgb({g.glow} / .08)"
								>
									<Icono nombre="consejo" tamano={16} clase="mt-0.5 shrink-0" />
									<p class="flex-1 text-xs leading-relaxed" style="color: var(--muted)">
										Todavía no hay series completadas para este ejercicio. Empezá con un peso que te
										deje hacer ~12 repeticiones cómodas y ajustá la próxima.
									</p>
								</div>
							{/if}
							{#if evaluacionProgresion.recomendacion}
								{@const recomendacion = evaluacionProgresion.recomendacion}
								<section
									class="mt-3 rounded-xl border p-3"
									style="background: rgb({g.glow} / .09); border-color: rgb({g.glow} / .3)"
								>
									<p
										class="text-xs font-bold uppercase tracking-wider"
										style="color: rgb({g.glow})"
									>
										Recomendación de progresión
									</p>
									<p class="mt-1 text-sm font-bold">
										{recomendacion.esMax
											? `MAX + ${formatoNumero(gramosAPeso(recomendacion.extraObjetivoGramos, unidad)!)} ${unidad}`
											: `${formatoNumero(gramosAPeso(recomendacion.pesoObjetivoGramos, unidad)!)} ${unidad}`}
										para la próxima sesión
									</p>
									<p class="mt-1 text-xs leading-relaxed" style="color: var(--muted)">
										{recomendacion.explicacion} La próxima empieza en {progresion?.repsMin} reps.
									</p>
									<div class="mt-3 grid grid-cols-3 gap-2">
										<button
											type="button"
											onclick={() => decidirProgresion('aceptada')}
											class="min-h-11 rounded-xl px-2 text-xs font-bold"
											style="background: var(--accent); color: var(--on-accent)">Aceptar</button
										>
										<button
											type="button"
											onclick={() => decidirProgresion('pospuesta')}
											class="min-h-11 rounded-xl bg-white/[0.06] px-2 text-xs font-bold"
											>Posponer</button
										>
										<button
											type="button"
											onclick={() => decidirProgresion('descartada')}
											class="min-h-11 rounded-xl bg-white/[0.06] px-2 text-xs font-bold"
											style="color: var(--muted)">Descartar</button
										>
									</div>
								</section>
							{:else if progresion?.decisionSesionId === sesionId(diaId, fechaSesion)}
								<p
									class="mt-2 rounded-xl bg-white/[0.035] px-3 py-2 text-xs"
									style="color: var(--muted)"
								>
									Recomendación {progresion.decision === 'aceptada'
										? 'aceptada para la próxima sesión'
										: progresion.decision === 'pospuesta'
											? 'pospuesta'
											: 'descartada'}.
								</p>
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
							El descanso en dos renglones parejos en vez de ocho píldoras que se
							envolvían donde caía cada una: primero el modo (Auto / Off), después los
							valores, todos del mismo ancho. El párrafo que explicaba qué hacía Auto se
							convierte en el estado de la derecha, que dice lo mismo en cuatro palabras.
						-->
						<div class="gb-rest-presets mt-3 border-t border-white/10 pt-3">
							<div class="flex items-center justify-between gap-2">
								<span
									class="flex items-center gap-1.5 text-xs font-semibold"
									style="color: var(--muted)"
								>
									<Icono nombre="descanso" tamano={15} /> Descanso
								</span>
								<span class="text-[11px] font-semibold" style="color: var(--muted)">
									{#if descansoPropio == null}
										Auto · {ajustes.timer.activo
											? etiquetaDescanso(ajustes.timer.minutos)
											: 'apagado'}
									{:else if descansoPropio === 0}
										Sin descanso acá
									{:else}
										Propio · {etiquetaDescanso(descansoPropio)}
									{/if}
								</span>
							</div>
							<div class="mt-2 grid grid-cols-4 gap-1.5">
								<button
									onclick={descansoAutomatico}
									class="min-h-11 rounded-xl px-2 text-xs font-semibold"
									aria-pressed={descansoPropio == null}
									aria-label="Usar el descanso general en este ejercicio"
									style={descansoPropio == null
										? 'background: var(--accent); color: var(--on-accent)'
										: 'background: rgba(255,255,255,.06); color: var(--muted)'}>Auto</button
								>
								<button
									onclick={apagarDescansoEjercicio}
									class="min-h-11 rounded-xl px-2 text-xs font-semibold"
									aria-pressed={descansoPropio === 0}
									aria-label="Sin descanso en este ejercicio"
									style={descansoPropio === 0
										? 'background: var(--accent); color: var(--on-accent)'
										: 'background: rgba(255,255,255,.06); color: var(--muted)'}>Off</button
								>
								{#each PRESETS_DESCANSO as minutos (minutos)}
									<button
										onclick={() => cambiarDescansoEjercicio(minutos)}
										class="min-h-11 rounded-xl px-2 text-xs font-semibold tabular-nums"
										aria-pressed={descansoPropio === minutos}
										aria-label={`Descanso de ${etiquetaDescanso(minutos)} en este ejercicio`}
										style={descansoPropio === minutos
											? 'background: var(--accent); color: var(--on-accent)'
											: 'background: rgba(255,255,255,.06); color: var(--muted)'}
										>{etiquetaCortaDescanso(minutos)}</button
									>
								{/each}
								<button
									onclick={alternarRuedaDescanso}
									class="col-span-2 flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold tabular-nums"
									aria-pressed={descansoDeRueda}
									aria-expanded={mostrarRuedaDescanso}
									aria-label="Elegir otro descanso con la rueda"
									style={descansoDeRueda
										? 'background: var(--accent); color: var(--on-accent)'
										: 'background: rgba(255,255,255,.06); color: var(--muted)'}
								>
									<Icono nombre="rueda" tamano={14} />
									{descansoDeRueda && descansoPropio
										? etiquetaCortaDescanso(descansoPropio)
										: 'Otro'}
								</button>
							</div>
							{#if mostrarRuedaDescanso}
								<div class="mt-3 flex flex-col items-center gap-2">
									<RuedaTiempo
										segundos={segundosRueda}
										min={RUEDA_DESCANSO.min}
										max={RUEDA_DESCANSO.max}
										paso={RUEDA_DESCANSO.paso}
										glow={g.glow}
										vibracion={vibracionActiva}
										etiqueta="Descanso de este ejercicio"
										onCambio={girarDescanso}
									/>
									<button
										onclick={() => (mostrarRuedaDescanso = false)}
										class="min-h-11 rounded-full px-4 text-xs font-bold"
										style="background: rgba(255,255,255,.06); color: var(--muted)">Listo</button
									>
								</div>
							{/if}
						</div>
						{#if mostrarHintTimer}
							<div
								class="mt-2 flex items-center gap-2 rounded-xl p-2.5"
								style="background: rgb({g.glow} / .08)"
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

						<!--
							Configuración al pie, no en el medio: el paso del ± y la doble progresión se
							definen una vez y no se vuelven a tocar, pero estaban entre el encabezado y la
							primera serie, empujando hacia abajo lo único que se usa entre repeticiones.
						-->
						<p
							class="mt-4 border-t border-white/10 pt-3 text-[11px] font-bold uppercase tracking-wider"
							style="color: var(--muted)"
						>
							Ajustes de este ejercicio
						</p>
						<details class="mt-2 rounded-xl border border-white/5 bg-white/[0.025] px-3 py-1">
							<summary
								class="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-xs font-semibold"
								style="color: var(--muted)"
							>
								<span>Doble progresión</span>
								<span
									>{progresion?.activa
										? `${progresion.repsMin}–${progresion.repsMax} reps`
										: 'Off'}</span
								>
							</summary>
							<div class="pb-3 pt-2">
								{#if modo === 'reps'}
									<p class="text-xs leading-relaxed" style="color: var(--muted)">
										Este ejercicio no registra carga. La doble progresión de peso no aplica.
									</p>
								{:else if !progresion?.activa}
									<p class="text-xs leading-relaxed" style="color: var(--muted)">
										Opcional. Cuando todas las series lleguen al techo del rango con la misma carga,
										la app recomienda subirla; nunca cambia nada sola.
									</p>
									<button
										type="button"
										onclick={() => configurarProgresion(true)}
										class="mt-3 min-h-11 w-full rounded-xl text-sm font-bold"
										style="background: rgb({g.glow} / .18); color: rgb({g.glow})"
										>Activar 8–12 reps</button
									>
								{:else}
									<div class="grid grid-cols-2 gap-2">
										{#each [{ campo: 'repsMin', label: 'Mínimo', valor: progresion.repsMin }, { campo: 'repsMax', label: 'Máximo', valor: progresion.repsMax }] as control (control.campo)}
											<div>
												<p
													class="text-[11px] font-bold uppercase tracking-wider"
													style="color: var(--muted)"
												>
													{control.label}
												</p>
												<div class="mt-1 flex min-h-11 items-center rounded-xl bg-white/[0.05]">
													<button
														type="button"
														onclick={() =>
															ajustarRangoProgresion(control.campo as 'repsMin' | 'repsMax', -1)}
														class="size-11 text-lg font-bold"
														aria-label={`Bajar ${control.label.toLowerCase()} de reps`}>−</button
													>
													<span class="flex-1 text-center font-bold tabular-nums"
														>{control.valor}</span
													>
													<button
														type="button"
														onclick={() =>
															ajustarRangoProgresion(control.campo as 'repsMin' | 'repsMax', 1)}
														class="size-11 text-lg font-bold"
														aria-label={`Subir ${control.label.toLowerCase()} de reps`}>+</button
													>
												</div>
											</div>
										{/each}
									</div>
									<p class="mt-2 text-xs" style="color: var(--muted)">
										Incremento automático: {formatoNumero(pasoPeso)}
										{unidad}, usando el paso de este ejercicio.
									</p>
									<button
										type="button"
										onclick={() => configurarProgresion(false)}
										class="mt-2 min-h-11 rounded-xl px-3 text-xs font-bold"
										style="color: #ff8d8d">Desactivar</button
									>
								{/if}
							</div>
						</details>
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

					{#if completo && descanso.restoSeg === 0 && !descanso.vencido}
						<!-- Con todo hecho, el cierre queda fijo al alcance del pulgar. Si queda
						     algo pendiente en la rutina, el primario encadena directo con eso:
						     volver a la lista para buscar el siguiente era un viaje por ejercicio. -->
						<div
							transition:fly={{ y: 40, duration: dur(200) }}
							class="gb-exercise-finish-bar fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-5 pt-6"
							style="padding-bottom: calc(1.25rem + env(safe-area-inset-bottom)); background: linear-gradient(transparent, rgb(var(--scrim) / .92) 55%)"
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
						<button
							onclick={() => terminarEjercicio()}
							disabled={!!exito}
							class="mt-4 block w-full rounded-2xl py-4 text-center font-bold"
							style="background: var(--accent); color: var(--on-accent)"
							>{exito ? 'Cerrando…' : 'Terminar ejercicio'}</button
						>
						{#if proximo && hrefProximo && hechas > 0}
							<button
								onclick={() => terminarEjercicio(hrefProximo)}
								disabled={!!exito}
								class="mt-2 block w-full rounded-2xl border border-white/10 px-4 py-3 text-center text-sm font-bold"
								style="color: rgb({g.glow})"
							>
								<span class="block truncate">Siguiente: {proximo.nombre} →</span>
							</button>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	</main>

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
			</div>
		</div>
	{/if}

	{#if errorGuardado}
		<div
			class="fixed inset-x-0 bottom-0 z-[90] mx-auto max-w-md px-5"
			style="padding-bottom: calc(1rem + env(safe-area-inset-bottom))"
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

	{#if confirmacion}
		<ConfirmSheet
			titulo={confirmacion.titulo}
			mensaje={confirmacion.mensaje}
			confirmarTexto={confirmacion.confirmarTexto}
			onConfirm={confirmacion.onConfirm}
			onCancel={() => (confirmacion = null)}
		/>
	{/if}
{/if}
