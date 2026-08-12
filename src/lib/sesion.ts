import { liveQuery } from 'dexie';
import {
	conIndice,
	db,
	guardarSesion,
	type MetricaPr,
	type PrCelebrado,
	type Sesion,
	type SetSesion
} from './db';

/** Peso "efectivo" de un set: el peso ingresado + lo que haya encima de la placa si es MAX. */
export function pesoEfectivo(s: {
	peso?: number;
	esMax?: boolean;
	extraKg?: number;
}): number | null {
	if (s.peso == null) return null;
	return s.peso + (s.esMax ? (s.extraKg ?? 0) : 0);
}

/** Cómo puntúa un ejercicio: por peso (default) o por reps si nunca registró peso (bodyweight). */
export type ModoPr = 'peso' | 'reps';

/** Métrica que la UI rotula: la de ajustes, o reps máximas cuando el ejercicio es modo reps. */
export type MetricaEfectiva = MetricaPr | 'reps';

/** Epley sobreestima fuerte con reps altas → tope en 12 (por encima puntúa como 12). */
const TOPE_REPS_E1RM = 12;

/** La interfaz muestra un decimal: comparar el mismo valor evita PRs fantasma por IEEE-754. */
function normalizarValorPr(valor: number): number {
	return Math.round(valor * 10) / 10;
}

const METRICAS_EFECTIVAS: MetricaEfectiva[] = ['peso', 'e1rm', 'reps'];

/**
 * Valor de un set bajo la métrica elegida.
 * - `peso`: el peso efectivo tal cual.
 * - `e1rm`: 1RM estimado con Epley = peso × (1 + reps/30). reps se trata como ≥1 y ≤12.
 */
export function valorMetrica(
	peso: number,
	reps: number | undefined,
	metrica: MetricaPr
): number | null {
	if (metrica === 'e1rm') {
		// Sin reps no hay una estimación honesta; volumen también considera incompleto ese set.
		if (reps == null || reps <= 0) return null;
		const r = Math.min(TOPE_REPS_E1RM, reps);
		return normalizarValorPr(peso * (1 + r / 30));
	}
	return peso;
}

/**
 * Valor de un set bajo métrica y modo del ejercicio; null si no puntúa.
 * En modo reps (ejercicio sin peso) el valor son las reps y la métrica de ajustes no aplica.
 */
export function valorSet(
	set: { peso?: number; reps?: number; esMax?: boolean; extraKg?: number },
	metrica: MetricaPr,
	modo: ModoPr = 'peso'
): number | null {
	// Reps sin carga y carga son progresiones distintas; nunca se convierten entre sí.
	if (modo === 'reps') return set.peso == null ? (set.reps ?? null) : null;
	const ef = pesoEfectivo(set);
	return ef == null ? null : valorMetrica(ef, set.reps, metrica);
}

/** Explicación corta de cada métrica de PR — única fuente para toda la UI. */
export const DESCRIPCION_METRICA: Record<MetricaEfectiva, string> = {
	e1rm: 'El 1RM estimado (1 Repetición Máxima, fórmula de Epley) calcula tu fuerza máxima teórica a partir de peso y reps: 95 × 12 supera a 100 × 1. Premia la sobrecarga por repeticiones. Es fiable hasta ~12 reps: por encima se calcula como 12.',
	peso: 'El récord es la serie de mayor peso, sin importar las reps. Si el peso se repite, mostramos la que tuvo más reps.',
	reps: 'Este ejercicio se hace sin peso: el récord es la serie hecha con más repeticiones. La métrica de PR de Ajustes (peso/1RM) no aplica acá.'
};

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

async function ensureSesion(diaId: string, fecha = hoyStr()): Promise<Sesion> {
	const id = sesionId(diaId, fecha);
	let s = await db.sesiones.get(id);
	if (!s) {
		s = { id, fecha, diaId, ejercicios: [] };
		await db.sesiones.add(conIndice(s));
	}
	return s;
}

export interface MejorSet {
	/** Ausente en modo reps: el ejercicio no usa peso y el valor son las reps. */
	peso?: number;
	reps?: number;
	esMax: boolean;
	extraKg?: number;
	fecha: string;
	valor: number;
	sesionId?: string;
	setIndex?: number;
}

export interface RecordEjercicio extends MejorSet {
	exerciseId: string;
	/** Con qué se midió el récord, para que la UI siempre rotule (kg vs reps). */
	modo: ModoPr;
}

/** Una serie cuenta como completa cuando fue confirmada y tiene repeticiones. */
export function serieCompleta(set: SetSesion): boolean {
	return set.hecha && set.reps != null;
}

/** 'reps' si el ejercicio tiene series hechas y ninguna registró peso; si no, 'peso'. */
export function modoEjercicio(sesiones: Sesion[], exerciseId: string): ModoPr {
	let tieneHechas = false;
	for (const s of sesiones) {
		const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
		for (const set of e?.sets ?? []) {
			if (!set.hecha) continue;
			if (set.peso != null) return 'peso';
			tieneHechas = true;
		}
	}
	return tieneHechas ? 'reps' : 'peso';
}

/** El mejor de dos sets bajo `valor` (desempata por reps). */
export function mejorSet(a: MejorSet | null, b: MejorSet): MejorSet {
	if (!a) return b;
	if (b.valor > a.valor) return b;
	if (b.valor === a.valor && (b.reps ?? 0) > (a.reps ?? 0)) return b;
	return a;
}

function metricaDeSnapshot(pr: PrCelebrado): MetricaEfectiva {
	// En datos viejos sin métrica se infiere sólo para recalcular; la UI los llama “PR registrado”.
	return pr.metrica ?? (pr.peso == null ? 'reps' : 'peso');
}

function modoDeMetrica(metrica: MetricaEfectiva): ModoPr {
	return metrica === 'reps' ? 'reps' : 'peso';
}

function mejorSetDeSeries(
	sets: SetSesion[],
	fecha: string,
	metrica: MetricaPr,
	sesionIdFuente?: string,
	modo: ModoPr = 'peso'
): MejorSet | null {
	return sets.reduce<MejorSet | null>((best, set, setIndex) => {
		if (!set.hecha) return best;
		const valor = valorSet(set, metrica, modo);
		if (valor == null) return best;
		return mejorSet(best, {
			peso: set.peso,
			reps: set.reps,
			esMax: !!set.esMax,
			extraKg: set.extraKg,
			fecha,
			valor,
			sesionId: sesionIdFuente,
			setIndex
		});
	}, null);
}

function snapPr(set: MejorSet, metrica: MetricaEfectiva): PrCelebrado {
	return {
		peso: set.peso,
		reps: set.reps,
		esMax: set.esMax,
		extraKg: set.extraKg,
		setIndex: set.setIndex,
		metrica
	};
}

/**
 * Sesiones que registraron este ejercicio, por fecha ascendente (id como desempate,
 * igual que el orden con el que se decide un récord).
 *
 * Va por el índice multiEntry `exerciseIds` en vez de deserializar toda la tabla: como
 * cualquier escritura invalida los liveQuery, ese escaneo se pagaba en CADA toque de peso
 * y crecía sin techo con los años de historial.
 */
export async function sesionesDe(exerciseId: string): Promise<Sesion[]> {
	const sesiones = await db.sesiones.where('exerciseIds').equals(exerciseId).toArray();
	return sesiones.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
}

/** Mejor set hecho por sesión para una progresión homogénea: carga o reps sin carga. */
export function historialPorModoObs(exerciseId: string, metrica: MetricaPr, modo: ModoPr) {
	return liveQuery(async () =>
		historialPorModo(await sesionesDe(exerciseId), exerciseId, metrica, modo)
	);
}

/** Derivación pura para reutilizar una misma lectura de IndexedDB en varias vistas. */
export function historialPorModo(
	sesiones: Sesion[],
	exerciseId: string,
	metrica: MetricaPr,
	modo: ModoPr
): MejorSet[] {
	const puntos: MejorSet[] = [];
	for (const s of sesiones) {
		if (s.fecha > hoyStr()) continue;
		const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
		if (!e) continue;
		const mejor = mejorSetDeSeries(e.sets, s.fecha, metrica, s.id, modo);
		if (mejor) puntos.push(mejor);
	}
	return puntos;
}

/** Serie principal: carga si ya existe una serie hecha con carga; si no, reps. */
export function historialObs(exerciseId: string, metrica: MetricaPr = 'peso') {
	return liveQuery(async () => {
		const todas = (await sesionesDe(exerciseId)).filter((sesion) => sesion.fecha <= hoyStr());
		const modo = modoEjercicio(todas, exerciseId);
		const puntos: MejorSet[] = [];
		for (const s of todas) {
			const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
			if (!e) continue;
			const mejor = mejorSetDeSeries(e.sets, s.fecha, metrica, s.id, modo);
			if (mejor) puntos.push(mejor);
		}
		return puntos;
	});
}

export function recordsGlobalesObs(metrica: MetricaPr = 'peso') {
	return liveQuery(async () => {
		const todas = (await db.sesiones.orderBy('fecha').toArray()).filter(
			(sesion) => sesion.fecha <= hoyStr()
		);
		// Modo por ejercicio en una pasada: con algún set ✓ con peso puntúa por peso.
		const conPeso = new Set<string>();
		for (const s of todas)
			for (const e of s.ejercicios)
				for (const set of e.sets) if (set.hecha && set.peso != null) conPeso.add(e.exerciseId);
		const mejores = new Map<string, RecordEjercicio>();
		for (const s of todas) {
			for (const ejercicio of s.ejercicios) {
				const modo: ModoPr = conPeso.has(ejercicio.exerciseId) ? 'peso' : 'reps';
				const candidato = mejorSetDeSeries(ejercicio.sets, s.fecha, metrica, s.id, modo);
				if (!candidato) continue;
				const mejor = mejorSet(mejores.get(ejercicio.exerciseId) ?? null, candidato);
				mejores.set(ejercicio.exerciseId, { ...mejor, exerciseId: ejercicio.exerciseId, modo });
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
	fecha = hoyStr()
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
			if (e?.sets.some((set) => set.hecha)) {
				encontrada = {
					// Conserva índices, pero no prellena datos de sets abandonados o borrados.
					sets: e.sets.map((set) => (set.hecha ? set : { hecha: false })),
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
	fecha = hoyStr()
): Promise<SetSesion[] | undefined> {
	return (await ultimaSesion(diaId, exerciseId, fecha))?.sets;
}

/** Inicializa los sets de un ejercicio en la sesión de hoy (atómico). */
export async function ensureEjercicio(
	diaId: string,
	exerciseId: string,
	nSets: number,
	fecha = hoyStr()
): Promise<void> {
	await db.transaction('rw', db.sesiones, async () => {
		const s = await ensureSesion(diaId, fecha);
		if (s.ejercicios.some((e) => e.exerciseId === exerciseId)) return;
		const prev = await ultimaDe(diaId, exerciseId, fecha);
		const sets: SetSesion[] = Array.from({ length: Math.max(1, nSets) }, (_, i) => ({
			peso: prev?.[i]?.peso,
			reps: prev?.[i]?.reps,
			hecha: false
		}));
		s.ejercicios.push({ exerciseId, sets });
		await guardarSesion(s);
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
	metrica: MetricaPr = 'peso',
	recalcularPr = false
): Promise<void> {
	await db.transaction('rw', db.sesiones, async () => {
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
	// El orden (fecha, id) es el mismo con el que se decide un récord al celebrarlo.
	const orden = [...todas.filter((s) => s.id !== sesion.id), sesion].sort(
		(a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id)
	);
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
	metrica: MetricaPr = 'peso'
): Promise<boolean> {
	return db.transaction('rw', db.sesiones, async () => {
		const s = await db.sesiones.get(idSesion);
		const e = s?.ejercicios.find((x) => x.exerciseId === exerciseId);
		const set = e?.sets[setIndex];
		if (!s || !set?.hecha) return false;
		set.peso = cambios.peso;
		set.reps = cambios.reps;
		set.esMax = cambios.esMax;
		set.extraKg = cambios.extraKg;
		// Editar el historial puede invalidar el PR de sesiones POSTERIORES a esta.
		await recalcularPrCelebrado(s, exerciseId, true);
		await guardarSesion(s);
		return true;
	});
}

export function borrarSetHistorial(
	idSesion: string,
	exerciseId: string,
	setIndex: number,
	metrica: MetricaPr = 'peso'
): Promise<boolean> {
	return db.transaction('rw', db.sesiones, async () => {
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
	return db.transaction('rw', db.sesiones, async (): Promise<ResultadoSet> => {
		const s = await db.sesiones.get(sesionId(diaId, fecha));
		const e = s?.ejercicios.find((x) => x.exerciseId === exerciseId);
		const set = e?.sets[i];
		if (!s || !e || !set) return { encontrada: false, cambio: false };

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

export function toggleMax(
	diaId: string,
	exerciseId: string,
	i: number,
	fecha = hoyStr(),
	metrica: MetricaPr = 'peso'
) {
	return mutar(
		diaId,
		exerciseId,
		(sets) => {
			if (sets[i]) sets[i].esMax = !sets[i].esMax;
		},
		fecha,
		metrica,
		true
	);
}
export function setPeso(
	diaId: string,
	exerciseId: string,
	i: number,
	peso?: number,
	fecha = hoyStr(),
	metrica: MetricaPr = 'peso'
) {
	return mutar(
		diaId,
		exerciseId,
		(sets) => {
			if (sets[i]) sets[i].peso = peso;
		},
		fecha,
		metrica,
		true
	);
}
export function setReps(
	diaId: string,
	exerciseId: string,
	i: number,
	reps?: number,
	fecha = hoyStr(),
	metrica: MetricaPr = 'peso'
) {
	return mutar(
		diaId,
		exerciseId,
		(sets) => {
			if (sets[i]) sets[i].reps = reps;
		},
		fecha,
		metrica,
		true
	);
}
/** Kg encima de la placa full (solo aplica al PR cuando el set es MAX). */
export function setExtra(
	diaId: string,
	exerciseId: string,
	i: number,
	extraKg?: number,
	fecha = hoyStr(),
	metrica: MetricaPr = 'peso'
) {
	return mutar(
		diaId,
		exerciseId,
		(sets) => {
			if (sets[i]) sets[i].extraKg = extraKg;
		},
		fecha,
		metrica,
		true
	);
}
export function addSet(diaId: string, exerciseId: string, fecha = hoyStr()) {
	return mutar(
		diaId,
		exerciseId,
		(sets, sesion) => {
			const last = sets[sets.length - 1];
			sets.push({ peso: last?.peso, reps: last?.reps, hecha: false });
			sesion.diaTerminado = false;
			sesion.diaTerminadoAt = undefined;
		},
		fecha
	);
}

export function removeSet(
	diaId: string,
	exerciseId: string,
	i: number,
	fecha = hoyStr(),
	metrica: MetricaPr = 'peso'
) {
	return mutar(
		diaId,
		exerciseId,
		(sets, sesion) => {
			if (sets.length > 1 && sets[i]) sets.splice(i, 1);
			sesion.diaTerminado = false;
			sesion.diaTerminadoAt = undefined;
		},
		fecha,
		metrica,
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

/** Saltar el ejercicio hoy (p. ej. máquina ocupada): se asegura su entrada y lo marca. */
export async function saltarEjercicio(
	diaId: string,
	exerciseId: string,
	nSets: number,
	fecha = hoyStr()
): Promise<void> {
	await ensureEjercicio(diaId, exerciseId, nSets, fecha);
	await setSaltado(diaId, exerciseId, true, fecha);
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
	fecha = hoyStr()
): Promise<MejorSet | null> {
	return db.transaction('rw', db.sesiones, async (): Promise<MejorSet | null> => {
		const s = await db.sesiones.get(sesionId(diaId, fecha));
		const e = s?.ejercicios.find((x) => x.exerciseId === exerciseId);
		const set = e?.sets[setIndex];
		if (!s || !e || !set || !serieCompleta(set)) return null;

		const todas = await sesionesDe(exerciseId);
		// El modo pertenece al ejercicio completo, no a la serie recién tocada. Si ya
		// existe historial con carga, una serie incompleta con solo reps no puede mutar
		// temporalmente a “reps” ni disparar un PR rotulado como kg en la interfaz.
		const modo = modoEjercicio(
			todas.filter((otra) => otra.fecha <= s.fecha),
			exerciseId
		);
		const metricaEfectiva: MetricaEfectiva = modo === 'reps' ? 'reps' : metrica;
		const valor = valorSet(set, metricaEfectiva === 'reps' ? 'peso' : metricaEfectiva, modo);
		if (valor == null) return null;

		// “Previo” es sólo lo que existía cronológicamente antes de esta sesión. Mirar
		// sesiones futuras hacía negar récords históricos válidos al cargar/editar datos.
		const mejorPrevio = todas.reduce<number | null>((best, otra) => {
			if (otra.id === s.id || otra.fecha > s.fecha || (otra.fecha === s.fecha && otra.id > s.id)) {
				return best;
			}
			const eo = otra.ejercicios.find((x) => x.exerciseId === exerciseId);
			if (!eo) return best;
			const mejor = mejorSetDeSeries(
				eo.sets,
				otra.fecha,
				metricaEfectiva === 'reps' ? 'peso' : metricaEfectiva,
				otra.id,
				modo
			);
			if (!mejor) return best;
			return best == null || mejor.valor > best ? mejor.valor : best;
		}, null);
		const yaCelebrado =
			e.prCelebrado && metricaDeSnapshot(e.prCelebrado) === metricaEfectiva
				? valorSet(e.prCelebrado, metricaEfectiva === 'reps' ? 'peso' : metricaEfectiva, modo)
				: null;

		const supera =
			(mejorPrevio == null || valor > mejorPrevio) && (yaCelebrado == null || valor > yaCelebrado);
		if (!supera) return null;

		const ganador: MejorSet = {
			peso: set.peso,
			reps: set.reps,
			esMax: !!set.esMax,
			extraKg: set.extraKg,
			fecha: s.fecha,
			valor,
			sesionId: s.id,
			setIndex
		};
		e.prCelebrado = snapPr(ganador, metricaEfectiva);
		await guardarSesion(s);
		return ganador;
	});
}

/**
 * `fecha` es explícita por el mismo motivo que en el resto de las mutaciones: sin
 * ella, terminar el día justo después de la medianoche creaba una sesión nueva y
 * vacía marcada como terminada, y dejaba la sesión real del entrenamiento abierta.
 */
export async function marcarDiaTerminado(diaId: string, fecha = hoyStr()) {
	await db.transaction('rw', db.sesiones, async () => {
		const s = await ensureSesion(diaId, fecha);
		s.diaTerminado = true;
		s.diaTerminadoAt = new Date().toISOString();
		await guardarSesion(s);
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
