import { liveQuery } from 'dexie';
import { db, type Ajustes } from './db';

// --- Notas por ejercicio ---

export function notaObs(exerciseId: string) {
	return liveQuery(() => db.notas.get(exerciseId));
}

export async function setNota(exerciseId: string, texto: string): Promise<void> {
	if (texto.trim()) await db.notas.put({ exerciseId, texto: texto.trim() });
	else await db.notas.delete(exerciseId);
}

// --- Ajustes (timer de descanso, unidad, etc.) ---

export const AJUSTES_DEFAULT: Ajustes = {
	id: 'app',
	darkMode: true,
	unidad: 'kg',
	timer: { activo: false, minutos: 2 }
};

export function ajustesObs() {
	return liveQuery(async () => (await db.ajustes.get('app')) ?? AJUSTES_DEFAULT);
}

export async function setTimer(activo: boolean, minutos: number): Promise<void> {
	const a = (await db.ajustes.get('app')) ?? AJUSTES_DEFAULT;
	await db.ajustes.put({ ...a, timer: { activo, minutos } });
}
