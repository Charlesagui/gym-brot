import { liveQuery } from 'dexie';
import {
	conIndice,
	db,
	type Dia,
	type Sesion,
	type Nota,
	type Ajustes,
	type MetricaPr,
	type ModoEsfuerzo,
	type ObjetivoEnergia,
	type PesoCorporal
} from './db';
import { fechaCalendarioValida, hoyCalendarioLocal } from './fechas';
import { PESO_CORPORAL_MAX_GRAMOS, PESO_CORPORAL_MIN_GRAMOS } from './peso-corporal';
import { rirValido } from './esfuerzo';
import { coincideConPr, repeticionesValidas, serieCompleta } from './sesion-reglas';
import {
	CATEGORIAS_VALIDAS,
	DENSIDADES_VALIDAS,
	DURACIONES_VALIDAS,
	ECUACIONES,
	METAS_VALIDAS,
	NIVELES_VALIDOS,
	OCUPACIONES_VALIDAS,
	PASOS_VALIDOS
} from './energia';
import { conPesoCanonico } from './unidades';
import {
	anunciarReemplazoDatos,
	capturarRevisionDatos,
	exigirRevisionDatos,
	invalidarEscriturasPendientes
} from './revision-datos';

// --- Notas por ejercicio ---

export function notaObs(exerciseId: string) {
	return liveQuery(() => db.notas.get(exerciseId));
}

export async function setNota(exerciseId: string, texto: string): Promise<void> {
	const revision = capturarRevisionDatos();
	await db.transaction('rw', db.notas, async () => {
		exigirRevisionDatos(revision);
		if (texto.trim()) await db.notas.put({ exerciseId, texto: texto.trim() });
		else await db.notas.delete(exerciseId);
	});
}

// --- Ajustes (timer de descanso, unidad, etc.) ---

export const AJUSTES_DEFAULT: Ajustes = {
	id: 'app',
	unidad: 'kg',
	timer: { activo: true, minutos: 2 },
	sonido: true,
	sonidoLogros: true,
	volumen: 1,
	vibracion: true,
	descansoPantallaCompleta: true,
	ejercicioPantallaEncendida: true,
	metricaPr: 'peso',
	metricasPrEjercicio: {},
	modoEsfuerzo: 'off',
	pasoPeso: 5,
	pasosPesoEjercicio: {},
	descansosEjercicio: {},
	seedInicialHecho: false,
	snapshotsCompletados: false
};

/** Volúmenes ofrecidos. Ninguno es 0: para silenciar están los interruptores. */
export const VOLUMENES = [
	{ valor: 0.35, label: 'Bajo' },
	{ valor: 0.7, label: 'Medio' },
	{ valor: 1, label: 'Alto' }
] as const;

function volumenValido(volumen: unknown): volumen is number {
	return typeof volumen === 'number' && Number.isFinite(volumen) && volumen > 0 && volumen <= 1;
}

export function normalizarAjustes(a?: Ajustes | null): Ajustes {
	return {
		...AJUSTES_DEFAULT,
		...(a ?? {}),
		timer: { ...AJUSTES_DEFAULT.timer, ...(a?.timer ?? {}) },
		sonido: a?.sonido ?? AJUSTES_DEFAULT.sonido,
		// Los ajustes anteriores a la separación de canales no traen `sonidoLogros`:
		// heredan el maestro, así nadie se queda de golpe sin el beep que ya tenía.
		sonidoLogros: a?.sonidoLogros ?? a?.sonido ?? AJUSTES_DEFAULT.sonidoLogros,
		volumen: volumenValido(a?.volumen) ? a!.volumen : AJUSTES_DEFAULT.volumen,
		vibracion: a?.vibracion ?? AJUSTES_DEFAULT.vibracion,
		descansoPantallaCompleta:
			a?.descansoPantallaCompleta ?? AJUSTES_DEFAULT.descansoPantallaCompleta,
		ejercicioPantallaEncendida:
			a?.ejercicioPantallaEncendida ?? AJUSTES_DEFAULT.ejercicioPantallaEncendida,
		metricaPr: a?.metricaPr ?? AJUSTES_DEFAULT.metricaPr,
		metricasPrEjercicio: a?.metricasPrEjercicio ?? {},
		modoEsfuerzo: a?.modoEsfuerzo ?? 'off',
		pasoPeso: a?.pasoPeso ?? AJUSTES_DEFAULT.pasoPeso,
		pasosPesoEjercicio: a?.pasosPesoEjercicio ?? {},
		descansosEjercicio: a?.descansosEjercicio ?? {},
		seedInicialHecho: a?.seedInicialHecho ?? AJUSTES_DEFAULT.seedInicialHecho,
		snapshotsCompletados: a?.snapshotsCompletados ?? AJUSTES_DEFAULT.snapshotsCompletados
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
	const revision = capturarRevisionDatos();
	await db.transaction('rw', db.ajustes, async () => {
		exigirRevisionDatos(revision);
		const ajustes = normalizarAjustes(await db.ajustes.get('app'));
		mutador(ajustes);
		await db.ajustes.put(ajustes);
	});
}

export async function setTimer(activo: boolean, minutos: number): Promise<void> {
	if (!Number.isFinite(minutos) || minutos <= 0)
		throw new RangeError('El descanso debe ser un número positivo de minutos.');
	await actualizarAjustes((a) => {
		a.timer = { activo, minutos };
	});
}

export async function setSonido(sonido: boolean): Promise<void> {
	await actualizarAjustes((a) => {
		a.sonido = sonido;
	});
}

export async function toggleSonido(): Promise<void> {
	await actualizarAjustes((a) => {
		a.sonido = !a.sonido;
	});
}

export async function toggleSonidoLogros(): Promise<void> {
	await actualizarAjustes((a) => {
		a.sonidoLogros = !a.sonidoLogros;
	});
}

export async function setVolumen(volumen: number): Promise<void> {
	if (!volumenValido(volumen))
		throw new RangeError('El volumen debe estar entre 0 (exclusivo) y 1.');
	await actualizarAjustes((a) => {
		a.volumen = volumen;
	});
}

export async function setVibracion(vibracion: boolean): Promise<void> {
	await actualizarAjustes((a) => {
		a.vibracion = vibracion;
	});
}

export async function toggleVibracion(): Promise<void> {
	await actualizarAjustes((a) => {
		a.vibracion = !a.vibracion;
	});
}

export async function setDescansoPantallaCompleta(
	descansoPantallaCompleta: boolean
): Promise<void> {
	await actualizarAjustes((a) => {
		a.descansoPantallaCompleta = descansoPantallaCompleta;
	});
}

export async function toggleDescansoPantallaCompleta(): Promise<void> {
	await actualizarAjustes((a) => {
		a.descansoPantallaCompleta = !a.descansoPantallaCompleta;
	});
}

export async function toggleEjercicioPantallaEncendida(): Promise<void> {
	await actualizarAjustes((a) => {
		a.ejercicioPantallaEncendida = !a.ejercicioPantallaEncendida;
	});
}

export async function setMetricaPr(metricaPr: MetricaPr): Promise<void> {
	await actualizarAjustes((a) => {
		a.metricaPr = metricaPr;
	});
}

/** Guarda o elimina la métrica propia de un ejercicio. */
export async function setMetricaPrEjercicio(
	exerciseId: string,
	metricaPr?: MetricaPr
): Promise<void> {
	await actualizarAjustes((a) => {
		const metricas = { ...(a.metricasPrEjercicio ?? {}) };
		if (metricaPr == null) delete metricas[exerciseId];
		else metricas[exerciseId] = metricaPr;
		a.metricasPrEjercicio = metricas;
	});
}

export async function setModoEsfuerzo(modoEsfuerzo: ModoEsfuerzo): Promise<void> {
	await actualizarAjustes((a) => {
		a.modoEsfuerzo = modoEsfuerzo;
	});
}

export async function setMetaPesoGramos(metaPesoGramos?: number): Promise<void> {
	if (
		metaPesoGramos != null &&
		(!Number.isInteger(metaPesoGramos) ||
			metaPesoGramos < PESO_CORPORAL_MIN_GRAMOS ||
			metaPesoGramos > PESO_CORPORAL_MAX_GRAMOS)
	) {
		throw new RangeError('La meta de peso debe estar entre 20 y 500 kg.');
	}
	await actualizarAjustes((a) => {
		a.metaPesoGramos = metaPesoGramos;
	});
}

export async function setPasoPeso(pasoPeso: number): Promise<void> {
	if (!Number.isFinite(pasoPeso) || pasoPeso <= 0)
		throw new RangeError('El paso de peso debe ser un número positivo.');
	await actualizarAjustes((a) => {
		a.pasoPeso = pasoPeso;
	});
}

/**
 * Guarda o vuelve a automático el descanso de un ejercicio. `0` lo apaga solo acá;
 * `undefined` borra la sobrescritura y devuelve el ejercicio al descanso general.
 */
export async function setDescansoEjercicio(exerciseId: string, minutos?: number): Promise<void> {
	if (minutos != null && (!Number.isFinite(minutos) || minutos < 0))
		throw new RangeError('El descanso del ejercicio no puede ser negativo.');
	await actualizarAjustes((a) => {
		const todos = { ...(a.descansosEjercicio ?? {}) };
		if (minutos == null) delete todos[exerciseId];
		else todos[exerciseId] = minutos;
		a.descansosEjercicio = todos;
	});
}

/** Guarda o vuelve a automático el paso de un ejercicio, separado por kg/lb. */
export async function setPasoPesoEjercicio(
	exerciseId: string,
	unidad: Ajustes['unidad'],
	pasoPeso?: number
): Promise<void> {
	if (pasoPeso != null && (!Number.isFinite(pasoPeso) || pasoPeso <= 0))
		throw new RangeError('El paso de peso debe ser un número positivo.');
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

export async function setUnidad(unidad: 'kg' | 'lb'): Promise<void> {
	// La unidad es presentación. Los pesos canónicos permanecen intactos, por lo que
	// alternar muchas veces no degrada el historial con redondeos acumulativos.
	await actualizarAjustes((ajustes) => {
		ajustes.unidad = unidad;
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
	pesosCorporales?: PesoCorporal[];
	objetivosEnergia?: ObjetivoEnergia[];
}

export async function exportarJSON(): Promise<string> {
	// Las cuatro tablas tienen que representar el mismo instante: sin la
	// transacción de solo lectura un toque concurrente podía dejar, por ejemplo,
	// una rutina nueva apuntando a una sesión que todavía no entró al archivo.
	const { dias, sesiones, notas, ajustes, pesosCorporales, objetivosEnergia } =
		await db.transaction(
			'r',
			// Con más de cinco tablas hay que usar la forma con arreglo: las sobrecargas
			// de Dexie con tablas sueltas llegan hasta cinco.
			[db.dias, db.sesiones, db.notas, db.ajustes, db.pesosCorporales, db.objetivosEnergia],
			async () => ({
				dias: await db.dias.toArray(),
				sesiones: await db.sesiones.toArray(),
				notas: await db.notas.toArray(),
				ajustes: await db.ajustes.toArray(),
				pesosCorporales: await db.pesosCorporales.toArray(),
				objetivosEnergia: await db.objetivosEnergia.toArray()
			})
		);
	return JSON.stringify(
		{
			app: 'gym-brot',
			// v3 agrega objetivosEnergia. Un backup v2 sigue importándose sin la tabla.
			version: 3,
			exportado: new Date().toISOString(),
			dias,
			// `exerciseIds` es un índice derivado de `ejercicios`: no viaja en el backup.
			// Lo recalcula `conIndice` al importar, así el archivo no carga datos redundantes
			// ni puede reinstalar un índice desfasado.
			sesiones: sesiones.map(({ exerciseIds: _exerciseIds, ...sesion }) => sesion),
			notas,
			ajustes: ajustes.map(normalizarAjustes),
			pesosCorporales,
			objetivosEnergia
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

function esEnteroNoNegativo(value: unknown): value is number {
	return esNumeroNoNegativo(value) && Number.isInteger(value);
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
		esEnteroNoNegativo(value.orden) &&
		Array.isArray(ejercicios) &&
		ejercicios.every(
			(e) =>
				esRecord(e) &&
				esString(e.exerciseId) &&
				esEnteroNoNegativo(e.seriesObjetivo) &&
				esEnteroNoNegativo(e.orden)
		)
	);
}

function esPrCelebrado(value: unknown): boolean {
	return (
		esRecord(value) &&
		(value.peso === undefined || esNumeroNoNegativo(value.peso)) &&
		(value.pesoGramos === undefined || esEnteroNoNegativo(value.pesoGramos)) &&
		(value.reps === undefined ||
			(esNumeroNoNegativo(value.reps) && Number.isInteger(value.reps))) &&
		(value.esMax === undefined || esBoolean(value.esMax)) &&
		(value.extraKg === undefined || esNumeroNoNegativo(value.extraKg)) &&
		(value.extraGramos === undefined || esEnteroNoNegativo(value.extraGramos)) &&
		(value.setIndex === undefined ||
			(esNumeroNoNegativo(value.setIndex) && Number.isInteger(value.setIndex))) &&
		(value.metrica === undefined ||
			value.metrica === 'peso' ||
			value.metrica === 'e1rm' ||
			value.metrica === 'reps')
	);
}

function esPlanSesion(value: unknown): boolean {
	return (
		esRecord(value) && esEnteroNoNegativo(value.ejercicios) && esEnteroNoNegativo(value.series)
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
		(value.diaTerminadoConPendientes === undefined || esBoolean(value.diaTerminadoConPendientes)) &&
		// Un plan con basura adentro no es un dato raro que se muestra tal cual: es el
		// denominador de "4 de 12 series" y de la calidad del día. Se exige entero no
		// negativo o no entra.
		(value.plan === undefined || esPlanSesion(value.plan)) &&
		(value.reaperturaMotivo === undefined || esString(value.reaperturaMotivo)) &&
		(value.reaperturaAt === undefined || esString(value.reaperturaAt)) &&
		(value.diaNombre === undefined || esString(value.diaNombre)) &&
		(value.ordenEnDia === undefined ||
			(esNumeroNoNegativo(value.ordenEnDia) && Number.isInteger(value.ordenEnDia))) &&
		Array.isArray(ejercicios) &&
		ejercicios.every((e) => {
			if (!esRecord(e) || !esString(e.exerciseId) || !Array.isArray(e.sets)) return false;
			return (
				(e.nombreSnapshot === undefined || esString(e.nombreSnapshot)) &&
				(e.saltado === undefined || esBoolean(e.saltado)) &&
				(e.prCelebrado === undefined || esPrCelebrado(e.prCelebrado)) &&
				// legacy: backups viejos guardaban un escalar prPesoCelebrado → se tolera y se ignora.
				(e.prPesoCelebrado === undefined || esNumero(e.prPesoCelebrado)) &&
				e.sets.every(
					(set) =>
						esRecord(set) &&
						esBoolean(set.hecha) &&
						(set.peso === undefined || esNumeroNoNegativo(set.peso)) &&
						(set.pesoGramos === undefined || esEnteroNoNegativo(set.pesoGramos)) &&
						(set.reps === undefined ||
							(esNumeroNoNegativo(set.reps) && Number.isInteger(set.reps))) &&
						(set.esMax === undefined || esBoolean(set.esMax)) &&
						(set.extraKg === undefined || esNumeroNoNegativo(set.extraKg)) &&
						(set.extraGramos === undefined || esEnteroNoNegativo(set.extraGramos)) &&
						(set.rir === undefined || esNumero(set.rir))
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

function esDescansosEjercicio(value: unknown): boolean {
	// 0 es válido a propósito: significa "sin descanso en este ejercicio".
	return esRecord(value) && Object.values(value).every((minutos) => esNumeroNoNegativo(minutos));
}

function esMetricasPrEjercicio(value: unknown): boolean {
	return (
		esRecord(value) &&
		Object.values(value).every((metrica) => metrica === 'peso' || metrica === 'e1rm')
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
		(value.sonidoLogros === undefined || esBoolean(value.sonidoLogros)) &&
		(value.volumen === undefined || esNumeroNoNegativo(value.volumen)) &&
		(value.vibracion === undefined || esBoolean(value.vibracion)) &&
		(value.descansoPantallaCompleta === undefined || esBoolean(value.descansoPantallaCompleta)) &&
		(value.ejercicioPantallaEncendida === undefined ||
			esBoolean(value.ejercicioPantallaEncendida)) &&
		(value.metricaPr === undefined || value.metricaPr === 'peso' || value.metricaPr === 'e1rm') &&
		(value.metricasPrEjercicio === undefined || esMetricasPrEjercicio(value.metricasPrEjercicio)) &&
		(value.modoEsfuerzo === undefined ||
			value.modoEsfuerzo === 'off' ||
			value.modoEsfuerzo === 'rir' ||
			value.modoEsfuerzo === 'rpe') &&
		(value.metaPesoGramos === undefined || esEnteroNoNegativo(value.metaPesoGramos)) &&
		(value.pasoPeso === undefined || esNumeroNoNegativo(value.pasoPeso)) &&
		(value.pasosPesoEjercicio === undefined || esPasosPesoEjercicio(value.pasosPesoEjercicio)) &&
		(value.descansosEjercicio === undefined || esDescansosEjercicio(value.descansosEjercicio)) &&
		(value.ultimoBackup === undefined || esString(value.ultimoBackup)) &&
		(value.seedInicialHecho === undefined || esBoolean(value.seedInicialHecho)) &&
		(value.snapshotsCompletados === undefined || esBoolean(value.snapshotsCompletados))
	);
}

function esPesoCorporal(value: unknown): value is PesoCorporal {
	return (
		esRecord(value) &&
		esString(value.fecha) &&
		esNumero(value.pesoGramos) &&
		Number.isInteger(value.pesoGramos) &&
		value.pesoGramos >= PESO_CORPORAL_MIN_GRAMOS &&
		value.pesoGramos <= PESO_CORPORAL_MAX_GRAMOS &&
		esString(value.registradoAt) &&
		Number.isFinite(Date.parse(value.registradoAt))
	);
}

function esDe<T extends string>(valores: readonly T[], value: unknown): value is T {
	return esString(value) && (valores as readonly string[]).includes(value);
}

function esPerfilEnergia(value: unknown): boolean {
	return (
		esRecord(value) &&
		esNumero(value.edad) &&
		esNumero(value.alturaCm) &&
		esEnteroNoNegativo(value.pesoGramos) &&
		esNumeroNoNegativo(value.sesionesSemana) &&
		esDe(ECUACIONES, value.ecuacion) &&
		esDe(OCUPACIONES_VALIDAS, value.ocupacion) &&
		esDe(PASOS_VALIDOS, value.pasos) &&
		esDe(DURACIONES_VALIDAS, value.duracion) &&
		esDe(DENSIDADES_VALIDAS, value.densidad)
	);
}

/**
 * Los valores de cada unión se validan uno por uno, no alcanza con que sean strings.
 * El perfil no es un dato que solo se muestra: alimenta `estimarPal` en cada revisión,
 * y una ocupación desconocida ahí es un `undefined.pasosBase` que rompe el asistente
 * hasta que el usuario borre todo. El caso real no es un JSON editado a mano: es un
 * backup escrito por una versión más nueva de la app.
 */
function esObjetivoEnergia(value: unknown): value is ObjetivoEnergia {
	return (
		esRecord(value) &&
		esString(value.id) &&
		esString(value.creadoAt) &&
		Number.isFinite(Date.parse(value.creadoAt)) &&
		esPerfilEnergia(value.perfil) &&
		esNumeroNoNegativo(value.palEstimado) &&
		esDe(CATEGORIAS_VALIDAS, value.categoriaPal) &&
		esNumeroNoNegativo(value.tdeeKcal) &&
		esNumeroNoNegativo(value.sepvKcal) &&
		esDe(METAS_VALIDAS, value.meta) &&
		(value.nivel === null || value.nivel === undefined || esDe(NIVELES_VALIDOS, value.nivel)) &&
		esNumero(value.ritmoPctSemana) &&
		esNumeroNoNegativo(value.objetivoKcal) &&
		esNumeroNoNegativo(value.proteinaG) &&
		(value.calibradoDe === undefined || esString(value.calibradoDe))
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
	if (texto.length > 25 * 1024 * 1024) throw new Error('El backup supera el límite de 25 MB');
	const data = JSON.parse(texto) as unknown;
	if (!esRecord(data) || data.app !== 'gym-brot') {
		throw new Error('No parece un backup de gym-brot');
	}
	if (data.version !== undefined && (!esNumero(data.version) || data.version > 3)) {
		throw new Error('Backup inválido: version');
	}
	if (data.exportado !== undefined && !esString(data.exportado)) {
		throw new Error('Backup inválido: exportado');
	}
	for (const nombre of ['dias', 'sesiones', 'notas', 'ajustes'] as const) {
		if (!Array.isArray(data[nombre])) throw new Error(`Backup inválido: ${nombre}`);
	}
	// v1 no tenía seguimiento de peso corporal.
	if (data.pesosCorporales !== undefined && !Array.isArray(data.pesosCorporales))
		throw new Error('Backup inválido: pesosCorporales');
	// v1 y v2 no tenían objetivos calóricos.
	if (data.objetivosEnergia !== undefined && !Array.isArray(data.objetivosEnergia))
		throw new Error('Backup inválido: objetivosEnergia');
	if ((data.dias as unknown[]).length > 1_000)
		throw new Error('Backup inválido: demasiadas rutinas');
	if ((data.sesiones as unknown[]).length > 50_000)
		throw new Error('Backup inválido: demasiadas sesiones');
	if ((data.notas as unknown[]).length > 10_000)
		throw new Error('Backup inválido: demasiadas notas');
	if ((data.pesosCorporales as unknown[] | undefined)?.length! > 50_000)
		throw new Error('Backup inválido: demasiados pesos corporales');
	if ((data.objetivosEnergia as unknown[] | undefined)?.length! > 10_000)
		throw new Error('Backup inválido: demasiados objetivos');
	validarLista(data, 'dias', esDia);
	validarLista(data, 'sesiones', esSesion);
	validarLista(data, 'notas', esNota);
	validarLista(data, 'ajustes', esAjustes);
	if (data.pesosCorporales !== undefined) validarLista(data, 'pesosCorporales', esPesoCorporal);
	if (data.objetivosEnergia !== undefined)
		validarLista(data, 'objetivosEnergia', esObjetivoEnergia);
	return data as Backup;
}

/** Migra un día de backup viejo: diaSemana único → diasSemana[]. */
function normalizarDiaBackup(dia: Dia & { diaSemana?: number }): Dia {
	const { diaSemana, ...resto } = dia;
	if (diaSemana != null && resto.diasSemana == null) resto.diasSemana = [diaSemana];
	return resto;
}

export interface ImportPreparado {
	datos: Required<
		Pick<Backup, 'dias' | 'sesiones' | 'notas' | 'ajustes' | 'pesosCorporales' | 'objetivosEnergia'>
	>;
	/** Qué se reparó o se descartó, para decírselo al usuario antes de confirmar. */
	avisos: string[];
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

	const ajustesRecibidos = data.ajustes ?? [];
	if (ajustesRecibidos.length > 1)
		avisos.push(`${ajustesRecibidos.length - 1} ajuste(s) duplicados: se conservó el primero`);
	const ajustes = normalizarAjustes(ajustesRecibidos[0]);

	const sesiones: Sesion[] = [];
	const idsSesion = new Set<string>();
	let fechaInvalida = 0;
	let idReparado = 0;
	let colision = 0;
	let sinDia = 0;
	let prsReubicados = 0;
	let prsDescartados = 0;
	let seriesInvalidasReparadas = 0;
	let esfuerzosInvalidosReparados = 0;
	let ejerciciosDuplicados = 0;
	let seriesTruncadas = 0;
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
		const idsEjercicio = new Set<string>();
		const ejercicios = sesion.ejercicios
			.filter((ejercicio) => {
				if (idsEjercicio.has(ejercicio.exerciseId)) {
					ejerciciosDuplicados++;
					return false;
				}
				idsEjercicio.add(ejercicio.exerciseId);
				return true;
			})
			.map((ejercicio) => {
				// `prPesoCelebrado` existió antes del snapshot completo. Se acepta al parsear
				// backups viejos, pero nunca vuelve a entrar a la base actual.
				const { prPesoCelebrado: _legacy, ...actual } = ejercicio as typeof ejercicio & {
					prPesoCelebrado?: number;
				};
				if (actual.sets.length > 500) seriesTruncadas += actual.sets.length - 500;
				const sets = actual.sets.slice(0, 500).map((set) => {
					let reparado = conPesoCanonico(set, ajustes.unidad);
					if (reparado.rir != null && !rirValido(reparado.rir)) {
						const { rir: _rirInvalido, ...sinRir } = reparado;
						reparado = sinRir;
						esfuerzosInvalidosReparados++;
					}
					if (!reparado.hecha || repeticionesValidas(reparado.reps)) return reparado;
					seriesInvalidasReparadas++;
					return { ...reparado, reps: undefined, hecha: false };
				});
				const actualConSeries = {
					...actual,
					sets,
					prCelebrado: actual.prCelebrado
						? conPesoCanonico(actual.prCelebrado, ajustes.unidad)
						: undefined
				};
				if (!actualConSeries.prCelebrado) return actualConSeries;

				const indiceGuardado = actualConSeries.prCelebrado.setIndex;
				const indice =
					indiceGuardado != null &&
					coincideConPr(actualConSeries.sets[indiceGuardado], actualConSeries.prCelebrado)
						? indiceGuardado
						: actualConSeries.sets.findIndex((set) =>
								coincideConPr(set, actualConSeries.prCelebrado!)
							);
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
	if (seriesInvalidasReparadas)
		avisos.push(
			`${seriesInvalidasReparadas} serie(s) sin repeticiones válidas: se marcaron pendientes`
		);
	if (esfuerzosInvalidosReparados)
		avisos.push(
			`${esfuerzosInvalidosReparados} valor(es) RIR inválidos: se eliminaron de las series`
		);
	if (ejerciciosDuplicados)
		avisos.push(
			`${ejerciciosDuplicados} ejercicio(s) duplicados dentro de una sesión: se ignoraron`
		);
	if (seriesTruncadas)
		avisos.push(`${seriesTruncadas} serie(s) por encima del límite de 500: se ignoraron`);

	const sesionesPorFecha = new Map<string, Sesion[]>();
	for (const sesion of sesiones) {
		const grupo = sesionesPorFecha.get(sesion.fecha) ?? [];
		grupo.push(sesion);
		sesionesPorFecha.set(sesion.fecha, grupo);
	}
	for (const grupo of sesionesPorFecha.values()) {
		grupo.sort((a, b) => {
			const ordenA =
				a.ordenEnDia != null && Number.isInteger(a.ordenEnDia)
					? a.ordenEnDia
					: Number.MAX_SAFE_INTEGER;
			const ordenB =
				b.ordenEnDia != null && Number.isInteger(b.ordenEnDia)
					? b.ordenEnDia
					: Number.MAX_SAFE_INTEGER;
			if (ordenA !== ordenB) return ordenA - ordenB;
			const finA = a.diaTerminadoAt ? Date.parse(a.diaTerminadoAt) : Number.NaN;
			const finB = b.diaTerminadoAt ? Date.parse(b.diaTerminadoAt) : Number.NaN;
			if (Number.isFinite(finA) && Number.isFinite(finB) && finA !== finB) return finA - finB;
			return a.id.localeCompare(b.id);
		});
		grupo.forEach((sesion, ordenEnDia) => (sesion.ordenEnDia = ordenEnDia));
	}

	const notas: Nota[] = [];
	const idsNota = new Set<string>();
	for (const nota of data.notas ?? []) {
		if (idsNota.has(nota.exerciseId)) continue;
		idsNota.add(nota.exerciseId);
		notas.push(nota);
	}

	const pesosCorporales: PesoCorporal[] = [];
	const fechasPeso = new Set<string>();
	let pesosDuplicados = 0;
	let pesosFechaInvalida = 0;
	let pesosFechaFutura = 0;
	const hoy = hoyCalendarioLocal();
	for (const peso of data.pesosCorporales ?? []) {
		// La fecha es la clave de la tabla: una que no existe en el calendario desordena el
		// historial, envenena el peso actual y los cambios de 7/30 días, y llega al gráfico.
		// Se descarta igual que una sesión con fecha imposible.
		if (!fechaCalendarioValida(peso.fecha)) {
			pesosFechaInvalida++;
			continue;
		}
		if (peso.fecha > hoy) {
			pesosFechaFutura++;
			continue;
		}
		if (fechasPeso.has(peso.fecha)) {
			pesosDuplicados++;
			continue;
		}
		fechasPeso.add(peso.fecha);
		pesosCorporales.push(peso);
	}
	if (pesosFechaInvalida)
		avisos.push(`${pesosFechaInvalida} medición(es) de peso con fecha inválida: se descartaron`);
	if (pesosFechaFutura)
		avisos.push(`${pesosFechaFutura} medición(es) de peso con fecha futura: se descartaron`);
	if (pesosDuplicados)
		avisos.push(`${pesosDuplicados} medición(es) de peso repetidas: se conservó la primera`);

	// El objetivo vigente es el de id más alto, así que un id repetido no es solo una
	// fila de más: puede tapar al vigente o resucitar a uno viejo.
	const objetivosEnergia: ObjetivoEnergia[] = [];
	const idsObjetivo = new Set<string>();
	let objetivosDuplicados = 0;
	for (const objetivo of data.objetivosEnergia ?? []) {
		if (idsObjetivo.has(objetivo.id)) {
			objetivosDuplicados++;
			continue;
		}
		idsObjetivo.add(objetivo.id);
		objetivosEnergia.push(objetivo);
	}
	if (objetivosDuplicados)
		avisos.push(`${objetivosDuplicados} objetivo(s) con id repetido: se ignoraron`);

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
	if (
		ajustes.metaPesoGramos != null &&
		(!Number.isInteger(ajustes.metaPesoGramos) ||
			ajustes.metaPesoGramos < PESO_CORPORAL_MIN_GRAMOS ||
			ajustes.metaPesoGramos > PESO_CORPORAL_MAX_GRAMOS)
	) {
		ajustes.metaPesoGramos = undefined;
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
		datos: { dias, sesiones, notas, ajustes: [ajustes], pesosCorporales, objetivosEnergia },
		avisos
	};
}

/** Reemplaza TODOS los datos locales por los del backup (destructivo). */
export async function importarBackup(data: Backup): Promise<ImportPreparado['avisos']> {
	const { datos, avisos } = prepararImport(data);
	invalidarEscriturasPendientes();
	await db.transaction(
		'rw',
		[db.dias, db.sesiones, db.notas, db.ajustes, db.pesosCorporales, db.objetivosEnergia],
		async () => {
			await Promise.all([
				db.dias.clear(),
				db.sesiones.clear(),
				db.notas.clear(),
				db.ajustes.clear(),
				db.pesosCorporales.clear(),
				db.objetivosEnergia.clear()
			]);
			if (datos.dias.length) await db.dias.bulkPut(datos.dias);
			if (datos.sesiones.length) await db.sesiones.bulkPut(datos.sesiones.map(conIndice));
			if (datos.notas.length) await db.notas.bulkPut(datos.notas);
			if (datos.ajustes.length) await db.ajustes.bulkPut(datos.ajustes);
			if (datos.pesosCorporales.length) await db.pesosCorporales.bulkPut(datos.pesosCorporales);
			if (datos.objetivosEnergia.length) await db.objetivosEnergia.bulkPut(datos.objetivosEnergia);
		}
	);
	anunciarReemplazoDatos();
	return avisos;
}

/** Borra todos los datos locales y deja la app como recién instalada. */
export async function borrarTodo(): Promise<void> {
	invalidarEscriturasPendientes();
	await db.transaction(
		'rw',
		[db.dias, db.sesiones, db.notas, db.ajustes, db.pesosCorporales, db.objetivosEnergia],
		async () => {
			await Promise.all([
				db.dias.clear(),
				db.sesiones.clear(),
				db.notas.clear(),
				db.ajustes.clear(),
				db.pesosCorporales.clear(),
				db.objetivosEnergia.clear()
			]);
		}
	);
	anunciarReemplazoDatos();
}
