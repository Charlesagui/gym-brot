import { liveQuery } from 'dexie';
import {
	compararSesiones,
	conIndice,
	db,
	guardarSesion,
	type Ajustes,
	type MetricaPr,
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
	metricaConfigurada,
	modoEjercicio,
	resolverMetricaPr,
	repeticionesValidas,
	serieCompleta,
	snapPr,
	valorSet,
	type MejorSet,
	type MetricaEfectiva,
	type ModoPr,
	type RecordEjercicio
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
import { rirValido } from './esfuerzo';

export {
	DESCRIPCION_METRICA,
	mejorSet,
	modoEjercicio,
	pesoEfectivo,
	serieCompleta,
	valorMetrica,
	valorSet
} from './sesion-reglas';
export type { MejorSet, MetricaEfectiva, ModoPr, RecordEjercicio } from './sesion-reglas';

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
			prCelebrado: ejercicio?.prCelebrado ? conPesoVisible(ejercicio.prCelebrado, unidad) : null
		};
	});
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

async function ensureSesion(diaId: string, fecha = hoyStr(), diaNombre?: string): Promise<Sesion> {
	const id = sesionId(diaId, fecha);
	let s = await db.sesiones.get(id);
	if (!s) {
		const mismoDia = await db.sesiones.where('fecha').equals(fecha).toArray();
		const ordenEnDia =
			mismoDia.reduce((maximo, sesion) => Math.max(maximo, sesion.ordenEnDia ?? -1), -1) + 1;
		s = { id, fecha, diaId, diaNombre, ordenEnDia, ejercicios: [] };
		await db.sesiones.add(conIndice(s));
	}
	return s;
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

export function recordsGlobalesObs(
	configuracion: MetricaPr | Pick<Ajustes, 'metricaPr' | 'metricasPrEjercicio'> = 'peso',
	unidad: UnidadPeso = 'kg'
) {
	return liveQuery(async () => {
		const ajustes =
			typeof configuracion === 'string'
				? { metricaPr: configuracion, metricasPrEjercicio: {} }
				: configuracion;
		const hoy = hoyStr();
		const todas = (await db.sesiones.orderBy('fecha').toArray())
			.filter((sesion) => sesion.fecha <= hoy)
			.sort(compararSesiones);
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
			for (const e of s.ejercicios)
				if (e.nombreSnapshot) nombres.set(e.exerciseId, e.nombreSnapshot);
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
		return [...mejores.values()].sort(
			(a, b) => b.fecha.localeCompare(a.fecha) || b.valor - a.valor
		);
	});
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
		if (!dia || !configuracion) return { disponible: false };

		const id = sesionId(diaId, fecha);
		let sesion = await db.sesiones.get(id);
		if (!sesion) {
			sesion = await ensureSesion(diaId, fecha, dia.nombre);
		}
		let snapshotsActualizados = false;
		if (!sesion.diaNombre) {
			sesion.diaNombre = dia.nombre;
			snapshotsActualizados = true;
		}
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
 * Mutación atómica de los sets de un ejercicio (serializada por Dexie → sin race).
 * `fecha` fija la sesión destino al entrar al ejercicio, para no perder toques si
 * cruzás la medianoche entrenando (si no, apuntaría a una sesión de otro día inexistente).
 */
async function mutar(
	diaId: string,
	exerciseId: string,
	fn: (sets: SetSesion[], sesion: Sesion) => void,
	fecha = hoyStr(),
	recalcularPr = false
): Promise<void> {
	const revision = capturarRevisionDatos();
	await db.transaction('rw', db.sesiones, async () => {
		exigirRevisionDatos(revision);
		const s = await db.sesiones.get(sesionId(diaId, fecha));
		const e = s?.ejercicios.find((x) => x.exerciseId === exerciseId);
		if (!s || !e) return;
		fn(e.sets, s);
		if (recalcularPr) await recalcularPrCelebrado(s, exerciseId);
		await guardarSesion(s);
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
	const previos = new Map<MetricaEfectiva, number | null>(
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
			if (!mejor || (previo != null && mejor.valor <= previo)) {
				e.prCelebrado = undefined;
				if (s.id !== sesion.id && revalidarPosteriores) await guardarSesion(s);
			} else {
				// No inventamos una etiqueta de métrica en PRs heredados: sólo se usa internamente
				// para comprobarlos. La interfaz los presenta como “PR registrado”.
				e.prCelebrado = e.prCelebrado.metrica
					? snapPr(mejor, metricaPr)
					: { ...snapPr(mejor, metricaPr), metrica: undefined };
				if (s.id !== sesion.id && revalidarPosteriores) await guardarSesion(s);
			}
		}

		for (const metrica of METRICAS_EFECTIVAS) {
			const mejor = mejores.get(metrica);
			const previo = previos.get(metrica) ?? null;
			if (mejor && (previo == null || mejor.valor > previo)) previos.set(metrica, mejor.valor);
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
			reabrirSesion(s);
		}
		// Editar el historial puede invalidar el PR de sesiones POSTERIORES a esta.
		await recalcularPrCelebrado(s, exerciseId, true);
		await guardarSesion(s);
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
		reabrirSesion(s);
		await recalcularPrCelebrado(s, exerciseId, true);
		await guardarSesion(s);
		return true;
	});
}

export interface ResultadoSet {
	encontrada: boolean;
	hecha?: boolean;
	cambio: boolean;
	ejercicioCompleto?: boolean;
}

function reabrirSesion(sesion: Sesion) {
	sesion.diaTerminado = false;
	sesion.diaTerminadoAt = undefined;
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
			reabrirSesion(s);
		}
		if (!hecha) {
			reabrirSesion(s);
			if (cambio) await recalcularPrCelebrado(s, exerciseId);
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
			if (sets[i]) sets[i].esMax = !sets[i].esMax;
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
			if (sets[i]) {
				sets[i].peso = peso;
				const canonico = pesoAGramos(peso, unidad);
				if (canonico == null) delete sets[i].pesoGramos;
				else sets[i].pesoGramos = canonico;
			}
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
		(sets, sesion) => {
			const set = sets[i];
			if (!set) return;
			set.reps = reps;
			if (set.hecha && !repeticionesValidas(reps)) {
				set.hecha = false;
				reabrirSesion(sesion);
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
			if (sets[i]) sets[i].rir = rir;
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
			if (sets[i]) {
				sets[i].extraKg = extraKg;
				const canonico = pesoAGramos(extraKg, unidad);
				if (canonico == null) delete sets[i].extraGramos;
				else sets[i].extraGramos = canonico;
			}
		},
		fecha,
		true
	);
}
export function addSet(diaId: string, exerciseId: string, fecha = hoyStr()) {
	return mutar(
		diaId,
		exerciseId,
		(sets, sesion) => {
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
			sesion.diaTerminado = false;
			sesion.diaTerminadoAt = undefined;
		},
		fecha
	);
}

export function removeSet(diaId: string, exerciseId: string, i: number, fecha = hoyStr()) {
	return mutar(
		diaId,
		exerciseId,
		(sets, sesion) => {
			if (sets.length > 1 && sets[i]) sets.splice(i, 1);
			sesion.diaTerminado = false;
			sesion.diaTerminadoAt = undefined;
		},
		fecha,
		true
	);
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
			s.diaTerminado = false;
			s.diaTerminadoAt = undefined;
		});
}

/**
 * Saltar el ejercicio hoy (p. ej. máquina ocupada). Valida la rutina dentro de la
 * misma transacción: una pantalla vieja no puede crear una sesión huérfana al tocar
 * "Saltar" mientras otra pestaña quitó el ejercicio.
 */
export async function saltarEjercicio(
	diaId: string,
	exerciseId: string,
	fecha = hoyStr(),
	unidad: UnidadPeso = 'kg'
): Promise<boolean> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.dias, db.sesiones, async () => {
		exigirRevisionDatos(revision);
		const dia = await db.dias.get(diaId);
		const configuracion = dia?.ejercicios.find((item) => item.exerciseId === exerciseId);
		if (!dia || !configuracion) return false;
		const sesion = await ensureSesion(diaId, fecha, dia.nombre);
		sesion.diaNombre ??= dia.nombre;
		let ejercicio = sesion.ejercicios.find((item) => item.exerciseId === exerciseId);
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
		reabrirSesion(sesion);
		await guardarSesion(sesion);
		return true;
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
): Promise<MejorSet | null> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.sesiones, async (): Promise<MejorSet | null> => {
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
		const mejorPrevio = todas.reduce<number | null>((best, otra) => {
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
			return best == null || mejor.valor > best ? mejor.valor : best;
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
			(mejorPrevio == null || valor > mejorPrevio) && (yaCelebrado == null || valor > yaCelebrado);
		if (!supera) return null;

		const ganador: MejorSet = {
			peso: conPesoVisible(set, unidad).peso,
			reps: set.reps,
			esMax: !!set.esMax,
			extraKg: conPesoVisible(set, unidad).extraKg,
			fecha: s.fecha,
			valor,
			sesionId: s.id,
			setIndex
		};
		e.prCelebrado = snapPr(ganador, metricaEfectiva, unidad);
		await guardarSesion(s);
		return ganador;
	});
}

/**
 * `fecha` es explícita por el mismo motivo que en el resto de las mutaciones: sin
 * ella, terminar el día justo después de la medianoche creaba una sesión nueva y
 * vacía marcada como terminada, y dejaba la sesión real del entrenamiento abierta.
 */
export type ResultadoDiaTerminado =
	| { terminado: true }
	| { terminado: false; razon: 'rutina-no-disponible' | 'ejercicios-pendientes' };

export async function marcarDiaTerminado(
	diaId: string,
	fecha = hoyStr()
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
		if (!todoResuelto) return { terminado: false, razon: 'ejercicios-pendientes' };
		s.diaTerminado = true;
		s.diaTerminadoAt = new Date().toISOString();
		await guardarSesion(s);
		return { terminado: true };
	});
}

export function reabrirDia(diaId: string, fecha = hoyStr()) {
	return db.sesiones
		.where('id')
		.equals(sesionId(diaId, fecha))
		.modify((s) => {
			s.diaTerminado = false;
			s.diaTerminadoAt = undefined;
		});
}
