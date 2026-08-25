import { liveQuery } from 'dexie';
import { db, type PesoCorporal } from './db';
import { fechaCalendarioValida, hoyCalendarioLocal } from './fechas';
import { capturarRevisionDatos, exigirRevisionDatos } from './revision-datos';

export const PESO_CORPORAL_MIN_GRAMOS = 20_000;
export const PESO_CORPORAL_MAX_GRAMOS = 500_000;

export function pesoCorporalValido(gramos: unknown): gramos is number {
	return (
		typeof gramos === 'number' &&
		Number.isInteger(gramos) &&
		gramos >= PESO_CORPORAL_MIN_GRAMOS &&
		gramos <= PESO_CORPORAL_MAX_GRAMOS
	);
}

export function pesosCorporalesObs() {
	return liveQuery(() => db.pesosCorporales.orderBy('fecha').toArray());
}

export async function guardarPesoCorporal(
	fecha: string,
	pesoGramos: number,
	registradoAt = new Date().toISOString()
): Promise<void> {
	if (!fechaCalendarioValida(fecha)) throw new RangeError('La fecha de la medición no es válida.');
	if (fecha > hoyCalendarioLocal())
		throw new RangeError('La fecha de la medición no puede ser futura.');
	if (!pesoCorporalValido(pesoGramos))
		throw new RangeError('El peso corporal debe estar entre 20 y 500 kg.');
	if (!Number.isFinite(Date.parse(registradoAt)))
		throw new RangeError('La fecha de registro no es válida.');
	const revision = capturarRevisionDatos();
	await db.transaction('rw', db.pesosCorporales, async () => {
		exigirRevisionDatos(revision);
		await db.pesosCorporales.put({ fecha, pesoGramos, registradoAt });
	});
}

export async function borrarPesoCorporal(fecha: string): Promise<void> {
	const revision = capturarRevisionDatos();
	await db.transaction('rw', db.pesosCorporales, async () => {
		exigirRevisionDatos(revision);
		await db.pesosCorporales.delete(fecha);
	});
}

export interface ResumenPesoCorporal {
	actual: PesoCorporal | null;
	cambio7DiasGramos: number | null;
	cambio30DiasGramos: number | null;
	distanciaMetaGramos: number | null;
}

function fechaMenosDias(fecha: string, dias: number): string {
	const valor = new Date(`${fecha}T12:00:00`);
	valor.setDate(valor.getDate() - dias);
	return valor.toLocaleDateString('sv');
}

/**
 * Referencia para el cambio de N días: la medición más reciente que no sea posterior al
 * límite. La ventana se cierra por abajo en 2N días a propósito. Sin ese piso, quien se
 * pesó en enero y hoy vuelve a pesarse ve esa diferencia rotulada como "Cambio 7 días":
 * el número es real pero el rótulo miente, y es el caso más común al empezar. Fuera de la
 * ventana devolvemos null, que la pantalla ya muestra como "Sin datos suficientes".
 */
function cambioDesde(ordenados: PesoCorporal[], actual: PesoCorporal, dias: number): number | null {
	const limite = fechaMenosDias(actual.fecha, dias);
	const piso = fechaMenosDias(actual.fecha, dias * 2);
	const anterior = [...ordenados]
		.reverse()
		.find((peso) => peso.fecha <= limite && peso.fecha >= piso);
	return anterior ? actual.pesoGramos - anterior.pesoGramos : null;
}

export function resumirPesoCorporal(
	pesos: PesoCorporal[],
	metaPesoGramos?: number
): ResumenPesoCorporal {
	// Una versión anterior aceptaba fechas futuras. No dejamos que una fila heredada
	// desplace el peso actual ni contamine los cambios mientras el usuario la elimina.
	const hoy = hoyCalendarioLocal();
	const ordenados = [...pesos]
		.filter((peso) => peso.fecha <= hoy)
		.sort((a, b) => a.fecha.localeCompare(b.fecha));
	const actual = ordenados.at(-1) ?? null;
	if (!actual) {
		return {
			actual: null,
			cambio7DiasGramos: null,
			cambio30DiasGramos: null,
			distanciaMetaGramos: null
		};
	}
	return {
		actual,
		cambio7DiasGramos: cambioDesde(ordenados, actual, 7),
		cambio30DiasGramos: cambioDesde(ordenados, actual, 30),
		distanciaMetaGramos: metaPesoGramos == null ? null : actual.pesoGramos - metaPesoGramos
	};
}
