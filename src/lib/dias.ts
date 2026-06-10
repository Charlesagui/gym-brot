import { db, type Dia } from './db';

/** Paleta de colores para los días. */
export const coloresDia: { nombre: string; rgb: string }[] = [
	{ nombre: 'Violeta', rgb: '124 92 255' },
	{ nombre: 'Rosa', rgb: '255 111 174' },
	{ nombre: 'Coral', rgb: '255 122 92' },
	{ nombre: 'Verde', rgb: '52 211 153' },
	{ nombre: 'Ámbar', rgb: '251 191 36' },
	{ nombre: 'Celeste', rgb: '56 189 248' },
	{ nombre: 'Cian', rgb: '34 211 238' }
];

export async function crearDia(): Promise<string> {
	const id = crypto.randomUUID();
	const ultimo = await db.dias.orderBy('orden').last();
	await db.dias.add({
		id,
		nombre: 'Nuevo día',
		color: '124 92 255',
		orden: (ultimo?.orden ?? -1) + 1,
		ejercicios: []
	});
	return id;
}

export async function actualizarDia(id: string, cambios: Partial<Dia>): Promise<void> {
	await db.dias.update(id, cambios);
}

export async function borrarDia(id: string): Promise<void> {
	await db.dias.delete(id);
}

export async function agregarEjercicio(diaId: string, exerciseId: string): Promise<void> {
	const dia = await db.dias.get(diaId);
	if (!dia) return;
	if (dia.ejercicios.some((e) => e.exerciseId === exerciseId)) return;
	// orden = max(orden)+1, no length: tras quitar+agregar, length puede duplicar un orden vigente.
	const orden = dia.ejercicios.reduce((m, e) => Math.max(m, e.orden), -1) + 1;
	dia.ejercicios.push({ exerciseId, seriesObjetivo: 3, orden });
	await db.dias.put(dia);
}

export async function quitarEjercicio(diaId: string, exerciseId: string): Promise<void> {
	const dia = await db.dias.get(diaId);
	if (!dia) return;
	dia.ejercicios = dia.ejercicios.filter((e) => e.exerciseId !== exerciseId);
	await db.dias.put(dia);
}

/**
 * Reordena los ejercicios del día según `idsEnOrden` y normaliza `orden` a 0..n-1.
 * Los ids que falten (defensivo) se preservan al final con su orden relativo.
 */
export async function reordenarEjercicios(diaId: string, idsEnOrden: string[]): Promise<void> {
	const dia = await db.dias.get(diaId);
	if (!dia) return;
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
	await db.dias.put(dia);
}

export async function setSeries(diaId: string, exerciseId: string, n: number): Promise<void> {
	const dia = await db.dias.get(diaId);
	if (!dia) return;
	const e = dia.ejercicios.find((x) => x.exerciseId === exerciseId);
	if (!e) return;
	e.seriesObjetivo = Math.max(1, Math.min(12, n));
	await db.dias.put(dia);
}
