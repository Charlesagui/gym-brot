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
	timer: { activo: false, minutos: 2 },
	sonido: true
};

function normalizarAjustes(a?: Ajustes | null): Ajustes {
	return {
		...AJUSTES_DEFAULT,
		...(a ?? {}),
		timer: { ...AJUSTES_DEFAULT.timer, ...(a?.timer ?? {}) },
		sonido: a?.sonido ?? AJUSTES_DEFAULT.sonido
	};
}

export function ajustesObs() {
	return liveQuery(async () => normalizarAjustes(await db.ajustes.get('app')));
}

export async function setTimer(activo: boolean, minutos: number): Promise<void> {
	const a = normalizarAjustes(await db.ajustes.get('app'));
	await db.ajustes.put({ ...a, timer: { activo, minutos } });
}

export async function setSonido(sonido: boolean): Promise<void> {
	const a = normalizarAjustes(await db.ajustes.get('app'));
	await db.ajustes.put({ ...a, sonido });
}

const KG_TO_LB = 2.2046226218;

function convertirPeso(peso: number, desde: Ajustes['unidad'], hacia: Ajustes['unidad']): number {
	if (desde === hacia) return peso;
	const convertido = hacia === 'lb' ? peso * KG_TO_LB : peso / KG_TO_LB;
	return Math.round(convertido * 10) / 10;
}

export async function setUnidad(unidad: 'kg' | 'lb'): Promise<void> {
	const a = normalizarAjustes(await db.ajustes.get('app'));
	if (a.unidad === unidad) {
		await db.ajustes.put({ ...a, unidad });
		return;
	}
	await db.transaction('rw', db.sesiones, db.ajustes, async () => {
		const sesiones = await db.sesiones.toArray();
		for (const sesion of sesiones) {
			let cambio = false;
			for (const ejercicio of sesion.ejercicios) {
				for (const set of ejercicio.sets) {
					if (set.peso == null) continue;
					set.peso = convertirPeso(set.peso, a.unidad, unidad);
					cambio = true;
				}
			}
			if (cambio) await db.sesiones.put(sesion);
		}
		await db.ajustes.put({ ...a, unidad });
	});
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
		{
			app: 'gym-brot',
			version: 1,
			exportado: new Date().toISOString(),
			dias,
			sesiones,
			notas,
			ajustes: ajustes.map(normalizarAjustes)
		},
		null,
		2
	);
}

type JsonRecord = Record<string, unknown>;

function esRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function esString(value: unknown): value is string {
	return typeof value === 'string';
}

function esNumero(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function esBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean';
}

function esDia(value: unknown): value is Dia {
	if (!esRecord(value)) return false;
	const ejercicios = value.ejercicios;
	return (
		esString(value.id) &&
		esString(value.nombre) &&
		(value.color === undefined || esString(value.color)) &&
		(value.diaSemana === undefined ||
			(esNumero(value.diaSemana) && value.diaSemana >= 0 && value.diaSemana <= 6)) &&
		esNumero(value.orden) &&
		Array.isArray(ejercicios) &&
		ejercicios.every(
			(e) =>
				esRecord(e) &&
				esString(e.exerciseId) &&
				esNumero(e.seriesObjetivo) &&
				esNumero(e.orden)
		)
	);
}

function esSesion(value: unknown): value is Sesion {
	if (!esRecord(value)) return false;
	const ejercicios = value.ejercicios;
	return (
		esString(value.id) &&
		esString(value.fecha) &&
		esString(value.diaId) &&
		(value.diaTerminado === undefined || esBoolean(value.diaTerminado)) &&
		(value.diaTerminadoAt === undefined || esString(value.diaTerminadoAt)) &&
		Array.isArray(ejercicios) &&
		ejercicios.every((e) => {
			if (!esRecord(e) || !esString(e.exerciseId) || !Array.isArray(e.sets)) return false;
			return (
				(e.prPesoCelebrado === undefined || esNumero(e.prPesoCelebrado)) &&
				e.sets.every(
					(set) =>
						esRecord(set) &&
						esBoolean(set.hecha) &&
						(set.peso === undefined || esNumero(set.peso)) &&
						(set.reps === undefined || esNumero(set.reps)) &&
						(set.esMax === undefined || esBoolean(set.esMax))
				)
			);
		})
	);
}

function esNota(value: unknown): value is Nota {
	return esRecord(value) && esString(value.exerciseId) && esString(value.texto);
}

function esAjustes(value: unknown): value is Ajustes {
	if (!esRecord(value) || value.id !== 'app') return false;
	const timer = value.timer;
	return (
		esBoolean(value.darkMode) &&
		(value.unidad === 'kg' || value.unidad === 'lb') &&
		esRecord(timer) &&
		esBoolean(timer.activo) &&
		esNumero(timer.minutos) &&
		(value.sonido === undefined || esBoolean(value.sonido))
	);
}

function validarLista<T>(
	data: JsonRecord,
	nombre: keyof Backup,
	guard: (value: unknown) => value is T
): void {
	const value = data[nombre];
	if (!Array.isArray(value) || !value.every(guard)) {
		throw new Error(`Backup inválido: ${String(nombre)}`);
	}
}

/** Parsea y valida que el texto sea un backup de gym-brot. Lanza si no lo es. */
export function parseBackup(texto: string): Backup {
	const data = JSON.parse(texto) as unknown;
	if (!esRecord(data) || data.app !== 'gym-brot') {
		throw new Error('No parece un backup de gym-brot');
	}
	if (data.version !== undefined && !esNumero(data.version)) {
		throw new Error('Backup inválido: version');
	}
	if (data.exportado !== undefined && !esString(data.exportado)) {
		throw new Error('Backup inválido: exportado');
	}
	validarLista(data, 'dias', esDia);
	validarLista(data, 'sesiones', esSesion);
	validarLista(data, 'notas', esNota);
	validarLista(data, 'ajustes', esAjustes);
	return data as Backup;
}

/** Reemplaza TODOS los datos locales por los del backup (destructivo). */
export async function importarBackup(data: Backup): Promise<void> {
	await db.transaction('rw', db.dias, db.sesiones, db.notas, db.ajustes, async () => {
		await Promise.all([db.dias.clear(), db.sesiones.clear(), db.notas.clear(), db.ajustes.clear()]);
		if (data.dias?.length) await db.dias.bulkPut(data.dias);
		if (data.sesiones?.length) await db.sesiones.bulkPut(data.sesiones);
		if (data.notas?.length) await db.notas.bulkPut(data.notas);
		if (data.ajustes?.length) await db.ajustes.bulkPut(data.ajustes.map(normalizarAjustes));
	});
}
