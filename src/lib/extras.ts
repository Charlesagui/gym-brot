import { liveQuery } from 'dexie';
import {
	conIndice,
	db,
	guardarSesion,
	type Dia,
	type Sesion,
	type Nota,
	type Ajustes,
	type MetricaPr
} from './db';
import { fechaCalendarioValida } from './fechas';

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
	unidad: 'kg',
	timer: { activo: true, minutos: 2 },
	sonido: true,
	vibracion: true,
	descansoPantallaCompleta: true,
	metricaPr: 'peso',
	pasoPeso: 5,
	pasosPesoEjercicio: {},
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
		pasosPesoEjercicio: a?.pasosPesoEjercicio ?? {},
		seedInicialHecho: a?.seedInicialHecho ?? AJUSTES_DEFAULT.seedInicialHecho
	};
}

export function ajustesObs() {
	return liveQuery(async () => normalizarAjustes(await db.ajustes.get('app')));
}

/**
 * Actualiza la única fila de ajustes a partir del estado persistido. Todas las
 * preferencias comparten esta vía para que dos toques rápidos (o dos pestañas) no
 * restauren campos viejos al hacer un `get + put` fuera de una transacción.
 */
async function actualizarAjustes(mutador: (ajustes: Ajustes) => void): Promise<void> {
	await db.transaction('rw', db.ajustes, async () => {
		const ajustes = normalizarAjustes(await db.ajustes.get('app'));
		mutador(ajustes);
		await db.ajustes.put(ajustes);
	});
}

export async function setTimer(activo: boolean, minutos: number): Promise<void> {
	await actualizarAjustes((a) => {
		a.timer = { activo, minutos };
	});
}

export async function setSonido(sonido: boolean): Promise<void> {
	await actualizarAjustes((a) => {
		a.sonido = sonido;
	});
}

export async function setVibracion(vibracion: boolean): Promise<void> {
	await actualizarAjustes((a) => {
		a.vibracion = vibracion;
	});
}

export async function setDescansoPantallaCompleta(
	descansoPantallaCompleta: boolean
): Promise<void> {
	await actualizarAjustes((a) => {
		a.descansoPantallaCompleta = descansoPantallaCompleta;
	});
}

export async function setMetricaPr(metricaPr: MetricaPr): Promise<void> {
	await actualizarAjustes((a) => {
		a.metricaPr = metricaPr;
	});
}

export async function setPasoPeso(pasoPeso: number): Promise<void> {
	await actualizarAjustes((a) => {
		a.pasoPeso = pasoPeso;
	});
}

/** Guarda o vuelve a automático el paso de un ejercicio, separado por kg/lb. */
export async function setPasoPesoEjercicio(
	exerciseId: string,
	unidad: Ajustes['unidad'],
	pasoPeso?: number
): Promise<void> {
	await actualizarAjustes((a) => {
		const todos = { ...(a.pasosPesoEjercicio ?? {}) };
		const ejercicio = { ...(todos[exerciseId] ?? {}) };
		if (pasoPeso == null) delete ejercicio[unidad];
		else ejercicio[unidad] = pasoPeso;
		if (Object.keys(ejercicio).length) todos[exerciseId] = ejercicio;
		else delete todos[exerciseId];
		a.pasosPesoEjercicio = todos;
	});
}

/** Registra que se exportó un backup recién: apaga el recordatorio por un tiempo. */
export async function registrarBackup(fecha = new Date()): Promise<void> {
	await actualizarAjustes((a) => {
		a.ultimoBackup = fecha.toISOString();
	});
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
	await db.transaction('rw', db.sesiones, db.ajustes, async () => {
		// La unidad debe leerse dentro de la misma transacción que convierte las
		// sesiones. Así una segunda llamada ve la unidad ya persistida y no vuelve a
		// convertir valores que la primera acabó de transformar.
		const a = normalizarAjustes(await db.ajustes.get('app'));
		if (a.unidad === unidad) {
			await db.ajustes.put(a);
			return;
		}
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
			if (cambio) await guardarSesion(sesion);
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
	// Las cuatro tablas tienen que representar el mismo instante: sin la
	// transacción de solo lectura un toque concurrente podía dejar, por ejemplo,
	// una rutina nueva apuntando a una sesión que todavía no entró al archivo.
	const { dias, sesiones, notas, ajustes } = await db.transaction(
		'r',
		db.dias,
		db.sesiones,
		db.notas,
		db.ajustes,
		async () => ({
			dias: await db.dias.toArray(),
			sesiones: await db.sesiones.toArray(),
			notas: await db.notas.toArray(),
			ajustes: await db.ajustes.toArray()
		})
	);
	return JSON.stringify(
		{
			app: 'gym-brot',
			version: 1,
			exportado: new Date().toISOString(),
			dias,
			// `exerciseIds` es un índice derivado de `ejercicios`: no viaja en el backup.
			// Lo recalcula `conIndice` al importar, así el archivo no carga datos redundantes
			// ni puede reinstalar un índice desfasado.
			sesiones: sesiones.map(({ exerciseIds: _exerciseIds, ...sesion }) => sesion),
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

function esNumeroNoNegativo(value: unknown): value is number {
	return esNumero(value) && value >= 0;
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
		esNumeroNoNegativo(value.orden) &&
		Array.isArray(ejercicios) &&
		ejercicios.every(
			(e) =>
				esRecord(e) &&
				esString(e.exerciseId) &&
				esNumeroNoNegativo(e.seriesObjetivo) &&
				esNumeroNoNegativo(e.orden)
		)
	);
}

function esPrCelebrado(value: unknown): boolean {
	return (
		esRecord(value) &&
		(value.peso === undefined || esNumeroNoNegativo(value.peso)) &&
		(value.reps === undefined || esNumeroNoNegativo(value.reps)) &&
		(value.esMax === undefined || esBoolean(value.esMax)) &&
		(value.extraKg === undefined || esNumeroNoNegativo(value.extraKg)) &&
		(value.setIndex === undefined ||
			(esNumeroNoNegativo(value.setIndex) && Number.isInteger(value.setIndex))) &&
		(value.metrica === undefined ||
			value.metrica === 'peso' ||
			value.metrica === 'e1rm' ||
			value.metrica === 'reps')
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
						(set.peso === undefined || esNumeroNoNegativo(set.peso)) &&
						(set.reps === undefined || esNumeroNoNegativo(set.reps)) &&
						(set.esMax === undefined || esBoolean(set.esMax)) &&
						(set.extraKg === undefined || esNumeroNoNegativo(set.extraKg))
				)
			);
		})
	);
}

function esNota(value: unknown): value is Nota {
	return esRecord(value) && esString(value.exerciseId) && esString(value.texto);
}

function esPasosPesoEjercicio(value: unknown): boolean {
	return (
		esRecord(value) &&
		Object.values(value).every(
			(pasos) =>
				esRecord(pasos) &&
				(pasos.kg === undefined || (esNumero(pasos.kg) && pasos.kg > 0)) &&
				(pasos.lb === undefined || (esNumero(pasos.lb) && pasos.lb > 0))
		)
	);
}

function esAjustes(value: unknown): value is Ajustes {
	if (!esRecord(value) || value.id !== 'app') return false;
	const timer = value.timer;
	// `darkMode` existió en backups viejos y no lo lee nadie: se tolera y se ignora.
	return (
		(value.unidad === 'kg' || value.unidad === 'lb') &&
		esRecord(timer) &&
		esBoolean(timer.activo) &&
		esNumeroNoNegativo(timer.minutos) &&
		(value.sonido === undefined || esBoolean(value.sonido)) &&
		(value.vibracion === undefined || esBoolean(value.vibracion)) &&
		(value.descansoPantallaCompleta === undefined || esBoolean(value.descansoPantallaCompleta)) &&
		(value.metricaPr === undefined || value.metricaPr === 'peso' || value.metricaPr === 'e1rm') &&
		(value.pasoPeso === undefined || esNumeroNoNegativo(value.pasoPeso)) &&
		(value.pasosPesoEjercicio === undefined || esPasosPesoEjercicio(value.pasosPesoEjercicio)) &&
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
	if (data.version !== undefined && (!esNumero(data.version) || data.version > 1)) {
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

export interface ImportPreparado {
	datos: Required<Pick<Backup, 'dias' | 'sesiones' | 'notas' | 'ajustes'>>;
	/** Qué se reparó o se descartó, para decírselo al usuario antes de confirmar. */
	avisos: string[];
}

function coincidePr(
	set: Sesion['ejercicios'][number]['sets'][number] | undefined,
	pr: NonNullable<Sesion['ejercicios'][number]['prCelebrado']>
): boolean {
	return (
		!!set?.hecha &&
		set.reps !== 0 &&
		set.peso === pr.peso &&
		set.reps === pr.reps &&
		!!set.esMax === !!pr.esMax &&
		(set.extraKg ?? 0) === (pr.extraKg ?? 0)
	);
}

/**
 * Los type guards de `parseBackup` validan formas, no coherencia. Un backup editado
 * a mano (o de otra app) puede traer una sesión cuyo `id` no sea `${fecha}__${diaId}`:
 * la app la mostraría en el historial pero nunca podría volver a escribirla, porque
 * `sesionId()` arma otro id. Acá se repara lo reparable y se descarta lo imposible,
 * dejando dicho qué pasó.
 */
export function prepararImport(data: Backup): ImportPreparado {
	const avisos: string[] = [];

	const dias: Dia[] = [];
	const idsDia = new Set<string>();
	let diasDuplicados = 0;
	for (const dia of data.dias ?? []) {
		if (idsDia.has(dia.id)) {
			diasDuplicados++;
			continue;
		}
		idsDia.add(dia.id);
		dias.push(normalizarDiaBackup(dia));
	}
	if (diasDuplicados) avisos.push(`${diasDuplicados} día(s) con id repetido: se ignoraron`);

	const sesiones: Sesion[] = [];
	const idsSesion = new Set<string>();
	let fechaInvalida = 0;
	let idReparado = 0;
	let colision = 0;
	let sinDia = 0;
	let prsReubicados = 0;
	let prsDescartados = 0;
	let seriesCeroReparadas = 0;
	for (const sesion of data.sesiones ?? []) {
		if (!fechaCalendarioValida(sesion.fecha)) {
			fechaInvalida++;
			continue;
		}
		const idEsperado = `${sesion.fecha}__${sesion.diaId}`;
		if (sesion.id !== idEsperado) idReparado++;
		if (idsSesion.has(idEsperado)) {
			colision++;
			continue;
		}
		idsSesion.add(idEsperado);
		if (!idsDia.has(sesion.diaId)) sinDia++;
		const ejercicios = sesion.ejercicios.map((ejercicio) => {
			// `prPesoCelebrado` existió antes del snapshot completo. Se acepta al parsear
			// backups viejos, pero nunca vuelve a entrar a la base actual.
			const { prPesoCelebrado: _legacy, ...actual } = ejercicio as typeof ejercicio & {
				prPesoCelebrado?: number;
			};
			const sets = actual.sets.map((set) => {
				if (set.reps !== 0) return set;
				seriesCeroReparadas++;
				return { ...set, reps: undefined, hecha: false };
			});
			const actualConSeries = { ...actual, sets };
			if (!actualConSeries.prCelebrado) return actualConSeries;

			const indiceGuardado = actualConSeries.prCelebrado.setIndex;
			const indice =
				indiceGuardado != null &&
				coincidePr(actualConSeries.sets[indiceGuardado], actualConSeries.prCelebrado)
					? indiceGuardado
					: actualConSeries.sets.findIndex((set) => coincidePr(set, actualConSeries.prCelebrado!));
			if (indice < 0) {
				prsDescartados++;
				return { ...actualConSeries, prCelebrado: undefined };
			}
			if (indiceGuardado !== indice) {
				prsReubicados++;
				return {
					...actualConSeries,
					prCelebrado: { ...actualConSeries.prCelebrado, setIndex: indice }
				};
			}
			return actualConSeries;
		});
		sesiones.push({ ...sesion, id: idEsperado, ejercicios });
	}
	if (fechaInvalida) avisos.push(`${fechaInvalida} sesión(es) con fecha inválida: se descartaron`);
	if (idReparado) avisos.push(`${idReparado} sesión(es) con id inconsistente: se corrigieron`);
	if (colision) avisos.push(`${colision} sesión(es) duplicadas: se conservó la primera`);
	if (sinDia) avisos.push(`${sinDia} sesión(es) apuntan a una rutina que no está en el backup`);
	if (prsReubicados) avisos.push(`${prsReubicados} PR(s) con índice antiguo: se reubicaron`);
	if (prsDescartados)
		avisos.push(`${prsDescartados} PR(s) sin una serie hecha que los respalde: se descartaron`);
	if (seriesCeroReparadas)
		avisos.push(`${seriesCeroReparadas} serie(s) con 0 reps: se marcaron pendientes`);

	const notas: Nota[] = [];
	const idsNota = new Set<string>();
	for (const nota of data.notas ?? []) {
		if (idsNota.has(nota.exerciseId)) continue;
		idsNota.add(nota.exerciseId);
		notas.push(nota);
	}

	const ajustesRecibidos = data.ajustes ?? [];
	if (ajustesRecibidos.length > 1)
		avisos.push(`${ajustesRecibidos.length - 1} ajuste(s) duplicados: se conservó el primero`);
	const ajustes = normalizarAjustes(ajustesRecibidos[0]);
	let ajustesReparados = false;
	if (!(ajustes.timer.minutos > 0)) {
		ajustes.timer.minutos = AJUSTES_DEFAULT.timer.minutos;
		ajustesReparados = true;
	}
	if (!(ajustes.pasoPeso > 0)) {
		ajustes.pasoPeso = AJUSTES_DEFAULT.pasoPeso;
		ajustesReparados = true;
	}
	if (ajustes.ultimoBackup && !Number.isFinite(Date.parse(ajustes.ultimoBackup))) {
		ajustes.ultimoBackup = undefined;
		ajustesReparados = true;
	}
	// Restaurar una lista de rutinas vacía es deliberado. Sin este flag, un backup
	// vacío y antiguo recibía las rutinas de ejemplo al recargar. Si sí trae días,
	// conservamos el valor original para que el ida y vuelta no altere datos sanos.
	if (dias.length === 0) ajustes.seedInicialHecho = true;
	if (ajustesRecibidos.length === 0)
		avisos.push('El backup no traía ajustes: se usaron los valores predeterminados');
	else if (ajustesReparados)
		avisos.push('Había ajustes inválidos: se repararon con valores seguros');

	return {
		datos: { dias, sesiones, notas, ajustes: [ajustes] },
		avisos
	};
}

/** Reemplaza TODOS los datos locales por los del backup (destructivo). */
export async function importarBackup(data: Backup): Promise<ImportPreparado['avisos']> {
	const { datos, avisos } = prepararImport(data);
	await db.transaction('rw', db.dias, db.sesiones, db.notas, db.ajustes, async () => {
		await Promise.all([db.dias.clear(), db.sesiones.clear(), db.notas.clear(), db.ajustes.clear()]);
		if (datos.dias.length) await db.dias.bulkPut(datos.dias);
		if (datos.sesiones.length) await db.sesiones.bulkPut(datos.sesiones.map(conIndice));
		if (datos.notas.length) await db.notas.bulkPut(datos.notas);
		if (datos.ajustes.length) await db.ajustes.bulkPut(datos.ajustes);
	});
	return avisos;
}

/** Borra todos los datos locales y deja la app como recién instalada. */
export async function borrarTodo(): Promise<void> {
	await db.transaction('rw', db.dias, db.sesiones, db.notas, db.ajustes, async () => {
		await Promise.all([db.dias.clear(), db.sesiones.clear(), db.notas.clear(), db.ajustes.clear()]);
	});
}
