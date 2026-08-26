import { db, guardarSesion, VIOLETA_RUTINA, type Dia } from './db';
import { capturarRevisionDatos, exigirRevisionDatos } from './revision-datos';
import { reabrirSesion } from './sesion-reglas';
import { ejercicioPorId } from './catalog';

/** Paleta de colores para los días. */
export const coloresDia: { nombre: string; rgb: string }[] = [
	{ nombre: 'Violeta', rgb: VIOLETA_RUTINA },
	{ nombre: 'Rosa', rgb: '255 111 174' },
	{ nombre: 'Coral', rgb: '255 122 92' },
	{ nombre: 'Verde', rgb: '52 211 153' },
	{ nombre: 'Ámbar', rgb: '251 191 36' },
	{ nombre: 'Celeste', rgb: '56 189 248' },
	{ nombre: 'Cian', rgb: '34 211 238' }
];

export const SERIES_MIN = 1;
export const SERIES_MAX = 12;

/**
 * Toda mutación de un día se resuelve DENTRO de una transacción y a partir del
 * estado persistido, nunca de lo que tiene renderizado la pantalla. Con dos toques
 * rápidos (el liveQuery todavía no emitió) el patrón leer-en-la-UI → escribir-absoluto
 * perdía la primera escritura; `modify` lee y escribe de forma atómica.
 */
function modificarDia(id: string, fn: (dia: Dia) => void): Promise<number> {
	const revision = capturarRevisionDatos();
	return db.transaction('rw', db.dias, async () => {
		exigirRevisionDatos(revision);
		return db.dias.where('id').equals(id).modify(fn);
	});
}

export async function crearDia(): Promise<string> {
	const revision = capturarRevisionDatos();
	const id = crypto.randomUUID();
	// El orden se calcula adentro de la transacción: dos "Nuevo día" seguidos no
	// pueden quedar con el mismo orden.
	await db.transaction('rw', db.dias, async () => {
		exigirRevisionDatos(revision);
		const ultimo = await db.dias.orderBy('orden').last();
		await db.dias.add({
			id,
			nombre: 'Nuevo día',
			color: VIOLETA_RUTINA,
			orden: (ultimo?.orden ?? -1) + 1,
			ejercicios: []
		});
	});
	return id;
}

/** Cambios de campos escalares (nombre, color): `update` ya es atómico en Dexie. */
export async function actualizarDia(id: string, cambios: Partial<Dia>): Promise<void> {
	const revision = capturarRevisionDatos();
	await db.transaction('rw', db.dias, async () => {
		exigirRevisionDatos(revision);
		await db.dias.update(id, cambios);
	});
}

export async function borrarDia(id: string): Promise<void> {
	const revision = capturarRevisionDatos();
	await db.transaction('rw', db.dias, async () => {
		exigirRevisionDatos(revision);
		await db.dias.delete(id);
	});
}

/** Suma o quita un día de la semana de la agenda (0 dom – 6 sáb). */
export async function toggleDiaSemana(id: string, indice: number): Promise<void> {
	await modificarDia(id, (dia) => {
		const actual = dia.diasSemana ?? [];
		const nuevo = actual.includes(indice)
			? actual.filter((x) => x !== indice)
			: [...actual, indice].sort((a, b) => a - b);
		if (nuevo.length) dia.diasSemana = nuevo;
		else delete dia.diasSemana;
	});
}

/** Reordena los días según `idsEnOrden` y normaliza `orden` a 0..n-1. */
export async function reordenarDias(idsEnOrden: string[]): Promise<void> {
	const revision = capturarRevisionDatos();
	await db.transaction('rw', db.dias, async () => {
		exigirRevisionDatos(revision);
		const todos = await db.dias.toArray();
		const porId = new Map(todos.map((d) => [d.id, d]));
		const ordenados: Dia[] = [];
		for (const id of idsEnOrden) {
			const d = porId.get(id);
			if (d) {
				ordenados.push(d);
				porId.delete(id);
			}
		}
		for (const d of todos) if (porId.has(d.id)) ordenados.push(d);
		ordenados.forEach((d, i) => (d.orden = i));
		await db.dias.bulkPut(ordenados);
	});
}

export async function agregarEjercicio(diaId: string, exerciseId: string): Promise<void> {
	const revision = capturarRevisionDatos();
	await db.transaction('rw', db.dias, db.sesiones, async () => {
		exigirRevisionDatos(revision);
		const dia = await db.dias.get(diaId);
		if (!dia) return;
		if (dia.ejercicios.some((e) => e.exerciseId === exerciseId)) return;
		// orden = max(orden)+1, no length: tras quitar+agregar, length puede duplicar un orden vigente.
		const orden = dia.ejercicios.reduce((m, e) => Math.max(m, e.orden), -1) + 1;
		dia.ejercicios.push({ exerciseId, seriesObjetivo: 3, orden });
		await db.dias.put(dia);

		// La rutina puede cambiar durante el mismo día. Si esa sesión ya se había
		// terminado, el nuevo ejercicio debe volverla a abrir en vez de esconder una
		// tarea pendiente bajo el estado "Terminado".
		const fecha = new Date().toLocaleDateString('sv');
		const sesion = await db.sesiones.get(`${fecha}__${diaId}`);
		if (sesion?.diaTerminado) {
			const nombre = ejercicioPorId(exerciseId)?.nombre ?? 'un ejercicio';
			reabrirSesion(sesion, `Agregaste ${nombre} a la rutina`);
			await guardarSesion(sesion);
		}
	});
}

export async function quitarEjercicio(diaId: string, exerciseId: string): Promise<void> {
	await modificarDia(diaId, (dia) => {
		dia.ejercicios = dia.ejercicios.filter((e) => e.exerciseId !== exerciseId);
	});
}

/**
 * Reordena los ejercicios del día según `idsEnOrden` y normaliza `orden` a 0..n-1.
 * Los ids que falten (defensivo) se preservan al final con su orden relativo.
 */
export async function reordenarEjercicios(diaId: string, idsEnOrden: string[]): Promise<void> {
	await modificarDia(diaId, (dia) => {
		const porId = new Map(dia.ejercicios.map((e) => [e.exerciseId, e]));
		const nuevos: Dia['ejercicios'] = [];
		for (const id of idsEnOrden) {
			const e = porId.get(id);
			if (e) {
				nuevos.push(e);
				porId.delete(id);
			}
		}
		for (const e of dia.ejercicios) if (porId.has(e.exerciseId)) nuevos.push(e);
		nuevos.forEach((e, i) => (e.orden = i));
		dia.ejercicios = nuevos;
	});
}

/**
 * Suma `delta` a las series objetivo. Se pasa el delta y no el total: con el total
 * calculado en la pantalla, dos toques seguidos de "+" escribían dos veces el mismo
 * número y uno de los dos se perdía.
 */
export async function ajustarSeries(
	diaId: string,
	exerciseId: string,
	delta: number
): Promise<void> {
	await modificarDia(diaId, (dia) => {
		const e = dia.ejercicios.find((x) => x.exerciseId === exerciseId);
		if (!e) return;
		e.seriesObjetivo = Math.max(SERIES_MIN, Math.min(SERIES_MAX, e.seriesObjetivo + delta));
	});
}
