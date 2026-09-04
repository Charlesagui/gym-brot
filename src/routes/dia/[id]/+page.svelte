<script lang="ts">
	import Icono from '$lib/components/Icono.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { flushSync, onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { liveQuery } from 'dexie';
	import { db, type Ajustes, type Dia, type Sesion } from '$lib/db';
	import { ejercicioPorId, grupos } from '$lib/catalog';
	import {
		actualizarDia,
		ajustarSeries,
		borrarDia,
		quitarEjercicio,
		toggleDiaSemana,
		coloresDia,
		reordenarEjercicios
	} from '$lib/dias';
	import { mantener } from '$lib/mantener';
	import { modoOrden } from '$lib/modo-orden.svelte';
	import {
		descartarReapertura,
		hoyStr,
		reiniciarDia,
		type InstantaneaSesion,
		marcarDiaTerminado,
		reabrirDia,
		sesionHoyObs,
		sesionRecienteObs,
		saltarEjercicio,
		reanudarEjercicio,
		type SesionReciente
	} from '$lib/sesion';
	import {
		calidadDesde,
		estadoEjercicioSesion,
		estadoSesion,
		serieCompleta,
		totalesSesion,
		type CalidadSesion
	} from '$lib/sesion-reglas';
	import { ajustesObs, AJUSTES_DEFAULT } from '$lib/extras';
	import { resumenDiaSesion, resumenHistorialActual } from '$lib/historial';
	import { placasConstancia, placasGanadasEl, type Placa } from '$lib/placas';
	import { sonarDiaTerminado, sonarExito } from '$lib/audio';
	import { vibrar } from '$lib/vibracion';
	import { reproducirEnVista } from '$lib/video';
	import { dur } from '$lib/motion';
	import { estadoLiveQuery, fromLiveQuery } from '$lib/live';
	import { hoy } from '$lib/hoy.svelte';
	import { formatoVolumen } from '$lib/formato';
	import { fechaSesionDesdeUrl } from '$lib/fechas';
	import { fechaCorta } from '$lib/formato';
	import ConfirmSheet from '$lib/components/ConfirmSheet.svelte';
	import ToastAccion from '$lib/components/ToastAccion.svelte';
	import AvisoSesionAnterior from '$lib/components/AvisoSesionAnterior.svelte';
	import { deshacer } from '$lib/deshacer.svelte';
	import CelebracionParticulas from '$lib/components/CelebracionParticulas.svelte';
	import PlacaFila from '$lib/components/PlacaFila.svelte';
	import { guardarSinBloquear, reportarErrorDatos } from '$lib/errores-datos';

	let editando = $state(false);
	let nombreEdit = $state('');
	let avisoDia = $state<string | null>(null);
	let premioDia = $state(false);
	let premioId: ReturnType<typeof setTimeout> | null = null;
	/**
	 * El veredicto con el que se abrió el resumen, congelado.
	 *
	 * No se lee `calidadDia` acá: ese derivado sale del liveQuery, que todavía no
	 * re-emitió cuando volvemos del await de la escritura. En el único caso que el cierre
	 * a mano promueve —bastantes ejercicios trabajados con pocas series— el valor viejo
	 * dice "parcial", así que la celebración salía corta y sobria mientras la pantalla
	 * terminaba diciendo "Día terminado".
	 */
	let premioCalidad = $state<CalidadSesion>('nula');
	/**
	 * El toque que abre el resumen no puede cerrarlo.
	 *
	 * El fondo del resumen es un botón y se monta justo debajo del dedo que acaba de
	 * apretar "Terminar día" (o "Cerrar día" en la confirmación). Sin esta gracia, quien
	 * toca dos veces porque la escritura tardó se lleva puesto el resumen sin verlo.
	 *
	 * Va como `disabled` y no como un chequeo de reloj adentro del handler: así el toque
	 * no se traga en silencio, lo ignora el navegador, y el estado queda dicho donde ya
	 * lo leen el lector de pantalla y los tests.
	 */
	const GRACIA_PREMIO_MS = 400;
	let premioTocable = $state(false);
	let graciaId: ReturnType<typeof setTimeout> | null = null;
	// Solo se muestra si es una racha real (2+ semanas seguidas): no infla la primera.
	let rachaSemanal = $state(0);
	/**
	 * Placas ganadas ESTE día, para el cierre. Salen del mismo resumen que la racha y se
	 * filtran por fecha: corregir el pasado no celebra nada acá, sólo aparece en Historial.
	 */
	let placasHoy = $state<Placa[]>([]);
	let confirmacion = $state<{
		titulo: string;
		mensaje: string;
		confirmarTexto: string;
		onConfirm: () => void | Promise<void>;
	} | null>(null);
	/**
	 * Reiniciar el día borra el trabajo de todos los ejercicios, así que va en dos tiempos:
	 * el botón arma el aviso y el aviso reinicia. Después quedan unos segundos de "Deshacer".
	 */
	let toast = $state<{
		mensaje: string;
		accionTexto: string;
		onAccion: () => void | Promise<void>;
	} | null>(null);
	// Modo reordenar: se entra con long-press; las cards se arrastran (svelte-dnd-action).
	//
	// La tarjeta lleva grupo y no video: en una lista para ordenar el video no ayuda a
	// reconocer nada que el nombre no diga, y costaba 56 px de alto por fila. El color
	// y el emoji del grupo sí ubican, y eran justo lo que este modo perdía respecto de
	// la lista normal.
	interface ItemOrden {
		id: string;
		nombre: string;
		grupo: string;
		glow: string;
		emoji: string;
	}
	// El modo vive en un estado global porque el layout también lo necesita: ver
	// $lib/modo-orden (atrás lo cierra, la barra inferior se esconde mientras dura).
	const reordenando = $derived(modoOrden.abierto);
	let ordenItems = $state<ItemOrden[]>([]);
	const flipMs = dur(180);
	/**
	 * La tarjeta que NO se anima en el movimiento actual.
	 *
	 * La que acabás de mover se queda quieta y la vecina se desliza: además de leerse
	 * mejor —lo que se movió es lo otro—, es lo que deja el botón donde estaba. Con el
	 * `flip` puesto también sobre ella, durante 180 ms la tarjeta se sigue dibujando
	 * (y se sigue tocando) en su lugar viejo, así que un segundo toque rápido caía
	 * sobre la de al lado aunque el scroll ya estuviera compensado.
	 */
	let ancladaId = $state<string | null>(null);
	/**
	 * La tarjeta que se mantuvo apretada para abrir el modo.
	 *
	 * Entrar cambia la forma de todas las filas a la vez, así que sin una marca no hay
	 * forma de saber cuál era la que agarraste — y con la lista scrolleada puede ni
	 * quedar donde estaba el dedo. Se apaga en cuanto movés algo: ahí ya la ubicaste.
	 */
	let agarradaId = $state<string | null>(null);

	const diaId = $derived($page.params.id!);

	const abrevDia = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
	const grupoArchivado = { label: 'Archivado', glow: '148 163 184', emoji: '·' };

	const diaStore = $derived(
		estadoLiveQuery(
			liveQuery(() => db.dias.get(diaId)),
			undefined
		)
	);
	const consultaDia = $derived($diaStore);
	const dia = $derived<Dia | undefined>(consultaDia.valor);
	const cargando = $derived(consultaDia.estado === 'cargando');

	// La fecha queda fijada al abrir. Si viene en la URL sobrevive navegación, recarga
	// y medianoche; las URLs antiguas sin parámetro siguen empezando en hoy.
	//
	// Es a qué sesión escribimos, y NO qué día es hoy: para eso está `hoy`, que es vivo.
	// Mezclar las dos cosas en esta constante era lo que dejaba la pantalla escribiendo en
	// la sesión de ayer sin decirlo después de la medianoche.
	const fechaApertura = hoyStr();
	const fechaSesion = $derived(
		fechaSesionDesdeUrl($page.url.searchParams.get('fecha'), fechaApertura, hoy.valor)
	);
	const fechaInvalida = $derived(fechaSesion == null);
	const sesionStore = $derived(
		estadoLiveQuery(sesionHoyObs(diaId, fechaSesion ?? 'fecha-invalida'), undefined)
	);
	const consultaSesion = $derived($sesionStore);
	const sesion = $derived<Sesion | undefined>(consultaSesion.valor);
	// "Sin sesión" y "todavía no cargó" son el mismo `undefined`: hay que poder
	// distinguirlos para no anunciar un día vacío que todavía no se leyó.
	const sesionCargada = $derived(consultaSesion.estado !== 'cargando');
	const ajustesStore = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const ajustes = $derived<Ajustes>($ajustesStore);

	onDestroy(() => {
		if (premioId) clearTimeout(premioId);
		if (graciaId) clearTimeout(graciaId);
		// Si la pantalla se va con el modo abierto (borrar el día, una recarga), el
		// listener de "atrás" no puede quedar vivo apuntando a una pantalla que no está.
		modoOrden.descartar();
	});

	function progreso(exId: string): { hechas: number; total: number } | null {
		const e = sesion?.ejercicios.find((x) => x.exerciseId === exId);
		if (!e || e.sets.length === 0) return null;
		return { hechas: e.sets.filter(serieCompleta).length, total: e.sets.length };
	}

	function estaCompleto(exId: string): boolean {
		const e = sesion?.ejercicios.find((x) => x.exerciseId === exId);
		return !!e && estadoEjercicioSesion(e.sets, e.saltado) === 'completado';
	}

	function estaSaltado(exId: string): boolean {
		return !!sesion?.ejercicios.find((x) => x.exerciseId === exId)?.saltado;
	}
	function estaParcialSaltado(exId: string): boolean {
		const e = sesion?.ejercicios.find((x) => x.exerciseId === exId);
		return !!e && estadoEjercicioSesion(e.sets, e.saltado) === 'parcial';
	}

	const ejerciciosCompletos = $derived(
		dia?.ejercicios.filter((item) => estaCompleto(item.exerciseId)).length ?? 0
	);
	// Datos viejos pueden traer un ejercicio marcado saltado Y completo: el resumen decía
	// "3/3 ejercicios · 1 saltado" sobre el mismo. Manda lo que de verdad se hizo.
	const ejerciciosSaltados = $derived(
		dia?.ejercicios.filter(
			(item) =>
				estaSaltado(item.exerciseId) &&
				!estaParcialSaltado(item.exerciseId) &&
				!estaCompleto(item.exerciseId)
		).length ?? 0
	);
	const ejerciciosParciales = $derived(
		dia?.ejercicios.filter((item) => estaParcialSaltado(item.exerciseId)).length ?? 0
	);
	// Un ejercicio "resuelto" está hecho o saltado: ninguno bloquea terminar el día.
	const ejerciciosResueltos = $derived(
		dia?.ejercicios.filter((item) => estaCompleto(item.exerciseId) || estaSaltado(item.exerciseId))
			.length ?? 0
	);
	const totalEjercicios = $derived(dia?.ejercicios.length ?? 0);
	const diaListo = $derived(totalEjercicios > 0 && ejerciciosResueltos === totalEjercicios);
	const diaTerminado = $derived(!!sesion?.diaTerminado);
	// Veredicto único del producto, el mismo que lee el historial y el objetivo calórico.
	const calidadDia = $derived(sesion ? estadoSesion(sesion).calidad : 'nula');
	const seriesPlanDia = $derived(sesion?.plan?.series ?? null);
	// Los logros tienen su propio canal: la alarma de descanso es funcional y esto
	// es celebratorio, así que se puede querer una sin la otra.
	const sonidoActivo = $derived(ajustes.sonido && ajustes.sonidoLogros);
	const resumenDia = $derived(resumenDiaSesion(sesion, ajustes.unidad));
	// Por qué el día dejó de estar terminado. Vive en la sesión y no en un estado local
	// porque la reapertura casi siempre se dispara en la pantalla de ejercicio y se lee
	// acá, después de navegar: sin persistirlo, la app se llevaba la celebración en silencio.
	const reapertura = $derived(!diaTerminado ? (sesion?.reaperturaMotivo ?? null) : null);
	const editandoPasado = $derived(!!fechaSesion && fechaSesion !== hoy.valor);

	function abrirEdicion() {
		nombreEdit = dia?.nombre ?? '';
		editando = true;
	}
	function guardarNombre() {
		if (dia && nombreEdit.trim()) {
			guardarSinBloquear(
				actualizarDia(diaId, { nombre: nombreEdit.trim() }),
				'No se pudo guardar el nombre de la rutina. Intentá de nuevo.'
			);
		}
	}
	async function eliminar() {
		if (!dia) return;
		confirmacion = {
			titulo: 'Borrar día',
			mensaje: `Vas a borrar "${dia.nombre}" de tus rutinas. El historial ya registrado no se borra.`,
			confirmarTexto: 'Borrar',
			onConfirm: async () => {
				await borrarDia(diaId);
				confirmacion = null;
				goto('/');
			}
		};
	}

	/**
	 * Cerrar el día ya no exige haber resuelto todo.
	 *
	 * Antes sí, y era la trampa: quien hacía un ejercicio y se iba sólo podía saltar el
	 * resto —mintiendo sobre por qué no los hizo— o dejar el día abierto para siempre.
	 * Ahora el botón siempre está, y cuando queda trabajo afuera la app lo dice con
	 * números antes de cerrar en vez de esconderlo.
	 */
	async function terminarDia() {
		if (diaTerminado || !fechaSesion || !hayTrabajo) return;
		if (diaListo) {
			await cerrarDia(false);
			return;
		}
		const faltan = totalEjercicios - ejerciciosResueltos;
		const hechas = seriesPlanDia
			? `${seriesHechasDia} de ${seriesPlanDia} series`
			: `${seriesHechasDia} ${seriesHechasDia === 1 ? 'serie' : 'series'}`;
		confirmacion = {
			titulo: 'Cerrar día con lo hecho',
			mensaje: `Vas a cerrar "${dia?.nombre ?? 'la rutina'}" con ${hechas} y ${faltan} ejercicio${
				faltan === 1 ? '' : 's'
			} sin resolver. Queda registrado como día parcial y podés reabrirlo cuando quieras.`,
			confirmarTexto: 'Cerrar día',
			onConfirm: async () => {
				confirmacion = null;
				await cerrarDia(true);
			}
		};
	}

	async function cerrarDia(conPendientes: boolean) {
		if (!fechaSesion) return;
		// La fecha va explícita: con `hoyStr()` adentro, terminar el día pasada la
		// medianoche marcaba una sesión nueva y vacía y dejaba abierta la real.
		try {
			const resultado = await marcarDiaTerminado(diaId, fechaSesion, { conPendientes });
			if (!resultado.terminado) {
				avisoDia =
					resultado.razon === 'ejercicios-pendientes'
						? 'La rutina cambió mientras la cerrabas. Revisá el ejercicio pendiente antes de terminar el día.'
						: resultado.razon === 'sin-trabajo'
							? 'Todavía no hay nada que cerrar: marcá una serie o saltá un ejercicio.'
							: 'Esta rutina ya no está disponible. Volvé a tus rutinas e intentá de nuevo.';
				return;
			}
		} catch (error) {
			reportarErrorDatos('No se pudo marcar la rutina como terminada. Intentá de nuevo.', error);
			return;
		}
		avisoDia = null;
		// El veredicto se calcula acá, sobre la sesión que ya tenemos y con el cierre a
		// mano puesto: ver `premioCalidad`. Las series ya estaban escritas antes de este
		// await, así que lo único que le falta al derivado es el `diaTerminado`.
		premioCalidad = sesion
			? calidadDesde({ ...totalesSesion(sesion), cerradaAMano: true })
			: 'nula';
		premioDia = true;
		premioTocable = false;
		if (graciaId) clearTimeout(graciaId);
		graciaId = setTimeout(() => (premioTocable = true), GRACIA_PREMIO_MS);
		rachaSemanal = 0;
		placasHoy = [];
		// La recompensa sigue al veredicto, no al toque: la fiesta entera es para el día
		// completo, y el parcial recibe el acuse corto. Celebrar los dos igual es lo que
		// hacía que "día terminado" no significara nada.
		const completo = premioCalidad === 'completa';
		const conActividadReal = resumenDia.setsHechos > 0;
		if (conActividadReal && sonidoActivo)
			void (completo ? sonarDiaTerminado() : sonarExito(false)).catch(() => {});
		if (conActividadReal)
			vibrar(completo ? [120, 70, 120, 70, 220] : [90], ajustes.vibracion ?? true);
		if (conActividadReal) {
			// Puntual, no suscripta: ver el comentario en rachaSemanalActual(). Una sola
			// lectura para la racha y las placas. Se lee también en el día parcial porque el
			// parcial sostiene la racha, así que también puede ganar una placa.
			const fechaCierre = fechaSesion;
			void resumenHistorialActual()
				.then((resumen) => {
					if (!premioDia) return;
					if (completo) rachaSemanal = resumen.rachaSemanal;
					placasHoy = fechaCierre ? placasGanadasEl(placasConstancia(resumen), fechaCierre) : [];
					// Nada importante vuelve de forma abrupta después de un logro: si el cierre
					// corto iba a irse solo, con una placa ganada se queda hasta que lo cierren.
					if (placasHoy.length > 0 && premioId) {
						clearTimeout(premioId);
						premioId = null;
					}
				})
				.catch(() => {});
		}
		if (premioId) clearTimeout(premioId);
		premioId = null;
		// El día completo NO se cierra solo. Es la recompensa mayor de la app y además la
		// única pantalla que junta volumen, PRs y racha: irse sola a los 2,4 s dejaba un
		// resumen que no se llegaba a leer y que después no se puede volver a abrir desde
		// acá. Se va cuando la persona lo cierra. El parcial sí caduca, pero con tiempo
		// para leerse: 1,6 s no alcanzaban ni para la primera línea.
		if (!completo) premioId = setTimeout(() => (premioDia = false), 3600);
	}

	async function saltarEjercicioActual(exerciseId: string) {
		if (!fechaSesion) return;
		try {
			const resultado = await saltarEjercicio(diaId, exerciseId, fechaSesion, ajustes.unidad);
			if (resultado.saltado) return;
			avisoDia =
				resultado.razon === 'ya-completado'
					? 'Ese ejercicio ya está hecho: no hace falta saltarlo.'
					: resultado.razon === 'fecha-futura'
						? 'Esa fecha todavía no llegó: no se guardó ningún cambio.'
						: 'Este ejercicio ya no está en la rutina. No se guardó ningún cambio.';
		} catch (error) {
			reportarErrorDatos('No se pudo guardar que saltaste el ejercicio. Intentá de nuevo.', error);
		}
	}

	/** Series realmente marcadas hoy: sin ninguna, no hay nada que reiniciar ni que cerrar. */
	const seriesHechasDia = $derived(resumenDia.setsHechos);
	const hayTrabajo = $derived(seriesHechasDia > 0 || ejerciciosSaltados > 0);
	const hayQueReiniciar = $derived(hayTrabajo);

	/**
	 * Trabajo tuyo de hace un rato en otra fecha, cuando esta pantalla está vacía.
	 *
	 * Es lo que faltaba del lado del "se me borró todo": la sesión nueva se abre en cero
	 * porque cambió el día, no porque se haya perdido nada, y desde acá no había ninguna
	 * forma de enterarse. Se apaga solo al marcar la primera serie de hoy.
	 */
	const recienteStore = $derived(
		fromLiveQuery(sesionRecienteObs(diaId, null, hoy.valor), null as SesionReciente | null)
	);
	const sesionAnterior = $derived(
		sesionCargada && !editandoPasado && !hayTrabajo && !diaTerminado ? $recienteStore : null
	);

	function pedirReinicioDia() {
		if (!fechaSesion || !hayQueReiniciar) return;
		const partes: string[] = [];
		if (seriesHechasDia > 0)
			partes.push(`${seriesHechasDia} ${seriesHechasDia === 1 ? 'serie' : 'series'}`);
		if (ejerciciosSaltados > 0)
			partes.push(`${ejerciciosSaltados} ${ejerciciosSaltados === 1 ? 'salto' : 'saltos'}`);
		toast = {
			mensaje: `Se desmarca todo el día: ${partes.join(' y ')}. Los pesos y las reps quedan como referencia.`,
			accionTexto: 'Reiniciar',
			onAccion: hacerReinicioDia
		};
	}

	async function hacerReinicioDia() {
		if (!fechaSesion) return;
		toast = null;
		cerrarPremio();
		let instantanea: InstantaneaSesion | null;
		try {
			instantanea = await reiniciarDia(diaId, fechaSesion);
		} catch (error) {
			reportarErrorDatos('No se pudo reiniciar el día. Intentá de nuevo.', error);
			return;
		}
		if (!instantanea) return;
		deshacer.ofrecer('Día reiniciado.', diaId, fechaSesion, instantanea);
	}

	function descartarAvisoReapertura() {
		if (!fechaSesion) return;
		guardarSinBloquear(
			descartarReapertura(diaId, fechaSesion),
			'No se pudo descartar el aviso. Intentá de nuevo.'
		);
	}

	async function reabrir() {
		if (!fechaSesion) return;
		cerrarPremio();
		try {
			await reabrirDia(diaId, fechaSesion);
		} catch (error) {
			reportarErrorDatos('No se pudo reabrir la rutina. Intentá de nuevo.', error);
		}
	}

	function cerrarPremio() {
		premioDia = false;
		premioTocable = false;
		if (premioId) clearTimeout(premioId);
		premioId = null;
		if (graciaId) clearTimeout(graciaId);
		graciaId = null;
	}

	/** El orden que está EN LA BASE, en la forma que muestra el modo. */
	function itemsDelDia(fuente: Dia): ItemOrden[] {
		return [...fuente.ejercicios]
			.sort((a, b) => a.orden - b.orden)
			.map((it) => {
				const e = ejercicioPorId(it.exerciseId);
				const g = e ? grupos[e.grupo] : grupoArchivado;
				return {
					id: it.exerciseId,
					nombre: e?.nombre ?? it.exerciseId,
					grupo: g.label,
					glow: g.glow,
					emoji: g.emoji
				};
			});
	}

	/**
	 * Abre el modo de orden, opcionalmente sabiendo qué tarjeta se mantuvo apretada.
	 *
	 * Con un solo ejercicio no se entra: las dos flechas nacerían deshabilitadas y lo
	 * único apretable sería quitar. El botón de Editar ya tenía esta guarda; el
	 * long-press no, así que mantener el único ejercicio de un día abría un modo vacío
	 * de trabajo. (La portada la tenía en los dos lados desde siempre.)
	 */
	function entrarReordenar(exerciseId?: string) {
		if (!dia || dia.ejercicios.length < 2) return;
		ordenItems = itemsDelDia(dia);
		// El único aviso de que cambiaste de modo era que la lista se rearmaba sola:
		// `mantener` apaga su resalte de "vas a activar" justo al disparar, y el tic
		// global de presión sale al soltar un botón, no al cumplirse una pulsación
		// sostenida. Un golpe corto dice "te escuché" sin tapar nada.
		vibrar(18, ajustes.vibracion ?? true);
		agarradaId = exerciseId ?? null;
		// Dónde está esa tarjeta AHORA, para dejarla en el mismo lugar de la pantalla.
		const antes = exerciseId ? topEnPantalla('data-ejercicio-id', exerciseId) : null;
		modoOrden.abrir();
		if (antes == null) return;
		flushSync();
		const despues = topEnPantalla('data-orden-id', exerciseId!);
		if (despues != null && despues !== antes) window.scrollBy(0, despues - antes);
	}

	/**
	 * Posición en la ventana de la tarjeta de un ejercicio, buscándola por el atributo
	 * que use la lista que esté montada. Se compara contra otra medición tomada al mismo
	 * scroll, así que alcanza con coordenadas de ventana.
	 */
	function topEnPantalla(atributo: string, id: string): number | null {
		const el = document.querySelector<HTMLElement>(`[${atributo}="${CSS.escape(id)}"]`);
		return el ? el.getBoundingClientRect().top : null;
	}

	function salirReordenar() {
		modoOrden.cerrar();
	}

	/**
	 * Dónde arranca la tarjeta dentro de la lista, en píxeles de layout.
	 *
	 * `offsetTop` y no `getBoundingClientRect()`: mientras corre el `flip` la tarjeta
	 * lleva un transform que la sigue dibujando en su lugar viejo, así que el rect
	 * miente justo en el momento en que necesitamos el dato.
	 */
	function topDeTarjeta(id: string): number | null {
		const el = document.querySelector<HTMLElement>(`[data-orden-id="${CSS.escape(id)}"]`);
		return el ? el.offsetTop : null;
	}

	function alConsiderar(e: CustomEvent<DndEvent<ItemOrden>>) {
		agarradaId = null; // ya la encontraste: el resalte cumplió su trabajo
		ordenItems = e.detail.items;
	}

	/**
	 * Guarda el orden y, si la base lo rechaza, vuelve a mostrar el que sí está guardado.
	 *
	 * Antes el fallo sólo levantaba el aviso global: la pantalla se quedaba mostrando un
	 * orden que no existía en ningún lado, y al salir del modo la lista pegaba el salto
	 * al orden viejo sin que nada lo explicara. Se relee del día —la verdad persistida—
	 * y no de una copia previa, que con dos toques seguidos ya estaría vencida.
	 */
	function guardarOrdenEjercicios() {
		reordenarEjercicios(
			diaId,
			ordenItems.map((it) => it.id)
		).catch((error: unknown) => {
			if (dia) ordenItems = itemsDelDia(dia);
			reportarErrorDatos('No se pudo guardar el orden de los ejercicios. Intentá de nuevo.', error);
		});
	}

	function alSoltar(e: CustomEvent<DndEvent<ItemOrden>>) {
		ordenItems = e.detail.items;
		guardarOrdenEjercicios();
	}

	/**
	 * Sube o baja un ejercicio, y deja la tarjeta donde estaba EN LA PANTALLA.
	 *
	 * Las flechas viven adentro de la tarjeta y el `flip` mueve el nodo de verdad, así
	 * que sin compensar el scroll el botón se iba de abajo del dedo: el segundo toque en
	 * el mismo lugar caía sobre el ejercicio que acababa de ocupar esa ranura y lo
	 * mandaba para el otro lado. Dos toques, dos animaciones y el orden como al
	 * principio — la lista parecía sacudirse sola. Corriendo la página lo que se movió
	 * la tarjeta, tocar ↓ cuatro veces baja cuatro posiciones el mismo ejercicio.
	 */
	function moverEjercicio(id: string, delta: -1 | 1) {
		const origen = ordenItems.findIndex((item) => item.id === id);
		const destino = origen + delta;
		if (origen < 0 || destino < 0 || destino >= ordenItems.length) return;
		agarradaId = null;
		const antes = topDeTarjeta(id);
		const nuevos = [...ordenItems];
		const [movido] = nuevos.splice(origen, 1);
		nuevos.splice(destino, 0, movido!);
		ancladaId = id;
		ordenItems = nuevos;
		guardarOrdenEjercicios();
		// `flushSync` y no `await tick()`: la corrección tiene que entrar en el mismo
		// click. Con un await en el medio, dos toques muy seguidos alcanzaban a caer
		// sobre la tarjeta vieja antes de que la página se hubiera acomodado.
		flushSync();
		const despues = topDeTarjeta(id);
		if (antes != null && despues != null && despues !== antes) window.scrollBy(0, despues - antes);
		// Las animaciones de las demás ya arrancaron con su duración: se puede soltar.
		ancladaId = null;
	}

	async function quitarEnReorden(it: ItemOrden) {
		confirmacion = {
			titulo: 'Quitar ejercicio',
			mensaje: `Vas a quitar "${it.nombre}" de este día. Si lo volvés a agregar, puede perder su configuración de series objetivo.`,
			confirmarTexto: 'Quitar',
			onConfirm: async () => {
				ordenItems = ordenItems.filter((x) => x.id !== it.id);
				await quitarEjercicio(diaId, it.id);
				confirmacion = null;
			}
		};
	}

	function confirmarQuitarEjercicio(nombre: string, exerciseId: string) {
		confirmacion = {
			titulo: 'Quitar ejercicio',
			mensaje: `Vas a quitar "${nombre}" de este día. Si lo volvés a agregar, puede perder su configuración de series objetivo.`,
			confirmarTexto: 'Quitar',
			onConfirm: async () => {
				await quitarEjercicio(diaId, exerciseId);
				confirmacion = null;
			}
		};
	}
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-var(--gb-nav))] px-5 pb-28">
	<header class="mb-5 flex flex-wrap items-center gap-3">
		{#if reordenando}
			<!--
				Mientras se ordena, la flecha de arriba NO puede irse a Rutinas: es el
				control que la mano busca primero para salir de un modo, y era la forma
				más rápida de terminar el orden y aparecer en otra pantalla.
			-->
			<button
				onclick={salirReordenar}
				class="grid size-11 shrink-0 place-items-center rounded-full border border-white/10"
				aria-label="Volver a los ejercicios"><Icono nombre="volver" /></button
			>
		{:else}
			<a
				href="/"
				class="grid size-11 shrink-0 place-items-center rounded-full border border-white/10"
				aria-label="Volver"><Icono nombre="volver" /></a
			>
		{/if}
		{#if editando}
			<input
				bind:value={nombreEdit}
				onblur={guardarNombre}
				class="min-w-0 flex-1 rounded-lg bg-white/5 px-3 py-1.5 text-lg font-bold outline-none"
				placeholder="Nombre del día (ej: Piernas, Pecho…)"
			/>
			<button
				onclick={() => (editando = false)}
				class="min-h-11 basis-full rounded-full px-4 py-2 text-sm font-bold"
				style="background: var(--accent); color: var(--on-accent)">Guardar nombre</button
			>
		{:else}
			<div class="min-w-0 flex-1">
				<h1 class="truncate text-xl font-bold leading-tight">{dia?.nombre ?? ''}</h1>
				{#if editandoPasado}
					<!-- Se llega acá desde el historial: entrenar ayer no puede parecerse a hoy. -->
					<p class="text-[11px] font-semibold leading-tight" style="color: rgb(var(--max))">
						Entrenamiento del {fechaCorta(fechaSesion!)} · no es hoy
					</p>
				{/if}
			</div>
			{#if dia && !reordenando}
				<button
					onclick={abrirEdicion}
					class="flex min-h-11 items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-sm font-semibold"
					aria-label="Editar">✏️ Editar</button
				>
			{/if}
		{/if}
	</header>

	{#if cargando}
		<p class="text-center text-sm" style="color: var(--muted)">Cargando…</p>
	{:else if consultaDia.estado === 'error'}
		<div class="rounded-2xl border border-red-400/25 bg-red-400/10 p-4 text-center" role="alert">
			<p class="text-sm font-semibold" style="color: #ff9b9b">No se pudo cargar esta rutina.</p>
			<button
				onclick={() => location.reload()}
				class="mt-3 min-h-11 rounded-xl px-4 text-sm font-bold"
				style="background: rgba(255,255,255,.1); color: white">Reintentar</button
			>
		</div>
	{:else if fechaInvalida}
		<section class="rounded-2xl border border-dashed border-white/15 p-5 text-center" role="alert">
			<p class="text-sm font-bold">La fecha de esta sesión no es válida</p>
			<p class="mt-1 text-xs" style="color: var(--muted)">
				Puede ser una fecha imposible o una que todavía no llegó. No se creó ni modificó ningún
				entrenamiento.
			</p>
			<a
				href={`/dia/${diaId}`}
				class="mt-4 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold"
				style="background: var(--accent); color: var(--on-accent)"
			>
				Abrir la sesión de hoy
			</a>
		</section>
	{:else if !dia}
		<section class="rounded-2xl border border-dashed border-white/15 p-5 text-center">
			<p class="text-sm font-bold">Día no encontrado</p>
			<p class="mt-1 text-xs" style="color: var(--muted)">Esta rutina pudo haber sido eliminada.</p>
			<a
				href="/"
				class="mt-4 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold"
				style="background: var(--accent); color: var(--on-accent)"
			>
				Volver a rutinas
			</a>
		</section>
	{:else if reordenando}
		<p
			class="mb-3 text-center text-xs font-semibold uppercase tracking-wider"
			style="color: var(--muted)"
		>
			Arrastrá una tarjeta, o movela con las flechas
		</p>
		<section
			aria-label="Orden de ejercicios"
			use:dndzone={{
				items: ordenItems,
				flipDurationMs: flipMs,
				dropTargetStyle: {},
				// Sin esto, un swipe para scrollear la lista arrancaba un arrastre en vez
				// de mover la página: con muchos ejercicios era imposible bajar la lista.
				delayTouchStart: 200
			}}
			onconsider={alConsiderar}
			onfinalize={alSoltar}
			class="space-y-3"
		>
			<!--
				Una fila por ejercicio, como el reordenado de rutinas. Antes era una grilla
				de dos filas —video de 56 px arriba, flechas y ✕ abajo— y cada tarjeta
				pasaba de 86 px a 130: entrar al modo estiraba la lista casi un 50 %, se
				iban ejercicios abajo del fold y el botón de salir quedaba a dos pantallas
				de scroll. El número de posición y el grupo vuelven a decir qué ejercicio
				es y cómo quedó el orden, que era lo que la tarjeta vieja no decía.
			-->
			{#each ordenItems as it, i (it.id)}
				<div
					animate:flip={{ duration: it.id === ancladaId ? 0 : flipMs }}
					data-orden-id={it.id}
					aria-label={`Mover ${it.nombre}`}
					class="gb-sortable-card flex touch-pan-y items-center gap-2 rounded-2xl border p-3 {it.id ===
					agarradaId
						? 'gb-agarrada'
						: 'border-white/10'}"
					style="--drag-color: {it.glow}; background: linear-gradient(90deg, rgb({it.glow} / 0.12), transparent 55%), var(--surface)"
				>
					<span
						class="h-9 w-1.5 shrink-0 rounded-full"
						style="background: rgb({it.glow})"
						aria-hidden="true"
					></span>
					<div class="min-w-0 flex-1">
						<p class="gb-line-clamp-2 text-sm font-semibold leading-tight">{it.nombre}</p>
						<p class="mt-0.5 truncate text-[11px] font-medium" style="color: rgb({it.glow})">
							{i + 1}º · {it.emoji}
							{it.grupo}
						</p>
					</div>
					<div class="flex shrink-0 items-center gap-1">
						<button
							onpointerdown={(evento) => evento.stopPropagation()}
							onclick={() => moverEjercicio(it.id, -1)}
							disabled={ordenItems[0]?.id === it.id}
							class="grid size-11 place-items-center rounded-full bg-white/[0.06] disabled:opacity-30"
							aria-label={`Subir ${it.nombre}`}><Icono nombre="subir" tamano={18} /></button
						>
						<button
							onpointerdown={(evento) => evento.stopPropagation()}
							onclick={() => moverEjercicio(it.id, 1)}
							disabled={ordenItems.at(-1)?.id === it.id}
							class="grid size-11 place-items-center rounded-full bg-white/[0.06] disabled:opacity-30"
							aria-label={`Bajar ${it.nombre}`}><Icono nombre="bajar" tamano={18} /></button
						>
						<!-- Quitar deja de ser el botón más grande de un modo que sirve para ordenar. -->
						<button
							onpointerdown={(ev) => ev.stopPropagation()}
							onclick={() => quitarEnReorden(it)}
							class="grid size-11 place-items-center rounded-full"
							style="background: rgba(255,80,80,.15); color: #ff6b6b"
							aria-label={`Quitar ${it.nombre}`}><Icono nombre="cerrar" tamano={18} /></button
						>
					</div>
				</div>
			{/each}
		</section>
		<!--
			La salida va fija en el hueco que dejó la barra inferior, no al final de la
			lista: con seis ejercicios había que scrollear hasta el fondo para encontrarla,
			y lo que estaba a mano eran las cuatro secciones del nav.
		-->
		<div
			class="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-5 pt-3"
			style="padding-bottom: calc(0.75rem + var(--safe-bottom)); background: linear-gradient(to top, var(--bg) 72%, transparent)"
		>
			<button
				onclick={salirReordenar}
				class="w-full rounded-2xl py-3 text-sm font-bold"
				style="background: var(--accent); color: var(--on-accent)">Terminar orden</button
			>
		</div>
	{:else}
		{#if editando}
			{#if dia.ejercicios.length > 1}
				<button
					onclick={() => entrarReordenar()}
					class="mb-4 min-h-11 w-full rounded-xl border border-white/10 px-4 text-sm font-bold"
					style="color: var(--accent-text)"
					><span class="inline-flex items-center justify-center gap-1.5"
						><Icono nombre="ordenar" tamano={18} /> Reordenar ejercicios</span
					></button
				>
			{/if}
			<p class="mb-2 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Días de la semana (podés elegir varios)
			</p>
			<div class="mb-4 grid grid-cols-4 gap-1.5">
				{#each abrevDia as d, i (i)}
					<button
						onclick={() =>
							guardarSinBloquear(
								toggleDiaSemana(diaId, i),
								'No se pudo guardar el día de entrenamiento. Intentá de nuevo.'
							)}
						class="min-h-11 min-w-11 rounded-lg py-2 text-xs font-semibold"
						aria-pressed={dia.diasSemana?.includes(i) ?? false}
						aria-label={`Entrenar los días ${d}`}
						style={dia.diasSemana?.includes(i)
							? 'background: var(--accent); color: var(--on-accent)'
							: 'background: rgba(255,255,255,.05); color: var(--muted)'}>{d}</button
					>
				{/each}
			</div>

			<p class="mb-2 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Color
			</p>
			<div class="mb-6 flex flex-wrap gap-2.5">
				{#each coloresDia as c (c.rgb)}
					<button
						onclick={() =>
							guardarSinBloquear(
								actualizarDia(diaId, { color: c.rgb }),
								'No se pudo guardar el color de la rutina. Intentá de nuevo.'
							)}
						class="size-11 rounded-full transition"
						aria-pressed={dia.color === c.rgb}
						aria-label={`Color ${c.nombre}`}
						style="background: rgb({c.rgb}); outline: {dia.color === c.rgb
							? '2px solid white'
							: '2px solid transparent'}; outline-offset: 2px"
					></button>
				{/each}
			</div>
		{/if}

		{#if !editando && sesionAnterior}
			<!-- Va ARRIBA de la lista: es la respuesta a "¿y lo que hice?", y esa pregunta
			     se la hace la persona en el primer segundo, mirando los contadores en cero. -->
			<div class="mb-3">
				<AvisoSesionAnterior
					aviso={sesionAnterior}
					href={`/dia/${diaId}?fecha=${sesionAnterior.fecha}`}
				/>
			</div>
		{/if}

		<div class="gb-landscape-cards space-y-3">
			{#each dia.ejercicios.slice().sort((a, b) => a.orden - b.orden) as item, i (item.exerciseId)}
				{@const e = ejercicioPorId(item.exerciseId)}
				{@const g = e ? grupos[e.grupo] : grupoArchivado}
				{@const nombre = e?.nombre ?? 'Ejercicio archivado'}
				{@const p = progreso(item.exerciseId)}
				{@const saltado = estaSaltado(item.exerciseId)}
				{#if editando}
					<div
						class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 p-2.5"
						style="background: radial-gradient(150% 130% at 0% 0%, rgb({g.glow} / 0.14), transparent 60%), var(--surface)"
					>
						{#if e}
							<video
								use:reproducirEnVista={e.demoVideo}
								class="gb-thumb-frame size-14 shrink-0 rounded-xl object-contain"
								aria-label={e.nombre}
								loop
								muted
								playsinline
								preload="none"
							></video>
						{:else}
							<div
								class="grid size-14 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-lg font-black"
								style="color: rgb({g.glow})"
								aria-label="Ejercicio archivado"
							>
								?
							</div>
						{/if}
						<div class="min-w-0 flex-1">
							<p class="gb-line-clamp-2 text-sm font-semibold leading-tight">{nombre}</p>
							{#if !e}
								<p class="mt-0.5 text-xs" style="color: var(--muted)">
									ID guardado: {item.exerciseId}
								</p>
							{/if}
						</div>
						<!-- Deltas, no totales: con el total calculado acá, dos toques rápidos
							     escribían dos veces el mismo número y uno se perdía. -->
						<div class="col-span-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5">
							<button
								onclick={() =>
									guardarSinBloquear(
										ajustarSeries(diaId, item.exerciseId, -1),
										'No se pudo cambiar la cantidad de series. Intentá de nuevo.'
									)}
								class="grid size-11 shrink-0 touch-manipulation place-items-center rounded-full bg-white/10 text-sm"
								aria-label={`Menos series de ${nombre}`}>−</button
							>
							<span class="text-sm font-semibold tabular-nums"
								>{item.seriesObjetivo}
								{item.seriesObjetivo === 1 ? 'serie' : 'series'} objetivo</span
							>
							<button
								onclick={() =>
									guardarSinBloquear(
										ajustarSeries(diaId, item.exerciseId, 1),
										'No se pudo cambiar la cantidad de series. Intentá de nuevo.'
									)}
								class="grid size-11 shrink-0 touch-manipulation place-items-center rounded-full bg-white/10 text-sm"
								aria-label={`Más series de ${nombre}`}>+</button
							>
						</div>
						<button
							onclick={() => confirmarQuitarEjercicio(nombre, item.exerciseId)}
							class="col-start-3 row-start-1 grid size-11 shrink-0 place-items-center rounded-full"
							style="background: rgba(255,80,80,.15); color: #ff6b6b"
							aria-label="Quitar"><Icono nombre="cerrar" tamano={18} /></button
						>
					</div>
				{:else}
					<!-- Cascada corta al entrar, como en la portada. El tope de 6 importa acá:
					     una rutina larga si no deja la última tarjeta llegando a los 700ms, y a
					     esta pantalla se vuelve entre serie y serie. -->
					<div
						data-ejercicio-id={item.exerciseId}
						use:mantener={() => entrarReordenar(item.exerciseId)}
						in:fly={{ y: 12, duration: dur(250), delay: dur(Math.min(i, 6) * 45) }}
						class="flex items-center gap-2 rounded-2xl border border-white/10 p-2.5 {saltado
							? 'opacity-55'
							: ''}"
						style="background: radial-gradient(150% 130% at 0% 0%, rgb({g.glow} / 0.14), transparent 60%), var(--surface)"
					>
						<a
							href={`/ejercicio/${item.exerciseId}?dia=${diaId}&fecha=${fechaSesion}`}
							class="flex min-w-0 flex-1 items-center gap-3"
						>
							{#if e}
								<video
									use:reproducirEnVista={e.demoVideo}
									class="gb-thumb-frame size-16 shrink-0 rounded-xl object-contain"
									aria-label={e.nombre}
									loop
									muted
									playsinline
									preload="none"
								></video>
							{:else}
								<div
									class="grid size-16 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-xl font-black"
									style="color: rgb({g.glow})"
									aria-label="Ejercicio archivado"
								>
									?
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="gb-line-clamp-2 text-sm font-semibold leading-tight">{nombre}</p>
								<p class="mt-0.5 text-xs font-medium" style="color: rgb({g.glow})">
									{g.emoji}
									{g.label}
								</p>
								{#if !e}
									<p class="mt-0.5 truncate text-[11px]" style="color: var(--muted)">
										ID guardado: {item.exerciseId}
									</p>
								{/if}
							</div>
							<div class="pr-1 text-right">
								{#if estaParcialSaltado(item.exerciseId) && p}
									<p class="text-lg font-bold leading-none">{p.hechas}/{p.total}</p>
									<p class="max-w-16 text-[10px] leading-tight" style="color: var(--muted)">
										resto saltado
									</p>
								{:else if saltado}
									<p class="text-[11px] font-bold leading-none" style="color: var(--muted)">
										Saltado
									</p>
									<p class="text-[11px]" style="color: var(--muted)">hoy</p>
								{:else if p && p.hechas === p.total}
									<p class="text-xl leading-none" style="color: rgb({g.glow})">✓</p>
									<p class="text-[11px]" style="color: var(--muted)">hecho</p>
								{:else if p}
									<p class="text-lg font-bold leading-none">{p.hechas}/{p.total}</p>
									<p class="text-[11px]" style="color: var(--muted)">
										{p.total === 1 ? 'serie' : 'series'}
									</p>
								{:else}
									<p class="text-lg font-bold leading-none">{item.seriesObjetivo}</p>
									<p class="text-[11px]" style="color: var(--muted)">
										{item.seriesObjetivo === 1 ? 'serie' : 'series'}
									</p>
								{/if}
							</div>
						</a>
						{#if saltado}
							<button
								onclick={() =>
									guardarSinBloquear(
										reanudarEjercicio(diaId, item.exerciseId, fechaSesion!),
										'No se pudo reanudar el ejercicio. Intentá de nuevo.'
									)}
								class="grid size-11 shrink-0 place-items-center rounded-full border border-white/10 text-sm"
								style="color: var(--accent-text)"
								aria-label={`Reanudar ${nombre} hoy`}>↩</button
							>
						{:else if estaCompleto(item.exerciseId)}
							<!-- Un ejercicio hecho no se salta: se corrige. Saltarlo lo rotulaba
							     "Saltado" en gris y reabría el día por nada. -->
							<a
								href={`/ejercicio/${item.exerciseId}?dia=${diaId}&fecha=${fechaSesion}`}
								class="grid min-h-11 shrink-0 place-items-center rounded-full px-3 text-xs font-medium"
								style="color: var(--muted)"
								aria-label={`Corregir o agregar series de ${nombre}`}>Corregir</a
							>
						{:else}
							<!-- Acción secundaria: sin borde ni negrita, para no competir con el
							     progreso de la fila. El target táctil se mantiene en 44px. -->
							<button
								onclick={() => void saltarEjercicioActual(item.exerciseId)}
								class="min-h-11 shrink-0 rounded-full px-3 py-2 text-xs font-medium"
								style="color: var(--muted)"
								aria-label={`Saltar ${nombre} hoy`}>Saltar</button
							>
						{/if}
					</div>
				{/if}
			{/each}

			{#if dia.ejercicios.length === 0}
				<p
					class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm"
					style="color: var(--muted)"
				>
					Sin ejercicios todavía. Agregá el primero 👇
				</p>
			{/if}
		</div>

		{#if !editando && totalEjercicios > 0}
			{#if reapertura}
				<div
					class="mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5"
					style="background: rgb(var(--max) / .1)"
					role="status"
				>
					<p class="flex-1 text-xs font-semibold leading-relaxed" style="color: rgb(var(--max))">
						Este día dejó de estar terminado: {reapertura.toLowerCase()}.
					</p>
					<button
						onclick={descartarAvisoReapertura}
						class="min-h-11 shrink-0 px-2 text-xs font-bold"
						style="color: rgb(var(--max))"
						aria-label="Descartar el aviso de reapertura">Entendido</button
					>
				</div>
			{/if}
			{#if avisoDia}
				<p
					class="mt-4 rounded-xl px-3 py-2.5 text-xs font-semibold leading-relaxed"
					style="background: rgb(var(--max) / .1); color: rgb(var(--max))"
					role="alert"
				>
					{avisoDia}
				</p>
			{/if}
			<section
				class="mt-4 rounded-2xl border border-white/10 p-4"
				style="background: var(--surface)"
			>
				<div class="flex items-center justify-between gap-3">
					<div>
						<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
							Estado del día
						</p>
						<p class="mt-1 text-sm font-bold">
							{ejerciciosCompletos}/{totalEjercicios} ejercicios{#if ejerciciosParciales > 0}<span
									class="font-medium"
									style="color: var(--muted)"
								>
									· {ejerciciosParciales} parcial{ejerciciosParciales === 1 ? '' : 'es'}</span
								>{/if}{#if ejerciciosSaltados > 0}<span
									class="font-medium"
									style="color: var(--muted)"
								>
									· {ejerciciosSaltados} saltado{ejerciciosSaltados === 1 ? '' : 's'}</span
								>{/if}
						</p>
					</div>
					<div class="flex shrink-0 flex-col items-end gap-1">
						{#if diaTerminado}
							<span
								class="rounded-full px-2.5 py-1 text-xs font-bold"
								style="background: {calidadDia === 'completa'
									? 'rgb(var(--exito) / .16)'
									: 'rgba(255,255,255,.08)'}; color: {calidadDia === 'completa'
									? 'rgb(var(--exito))'
									: 'var(--muted)'}"
								>{calidadDia === 'completa' ? 'Terminado' : 'Cerrado parcial'}</span
							>
						{:else if diaListo}
							<span
								class="rounded-full px-2.5 py-1 text-xs font-bold"
								style="background: rgba(255,255,255,.08); color: var(--muted)">Listo</span
							>
						{:else}
							<span
								class="rounded-full px-2.5 py-1 text-xs font-bold"
								style="background: rgba(255,255,255,.08); color: var(--muted)">En curso</span
							>
						{/if}
					</div>
				</div>

				<!--
					Reiniciar comparte la fila con la acción principal en vez de colgar debajo. No es
					solo estética: todo lo que se agrega DEBAJO de la lista de ejercicios le da scroll
					extra a la página, y con ese colchón la última tarjeta queda pegada al borde
					inferior, justo donde la barra fija se come los toques. Acá suma cero alto.
				-->
				<div class="mt-3 grid gap-2 {hayQueReiniciar ? 'grid-cols-[minmax(0,1fr)_auto]' : ''}">
					{#if diaTerminado}
						<button
							onclick={reabrir}
							class="rounded-2xl border border-white/10 py-3 text-sm font-bold"
							style="color: var(--muted)">Reabrir día</button
						>
					{:else}
						<!--
							Siempre apretable mientras haya trabajo real. Con el día incompleto no
							cierra de una: confirma diciendo cuánto queda afuera. Antes estaba
							deshabilitado y la única salida honesta era saltar los ejercicios que
							faltaban, que es mentir sobre por qué no se hicieron.
						-->
						<button
							onclick={terminarDia}
							disabled={!hayTrabajo}
							class="rounded-2xl py-3 text-sm font-bold disabled:opacity-45"
							style="background: {diaListo
								? 'var(--accent)'
								: 'rgba(255,255,255,.08)'}; color: {diaListo ? 'white' : 'var(--muted)'}"
						>
							{#if diaListo}
								<span class="inline-flex items-center gap-2">
									<Icono nombre="terminar" tamano={18} /> Terminar día
								</span>
							{:else if hayTrabajo}
								{@const faltan = totalEjercicios - ejerciciosResueltos}
								Cerrar con lo hecho · faltan {faltan}
							{:else}
								{@const faltan = totalEjercicios - ejerciciosResueltos}
								Faltan {faltan} ejercicio{faltan === 1 ? '' : 's'}
							{/if}
						</button>
					{/if}
					{#if hayQueReiniciar}
						<button
							onclick={pedirReinicioDia}
							class="rounded-2xl px-3 text-xs font-semibold"
							style="color: var(--muted)"
							aria-label="Reiniciar el día">Reiniciar</button
						>
					{/if}
				</div>
			</section>
		{/if}

		<a
			href={`/dia/${diaId}/agregar?fecha=${fechaSesion}`}
			class="mt-4 block rounded-2xl border border-dashed border-white/20 p-4 text-center text-sm font-medium"
			style="color: var(--accent-text)">+ Agregar ejercicio</a
		>

		{#if editando}
			<button
				onclick={eliminar}
				class="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 p-3 text-sm"
				style="color: #ff6b6b"><Icono nombre="borrar" tamano={16} /> Borrar día</button
			>
		{/if}
	{/if}
</main>

{#if premioDia}
	<!-- Celebratorio pero no carcelero: un toque en cualquier lado lo cierra. El fondo es
	     un botón propio y no el contenedor entero: así el resumen puede llevar adentro su
	     botón de salida, que es la única forma de cerrar un día completo. -->
	<div
		role="dialog"
		aria-label="Resumen del día"
		class="fixed inset-0 z-[60] grid w-full place-items-center px-8"
		style={premioCalidad === 'completa'
			? 'background: radial-gradient(72% 50% at 50% 42%, rgb(var(--exito) / .22), transparent 72%), rgb(var(--scrim) / .84); backdrop-filter: blur(8px)'
			: 'background: rgb(var(--scrim) / .9); backdrop-filter: blur(8px)'}
	>
		<button
			onclick={cerrarPremio}
			disabled={!premioTocable}
			aria-label="Cerrar resumen del día"
			class="absolute inset-0 cursor-default"
		></button>
		<div
			transition:fly={{ y: 18, duration: dur(260) }}
			class="pointer-events-none relative text-center"
			aria-live="polite"
		>
			<div class="relative mx-auto grid size-24 place-items-center">
				<!-- Las partículas y el halo son del día completo. Un día parcial recibe el
				     acuse corto: celebrar los dos igual es lo que hacía que "día terminado"
				     no significara nada. -->
				{#if premioCalidad === 'completa'}
					<CelebracionParticulas color="var(--exito)" cantidad={16} />
				{/if}
				<div
					class="relative grid size-24 place-items-center rounded-full border border-white/15 text-5xl font-extrabold"
					style="background: rgb(var(--exito) / {premioCalidad === 'completa'
						? '.18'
						: '.1'}); color: rgb(var(--exito)); box-shadow: {premioCalidad === 'completa'
						? '0 0 55px rgb(var(--exito) / .24)'
						: 'none'}"
				>
					<Icono nombre={premioCalidad === 'completa' ? 'terminar' : 'hecha'} tamano={42} />
				</div>
			</div>
			{#if premioCalidad === 'completa'}
				<p class="mt-5 text-2xl font-extrabold">Día terminado</p>
				<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
					{ejerciciosCompletos} completos · {ejerciciosParciales} parciales · {ejerciciosSaltados}
					saltados
				</p>
			{:else if resumenDia.setsHechos > 0}
				<p class="mt-5 text-xl font-bold">Día cerrado</p>
				<p class="mt-1 text-sm font-medium" style="color: var(--muted)">
					{seriesPlanDia
						? `${seriesHechasDia} de ${seriesPlanDia} series`
						: `${seriesHechasDia} ${seriesHechasDia === 1 ? 'serie' : 'series'}`} · queda como día parcial
				</p>
			{:else}
				<p class="mt-5 text-xl font-bold">
					Día cerrado · {ejerciciosSaltados} saltado{ejerciciosSaltados === 1 ? '' : 's'}
				</p>
				<p class="mt-1 text-sm font-medium" style="color: var(--muted)">Sin series registradas</p>
			{/if}
			{#if resumenDia.setsHechos > 0}<div class="mt-4 grid grid-cols-2 gap-2 text-left">
					<div class="rounded-xl border border-white/10 bg-white/[0.04] p-3">
						<p class="text-lg font-extrabold tabular-nums">
							{formatoVolumen(resumenDia.volumen)}
							<span class="text-sm" style="color: var(--muted)">{ajustes.unidad}</span>
						</p>
						<p class="text-[11px] font-semibold" style="color: var(--muted)">
							volumen (peso × reps ✓)
						</p>
					</div>
					<div class="rounded-xl border border-white/10 bg-white/[0.04] p-3">
						<p class="text-lg font-extrabold tabular-nums">{resumenDia.prs.length}</p>
						<p class="text-[11px] font-semibold" style="color: var(--muted)">PRs del día</p>
					</div>
				</div>{/if}
			{#if resumenDia.prs.length > 0}
				<div class="mt-3 space-y-1.5 text-left">
					{#each resumenDia.prs.slice(0, 3) as pr (pr.exerciseId)}
						<p
							class="truncate rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold"
							style="color: rgb(var(--max))"
						>
							<span class="inline-flex items-center gap-1.5">
								<Icono nombre="record" tamano={14} />
								{pr.nombre}
							</span>
						</p>
					{/each}
					{#if resumenDia.prs.length > 3}
						<p class="text-center text-xs font-semibold" style="color: var(--muted)">
							+{resumenDia.prs.length - 3} PR{resumenDia.prs.length - 3 === 1 ? '' : 's'} más
						</p>
					{/if}
				</div>
			{/if}
			{#if rachaSemanal >= 2}
				<p
					class="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold"
					style="color: rgb(var(--exito))"
				>
					🔥 {rachaSemanal} semanas seguidas
				</p>
			{/if}
			{#if placasHoy.length > 0}
				<!-- La placa entra en el cierre, que ya es el momento de mayor recompensa: no
				     abre un aviso propio ni suena aparte. -->
				<div class="mt-4 space-y-2 text-left" role="list" aria-label="Placas ganadas hoy">
					<p
						class="px-1 text-[11px] font-bold tracking-wider uppercase"
						style="color: rgb(var(--exito))"
					>
						{placasHoy.length === 1 ? 'Placa ganada' : 'Placas ganadas'}
					</p>
					{#each placasHoy as placa (placa.id)}
						<PlacaFila {placa} />
					{/each}
				</div>
			{/if}
			<button
				onclick={cerrarPremio}
				disabled={!premioTocable}
				class="gb-relieve pointer-events-auto mt-5 inline-flex min-h-14 items-center justify-center rounded-2xl border border-white/10 px-8 text-sm font-bold"
				>Volver al día</button
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
		offsetNav
	/>
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
