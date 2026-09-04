import { liveQuery } from 'dexie';
import {
	compararSesiones,
	conIndice,
	db,
	guardarSesion,
	type Ajustes,
	type Dia,
	type EjercicioSesion,
	type MetricaPr,
	type PlanSesion,
	type PrCelebrado,
	type Sesion,
	type SetSesion
} from './db';
import {
	METRICAS_EFECTIVAS,
	mejorSet,
	mejorSetDeSeries,
	metricaDeSnapshot,
	modoDeMetrica,
	estadoEjercicioSesion,
	limpiarReapertura,
	metricaConfigurada,
	mismoPlan,
	modoEjercicio,
	planDeDia,
	prVisible,
	reabrirSesion,
	resolverMetricaPr,
	repeticionesValidas,
	serieCompleta,
	sesionRecienteAOfrecer,
	snapPr,
	valorSet,
	type MejorSet,
	type MetricaEfectiva,
	type ModoPr,
	type PrGanado,
	type RecordEjercicio,
	type SesionReciente
} from './sesion-reglas';
import { ejercicioPorId } from './catalog';
import {
	conPesoCanonico,
	conPesoVisible,
	gramosAPeso,
	pesoAGramos,
	type UnidadPeso
} from './unidades';
import { capturarRevisionDatos, exigirRevisionDatos } from './revision-datos';
import { fechaMasDias } from './fechas';
import { rirValido } from './esfuerzo';

export {
	DESCRIPCION_METRICA,
	estadoSesion,
	mejorSet,
	modoEjercicio,
	pesoEfectivo,
	serieCompleta,
	valorMetrica,
	valorSet
} from './sesion-reglas';
export type {
	CalidadSesion,
	EstadoSesion,
	MejorSet,
	MetricaEfectiva,
	ModoPr,
	PrGanado,
	RecordEjercicio,
	SesionReciente
} from './sesion-reglas';

/** Fecha local en formato YYYY-MM-DD. */
export function hoyStr(): string {
	return new Date().toLocaleDateString('sv'); // 'sv' → YYYY-MM-DD
}

export function sesionId(diaId: string, fecha = hoyStr()): string {
	return `${fecha}__${diaId}`;
}

/** Observable (Svelte store) de la sesión para un día (hoy por defecto). */
export function sesionHoyObs(diaId: string, fecha = hoyStr()) {
	return liveQuery(() => db.sesiones.get(sesionId(diaId, fecha)));
}

export interface EstadoEjercicioSesion {
	sets: SetSesion[];
	prCelebrado: PrCelebrado | null;
}

/** Estado mínimo que necesita la pantalla de entrenamiento, sin exponer Dexie a la UI. */
export function ejercicioSesionObs(
	diaId: string,
	exerciseId: string,
	fecha = hoyStr(),
	unidad: UnidadPeso = 'kg'
) {
	return liveQuery(async (): Promise<EstadoEjercicioSesion> => {
		const sesion = await db.sesiones.get(sesionId(diaId, fecha));
		const ejercicio = sesion?.ejercicios.find((item) => item.exerciseId === exerciseId);
		return {
			sets: (ejercicio?.sets ?? []).map((set) => conPesoVisible(set, unidad)),
			prCelebrado: ejercicio?.prCelebrado ? prVisible(ejercicio.prCelebrado, unidad) : null
		};
	});
}

/**
 * Trabajo de ESTA rutina que se estaba escribiendo recién, en otra fecha.
 *
 * Es la explicación que faltaba del otro lado de la deriva de fecha: la pantalla nueva
 * está vacía porque es otro día, no porque se haya borrado nada, y hasta acá no había
 * ninguna forma de enterarse desde la pantalla vacía.
 *
 * Sólo mira las 48 h anteriores por el índice `fecha`. La ventana real la pone
 * `sesionRecienteAOfrecer` (8 h sobre `tocadaAt`); acortar el rango de la consulta evita
 * deserializar años de historial en una lectura que se invalida con cada toque de peso.
 */
export async function sesionRecienteDe(
	diaId: string,
	exerciseId: string | null,
	hoy: string
): Promise<SesionReciente | null> {
	const desde = fechaMasDias(hoy, -2);
	const candidatas = await db.sesiones
		.where('fecha')
		.between(desde, hoy, true, false)
		.filter((sesion) => sesion.diaId === diaId)
		.toArray();
	return sesionRecienteAOfrecer(candidatas, exerciseId, hoy, Date.now());
}

export function sesionRecienteObs(diaId: string, exerciseId: string | null, hoy: string) {
	return liveQuery(() => sesionRecienteDe(diaId, exerciseId, hoy));
}

/** Lee los sets persistidos al recuperar la UI tras un fallo de escritura optimista. */
export async function setsEjercicioSesion(
	diaId: string,
	exerciseId: string,
	fecha = hoyStr(),
	unidad: UnidadPeso = 'kg'
): Promise<SetSesion[]> {
	const sesion = await db.sesiones.get(sesionId(diaId, fecha));
	return (sesion?.ejercicios.find((item) => item.exerciseId === exerciseId)?.sets ?? []).map(
		(set) => conPesoVisible(set, unidad)
	);
}

/**
 * Una sesión en el futuro no existe: nadie entrenó todavía mañana.
 *
 * La pantalla ya no deja llegar hasta acá con una fecha así, pero el dominio también lo
 * protege — igual que con las reps o los pesos inválidos —, porque una URL vieja, una
 * automatización o un reloj corrido no pueden crear trabajo en un día que no pasó.
 */
export function fechaSesionEnFuturo(fecha: string): boolean {
	return fecha > hoyStr();
}

async function ensureSesion(
	diaId: string,
	fecha = hoyStr(),
	diaNombre?: string,
	plan?: PlanSesion
): Promise<Sesion> {
	const id = sesionId(diaId, fecha);
	let s = await db.sesiones.get(id);
	if (!s) {
		if (fechaSesionEnFuturo(fecha)) {
			throw new RangeError('No se puede empezar un entrenamiento en una fecha futura.');
		}
		const mismoDia = await db.sesiones.where('fecha').equals(fecha).toArray();
		const ordenEnDia =
			mismoDia.reduce((maximo, sesion) => Math.max(maximo, sesion.ordenEnDia ?? -1), -1) + 1;
		s = { id, fecha, diaId, diaNombre, ordenEnDia, plan, ejercicios: [] };
		await db.sesiones.add(conIndice(s));
	}
	return s;
}

/**
 * Congela (o actualiza) el plan del día en la sesión. Devuelve si hubo cambio.
 *
 * Sólo toca la sesión de HOY. El plan de una fecha pasada es historia: reescribirlo con
 * la rutina actual es exactamente el error que `Sesion.plan` existe para evitar, y por
 * eso una sesión anterior a este campo se queda sin denominador en vez de recibir uno
 * inventado.
 */
function sincronizarPlan(sesion: Sesion, dia: Dia, fecha: string): boolean {
	if (fecha !== hoyStr()) return false;
	const plan = planDeDia(dia.ejercicios);
	if (mismoPlan(sesion.plan, plan)) return false;
	sesion.plan = plan;
	return true;
}

/**
 * Sesiones que registraron este ejercicio, por fecha y orden real dentro del día.
 *
 * Va por el índice multiEntry `exerciseIds` en vez de deserializar toda la tabla: como
 * cualquier escritura invalida los liveQuery, ese escaneo se pagaba en CADA toque de peso
 * y crecía sin techo con los años de historial.
 */
export async function sesionesDe(exerciseId: string): Promise<Sesion[]> {
	const sesiones = await db.sesiones.where('exerciseIds').equals(exerciseId).toArray();
	return sesiones.sort(compararSesiones);
}

/** Derivación pura para reutilizar una misma lectura de IndexedDB en varias vistas. */
export function historialPorModo(
	sesiones: Sesion[],
	exerciseId: string,
	metrica: MetricaPr,
	modo: ModoPr,
	unidad: UnidadPeso = 'kg'
): MejorSet[] {
	// `hoyStr` construye un formateador Intl por llamada. Dentro del recorrido se pagaba
	// una vez por sesión, en una derivación que un liveQuery recalcula en cada toque.
	const hoy = hoyStr();
	const puntos: MejorSet[] = [];
	for (const s of sesiones) {
		if (s.fecha > hoy) continue;
		const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
		if (!e) continue;
		const mejor = mejorSetDeSeries(e.sets, s.fecha, metrica, s.id, modo, unidad);
		if (mejor) puntos.push(mejor);
	}
	return puntos;
}

/** Serie principal: carga si ya existe una serie hecha con carga; si no, reps. */
export function historialObs(
	exerciseId: string,
	metrica: MetricaPr = 'peso',
	unidad: UnidadPeso = 'kg'
) {
	return liveQuery(async () => {
		const hoy = hoyStr();
		const todas = (await sesionesDe(exerciseId)).filter((sesion) => sesion.fecha <= hoy);
		const modo = modoEjercicio(todas, exerciseId);
		const puntos: MejorSet[] = [];
		for (const s of todas) {
			const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
			if (!e) continue;
			const mejor = mejorSetDeSeries(e.sets, s.fecha, metrica, s.id, modo, unidad);
			if (mejor) puntos.push(mejor);
		}
		return puntos;
	});
}

/**
 * Récord vigente de cada ejercicio, a partir de sesiones YA leídas.
 *
 * Es puro a propósito: la pantalla de Historial necesita esto y el resumen del
 * historial sobre exactamente la misma tabla, y antes cada uno abría su propio
 * liveQuery y deserializaba `sesiones` entera por su cuenta. Con la parte pura
 * separada, esa lectura se hace una sola vez (ver `historialPantallaObs`).
 */
export function recordsGlobales(
	sesiones: Sesion[],
	configuracion: MetricaPr | Pick<Ajustes, 'metricaPr' | 'metricasPrEjercicio'> = 'peso',
	unidad: UnidadPeso = 'kg'
): RecordEjercicio[] {
	const ajustes =
		typeof configuracion === 'string'
			? { metricaPr: configuracion, metricasPrEjercicio: {} }
			: configuracion;
	const hoy = hoyStr();
	// `filter` ya devuelve un array nuevo: ordenar acá no toca el que recibimos, que
	// puede estar compartido con el resumen del historial.
	const todas = sesiones.filter((sesion) => sesion.fecha <= hoy).sort(compararSesiones);
	// Modo por ejercicio en una pasada: con algún set ✓ con peso puntúa por peso.
	const conPeso = new Set<string>();
	for (const s of todas)
		for (const e of s.ejercicios)
			for (const set of e.sets)
				if (serieCompleta(set) && (set.peso != null || set.pesoGramos != null))
					conPeso.add(e.exerciseId);
	// `todas` viene en orden ascendente: el último snapshot que se ve es el más
	// reciente, que es el nombre con el que la persona conoce hoy ese ejercicio.
	const nombres = new Map<string, string>();
	for (const s of todas)
		for (const e of s.ejercicios) if (e.nombreSnapshot) nombres.set(e.exerciseId, e.nombreSnapshot);
	const mejores = new Map<string, RecordEjercicio>();
	for (const s of todas) {
		for (const ejercicio of s.ejercicios) {
			const modo: ModoPr = conPeso.has(ejercicio.exerciseId) ? 'peso' : 'reps';
			const metricaEfectiva = resolverMetricaPr(ajustes, ejercicio.exerciseId, modo);
			// En modo reps `valorSet` ignora la métrica; se pasa la configurada igual para
			// no tener dos maneras de leer el override.
			const metrica = metricaConfigurada(ajustes, ejercicio.exerciseId);
			const candidato = mejorSetDeSeries(ejercicio.sets, s.fecha, metrica, s.id, modo, unidad);
			if (!candidato) continue;
			const mejor = mejorSet(mejores.get(ejercicio.exerciseId) ?? null, candidato);
			mejores.set(ejercicio.exerciseId, {
				...mejor,
				exerciseId: ejercicio.exerciseId,
				modo,
				metrica: metricaEfectiva,
				nombre: nombres.get(ejercicio.exerciseId)
			});
		}
	}
	// Récord más reciente primero: así los récords chicos también aparecen
	// (ordenar por valor dejaba siempre arriba a la prensa y afuera a las elevaciones).
	return [...mejores.values()].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.valor - a.valor);
}

export function recordsGlobalesObs(
	configuracion: MetricaPr | Pick<Ajustes, 'metricaPr' | 'metricasPrEjercicio'> = 'peso',
	unidad: UnidadPeso = 'kg'
) {
	return liveQuery(async () =>
		recordsGlobales(await db.sesiones.orderBy('fecha').toArray(), configuracion, unidad)
	);
}

/**
 * Última sesión (distinta de la actual) en que se hizo este ejercicio.
 * Recorre el índice `fecha` hacia atrás y corta en la primera coincidencia: se entra
 * a esta función al abrir cada ejercicio, y deserializar todo el historial para
 * quedarse con una fila se paga en cada entrada.
 */
export async function ultimaSesion(
	diaId: string,
	exerciseId: string,
	fecha = hoyStr(),
	unidad: UnidadPeso = 'kg'
): Promise<{ sets: SetSesion[]; fecha: string } | undefined> {
	const exceptoId = sesionId(diaId, fecha);
	let encontrada: { sets: SetSesion[]; fecha: string } | undefined;
	await db.sesiones
		.orderBy('fecha')
		.reverse()
		.until(() => encontrada != null, true)
		.each((s) => {
			// No hay hora de inicio: otra rutina del mismo día no es un “anterior” confiable.
			if (s.id === exceptoId || s.fecha >= fecha || encontrada) return;
			const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
			if (e?.sets.some(serieCompleta)) {
				encontrada = {
					// Conserva índices, pero no prellena datos de sets abandonados o borrados.
					sets: e.sets.map((set) =>
						serieCompleta(set) ? conPesoVisible(set, unidad) : { hecha: false }
					),
					fecha: s.fecha
				};
			}
		});
	return encontrada;
}

/** Sets de la última vez que se hizo este ejercicio (para pre-llenar pesos). */
async function ultimaDe(
	diaId: string,
	exerciseId: string,
	fecha = hoyStr(),
	unidad: UnidadPeso = 'kg'
): Promise<SetSesion[] | undefined> {
	return (await ultimaSesion(diaId, exerciseId, fecha, unidad))?.sets;
}

/**
 * Serie nueva sin marcar, prellenada con la carga de la serie de referencia.
 *
 * MAX y su extra son parte de la carga, no un adorno: copiar sólo el peso base
 * devolvía una serie más liviana que la que se está repitiendo y, si se marcaba tal
 * como venía, el historial registraba menos de lo que se levantó.
 *
 * `anterior` llega en valores visibles (`ultimaDe` los normaliza a la unidad activa y
 * `conPesoVisible` borra los gramos a propósito), así que se recanoniza acá: una serie
 * nueva nunca puede nacer sin `pesoGramos`, o deja de ser independiente de la unidad.
 */
function serieDesdeAnterior(anterior: SetSesion | undefined, unidad: UnidadPeso): SetSesion {
	return {
		...conPesoCanonico(
			{ peso: anterior?.peso, esMax: anterior?.esMax, extraKg: anterior?.extraKg },
			unidad
		),
		reps: anterior?.reps,
		hecha: false
	};
}

/** Inicializa los sets de un ejercicio en la sesión de hoy (atómico). */
export async function ensureEjercicio(
	diaId: string,
	exerciseId: string,
	nSets: number,
	fecha = hoyStr(),
	unidad: UnidadPeso = 'kg'
): Promise<void> {
	await db.transaction('rw', db.sesiones, async () => {
		const s = await ensureSesion(diaId, fecha);
		if (s.ejercicios.some((e) => e.exerciseId === exerciseId)) return;
		const prev = await ultimaDe(diaId, exerciseId, fecha, unidad);
		const sets: SetSesion[] = Array.from({ length: Math.max(1, nSets) }, (_, i) =>
			serieDesdeAnterior(prev?.[i], unidad)
		);
		s.ejercicios.push({ exerciseId, nombreSnapshot: ejercicioPorId(exerciseId)?.nombre, sets });
		await guardarSesion(s);
	});
}

export interface PreparacionEjercicioSesion {
	disponible: true;
	anteriores: SetSesion[];
	anterioresFecha: string | null;
}

export interface EjercicioSesionNoDisponible {
	disponible: false;
	/** Por qué esta URL no puede entrenar, para que la pantalla no invente el motivo. */
	motivo: 'rutina-no-disponible' | 'fecha-futura';
}

/**
 * Prepara el ejercicio activo dentro del límite de persistencia: crea sus sets si
 * faltan y devuelve la referencia de la última sesión para el prellenado visual.
 */
export async function prepararEjercicioSesion(
	diaId: string,
	exerciseId: string,
	fecha = hoyStr(),
	unidad: UnidadPeso = 'kg'
): Promise<PreparacionEjercicioSesion | EjercicioSesionNoDisponible> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.dias, db.sesiones, async () => {
		exigirRevisionDatos(revision);
		// La URL puede quedar abierta mientras se edita o se restaura un backup. Nunca
		// dejamos que una ruta vieja cree trabajo para una rutina o ejercicio inexistente.
		const dia = await db.dias.get(diaId);
		const configuracion = dia?.ejercicios.find((item) => item.exerciseId === exerciseId);
		if (!dia || !configuracion) return { disponible: false, motivo: 'rutina-no-disponible' };
		// Antes de tocar nada: una fecha futura no puede crear una sesión (ver `ensureSesion`).
		// Se corta acá y no en el `ensure` para poder explicarlo en vez de tirar un error.
		if (fechaSesionEnFuturo(fecha) && !(await db.sesiones.get(sesionId(diaId, fecha)))) {
			return { disponible: false, motivo: 'fecha-futura' };
		}

		const id = sesionId(diaId, fecha);
		let sesion = await db.sesiones.get(id);
		if (!sesion) {
			sesion = await ensureSesion(diaId, fecha, dia.nombre, planDeDia(dia.ejercicios));
		}
		let snapshotsActualizados = false;
		if (!sesion.diaNombre) {
			sesion.diaNombre = dia.nombre;
			snapshotsActualizados = true;
		}
		// La rutina puede haber cambiado desde que se creó la sesión de hoy: el denominador
		// tiene que seguir al plan vigente mientras el día siga siendo hoy.
		if (sincronizarPlan(sesion, dia, fecha)) snapshotsActualizados = true;
		const ejercicioExistente = sesion.ejercicios.find((item) => item.exerciseId === exerciseId);
		if (ejercicioExistente && !ejercicioExistente.nombreSnapshot) {
			ejercicioExistente.nombreSnapshot = ejercicioPorId(exerciseId)?.nombre;
			snapshotsActualizados = true;
		}
		if (!sesion.ejercicios.some((item) => item.exerciseId === exerciseId)) {
			const anterior = await ultimaDe(diaId, exerciseId, fecha, unidad);
			sesion.ejercicios.push({
				exerciseId,
				nombreSnapshot: ejercicioPorId(exerciseId)?.nombre,
				sets: Array.from({ length: Math.max(1, configuracion.seriesObjetivo) }, (_, indice) =>
					serieDesdeAnterior(anterior?.[indice], unidad)
				)
			});
			await guardarSesion(sesion);
		} else if (snapshotsActualizados) await guardarSesion(sesion);

		const anterior = await ultimaSesion(diaId, exerciseId, fecha, unidad);
		return {
			disponible: true,
			anteriores: anterior?.sets ?? [],
			anterioresFecha: anterior?.fecha ?? null
		};
	});
}

/**
 * Resultado de una mutación de serie.
 *
 * `encontrada: false` significa que el cambio NO se aplicó porque su destino no existe:
 * la sesión, el ejercicio o la serie desaparecieron. Antes esto era un `return` mudo y
 * una promesa que resolvía bien, así que la pantalla se quedaba mostrando un peso que
 * no estaba en ningún lado y sólo se enteraba al volver a entrar. Es el mismo contrato
 * que ya tenía `setSerieHecha`.
 */
export interface ResultadoMutacion {
	encontrada: boolean;
}

/**
 * Mutación atómica de los sets de un ejercicio (serializada por Dexie → sin race).
 * `fecha` fija la sesión destino al entrar al ejercicio, para no perder toques si
 * cruzás la medianoche entrenando (si no, apuntaría a una sesión de otro día inexistente).
 *
 * `fn` devuelve `false` cuando no encontró la serie que iba a tocar; devolver nada
 * significa que se aplicó.
 */
async function mutar(
	diaId: string,
	exerciseId: string,
	fn: (sets: SetSesion[], sesion: Sesion, ejercicio: EjercicioSesion) => boolean | void,
	fecha = hoyStr(),
	recalcularPr = false
): Promise<ResultadoMutacion> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.sesiones, async (): Promise<ResultadoMutacion> => {
		exigirRevisionDatos(revision);
		const s = await db.sesiones.get(sesionId(diaId, fecha));
		const e = s?.ejercicios.find((x) => x.exerciseId === exerciseId);
		if (!s || !e) return { encontrada: false };
		if (fn(e.sets, s, e) === false) return { encontrada: false };
		if (recalcularPr) await recalcularPrCelebrado(s, exerciseId);
		await guardarSesion(s);
		return { encontrada: true };
	});
}

/**
 * Revalida el PR celebrado de `sesion` después de editarla.
 *
 * No recibe métrica a propósito, y por eso tampoco la reciben las mutaciones que llaman
 * acá: cada celebración se vuelve a juzgar con la métrica que quedó guardada en SU
 * snapshot. Pasarle la métrica vigente de Ajustes reescribiría el pasado —un PR de peso
 * celebrado hace un año dejaría de serlo por cambiar hoy una preferencia.
 *
 * Con `revalidarPosteriores` además DEGRADA el PR de las sesiones siguientes que hayan
 * dejado de serlo: subir una serie vieja puede tapar un récord que se celebró después, y
 * sin este barrido "PRs del día" seguía mostrando un 🏆 que el historial ya no sostiene.
 *
 * Solo degrada, nunca promueve. Un día que retroactivamente pasa a ser récord no gana una
 * celebración que el usuario nunca vio: la UI puede callar, no puede mentir. El récord
 * vigente se deriva siempre de los sets crudos (`recordsGlobalesObs`), así que la pantalla
 * de récords no depende de este campo.
 *
 * Queda apagado en el camino de entrenamiento: ahí se edita la sesión de hoy, que es la
 * última, no hay posteriores que revalidar, y el barrido costaría un escaneo completo de
 * la tabla en cada toque de peso.
 */
async function recalcularPrCelebrado(
	sesion: Sesion,
	exerciseId: string,
	revalidarPosteriores = false
) {
	const ejercicio = sesion.ejercicios.find((x) => x.exerciseId === exerciseId);
	if (!ejercicio?.prCelebrado && !revalidarPosteriores) return;

	const todas = await sesionesDe(exerciseId);
	// `todas` trae la versión ya persistida de esta sesión: manda la copia editada.
	// El orden es el mismo con el que se decide un récord al celebrarlo.
	const orden = [...todas.filter((s) => s.id !== sesion.id), sesion].sort(compararSesiones);
	// El mejor set anterior por métrica, no su valor: al re-sellar un PR hay que volver a
	// escribirle el récord que rompió, y ese récord tiene que salir del historial de ahora
	// —no del que había cuando se celebró— o editar el pasado dejaría un “venías de” falso.
	const previos = new Map<MetricaEfectiva, MejorSet | null>(
		METRICAS_EFECTIVAS.map((metrica) => [metrica, null])
	);
	for (const s of orden) {
		const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
		const mejores = new Map<MetricaEfectiva, MejorSet | null>();
		for (const metrica of METRICAS_EFECTIVAS) {
			mejores.set(
				metrica,
				e
					? mejorSetDeSeries(
							e.sets,
							s.fecha,
							metrica === 'reps' ? 'peso' : metrica,
							s.id,
							modoDeMetrica(metrica)
						)
					: null
			);
		}

		if (e?.prCelebrado) {
			const metricaPr = metricaDeSnapshot(e.prCelebrado);
			const mejor = mejores.get(metricaPr) ?? null;
			const previo = previos.get(metricaPr) ?? null;
			// Cada celebración se juzga contra el pasado con SU métrica, no con Ajustes actuales.
			if (!mejor || (previo != null && mejor.valor <= previo.valor)) {
				e.prCelebrado = undefined;
				if (s.id !== sesion.id && revalidarPosteriores) await guardarSesion(s, { sellar: false });
			} else {
				// No inventamos una etiqueta de métrica en PRs heredados: sólo se usa internamente
				// para comprobarlos. La interfaz los presenta como “PR registrado”.
				e.prCelebrado = e.prCelebrado.metrica
					? snapPr(mejor, metricaPr, 'kg', previo)
					: { ...snapPr(mejor, metricaPr, 'kg', previo), metrica: undefined };
				if (s.id !== sesion.id && revalidarPosteriores) await guardarSesion(s, { sellar: false });
			}
		}

		for (const metrica of METRICAS_EFECTIVAS) {
			const mejor = mejores.get(metrica);
			const previo = previos.get(metrica) ?? null;
			if (mejor && (previo == null || mejor.valor > previo.valor)) previos.set(metrica, mejor);
		}
	}
}

export interface CambiosSetHistorial {
	peso?: number;
	reps?: number;
	esMax?: boolean;
	extraKg?: number;
	rir?: number;
}

/**
 * Las ediciones del historial devuelven si encontraron la serie: la pantalla no puede
 * cerrar el sheet como si hubiera guardado cuando la serie ya no existe (editada en
 * otra pestaña, backup restaurado en el medio).
 */
export function actualizarSetHistorial(
	idSesion: string,
	exerciseId: string,
	setIndex: number,
	cambios: CambiosSetHistorial,
	unidad: UnidadPeso = 'kg'
): Promise<boolean> {
	if (
		(cambios.peso != null && (!Number.isFinite(cambios.peso) || cambios.peso < 0)) ||
		(cambios.extraKg != null && (!Number.isFinite(cambios.extraKg) || cambios.extraKg < 0)) ||
		(cambios.reps != null && !repeticionesValidas(cambios.reps)) ||
		(cambios.rir != null && !rirValido(cambios.rir))
	)
		return Promise.reject(new RangeError('La serie contiene un peso o repeticiones inválidos.'));
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.sesiones, async () => {
		exigirRevisionDatos(revision);
		const s = await db.sesiones.get(idSesion);
		const e = s?.ejercicios.find((x) => x.exerciseId === exerciseId);
		const set = e?.sets[setIndex];
		if (!s || !set?.hecha) return false;
		set.peso = cambios.peso;
		const pesoCanonico = pesoAGramos(cambios.peso, unidad);
		if (pesoCanonico == null) delete set.pesoGramos;
		else set.pesoGramos = pesoCanonico;
		set.reps = cambios.reps;
		set.esMax = cambios.esMax;
		set.extraKg = cambios.extraKg;
		set.rir = cambios.rir;
		const extraCanonico = pesoAGramos(cambios.extraKg, unidad);
		if (extraCanonico == null) delete set.extraGramos;
		else set.extraGramos = extraCanonico;
		// Una edición puede vaciar las reps de una serie histórica. En ese caso no
		// conserva un ✓ inválido que seguiría contando para volumen, PR e historial.
		if (!repeticionesValidas(set.reps)) {
			set.hecha = false;
			reabrirSesion(s, `Editaste una serie de ${nombreDe(e!)} y quedó sin repeticiones`);
		}
		// Editar el historial puede invalidar el PR de sesiones POSTERIORES a esta.
		await recalcularPrCelebrado(s, exerciseId, true);
		// Sin sellar: corregir una serie pasada no es entrenar (ver `guardarSesion`).
		await guardarSesion(s, { sellar: false });
		return true;
	});
}

export function borrarSetHistorial(
	idSesion: string,
	exerciseId: string,
	setIndex: number
): Promise<boolean> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.sesiones, async () => {
		exigirRevisionDatos(revision);
		const s = await db.sesiones.get(idSesion);
		const e = s?.ejercicios.find((x) => x.exerciseId === exerciseId);
		const set = e?.sets[setIndex];
		if (!s || !set?.hecha) return false;
		set.hecha = false;
		reabrirSesion(s, `Borraste una serie de ${nombreDe(e!)} desde el historial`);
		await recalcularPrCelebrado(s, exerciseId, true);
		// Sin sellar: borrar una serie pasada no es entrenar (ver `guardarSesion`).
		await guardarSesion(s, { sellar: false });
		return true;
	});
}

export interface ResultadoSet {
	encontrada: boolean;
	hecha?: boolean;
	cambio: boolean;
	ejercicioCompleto?: boolean;
}

/** Nombre con el que la persona conoce ese ejercicio, para poder explicar la reapertura. */
function nombreDe(ejercicio: Pick<EjercicioSesion, 'exerciseId' | 'nombreSnapshot'>): string {
	return ejercicio.nombreSnapshot ?? ejercicioPorId(ejercicio.exerciseId)?.nombre ?? 'un ejercicio';
}

/**
 * Fija el estado de una serie de manera idempotente. La UI usa esta operación en
 * lugar de alternar el valor que tenía renderizado: dos toques con la misma
 * intención ya no pueden terminar desmarcando una serie recién hecha.
 */
export function setSerieHecha(
	diaId: string,
	exerciseId: string,
	i: number,
	hecha: boolean,
	fecha = hoyStr(),
	metrica: MetricaPr = 'peso'
): Promise<ResultadoSet> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.sesiones, async (): Promise<ResultadoSet> => {
		exigirRevisionDatos(revision);
		const s = await db.sesiones.get(sesionId(diaId, fecha));
		const e = s?.ejercicios.find((x) => x.exerciseId === exerciseId);
		const set = e?.sets[i];
		if (!s || !e || !set) return { encontrada: false, cambio: false };
		// La pantalla no permite marcar sin reps, pero el dominio también protege
		// importaciones, automatizaciones o pestañas desactualizadas.
		if (hecha && !repeticionesValidas(set.reps)) {
			return { encontrada: true, hecha: set.hecha, cambio: false, ejercicioCompleto: false };
		}

		let cambio = set.hecha !== hecha;
		set.hecha = hecha;
		// Entrenar una serie reanuda implícitamente un ejercicio que se había saltado.
		if (hecha && e.saltado) {
			e.saltado = false;
			cambio = true;
			reabrirSesion(s, `Retomaste ${nombreDe(e)}`);
		}
		if (!hecha) {
			if (cambio) {
				reabrirSesion(s, `Desmarcaste la serie ${i + 1} de ${nombreDe(e)}`);
				await recalcularPrCelebrado(s, exerciseId);
			}
		}
		if (cambio) await guardarSesion(s);
		return {
			encontrada: true,
			hecha: set.hecha,
			cambio,
			ejercicioCompleto: e.sets.every(serieCompleta)
		};
	});
}

export function toggleMax(diaId: string, exerciseId: string, i: number, fecha = hoyStr()) {
	return mutar(
		diaId,
		exerciseId,
		(sets) => {
			const set = sets[i];
			if (!set) return false;
			set.esMax = !set.esMax;
		},
		fecha,
		true
	);
}
export function setPeso(
	diaId: string,
	exerciseId: string,
	i: number,
	peso?: number,
	fecha = hoyStr(),
	unidad: UnidadPeso = 'kg'
) {
	if (peso != null && (!Number.isFinite(peso) || peso < 0))
		return Promise.reject(new RangeError('El peso debe ser un número no negativo.'));
	return mutar(
		diaId,
		exerciseId,
		(sets) => {
			const set = sets[i];
			if (!set) return false;
			set.peso = peso;
			const canonico = pesoAGramos(peso, unidad);
			if (canonico == null) delete set.pesoGramos;
			else set.pesoGramos = canonico;
		},
		fecha,
		true
	);
}
export function setReps(
	diaId: string,
	exerciseId: string,
	i: number,
	reps?: number,
	fecha = hoyStr()
) {
	if (reps != null && !repeticionesValidas(reps))
		return Promise.reject(new RangeError('Las repeticiones deben ser un entero positivo.'));
	return mutar(
		diaId,
		exerciseId,
		(sets, sesion, ejercicio) => {
			const set = sets[i];
			if (!set) return false;
			set.reps = reps;
			if (set.hecha && !repeticionesValidas(reps)) {
				set.hecha = false;
				reabrirSesion(sesion, `La serie ${i + 1} de ${nombreDe(ejercicio)} quedó sin repeticiones`);
			}
		},
		fecha,
		true
	);
}

export function setRir(
	diaId: string,
	exerciseId: string,
	i: number,
	rir?: number,
	fecha = hoyStr()
) {
	if (rir != null && !rirValido(rir))
		return Promise.reject(new RangeError('RIR debe estar entre 0 y 5 en pasos de 0,5.'));
	return mutar(
		diaId,
		exerciseId,
		(sets) => {
			const set = sets[i];
			if (!set) return false;
			set.rir = rir;
		},
		fecha
	);
}
/** Kg encima de la placa full (solo aplica al PR cuando el set es MAX). */
export function setExtra(
	diaId: string,
	exerciseId: string,
	i: number,
	extraKg?: number,
	fecha = hoyStr(),
	unidad: UnidadPeso = 'kg'
) {
	if (extraKg != null && (!Number.isFinite(extraKg) || extraKg < 0))
		return Promise.reject(new RangeError('El peso extra debe ser un número no negativo.'));
	return mutar(
		diaId,
		exerciseId,
		(sets) => {
			const set = sets[i];
			if (!set) return false;
			set.extraKg = extraKg;
			const canonico = pesoAGramos(extraKg, unidad);
			if (canonico == null) delete set.extraGramos;
			else set.extraGramos = canonico;
		},
		fecha,
		true
	);
}
export function addSet(diaId: string, exerciseId: string, fecha = hoyStr()) {
	return mutar(
		diaId,
		exerciseId,
		(sets, sesion, ejercicio) => {
			const last = sets[sets.length - 1];
			// Copia la carga entera, gramos incluidos: el MAX y su extra pesan, y una serie
			// agregada que los pierde registra menos de lo que se está por levantar.
			sets.push({
				peso: last?.peso,
				pesoGramos: last?.pesoGramos,
				reps: last?.reps,
				hecha: false,
				esMax: last?.esMax,
				extraKg: last?.extraKg,
				extraGramos: last?.extraGramos
			});
			reabrirSesion(sesion, `Agregaste la serie ${sets.length} a ${nombreDe(ejercicio)}`);
		},
		fecha
	);
}

/** Quita una serie y devuelve la foto previa, o null si no había nada que quitar. */
export function removeSet(
	diaId: string,
	exerciseId: string,
	i: number,
	fecha = hoyStr()
): Promise<InstantaneaSesion | null> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.sesiones, async (): Promise<InstantaneaSesion | null> => {
		exigirRevisionDatos(revision);
		const s = await db.sesiones.get(sesionId(diaId, fecha));
		const e = s?.ejercicios.find((x) => x.exerciseId === exerciseId);
		if (!s || !e || e.sets.length <= 1 || !e.sets[i]) return null;
		const instantanea = fotografiar(s, exerciseId);
		e.sets.splice(i, 1);
		reabrirSesion(s, `Quitaste la serie ${i + 1} de ${nombreDe(e)}`);
		await recalcularPrCelebrado(s, exerciseId);
		await guardarSesion(s);
		return instantanea;
	});
}

export interface ResultadoCierreParcial {
	cerrado: boolean;
	quitadas: number;
	/** Foto previa para deshacer; ausente cuando no se quitó nada. */
	instantanea?: InstantaneaSesion;
}

/**
 * "Terminé con menos series de las que planeaba": quita las que quedaron sin marcar y
 * deja el ejercicio completo con lo que de verdad se hizo.
 *
 * Existe porque destildar o abandonar una serie del medio dejaba el día imposible de
 * cerrar: `marcarDiaTerminado` exige que cada ejercicio esté hecho o saltado, y la única
 * salida era saltar el ejercicio entero (mintiendo sobre las series que sí se hicieron)
 * o borrar desde el final de a una. Nunca toca una serie marcada: el registro real es
 * intocable, lo que se descarta es el plan que no se cumplió.
 */
export function cerrarEjercicioConLoHecho(
	diaId: string,
	exerciseId: string,
	fecha = hoyStr()
): Promise<ResultadoCierreParcial> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.sesiones, async (): Promise<ResultadoCierreParcial> => {
		exigirRevisionDatos(revision);
		const s = await db.sesiones.get(sesionId(diaId, fecha));
		const e = s?.ejercicios.find((x) => x.exerciseId === exerciseId);
		if (!s || !e) return { cerrado: false, quitadas: 0 };
		const hechas = e.sets.filter(serieCompleta);
		// Sin una sola serie real no hay nada que cerrar: eso es saltar el ejercicio.
		if (hechas.length === 0) return { cerrado: false, quitadas: 0 };
		const quitadas = e.sets.length - hechas.length;
		if (quitadas === 0) return { cerrado: true, quitadas: 0 };
		const instantanea = fotografiar(s, exerciseId);
		e.sets = hechas;
		// Cerrar solo puede resolver trabajo pendiente, nunca crearlo: no reabre el día.
		await guardarSesion(s);
		return { cerrado: true, quitadas, instantanea };
	});
}

/** Marca/desmarca el ejercicio como saltado SOLO en la sesión (no toca la rutina). */
function setSaltado(diaId: string, exerciseId: string, saltado: boolean, fecha = hoyStr()) {
	return db.sesiones
		.where('id')
		.equals(sesionId(diaId, fecha))
		.modify((s) => {
			const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
			if (!e || e.saltado === saltado) return;
			e.saltado = saltado;
			reabrirSesion(s, saltado ? `Saltaste ${nombreDe(e)}` : `Retomaste ${nombreDe(e)}`);
		});
}

/**
 * Saltar el ejercicio hoy (p. ej. máquina ocupada). Valida la rutina dentro de la
 * misma transacción: una pantalla vieja no puede crear una sesión huérfana al tocar
 * "Saltar" mientras otra pestaña quitó el ejercicio.
 */
export type ResultadoSalto =
	| { saltado: true }
	| { saltado: false; razon: 'rutina-no-disponible' | 'ya-completado' | 'fecha-futura' };

export async function saltarEjercicio(
	diaId: string,
	exerciseId: string,
	fecha = hoyStr(),
	unidad: UnidadPeso = 'kg'
): Promise<ResultadoSalto> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.dias, db.sesiones, async (): Promise<ResultadoSalto> => {
		exigirRevisionDatos(revision);
		const dia = await db.dias.get(diaId);
		const configuracion = dia?.ejercicios.find((item) => item.exerciseId === exerciseId);
		if (!dia || !configuracion) return { saltado: false, razon: 'rutina-no-disponible' };
		if (fechaSesionEnFuturo(fecha) && !(await db.sesiones.get(sesionId(diaId, fecha)))) {
			return { saltado: false, razon: 'fecha-futura' };
		}
		const sesion = await ensureSesion(diaId, fecha, dia.nombre, planDeDia(dia.ejercicios));
		sincronizarPlan(sesion, dia, fecha);
		sesion.diaNombre ??= dia.nombre;
		let ejercicio = sesion.ejercicios.find((item) => item.exerciseId === exerciseId);
		// Saltar algo ya terminado lo rotulaba "Saltado" en gris y de paso reabría el día:
		// el resumen quedaba diciendo "3/3 ejercicios · 1 saltado" sobre el mismo ejercicio.
		if (ejercicio && estadoEjercicioSesion(ejercicio.sets) === 'completado')
			return { saltado: false, razon: 'ya-completado' };
		if (!ejercicio) {
			const anterior = await ultimaDe(diaId, exerciseId, fecha, unidad);
			ejercicio = {
				exerciseId,
				nombreSnapshot: ejercicioPorId(exerciseId)?.nombre,
				sets: Array.from({ length: Math.max(1, configuracion.seriesObjetivo) }, (_, indice) =>
					serieDesdeAnterior(anterior?.[indice], unidad)
				)
			};
			sesion.ejercicios.push(ejercicio);
		}
		ejercicio.nombreSnapshot ??= ejercicioPorId(exerciseId)?.nombre;
		ejercicio.saltado = true;
		reabrirSesion(sesion, `Saltaste ${nombreDe(ejercicio)}`);
		await guardarSesion(sesion);
		return { saltado: true };
	});
}

/** Reanudar un ejercicio saltado: vuelve a contar para terminar el día. */
export function reanudarEjercicio(diaId: string, exerciseId: string, fecha = hoyStr()) {
	return setSaltado(diaId, exerciseId, false, fecha);
}

/**
 * Registra el PR de una serie recién marcada, decidiendo DENTRO de la transacción.
 *
 * La pantalla no puede decidir esto sola: sus derivados vienen de un liveQuery
 * asíncrono que puede no haber emitido todavía, y con el dato viejo el mismo récord
 * se celebraba dos veces (destildar y volver a tildar) o se comparaba contra un
 * umbral que ya había cambiado. Acá se lee el estado persistido y se compara contra
 * el mejor de las otras sesiones y contra lo ya celebrado hoy.
 *
 * Devuelve el set ganador si hubo récord nuevo, o null. Quien llama celebra solo si
 * devolvió algo, así que la celebración y lo persistido nunca pueden discrepar.
 */
export function registrarPrSiSupera(
	diaId: string,
	exerciseId: string,
	setIndex: number,
	metrica: MetricaPr = 'peso',
	fecha = hoyStr(),
	unidad: UnidadPeso = 'kg'
): Promise<PrGanado | null> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.sesiones, async (): Promise<PrGanado | null> => {
		exigirRevisionDatos(revision);
		const s = await db.sesiones.get(sesionId(diaId, fecha));
		const e = s?.ejercicios.find((x) => x.exerciseId === exerciseId);
		const set = e?.sets[setIndex];
		if (!s || !e || !set || !serieCompleta(set)) return null;

		const todas = await sesionesDe(exerciseId);
		// El modo pertenece al ejercicio completo, no a la serie recién tocada. Si ya
		// existe historial con carga, una serie incompleta con solo reps no puede mutar
		// temporalmente a “reps” ni disparar un PR rotulado como kg en la interfaz.
		const modo = modoEjercicio(
			todas.filter((otra) => compararSesiones(otra, s) <= 0),
			exerciseId
		);
		const metricaEfectiva: MetricaEfectiva = modo === 'reps' ? 'reps' : metrica;
		const valor = valorSet(
			set,
			metricaEfectiva === 'reps' ? 'peso' : metricaEfectiva,
			modo,
			unidad
		);
		if (valor == null) return null;

		// “Previo” es sólo lo que existía cronológicamente antes de esta sesión. Mirar
		// sesiones futuras hacía negar récords históricos válidos al cargar/editar datos.
		//
		// Se guarda el set entero y no su valor porque además de decidir el récord hay
		// que poder mostrarlo: “130 kg — venías de 127,5” necesita el peso y las reps.
		const mejorPrevio = todas.reduce<MejorSet | null>((best, otra) => {
			if (otra.id === s.id || compararSesiones(otra, s) >= 0) {
				return best;
			}
			const eo = otra.ejercicios.find((x) => x.exerciseId === exerciseId);
			if (!eo) return best;
			const mejor = mejorSetDeSeries(
				eo.sets,
				otra.fecha,
				metricaEfectiva === 'reps' ? 'peso' : metricaEfectiva,
				otra.id,
				modo,
				unidad
			);
			if (!mejor) return best;
			return best == null || mejor.valor > best.valor ? mejor : best;
		}, null);
		const yaCelebrado =
			e.prCelebrado && metricaDeSnapshot(e.prCelebrado) === metricaEfectiva
				? valorSet(
						e.prCelebrado,
						metricaEfectiva === 'reps' ? 'peso' : metricaEfectiva,
						modo,
						unidad
					)
				: null;

		const supera =
			(mejorPrevio == null || valor > mejorPrevio.valor) &&
			(yaCelebrado == null || valor > yaCelebrado);
		if (!supera) return null;

		// El visible es para mostrar la celebración; los gramos son los de la serie, tal
		// cual: sellar el snapshot recanonizando el número redondeado lo dejaba sin
		// coincidir con su propio set en cuanto la unidad de lectura no era la de origen.
		const visible = conPesoVisible(set, unidad);
		const ganador: MejorSet = {
			peso: visible.peso,
			pesoGramos: set.pesoGramos,
			reps: set.reps,
			esMax: !!set.esMax,
			extraKg: visible.extraKg,
			extraGramos: set.extraGramos,
			fecha: s.fecha,
			valor,
			sesionId: s.id,
			setIndex
		};
		e.prCelebrado = snapPr(ganador, metricaEfectiva, unidad, mejorPrevio);
		await guardarSesion(s);
		return mejorPrevio ? { ...ganador, previo: mejorPrevio } : ganador;
	});
}

/**
 * Foto del estado que se pisa al reiniciar, para poder devolverlo tal cual.
 *
 * Reiniciar es la única acción de la app que borra trabajo de un toque, así que no
 * puede ser de ida: se guarda lo que había, y deshacer lo restaura completo —series,
 * PR celebrado, salto y estado del día incluidos—. Vive en memoria de la pantalla, no
 * en la base: es un arrepentimiento de segundos, no un historial de versiones.
 */
export interface InstantaneaSesion {
	ejercicios: EjercicioSesion[];
	diaTerminado?: boolean;
	diaTerminadoAt?: string;
	diaTerminadoConPendientes?: boolean;
	reaperturaMotivo?: string;
	reaperturaAt?: string;
}

function fotografiar(sesion: Sesion, exerciseId?: string): InstantaneaSesion {
	const ejercicios = exerciseId
		? sesion.ejercicios.filter((e) => e.exerciseId === exerciseId)
		: sesion.ejercicios;
	return {
		ejercicios: structuredClone(ejercicios),
		diaTerminado: sesion.diaTerminado,
		diaTerminadoAt: sesion.diaTerminadoAt,
		diaTerminadoConPendientes: sesion.diaTerminadoConPendientes,
		reaperturaMotivo: sesion.reaperturaMotivo,
		reaperturaAt: sesion.reaperturaAt
	};
}

/** Deja el ejercicio como al empezar: ninguna serie hecha, la carga queda de referencia. */
function limpiarEjercicio(ejercicio: EjercicioSesion): boolean {
	let cambio = false;
	for (const set of ejercicio.sets) {
		if (set.hecha) {
			set.hecha = false;
			cambio = true;
		}
	}
	if (ejercicio.saltado) {
		ejercicio.saltado = false;
		cambio = true;
	}
	// Sin ninguna serie hecha no puede quedar un PR celebrado: no hay set que lo sostenga.
	if (ejercicio.prCelebrado) {
		ejercicio.prCelebrado = undefined;
		cambio = true;
	}
	return cambio;
}

/**
 * Vuelve a empezar un ejercicio de la sesión. No borra pesos ni repeticiones: eso es
 * justamente lo que se quiere conservar para repetir la serie. Devuelve la instantánea
 * para deshacer, o null si no había nada que reiniciar.
 */
export function reiniciarEjercicio(
	diaId: string,
	exerciseId: string,
	fecha = hoyStr()
): Promise<InstantaneaSesion | null> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.sesiones, async (): Promise<InstantaneaSesion | null> => {
		exigirRevisionDatos(revision);
		const s = await db.sesiones.get(sesionId(diaId, fecha));
		const e = s?.ejercicios.find((x) => x.exerciseId === exerciseId);
		if (!s || !e) return null;
		const instantanea = fotografiar(s, exerciseId);
		if (!limpiarEjercicio(e)) return null;
		reabrirSesion(s, `Reiniciaste ${nombreDe(e)}`);
		await guardarSesion(s);
		return instantanea;
	});
}

/** Vuelve a empezar la sesión entera: todos los ejercicios sin marcar y sin saltos. */
export function reiniciarDia(diaId: string, fecha = hoyStr()): Promise<InstantaneaSesion | null> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.sesiones, async (): Promise<InstantaneaSesion | null> => {
		exigirRevisionDatos(revision);
		const s = await db.sesiones.get(sesionId(diaId, fecha));
		if (!s) return null;
		const instantanea = fotografiar(s);
		let cambio = false;
		for (const ejercicio of s.ejercicios) if (limpiarEjercicio(ejercicio)) cambio = true;
		if (!cambio) return null;
		reabrirSesion(s, 'Reiniciaste el día');
		s.diaTerminado = false;
		s.diaTerminadoAt = undefined;
		s.diaTerminadoConPendientes = undefined;
		await guardarSesion(s);
		return instantanea;
	});
}

/**
 * Deshace un reinicio devolviendo la instantánea. Los ejercicios que la foto no incluye
 * (reinicio de UN ejercicio) quedan como están: deshacer restaura lo que se pisó, no
 * revierte lo que hayas hecho después en el resto del día.
 */
export function restaurarInstantanea(
	diaId: string,
	instantanea: InstantaneaSesion,
	fecha = hoyStr()
): Promise<boolean> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.sesiones, async () => {
		exigirRevisionDatos(revision);
		const s = await db.sesiones.get(sesionId(diaId, fecha));
		if (!s) return false;
		for (const guardado of instantanea.ejercicios) {
			const indice = s.ejercicios.findIndex((e) => e.exerciseId === guardado.exerciseId);
			if (indice >= 0) s.ejercicios[indice] = structuredClone(guardado);
			else s.ejercicios.push(structuredClone(guardado));
		}
		s.diaTerminado = instantanea.diaTerminado;
		s.diaTerminadoAt = instantanea.diaTerminadoAt;
		s.diaTerminadoConPendientes = instantanea.diaTerminadoConPendientes;
		s.reaperturaMotivo = instantanea.reaperturaMotivo;
		s.reaperturaAt = instantanea.reaperturaAt;
		await guardarSesion(s);
		return true;
	});
}

/**
 * `fecha` es explícita por el mismo motivo que en el resto de las mutaciones: sin
 * ella, terminar el día justo después de la medianoche creaba una sesión nueva y
 * vacía marcada como terminada, y dejaba la sesión real del entrenamiento abierta.
 */
export type ResultadoDiaTerminado =
	| { terminado: true; conPendientes: boolean }
	| { terminado: false; razon: 'rutina-no-disponible' | 'ejercicios-pendientes' | 'sin-trabajo' };

/**
 * Cierra el día.
 *
 * `conPendientes` es la salida honesta para "terminé por hoy" con trabajo sin resolver.
 * Antes no existía: cerrar exigía cada ejercicio hecho o saltado, así que quien hacía un
 * ejercicio y se iba sólo podía saltar el resto —mintiendo sobre por qué no los hizo— o
 * dejar el día abierto para siempre. Se pide explícitamente desde la pantalla, que ya
 * confirmó con el usuario cuánto queda afuera, y queda registrado en la sesión: cerrar a
 * mano no puede valer lo mismo que haber cumplido el plan.
 */
export async function marcarDiaTerminado(
	diaId: string,
	fecha = hoyStr(),
	{ conPendientes = false }: { conPendientes?: boolean } = {}
): Promise<ResultadoDiaTerminado> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.dias, db.sesiones, async () => {
		exigirRevisionDatos(revision);
		const dia = await db.dias.get(diaId);
		const s = await db.sesiones.get(sesionId(diaId, fecha));
		if (!dia || !s) return { terminado: false, razon: 'rutina-no-disponible' };
		const todoResuelto =
			dia.ejercicios.length > 0 &&
			dia.ejercicios.every((item) => {
				const ejercicio = s.ejercicios.find((e) => e.exerciseId === item.exerciseId);
				return !!ejercicio && (ejercicio.saltado || ejercicio.sets.every(serieCompleta));
			});
		if (!todoResuelto && !conPendientes)
			return { terminado: false, razon: 'ejercicios-pendientes' };
		// Un día sin una sola serie ni un solo salto no es un día cerrado: es un día que no
		// empezó. Cerrarlo dejaría una sesión "terminada" que el historial no muestra.
		const hayAlgoQueCerrar = s.ejercicios.some((e) => e.saltado || e.sets.some(serieCompleta));
		if (!hayAlgoQueCerrar) return { terminado: false, razon: 'sin-trabajo' };
		s.diaTerminado = true;
		s.diaTerminadoAt = new Date().toISOString();
		s.diaTerminadoConPendientes = todoResuelto ? undefined : true;
		limpiarReapertura(s);
		await guardarSesion(s);
		return { terminado: true, conPendientes: !todoResuelto };
	});
}

/** Reapertura pedida a mano: no deja cartel, porque no hay nada que explicarle a nadie. */
export function reabrirDia(diaId: string, fecha = hoyStr()) {
	return db.sesiones
		.where('id')
		.equals(sesionId(diaId, fecha))
		.modify((s) => {
			s.diaTerminado = false;
			s.diaTerminadoAt = undefined;
			s.diaTerminadoConPendientes = undefined;
			limpiarReapertura(s);
		});
}

/** El usuario leyó por qué se reabrió el día: se apaga el cartel sin cerrar el día. */
export function descartarReapertura(diaId: string, fecha = hoyStr()) {
	return db.sesiones
		.where('id')
		.equals(sesionId(diaId, fecha))
		.modify((s) => limpiarReapertura(s));
}
