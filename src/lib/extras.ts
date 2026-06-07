import { liveQuery } from 'dexie';
import { db, type Dia, type Sesion, type Nota, type Ajustes } from './db';

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

export async function setUnidad(unidad: 'kg' | 'lb'): Promise<void> {
	const a = (await db.ajustes.get('app')) ?? AJUSTES_DEFAULT;
	await db.ajustes.put({ ...a, unidad });
}

// --- Backup (export / import a JSON) ---

export interface Backup {
	app?: string;
	version?: number;
	exportado?: string;
	dias?: Dia[];
	sesiones?: Sesion[];
	notas?: Nota[];
	ajustes?: Ajustes[];
}

export async function exportarJSON(): Promise<string> {
	const [dias, sesiones, notas, ajustes] = await Promise.all([
		db.dias.toArray(),
		db.sesiones.toArray(),
		db.notas.toArray(),
		db.ajustes.toArray()
	]);
	return JSON.stringify(
		{ app: 'gym-brot', version: 1, exportado: new Date().toISOString(), dias, sesiones, notas, ajustes },
		null,
		2
	);
}

/** Parsea y valida que el texto sea un backup de gym-brot. Lanza si no lo es. */
export function parseBackup(texto: string): Backup {
	const data = JSON.parse(texto) as Backup;
	if (!data || data.app !== 'gym-brot') {
		throw new Error('No parece un backup de gym-brot');
	}
	return data;
}

/** Reemplaza TODOS los datos locales por los del backup (destructivo). */
export async function importarBackup(data: Backup): Promise<void> {
	await db.transaction('rw', db.dias, db.sesiones, db.notas, db.ajustes, async () => {
		if (Array.isArray(data.dias)) {
			await db.dias.clear();
			await db.dias.bulkPut(data.dias);
		}
		if (Array.isArray(data.sesiones)) {
			await db.sesiones.clear();
			await db.sesiones.bulkPut(data.sesiones);
		}
		if (Array.isArray(data.notas)) {
			await db.notas.clear();
			await db.notas.bulkPut(data.notas);
		}
		if (Array.isArray(data.ajustes)) {
			await db.ajustes.clear();
			await db.ajustes.bulkPut(data.ajustes);
		}
	});
}
