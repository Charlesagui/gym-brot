import { liveQuery } from 'dexie';
import { db, type Dia, type Sesion, type Nota, type Ajustes, type MetricaPr } from './db';

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
	timer: { activo: true, minutos: 2 },
	sonido: true,
	vibracion: true,
	descansoPantallaCompleta: true,
	metricaPr: 'peso',
	pasoPeso: 5,
	seedInicialHecho: false
};

export function normalizarAjustes(a?: Ajustes | null): Ajustes {
	return {
		...AJUSTES_DEFAULT,
		...(a ?? {}),
		timer: { ...AJUSTES_DEFAULT.timer, ...(a?.timer ?? {}) },
		sonido: a?.sonido ?? AJUSTES_DEFAULT.sonido,
		vibracion: a?.vibracion ?? AJUSTES_DEFAULT.vibracion,
		descansoPantallaCompleta:
			a?.descansoPantallaCompleta ?? AJUSTES_DEFAULT.descansoPantallaCompleta,
		metricaPr: a?.metricaPr ?? AJUSTES_DEFAULT.metricaPr,
		pasoPeso: a?.pasoPeso ?? AJUSTES_DEFAULT.pasoPeso,
		seedInicialHecho: a?.seedInicialHecho ?? AJUSTES_DEFAULT.seedInicialHecho
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

export async function setVibracion(vibracion: boolean): Promise<void> {
	const a = normalizarAjustes(await db.ajustes.get('app'));
	await db.ajustes.put({ ...a, vibracion });
}

export async function setDescansoPantallaCompleta(descansoPantallaCompleta: boolean): Promise<void> {
	const a = normalizarAjustes(await db.ajustes.get('app'));
	await db.ajustes.put({ ...a, descansoPantallaCompleta });
}

export async function setMetricaPr(metricaPr: MetricaPr): Promise<void> {
	const a = normalizarAjustes(await db.ajustes.get('app'));
	await db.ajustes.put({ ...a, metricaPr });
}

export async function setPasoPeso(pasoPeso: number): Promise<void> {
	const a = normalizarAjustes(await db.ajustes.get('app'));
	await db.ajustes.put({ ...a, pasoPeso });
}

/** Registra que se exportó un backup recién: apaga el recordatorio por un tiempo. */
export async function registrarBackup(fecha = new Date()): Promise<void> {
	const a = normalizarAjustes(await db.ajustes.get('app'));
	await db.ajustes.put({ ...a, ultimoBackup: fecha.toISOString() });
}

const MS_DIA = 24 * 60 * 60 * 1000;
/** Más de este tiempo sin backup (con datos nuevos) → recordatorio en /historial. */
const DIAS_RECORDATORIO_BACKUP = 30;

export function diasDesde(iso: string, ahora = new Date()): number {
	return Math.floor((ahora.getTime() - new Date(iso).getTime()) / MS_DIA);
}

/**
 * true si corresponde recordar el backup: pasaron >30 días del último (o del
 * primer entrenamiento, si nunca exportó) y hay sesiones posteriores al último backup.
 */
export function necesitaBackup(
	ultimoBackup: string | undefined,
	fechasEntrenadas: string[],
	ahora = new Date()
): boolean {
	if (fechasEntrenadas.length === 0) return false;
	if (!ultimoBackup) {
		const primera = [...fechasEntrenadas].sort()[0]!;
		return diasDesde(`${primera}T00:00:00`, ahora) > DIAS_RECORDATORIO_BACKUP;
	}
	if (diasDesde(ultimoBackup, ahora) <= DIAS_RECORDATORIO_BACKUP) return false;
	const fechaBackup = new Date(ultimoBackup).toLocaleDateString('sv');
	return fechasEntrenadas.some((f) => f > fechaBackup);
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
					if (set.peso != null) {
						set.peso = convertirPeso(set.peso, a.unidad, unidad);
						cambio = true;
					}
					if (set.extraKg != null) {
						set.extraKg = convertirPeso(set.extraKg, a.unidad, unidad);
						cambio = true;
					}
				}
				// El umbral de PR ya celebrado se guarda en peso → convertir también.
				// En modo reps (sin peso) no hay nada que convertir.
				if (ejercicio.prCelebrado) {
					if (ejercicio.prCelebrado.peso != null) {
						ejercicio.prCelebrado.peso = convertirPeso(
							ejercicio.prCelebrado.peso,
							a.unidad,
							unidad
						);
						cambio = true;
					}
					if (ejercicio.prCelebrado.extraKg != null) {
						ejercicio.prCelebrado.extraKg = convertirPeso(
							ejercicio.prCelebrado.extraKg,
							a.unidad,
							unidad
						);
						cambio = true;
					}
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

function esDiaSemanaValido(n: unknown): n is number {
	return esNumero(n) && n >= 0 && n <= 6 && Number.isInteger(n);
}

function esDia(value: unknown): value is Dia {
	if (!esRecord(value)) return false;
	const ejercicios = value.ejercicios;
	return (
		esString(value.id) &&
		esString(value.nombre) &&
		(value.color === undefined || esString(value.color)) &&
		// legacy: backups viejos guardaban un único diaSemana → se tolera y se migra al importar.
		(value.diaSemana === undefined || esDiaSemanaValido(value.diaSemana)) &&
		(value.diasSemana === undefined ||
			(Array.isArray(value.diasSemana) && value.diasSemana.every(esDiaSemanaValido))) &&
		esNumero(value.orden) &&
		Array.isArray(ejercicios) &&
		ejercicios.every(
			(e) =>
				esRecord(e) && esString(e.exerciseId) && esNumero(e.seriesObjetivo) && esNumero(e.orden)
		)
	);
}

function esPrCelebrado(value: unknown): boolean {
	return (
		esRecord(value) &&
		(value.peso === undefined || esNumero(value.peso)) &&
		(value.reps === undefined || esNumero(value.reps)) &&
		(value.esMax === undefined || esBoolean(value.esMax)) &&
		(value.extraKg === undefined || esNumero(value.extraKg))
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
				(e.saltado === undefined || esBoolean(e.saltado)) &&
				(e.prCelebrado === undefined || esPrCelebrado(e.prCelebrado)) &&
				// legacy: backups viejos guardaban un escalar prPesoCelebrado → se tolera y se ignora.
				(e.prPesoCelebrado === undefined || esNumero(e.prPesoCelebrado)) &&
				e.sets.every(
					(set) =>
						esRecord(set) &&
						esBoolean(set.hecha) &&
						(set.peso === undefined || esNumero(set.peso)) &&
						(set.reps === undefined || esNumero(set.reps)) &&
						(set.esMax === undefined || esBoolean(set.esMax)) &&
						(set.extraKg === undefined || esNumero(set.extraKg))
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
		(value.sonido === undefined || esBoolean(value.sonido)) &&
		(value.vibracion === undefined || esBoolean(value.vibracion)) &&
		(value.descansoPantallaCompleta === undefined ||
			esBoolean(value.descansoPantallaCompleta)) &&
		(value.metricaPr === undefined || value.metricaPr === 'peso' || value.metricaPr === 'e1rm') &&
		(value.pasoPeso === undefined || esNumero(value.pasoPeso)) &&
		(value.ultimoBackup === undefined || esString(value.ultimoBackup)) &&
		(value.seedInicialHecho === undefined || esBoolean(value.seedInicialHecho))
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

/** Migra un día de backup viejo: diaSemana único → diasSemana[]. */
function normalizarDiaBackup(dia: Dia & { diaSemana?: number }): Dia {
	const { diaSemana, ...resto } = dia;
	if (diaSemana != null && resto.diasSemana == null) resto.diasSemana = [diaSemana];
	return resto;
}

/** Reemplaza TODOS los datos locales por los del backup (destructivo). */
export async function importarBackup(data: Backup): Promise<void> {
	await db.transaction('rw', db.dias, db.sesiones, db.notas, db.ajustes, async () => {
		await Promise.all([db.dias.clear(), db.sesiones.clear(), db.notas.clear(), db.ajustes.clear()]);
		if (data.dias?.length) await db.dias.bulkPut(data.dias.map(normalizarDiaBackup));
		if (data.sesiones?.length) await db.sesiones.bulkPut(data.sesiones);
		if (data.notas?.length) await db.notas.bulkPut(data.notas);
		if (data.ajustes?.length) await db.ajustes.bulkPut(data.ajustes.map(normalizarAjustes));
	});
}
