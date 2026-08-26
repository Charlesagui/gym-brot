import { liveQuery } from 'dexie';
import { db, type ObjetivoEnergia } from './db';
import {
	calcularMantenimiento,
	calcularObjetivo,
	RITMOS,
	type Mantenimiento,
	type Meta,
	type Objetivo,
	type PerfilEnergia
} from './energia';
import { hoyCalendarioLocal } from './fechas';
import { capturarRevisionDatos, exigirRevisionDatos } from './revision-datos';

/**
 * Persistencia de los objetivos calóricos y las lecturas que alimentan el asistente.
 *
 * El objetivo vigente es siempre el último de la tabla: ver el comentario de `v11` en
 * db.ts. Acá no hay ninguna bandera que mantener sincronizada.
 *
 * Todas las lecturas de este módulo están acotadas por índice a propósito. La tabla de
 * pesos crece una fila por día y la de sesiones una por entrenamiento: traerlas enteras
 * para calcular un promedio de siete días es la deuda que ya arrastra la portada.
 */

/** Ventana del promedio de peso que prellena el asistente. */
export const DIAS_PESO_RECIENTE = 7;
/** Ventana sobre la que se estima la frecuencia semanal de entrenamiento. */
export const DIAS_FRECUENCIA = 28;

function fechaMenosDias(fecha: string, dias: number): string {
	const valor = new Date(`${fecha}T12:00:00`);
	valor.setDate(valor.getDate() - dias);
	return valor.toLocaleDateString('sv');
}

function nuevoId(creadoAt: string): string {
	return `${creadoAt}-${Math.random().toString(36).slice(2, 8)}`;
}

export function objetivosEnergiaObs() {
	return liveQuery(() => db.objetivosEnergia.orderBy('id').toArray());
}

/** El objetivo vigente, o `null` si nunca se calculó uno. */
export function objetivoVigenteObs() {
	return liveQuery(async () => (await db.objetivosEnergia.orderBy('id').last()) ?? null);
}

export async function objetivoVigente(): Promise<ObjetivoEnergia | null> {
	return (await db.objetivosEnergia.orderBy('id').last()) ?? null;
}

export interface EntradaObjetivo {
	perfil: PerfilEnergia;
	mantenimiento: Mantenimiento;
	objetivo: Objetivo;
	/** Id del objetivo que esta revisión reemplaza. */
	calibradoDe?: string;
}

/**
 * Guarda un objetivo nuevo, que pasa a ser el vigente por ser el más reciente.
 *
 * Va en transacción con el chequeo de revisión igual que el resto de las escrituras:
 * si mientras el usuario completaba el asistente otra pestaña restauró un backup, esta
 * escritura no puede aterrizar sobre datos que ya no son los que vio.
 */
export async function guardarObjetivo(
	entrada: EntradaObjetivo,
	creadoAt = new Date().toISOString()
): Promise<ObjetivoEnergia> {
	if (!Number.isFinite(Date.parse(creadoAt))) {
		throw new RangeError('La fecha de creación del objetivo no es válida.');
	}
	const fila: ObjetivoEnergia = {
		id: nuevoId(creadoAt),
		creadoAt,
		perfil: entrada.perfil,
		palEstimado: entrada.mantenimiento.pal.valor,
		categoriaPal: entrada.mantenimiento.pal.categoria,
		tdeeKcal: entrada.mantenimiento.tdee,
		sepvKcal: entrada.mantenimiento.sepv,
		meta: entrada.objetivo.meta,
		nivel: entrada.objetivo.nivel,
		ritmoPctSemana: entrada.objetivo.ritmoPctSemana,
		objetivoKcal: entrada.objetivo.objetivoKcal,
		proteinaG: entrada.objetivo.proteinaG,
		...(entrada.calibradoDe ? { calibradoDe: entrada.calibradoDe } : {})
	};

	const revision = capturarRevisionDatos();
	await db.transaction('rw', db.objetivosEnergia, async () => {
		exigirRevisionDatos(revision);
		await db.objetivosEnergia.put(fila);
	});
	return fila;
}

/** Calcula y guarda en un paso. Devuelve `null` si el perfil o la meta no son válidos. */
export async function calcularYGuardar(
	perfil: PerfilEnergia,
	meta: Meta,
	ritmoPctSemana: number,
	opciones: { calibradoDe?: string; creadoAt?: string } = {}
): Promise<ObjetivoEnergia | null> {
	const mantenimiento = calcularMantenimiento(perfil);
	if (mantenimiento.estado !== 'calculado') return null;
	const objetivo = calcularObjetivo(mantenimiento, meta, ritmoPctSemana);
	if (objetivo.estado !== 'calculado') return null;
	return guardarObjetivo(
		{ perfil, mantenimiento, objetivo, calibradoDe: opciones.calibradoDe },
		opciones.creadoAt
	);
}

/**
 * Borra toda la cadena de objetivos. Es la única forma de quedarse sin objetivo: borrar
 * solo el vigente dejaría al anterior en su lugar, que nadie pidió revivir.
 */
export async function borrarObjetivos(): Promise<void> {
	const revision = capturarRevisionDatos();
	await db.transaction('rw', db.objetivosEnergia, async () => {
		exigirRevisionDatos(revision);
		await db.objetivosEnergia.clear();
	});
}

/**
 * Guarda la revisión de un objetivo: el mismo destino y el mismo nivel, pero con el
 * mantenimiento que salió de la balanza y con el peso de hoy.
 *
 * El perfil se actualiza con el peso actual porque el objetivo nuevo es para el cuerpo
 * de ahora, no para el de hace un mes. El mantenimiento, en cambio, no se recalcula: se
 * usa el calibrado, que es el punto de todo esto.
 */
export async function guardarRevision(
	anterior: ObjetivoEnergia,
	tdeeCalibrado: number,
	pesoGramos: number,
	creadoAt = new Date().toISOString()
): Promise<ObjetivoEnergia | null> {
	const perfil: PerfilEnergia = { ...anterior.perfil, pesoGramos };
	const mantenimiento = calcularMantenimiento(perfil);
	if (mantenimiento.estado !== 'calculado') return null;

	const conTdeeMedido: Mantenimiento = { ...mantenimiento, tdee: tdeeCalibrado };
	const ritmo =
		anterior.meta === 'mantener' || anterior.nivel == null
			? 0
			: RITMOS[anterior.meta === 'bajar' ? 'bajar' : 'subir'][anterior.nivel];
	const objetivo = calcularObjetivo(conTdeeMedido, anterior.meta, ritmo);
	if (objetivo.estado !== 'calculado') return null;

	return guardarObjetivo(
		{ perfil, mantenimiento: conTdeeMedido, objetivo, calibradoDe: anterior.id },
		creadoAt
	);
}

/** Un eslabón concreto de la cadena, por su id. Lectura por clave primaria. */
export async function objetivoAnterior(id: string): Promise<ObjetivoEnergia | null> {
	return (await db.objetivosEnergia.get(id)) ?? null;
}

/** El perfil del último objetivo, para prellenar el asistente sin volver a preguntar. */
export async function perfilGuardado(): Promise<PerfilEnergia | null> {
	return (await objetivoVigente())?.perfil ?? null;
}

/**
 * Promedio de los pesos de los últimos días, en gramos. Amortigua el ruido diario de
 * medio kilo a un kilo: prellenar con la última medición hace que el objetivo dependa
 * de si esa mañana el usuario fue al baño antes o después de pesarse.
 */
export async function pesoRecienteGramos(
	dias = DIAS_PESO_RECIENTE,
	hoy = hoyCalendarioLocal()
): Promise<number | null> {
	const desde = fechaMenosDias(hoy, dias - 1);
	const pesos = await db.pesosCorporales.where('fecha').between(desde, hoy, true, true).toArray();
	if (pesos.length === 0) return null;
	const suma = pesos.reduce((total, peso) => total + peso.pesoGramos, 0);
	return Math.round(suma / pesos.length);
}

/**
 * Sesiones por semana en la ventana reciente, redondeadas al medio entrenamiento más
 * cercano. Es un prellenado, no un dato: el asistente lo muestra con su procedencia y
 * el usuario puede corregirlo.
 */
export async function frecuenciaSemanalReciente(
	dias = DIAS_FRECUENCIA,
	hoy = hoyCalendarioLocal()
): Promise<number> {
	const desde = fechaMenosDias(hoy, dias - 1);
	const fechas = await db.sesiones.where('fecha').between(desde, hoy, true, true).toArray();
	// Dos rutinas el mismo día son un día de entrenamiento, no dos.
	const diasEntrenados = new Set(
		fechas.filter((sesion) => sesion.diaTerminado).map((s) => s.fecha)
	);
	return Math.round(((diasEntrenados.size * 7) / dias) * 2) / 2;
}
