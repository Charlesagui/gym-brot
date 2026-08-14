<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { type SetSesion, type PrCelebrado } from '$lib/db';
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
		serieCompleta,
		type MetricaEfectiva,
		type ModoPr
	} from '$lib/sesion-reglas';
	import {
		notaObs,
		setNota,
		ajustesObs,
		setTimer,
		setPasoPesoEjercicio,
		AJUSTES_DEFAULT
	} from '$lib/extras';
	import { sonarSetHecho, sonarExito } from '$lib/audio';
	import { descanso } from '$lib/descanso.svelte';
	import { dur, DUR_BASE, DUR_SLOW } from '$lib/motion';
	import { fromLiveQuery } from '$lib/live';
	import { formatoNumero, formatoSet, fechaCorta } from '$lib/formato';
	import { fechaSesionDesdeUrl } from '$lib/fechas';
	import { youtubeEmbedUrl } from '$lib/youtube';
	import {
		etiquetaProximaSerie,
		metricaEfectivaEjercicio,
		metricaLabelEjercicio,
		modoEjercicioActivo,
		unidadValorEjercicio
	} from '$lib/ejercicio-activo';
	import { leerPeso, leerReps, sumarPeso, sumarReps } from '$lib/numeros';
	import { pasoPesoEfectivo, pasoPesoPersonalizado } from '$lib/paso-peso';
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
		fromLiveQuery(historialObs($page.params.id!, ajustes.metricaPr), [] as MejorSet[])
	);
	const puntos = $derived($historial);
	const notaStore = $derived(fromLiveQuery(notaObs($page.params.id!), undefined));
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
			const preparacion = await prepararEjercicioSesion(dId, exId, fecha);
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
			sub = ejercicioSesionObs(dId, exId, fecha).subscribe((estado) => {
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
	const sonidoActivo = $derived(ajustes.sonido);
	const vibracionActiva = $derived(ajustes.vibracion ?? true);
	const metrica = $derived(ajustes.metricaPr);
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
		modo === 'peso' && pr && pesoEfectivo(pr) != null
			? valorMetrica(pesoEfectivo(pr)!, pr.reps, otraMetrica)
			: null
	);
	const mejorHoy = $derived(mejorSetDeSeries(sets, fechaSesion, metrica, undefined, modo));
	// "Previo" = todo menos la sesión actual: si hiciste este ejercicio hoy en otra
	// rutina, ese valor también cuenta (mismo criterio que recalcularPrCelebrado).
	const mejorPrevio = $derived(
		puntos
			.filter((p) => !diaId || p.sesionId !== sesionId(diaId, fechaSesion))
			.reduce<number | null>((m, p) => (m == null || p.valor > m ? p.valor : m), null)
	);
	const valorCelebrado = $derived(prCelebrado ? valorSet(prCelebrado, metrica, modo) : null);
	const valorMejorHoy = $derived(mejorHoy ? mejorHoy.valor : null);
	const superado = $derived(
		valorMejorHoy != null &&
			(mejorPrevio == null || valorMejorHoy > mejorPrevio) &&
			(valorCelebrado == null || valorMejorHoy > valorCelebrado)
	);
	const pasoPeso = $derived(
		ej ? pasoPesoEfectivo(ej, ajustes) : (ajustes.pasoPeso ?? AJUSTES_DEFAULT.pasoPeso)
	);
	const pasoPersonalizado = $derived(ej ? pasoPesoPersonalizado(ej, ajustes) : undefined);
	const opcionesPaso = $derived(unidad === 'kg' ? [1, 2.5, 5] : [1, 2.5, 5, 10]);
	// Sin PR ni serie previa: es la primera vez con este ejercicio → hint de peso inicial.
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
			const setsPersistidos = await setsEjercicioSesion(dId, exId, fechaSesion);
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
		escribir(setPeso(diaId!, $page.params.id!, i, peso, fechaSesion, metrica));
	}

	function ajustarReps(i: number, delta: number) {
		const reps = sumarReps(sets[i]?.reps, delta);
		if (sets[i]) {
			sets[i].reps = reps;
			if (reps == null) sets[i].hecha = false;
		}
		if (reps != null) avisoSerie = null;
		escribir(setReps(diaId!, $page.params.id!, i, reps, fechaSesion, metrica));
	}

	function ajustarExtra(i: number, delta: number) {
		const extra = sumarPeso(sets[i]?.extraKg, delta);
		if (sets[i]) sets[i].extraKg = extra;
		escribir(setExtra(diaId!, $page.params.id!, i, extra, fechaSesion, metrica));
	}

	function escribirPeso(i: number, el: HTMLInputElement) {
		const peso = leerPeso(el.value);
		if (sets[i]) sets[i].peso = peso;
		escribir(setPeso(diaId!, $page.params.id!, i, peso, fechaSesion, metrica));
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
					await removeSet(diaId, $page.params.id!, sets.length - 1, fechaSesion, metrica);
					confirmacion = null;
				}
			};
			return;
		}
		escribir(removeSet(diaId, $page.params.id!, sets.length - 1, fechaSesion, metrica));
	}

	function escribirReps(i: number, el: HTMLInputElement) {
		const reps = leerReps(el.value);
		if (sets[i]) {
			sets[i].reps = reps;
			if (reps == null) sets[i].hecha = false;
		}
		if (reps != null) avisoSerie = null;
		escribir(setReps(diaId!, $page.params.id!, i, reps, fechaSesion, metrica));
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
		if (objetivo && ajustes.timer.activo) descanso.prepararDesdeGesto();
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
			fechaSesion
		).catch(falloAlRegistrarPr);
		if (nuevoPr) {
			celebrarPrFlash(nuevoPr);
		} else {
			if (sonidoActivo) void sonarSetHecho().catch(() => {});
			// Háptica breve: el switch de silencio de iOS puede mutear el audio, la vibra no.
			if (vibracionActiva && 'vibrate' in navigator) navigator.vibrate(20);
		}

		if (resultado.ejercicioCompleto) {
			mostrarHintTimer = false;
			descanso.saltar();
		} else if (ajustes.timer.activo) {
			// El check y el glow de la fila necesitan un instante para percibirse antes
			// de que el descanso tape la pantalla con su propia barra.
			if (restoId) clearTimeout(restoId);
			restoId = setTimeout(() => {
				descanso.iniciar(
					ajustes.timer.minutos,
					g?.glow ?? '124 92 255',
					etiquetaProximaSerie(sets, i, ej?.nombre ?? '')
				);
			}, 220);
		} else if (debeMostrarHintTimer()) {
			// Timer apagado: sugerir activarlo (una sola vez) para que avise cuándo volver.
			mostrarHintTimer = true;
		}
	}

	function activarDescansoDesdeHint() {
		cambiarTimer(ajustes.timer.minutos || 2);
		descartarHintTimer();
	}

	function descartarHintTimer() {
		ocultarHintTimer();
		mostrarHintTimer = false;
	}

	/** Recompensa especial inmediata por PR: no bloquea el registro (pointer-events-none). */
	function celebrarPrFlash(mejor: MejorSet) {
		prFlash = mejor;
		if (sonidoActivo) void sonarExito(true).catch(() => {});
		if (vibracionActiva && 'vibrate' in navigator) navigator.vibrate([120, 70, 180]);
		if (prFlashId) clearTimeout(prFlashId);
		prFlashId = setTimeout(() => (prFlash = null), 1700);
	}

	async function terminarEjercicio() {
		if (!diaId || exito) return;
		descanso.saltar();
		if (prFlashId) clearTimeout(prFlashId);
		prFlash = null;
		// Sin series hechas no hay nada que celebrar: salida directa y en silencio.
		if (hechas === 0) {
			goto(volver);
			return;
		}
		// PR honesto: solo cuentan las series realmente marcadas ✓ (no fabrica nada).
		// Igual que al marcar, quien decide es la transacción; acá solo se elige qué
		// serie proponer (la mejor hecha bajo la métrica vigente).
		const mejor = mejorHoy;
		const candidato = mejor?.setIndex;
		const ganado =
			candidato != null
				? await registrarPrSiSupera(diaId, $page.params.id!, candidato, metrica, fechaSesion).catch(
						falloAlRegistrarPr
					)
				: null;
		const esPr = ganado != null;
		// La fanfarria es para el ejercicio completo (o PR); cierre parcial = sobrio.
		exito = esPr ? 'pr' : completo ? 'normal' : 'parcial';
		prExito = ganado;
		if (exito !== 'parcial') {
			if (sonidoActivo) void sonarExito(esPr).catch(() => {});
			if (vibracionActiva && 'vibrate' in navigator) navigator.vibrate(esPr ? [120, 70, 180] : 80);
		}
		if (exitoId) clearTimeout(exitoId);
		exitoId = setTimeout(() => goto(volver), esPr ? 2300 : exito === 'parcial' ? 900 : 1200);
	}

	function apagarTimer() {
		descanso.saltar();
		guardarDatoSecundario(
			setTimer(false, ajustes.timer.minutos),
			'No se pudo guardar el temporizador.'
		);
	}

	function cambiarTimer(minutos: number) {
		guardarDatoSecundario(setTimer(true, minutos), 'No se pudo guardar el temporizador.');
		// Si hay un descanso en curso, ajusta su fin en vez de reiniciarlo desde cero.
		descanso.ajustarFin(minutos);
	}

	function cambiarPasoEjercicio(paso?: number) {
		if (!ej) return;
		guardarDatoSecundario(
			setPasoPesoEjercicio(ej.id, unidad, paso),
			'No se pudo guardar el paso de peso del ejercicio.'
		);
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
						class="grid size-11 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
						aria-label="Volver">←</a
					>
					{#if !videoGrande}
						<button
							onclick={() => setVideoGrande(true)}
							class="gb-pressable gb-thumb-frame shrink-0 overflow-hidden rounded-xl"
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
							aria-label={`Ver video de técnica para ${ej.nombre}`}>▶ Ver técnica</button
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
				{#if Progreso}
					<Progreso
						exerciseId={$page.params.id!}
						glow={g.glow}
						unidad={ajustes.unidad}
						metrica={ajustes.metricaPr}
						{pasoPeso}
						maquinaPlacas={!!ej.maquinaPlacas}
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
											class="ml-1 inline-grid size-11 place-items-center align-middle text-[11px] font-bold normal-case"
											style="color: var(--muted)"
											aria-label="Qué es MAX">ⓘ</button
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
										class="gb-pressable grid size-11 touch-manipulation place-items-center rounded-full text-sm font-bold disabled:opacity-35"
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
										class="gb-pressable grid size-11 touch-manipulation place-items-center rounded-full text-sm font-bold"
										style="background: rgb({g.glow} / .18); color: rgb({g.glow})"
										aria-label="Agregar serie de hoy">+</button
									>
								</div>
							{/if}
						</div>
						<details class="mt-3 rounded-xl border border-white/5 bg-white/[0.025] px-3 py-1">
							<summary
								class="flex min-h-11 cursor-pointer items-center text-xs font-semibold"
								style="color: var(--muted)"
							>
								−/+ Paso: {formatoNumero(pasoPeso)}
								{unidad}
								{pasoPersonalizado == null ? '· automático' : '· personalizado'}
							</summary>
							<div class="mt-2 flex flex-wrap gap-2" aria-label="Configurar paso del peso">
								<button
									onclick={() => cambiarPasoEjercicio()}
									class="min-h-11 rounded-lg px-3 text-xs font-bold"
									aria-pressed={pasoPersonalizado == null}
									style={pasoPersonalizado == null
										? 'background: var(--accent); color: var(--on-accent)'
										: 'background: rgba(255,255,255,.06); color: var(--muted)'}>Automático</button
								>
								{#each opcionesPaso as paso (paso)}
									<button
										onclick={() => cambiarPasoEjercicio(paso)}
										class="min-h-11 rounded-lg px-3 text-xs font-bold tabular-nums"
										aria-pressed={pasoPersonalizado === paso}
										style={pasoPersonalizado === paso
											? 'background: var(--accent); color: var(--on-accent)'
											: 'background: rgba(255,255,255,.06); color: var(--muted)'}
										>{formatoNumero(paso)} {unidad}</button
									>
								{/each}
							</div>
							<p class="mt-2 text-[11px]" style="color: var(--muted)">
								Automático usa {unidad === 'kg' ? '1 kg' : '5 lb'} en mancuernas y el paso general en
								los demás ejercicios.
							</p>
						</details>

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
										pendiente={seriesPendientes.has(i)}
										flash={filasFlash.has(i)}
										onToggle={() => onToggle(i)}
										onToggleMax={() =>
											escribir(toggleMax(diaId, $page.params.id!, i, fechaSesion, metrica))}
										onAjustarPeso={(d) => ajustarPeso(i, d)}
										onEscribirPeso={(el) => escribirPeso(i, el)}
										onAjustarReps={(d) => ajustarReps(i, d)}
										onEscribirReps={(el) => escribirReps(i, el)}
										onAjustarExtra={(d) => ajustarExtra(i, d)}
									/>
								{/each}
							</div>
							{#if sinHistorial}
								<div
									class="mt-2 flex items-start gap-2 rounded-xl p-2.5"
									style="background: rgb({g.glow} / .08)"
								>
									<p class="flex-1 text-xs leading-relaxed" style="color: var(--muted)">
										💡 Primera vez con este ejercicio. Empezá con un peso que te deje hacer ~12
										repeticiones cómodas y ajustá la próxima.
									</p>
								</div>
							{/if}
							{#if mostrarHintMax}
								<div
									class="mt-2 flex items-start gap-2 rounded-xl p-2.5"
									style="background: rgb(var(--max) / .08)"
								>
									<p class="flex-1 text-xs leading-relaxed" style="color: var(--muted)">
										💡 ¿Llegaste al tope de la pila de placas? Marcá <b
											style="color: rgb(var(--max))">MAX</b
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

						<div
							class="gb-rest-presets mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-3"
						>
							<span class="mr-1 text-xs font-semibold" style="color: var(--muted)">⏱️ Descanso</span
							>
							<button
								onclick={apagarTimer}
								class="min-h-11 rounded-full px-3.5 py-2 text-xs font-semibold"
								aria-label="Apagar descanso"
								style={!ajustes.timer.activo
									? 'background: var(--accent); color: var(--on-accent)'
									: 'background: rgba(255,255,255,.06); color: var(--muted)'}>Off</button
							>
							{#each [1, 2, 3, 4, 5] as m (m)}
								<button
									onclick={() => cambiarTimer(m)}
									class="min-h-11 min-w-11 rounded-full px-3.5 py-2 text-xs font-semibold"
									aria-label={`Descanso ${m} ${m === 1 ? 'minuto' : 'minutos'}`}
									style={ajustes.timer.activo && ajustes.timer.minutos === m
										? 'background: var(--accent); color: var(--on-accent)'
										: 'background: rgba(255,255,255,.06); color: var(--muted)'}>{m}'</button
								>
							{/each}
						</div>
						{#if mostrarHintTimer}
							<div
								class="mt-2 flex items-center gap-2 rounded-xl p-2.5"
								style="background: rgb({g.glow} / .08)"
							>
								<p class="flex-1 text-xs leading-relaxed" style="color: var(--muted)">
									💡 ¿Activar el descanso? Te avisa cuándo volver a la serie.
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
							<div class="flex items-center justify-between">
								<p
									class="text-xs font-semibold uppercase tracking-wider"
									style="color: var(--muted)"
								>
									PR {metricaLabel}
								</p>
								{#if superado}
									<span
										class="rounded-full px-2 py-0.5 text-xs font-bold"
										style="background: rgb({g.glow} / .2); color: rgb({g.glow})">🏆 Nuevo PR</span
									>
								{/if}
							</div>
							<p class="mt-1 text-3xl font-extrabold">
								🏆 {formatoNumero(pr.valor)}<span
									class="ml-1 text-lg font-semibold"
									style="color: var(--muted)"
								>
									{unidadValor}</span
								>
							</p>
							<p class="mt-0.5 text-xs font-medium" style="color: var(--muted)">
								Mejor set: {formatoSet(pr, unidad)} · {fechaCorta(pr.fecha)}
							</p>
							{#if valorOtraPr != null}
								<p class="mt-0.5 text-[11px] font-medium" style="color: var(--muted)">
									Ese mismo set equivale a ≈ {formatoNumero(valorOtraPr)}
									{unidad} como {otraLabel}
								</p>
							{/if}
							<p
								class="mt-2.5 text-[11px] leading-relaxed border-t border-white/5 pt-2"
								style="color: var(--muted)"
							>
								💡 {DESCRIPCION_METRICA[metricaEfectiva]}
							</p>
							<MiniChart {puntos} glow={g.glow} {metricaLabel} unidad={unidadValor} />
							<!-- Link discreto: la operación manda, el progreso completo se consulta aparte. -->
							<a
								href={`/ejercicio/${$page.params.id}?desde=${diaId}&fecha=${fechaSesion}`}
								class="mt-2.5 block min-h-11 text-right text-xs font-bold leading-[2.75rem]"
								style="color: rgb({g.glow})">Ver progreso completo →</a
							>
						</section>
					{:else if !cargandoSeries}
						<section
							class="mt-3 rounded-2xl border border-dashed border-white/15 p-4 text-center"
							style="background: var(--surface)"
						>
							<p class="text-3xl">🏆</p>
							<p class="mt-1 text-sm font-semibold">Todavía sin PR</p>
							<p class="mt-0.5 text-xs" style="color: var(--muted)">
								Marcá una serie con ✓ para registrar tu primer récord de {metricaLabel}.
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
							📝 Notas {#if tieneNota}<span style="color: rgb({g.glow})">●</span>{/if}
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
						<!-- Con todo hecho, el cierre queda fijo al alcance del pulgar -->
						<div
							transition:fly={{ y: 40, duration: dur(200) }}
							class="gb-exercise-finish-bar fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-5 pt-6"
							style="padding-bottom: calc(1.25rem + env(safe-area-inset-bottom)); background: linear-gradient(transparent, rgb(var(--scrim) / .92) 55%)"
						>
							<button
								onclick={terminarEjercicio}
								disabled={!!exito}
								class="gb-pressable block w-full rounded-2xl py-4 text-center font-bold"
								style="background: rgb({g.glow}); color: var(--on-bright)"
								>{exito ? 'Cerrando…' : '✓ Volver al día'}</button
							>
						</div>
					{:else}
						<button
							onclick={terminarEjercicio}
							disabled={!!exito}
							class="gb-pressable mt-4 block w-full rounded-2xl py-4 text-center font-bold"
							style="background: var(--accent); color: var(--on-accent)"
							>{exito ? 'Cerrando…' : 'Terminar ejercicio'}</button
						>
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
