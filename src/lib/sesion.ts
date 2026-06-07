import { liveQuery } from 'dexie';
import { db, type Sesion, type SetSesion } from './db';

/** Fecha local en formato YYYY-MM-DD. */
export function hoyStr(): string {
	return new Date().toLocaleDateString('sv'); // 'sv' → YYYY-MM-DD
}

export function sesionId(diaId: string, fecha = hoyStr()): string {
	return `${fecha}__${diaId}`;
}

/** Observable (Svelte store) de la sesión de hoy para un día. */
export function sesionHoyObs(diaId: string) {
	return liveQuery(() => db.sesiones.get(sesionId(diaId)));
}

export interface MejorSet {
	peso: number;
	reps?: number;
	esMax: boolean;
	fecha: string;
}

/** Mejor set hecho (mayor peso) por sesión, ordenado por fecha — para PR y gráfico. */
export function historialObs(exerciseId: string) {
	return liveQuery(async () => {
		const todas = await db.sesiones.orderBy('fecha').toArray();
		const puntos: MejorSet[] = [];
		for (const s of todas) {
			const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
			if (!e) continue;
			let mejor: MejorSet | null = null;
			for (const set of e.sets) {
				if (!set.hecha) continue;
				if (set.peso == null) continue;
				if (!mejor || set.peso > mejor.peso) {
					mejor = { peso: set.peso, reps: set.reps, esMax: !!set.esMax, fecha: s.fecha };
				}
			}
			if (mejor) puntos.push(mejor);
		}
		return puntos;
	});
}

/** Sets de la última vez que se hizo este ejercicio (para pre-llenar pesos). */
async function ultimaDe(exerciseId: string, exceptoId: string): Promise<SetSesion[] | undefined> {
	const todas = await db.sesiones.orderBy('fecha').reverse().toArray();
	for (const s of todas) {
		if (s.id === exceptoId) continue;
		const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
		if (e && e.sets.length) return e.sets;
	}
	return undefined;
}

/** Inicializa los sets de un ejercicio en la sesión de hoy (atómico). */
export async function ensureEjercicio(
	diaId: string,
	exerciseId: string,
	nSets: number
): Promise<void> {
	const id = sesionId(diaId);
	await db.transaction('rw', db.sesiones, async () => {
		let s = await db.sesiones.get(id);
		if (!s) {
			s = { id, fecha: hoyStr(), diaId, ejercicios: [] };
			await db.sesiones.add(s);
		}
		if (s.ejercicios.some((e) => e.exerciseId === exerciseId)) return;
		const prev = await ultimaDe(exerciseId, id);
		const sets: SetSesion[] = Array.from({ length: Math.max(1, nSets) }, (_, i) => ({
			peso: prev?.[i]?.peso,
			reps: prev?.[i]?.reps,
			hecha: false
		}));
		s.ejercicios.push({ exerciseId, sets });
		await db.sesiones.put(s);
	});
}

/** Mutación atómica de los sets de un ejercicio (serializada por Dexie → sin race). */
async function mutar(diaId: string, exerciseId: string, fn: (sets: SetSesion[]) => void): Promise<void> {
	await db.sesiones
		.where('id')
		.equals(sesionId(diaId))
		.modify((s) => {
			const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
			if (e) fn(e.sets);
		});
}

export function toggleSet(diaId: string, exerciseId: string, i: number) {
	return mutar(diaId, exerciseId, (sets) => {
		if (sets[i]) sets[i].hecha = !sets[i].hecha;
	});
}
export function toggleMax(diaId: string, exerciseId: string, i: number) {
	return mutar(diaId, exerciseId, (sets) => {
		if (sets[i]) sets[i].esMax = !sets[i].esMax;
	});
}
export function setPeso(diaId: string, exerciseId: string, i: number, peso?: number) {
	return mutar(diaId, exerciseId, (sets) => {
		if (sets[i]) sets[i].peso = peso;
	});
}
export function setReps(diaId: string, exerciseId: string, i: number, reps?: number) {
	return mutar(diaId, exerciseId, (sets) => {
		if (sets[i]) sets[i].reps = reps;
	});
}
export function addSet(diaId: string, exerciseId: string) {
	return mutar(diaId, exerciseId, (sets) => {
		const last = sets[sets.length - 1];
		sets.push({ peso: last?.peso, reps: last?.reps, hecha: false });
	});
}

export function removeSet(diaId: string, exerciseId: string, i: number) {
	return mutar(diaId, exerciseId, (sets) => {
		if (sets.length > 1 && sets[i]) sets.splice(i, 1);
	});
}

export function completarEjercicio(diaId: string, exerciseId: string) {
	return mutar(diaId, exerciseId, (sets) => {
		for (const set of sets) set.hecha = true;
	});
}
