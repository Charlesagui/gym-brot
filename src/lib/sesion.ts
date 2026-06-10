import { liveQuery } from 'dexie';
import { db, type MetricaPr, type PrCelebrado, type Sesion, type SetSesion } from './db';

/** Peso "efectivo" de un set: el peso ingresado + lo que haya encima de la placa si es MAX. */
export function pesoEfectivo(s: {
	peso?: number;
	esMax?: boolean;
	extraKg?: number;
}): number | null {
	if (s.peso == null) return null;
	return s.peso + (s.esMax ? (s.extraKg ?? 0) : 0);
}

/**
 * Valor de un set bajo la métrica elegida.
 * - `peso`: el peso efectivo tal cual.
 * - `e1rm`: 1RM estimado con Epley = peso × (1 + reps/30). reps se trata como ≥1.
 */
export function valorMetrica(peso: number, reps: number | undefined, metrica: MetricaPr): number {
	if (metrica === 'e1rm') {
		const r = Math.max(1, reps ?? 1);
		return peso * (1 + r / 30);
	}
	return peso;
}

/** Explicación corta de cada métrica de PR — única fuente para toda la UI. */
export const DESCRIPCION_METRICA: Record<MetricaPr, string> = {
	e1rm: 'El 1RM estimado (1 Repetición Máxima, fórmula de Epley) calcula tu fuerza máxima teórica a partir de peso y reps: 95 × 12 supera a 100 × 1. Premia la sobrecarga por repeticiones.',
	peso: 'El récord es la serie de mayor peso, sin importar las reps. Simple y directo.'
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
		await db.sesiones.add(s);
	}
	return s;
}

export interface MejorSet {
	peso: number;
	reps?: number;
	esMax: boolean;
	extraKg?: number;
	fecha: string;
	valor: number;
}

/** El mejor de dos sets bajo `valor` (desempata por reps). */
export function mejorSet(a: MejorSet | null, b: MejorSet): MejorSet {
	if (!a) return b;
	if (b.valor > a.valor) return b;
	if (b.valor === a.valor && (b.reps ?? 0) > (a.reps ?? 0)) return b;
	return a;
}

function mejorSetDeSeries(sets: SetSesion[], fecha: string, metrica: MetricaPr): MejorSet | null {
	return sets.reduce<MejorSet | null>((best, set) => {
		if (!set.hecha) return best;
		const ef = pesoEfectivo(set);
		if (ef == null) return best;
		return mejorSet(best, {
			peso: set.peso!,
			reps: set.reps,
			esMax: !!set.esMax,
			extraKg: set.extraKg,
			fecha,
			valor: valorMetrica(ef, set.reps, metrica)
		});
	}, null);
}

function snapPr(set: MejorSet): PrCelebrado {
	return {
		peso: set.peso,
		reps: set.reps,
		esMax: set.esMax,
		extraKg: set.extraKg
	};
}

/** Mejor set hecho por sesión, ordenado por fecha — PR bajo la métrica elegida. */
export function historialObs(exerciseId: string, metrica: MetricaPr = 'peso') {
	return liveQuery(async () => {
		const todas = await db.sesiones.orderBy('fecha').toArray();
		const puntos: MejorSet[] = [];
		for (const s of todas) {
			const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
			if (!e) continue;
			let mejor: MejorSet | null = null;
			for (const set of e.sets) {
				if (!set.hecha) continue;
				const ef = pesoEfectivo(set);
				if (ef == null) continue;
				mejor = mejorSet(mejor, {
					peso: set.peso!,
					reps: set.reps,
					esMax: !!set.esMax,
					extraKg: set.extraKg,
					fecha: s.fecha,
					valor: valorMetrica(ef, set.reps, metrica)
				});
			}
			if (mejor) puntos.push(mejor);
		}
		return puntos;
	});
}

/** Última sesión (distinta de la actual) en que se hizo este ejercicio. */
export async function ultimaSesion(
	diaId: string,
	exerciseId: string,
	fecha = hoyStr()
): Promise<{ sets: SetSesion[]; fecha: string } | undefined> {
	const exceptoId = sesionId(diaId, fecha);
	const todas = await db.sesiones.orderBy('fecha').reverse().toArray();
	for (const s of todas) {
		if (s.id === exceptoId) continue;
		const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
		if (e && e.sets.length) return { sets: e.sets, fecha: s.fecha };
	}
	return undefined;
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
		await db.sesiones.put(s);
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
	fecha = hoyStr()
): Promise<void> {
	await db.sesiones
		.where('id')
		.equals(sesionId(diaId, fecha))
		.modify((s) => {
			const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
			if (e) fn(e.sets, s);
		});
}

async function recalcularPrCelebrado(sesion: Sesion, exerciseId: string, metrica: MetricaPr) {
	const ejercicio = sesion.ejercicios.find((x) => x.exerciseId === exerciseId);
	if (!ejercicio?.prCelebrado) return;

	const todas = await db.sesiones.toArray();
	const mejorPrevio = todas.reduce<MejorSet | null>((best, s) => {
		if (s.id === sesion.id) return best;
		const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
		if (!e) return best;
		const mejor = mejorSetDeSeries(e.sets, s.fecha, metrica);
		return mejor ? mejorSet(best, mejor) : best;
	}, null);
	const valorPrevio = mejorPrevio?.valor ?? null;

	const mejorRestante = mejorSetDeSeries(ejercicio.sets, sesion.fecha, metrica);
	if (!mejorRestante || (valorPrevio != null && mejorRestante.valor <= valorPrevio)) {
		ejercicio.prCelebrado = undefined;
		return;
	}
	ejercicio.prCelebrado = snapPr(mejorRestante);
}

export async function toggleSet(
	diaId: string,
	exerciseId: string,
	i: number,
	fecha = hoyStr(),
	metrica: MetricaPr = 'peso'
) {
	await db.transaction('rw', db.sesiones, async () => {
		const s = await db.sesiones.get(sesionId(diaId, fecha));
		const e = s?.ejercicios.find((x) => x.exerciseId === exerciseId);
		if (!s || !e?.sets[i]) return;
		e.sets[i].hecha = !e.sets[i].hecha;
		if (!e.sets[i].hecha) {
			s.diaTerminado = false;
			s.diaTerminadoAt = undefined;
			await recalcularPrCelebrado(s, exerciseId, metrica);
		}
		await db.sesiones.put(s);
	});
}
export function toggleMax(diaId: string, exerciseId: string, i: number, fecha = hoyStr()) {
	return mutar(
		diaId,
		exerciseId,
		(sets) => {
			if (sets[i]) sets[i].esMax = !sets[i].esMax;
		},
		fecha
	);
}
export function setPeso(diaId: string, exerciseId: string, i: number, peso?: number, fecha = hoyStr()) {
	return mutar(
		diaId,
		exerciseId,
		(sets) => {
			if (sets[i]) sets[i].peso = peso;
		},
		fecha
	);
}
export function setReps(diaId: string, exerciseId: string, i: number, reps?: number, fecha = hoyStr()) {
	return mutar(
		diaId,
		exerciseId,
		(sets) => {
			if (sets[i]) sets[i].reps = reps;
		},
		fecha
	);
}
/** Kg encima de la placa full (solo aplica al PR cuando el set es MAX). */
export function setExtra(diaId: string, exerciseId: string, i: number, extraKg?: number, fecha = hoyStr()) {
	return mutar(
		diaId,
		exerciseId,
		(sets) => {
			if (sets[i]) sets[i].extraKg = extraKg;
		},
		fecha
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

export function removeSet(diaId: string, exerciseId: string, i: number, fecha = hoyStr()) {
	return mutar(
		diaId,
		exerciseId,
		(sets) => {
			if (sets.length > 1 && sets[i]) sets.splice(i, 1);
		},
		fecha
	);
}

/** Marca/desmarca el ejercicio como saltado SOLO en la sesión (no toca la rutina). */
function setSaltado(diaId: string, exerciseId: string, saltado: boolean, fecha = hoyStr()) {
	return db.sesiones
		.where('id')
		.equals(sesionId(diaId, fecha))
		.modify((s) => {
			const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
			if (e) e.saltado = saltado;
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
 * Marca como ya celebrado el set que disparó el PR en esta sesión (anti-repetición).
 * Guarda el set (no un escalar) y conserva el de mayor valor bajo la métrica vigente.
 */
export function marcarPrCelebrado(
	diaId: string,
	exerciseId: string,
	snap: PrCelebrado,
	metrica: MetricaPr = 'peso',
	fecha = hoyStr()
) {
	return db.sesiones
		.where('id')
		.equals(sesionId(diaId, fecha))
		.modify((s) => {
			const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
			if (!e) return;
			const prevEf = e.prCelebrado ? pesoEfectivo(e.prCelebrado) : null;
			const prevVal =
				prevEf != null ? valorMetrica(prevEf, e.prCelebrado!.reps, metrica) : -Infinity;
			const nuevoEf = pesoEfectivo(snap);
			const nuevoVal = nuevoEf != null ? valorMetrica(nuevoEf, snap.reps, metrica) : -Infinity;
			if (nuevoVal >= prevVal) {
				e.prCelebrado = {
					peso: snap.peso,
					reps: snap.reps,
					esMax: snap.esMax,
					extraKg: snap.extraKg
				};
			}
		});
}

export async function marcarDiaTerminado(diaId: string) {
	await db.transaction('rw', db.sesiones, async () => {
		const s = await ensureSesion(diaId);
		s.diaTerminado = true;
		s.diaTerminadoAt = new Date().toISOString();
		await db.sesiones.put(s);
	});
}

export function reabrirDia(diaId: string) {
	return db.sesiones
		.where('id')
		.equals(sesionId(diaId))
		.modify((s) => {
			s.diaTerminado = false;
			s.diaTerminadoAt = undefined;
		});
}
