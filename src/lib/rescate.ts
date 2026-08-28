import type { Sesion } from './db';

/**
 * Leer los datos SIN pasar por Dexie, para cuando Dexie no puede abrir la base.
 *
 * Existe por una razón concreta: la pantalla de "no pude abrir tus datos locales" ofrecía
 * borrar todo y ella misma avisaba que desde ahí no se podía exportar un backup. O sea,
 * la única puerta de salida era también la única puerta sin retorno. Esto la reemplaza.
 *
 * Va por `indexedDB` crudo a propósito. Buena parte de los fallos de apertura no son
 * corrupción sino la máquina de esquema/migración de Dexie: una migración que tira, una
 * base más nueva que el código, un `versionchange` que quedó a medias. En todos esos
 * casos los datos están enteros y se leen perfecto abriendo sin declarar versión.
 */
export interface Rescate {
	/** JSON con la misma forma que el backup normal: se restaura desde Ajustes. */
	json: string;
	/** Cuántas filas salieron de cada tabla, para poder decirlo sin mentir. */
	filas: Record<string, number>;
	total: number;
}

export class RescateVacioError extends Error {
	constructor() {
		super('No hay ninguna base de datos de Gym-brot en este navegador.');
		this.name = 'RescateVacioError';
	}
}

/** Tablas que entiende el backup. Cualquier otra (p. ej. `registros`, de v1) se ignora. */
const TABLAS = [
	'dias',
	'sesiones',
	'notas',
	'ajustes',
	'pesosCorporales',
	'objetivosEnergia'
] as const;

const ESPERA_MAX_MS = 8000;

function leerTabla(db: IDBDatabase, nombre: string): Promise<unknown[]> {
	return new Promise((resolve, reject) => {
		try {
			const pedido = db.transaction(nombre, 'readonly').objectStore(nombre).getAll();
			pedido.onerror = () => reject(pedido.error ?? new Error(`No se pudo leer ${nombre}.`));
			pedido.onsuccess = () => resolve(pedido.result ?? []);
		} catch (error) {
			// Una tabla ilegible no puede llevarse puesto el rescate de las otras.
			reject(error);
		}
	});
}

function abrirCruda(nombre: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('Este navegador no expone IndexedDB.'));
			return;
		}
		// Sin número de versión: abre la que haya y NO dispara ninguna migración, que es
		// justo lo que suele estar roto cuando se llega hasta acá.
		const pedido = indexedDB.open(nombre);
		const temporizador = setTimeout(
			() => reject(new Error('La lectura de rescate tardó demasiado. Cerrá las otras pestañas.')),
			ESPERA_MAX_MS
		);
		const terminar = () => clearTimeout(temporizador);
		// Abrir sin versión una base inexistente la CREARÍA vacía. Abortar acá cancela esa
		// creación: preferimos decir "no hay nada" antes que dejar una base nueva de regalo.
		pedido.onupgradeneeded = () => {
			pedido.transaction?.abort();
			terminar();
			reject(new RescateVacioError());
		};
		pedido.onblocked = () => {
			terminar();
			reject(new Error('Otra pestaña tiene los datos tomados. Cerrala y volvé a intentar.'));
		};
		pedido.onerror = () => {
			terminar();
			reject(pedido.error ?? new Error('No se pudo abrir el almacenamiento local.'));
		};
		pedido.onsuccess = () => {
			terminar();
			resolve(pedido.result);
		};
	});
}

/**
 * Junta lo que se pueda leer en un backup restaurable.
 *
 * Nunca falla por una tabla: si `sesiones` se lee y `ajustes` no, sale un archivo con las
 * sesiones. Perder las preferencias es un mal día; perder el historial es el problema que
 * esto viene a evitar.
 */
export async function rescatarDatosCrudos(nombre = 'gym-brot'): Promise<Rescate> {
	const db = await abrirCruda(nombre);
	try {
		const datos: Record<string, unknown[]> = {};
		const filas: Record<string, number> = {};
		let total = 0;
		for (const tabla of TABLAS) {
			if (!db.objectStoreNames.contains(tabla)) continue;
			try {
				const contenido = await leerTabla(db, tabla);
				datos[tabla] = contenido;
				filas[tabla] = contenido.length;
				total += contenido.length;
			} catch (error) {
				console.error(`rescate: no se pudo leer ${tabla}`, error);
			}
		}

		// `exerciseIds` es un índice derivado y no viaja en el backup: lo reconstruye
		// `conIndice` al importar. Mismo criterio que `exportarJSON`.
		const sesiones = (datos.sesiones ?? []) as Sesion[];
		return {
			json: JSON.stringify({
				app: 'gym-brot',
				version: 3,
				exportado: new Date().toISOString(),
				rescate: true,
				dias: datos.dias ?? [],
				sesiones: sesiones.map(({ exerciseIds: _exerciseIds, ...sesion }) => sesion),
				notas: datos.notas ?? [],
				ajustes: datos.ajustes ?? [],
				pesosCorporales: datos.pesosCorporales ?? [],
				objetivosEnergia: datos.objetivosEnergia ?? []
			}),
			filas,
			total
		};
	} finally {
		db.close();
	}
}

/** Resumen legible de lo rescatado, para que el aviso diga qué hay adentro del archivo. */
export function resumenRescate(filas: Record<string, number>): string {
	const etiquetas: Record<string, [string, string]> = {
		dias: ['rutina', 'rutinas'],
		sesiones: ['entrenamiento', 'entrenamientos'],
		notas: ['nota', 'notas'],
		pesosCorporales: ['peso registrado', 'pesos registrados'],
		objetivosEnergia: ['objetivo', 'objetivos']
	};
	const partes = Object.entries(etiquetas)
		.filter(([tabla]) => (filas[tabla] ?? 0) > 0)
		.map(([tabla, [uno, varios]]) => {
			const n = filas[tabla]!;
			return `${n} ${n === 1 ? uno : varios}`;
		});
	return partes.join(' · ');
}
