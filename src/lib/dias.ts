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
	dia.ejercicios.push({ exerciseId, seriesObjetivo: 3, orden: dia.ejercicios.length });
	await db.dias.put(dia);
}

export async function quitarEjercicio(diaId: string, exerciseId: string): Promise<void> {
	const dia = await db.dias.get(diaId);
	if (!dia) return;
	dia.ejercicios = dia.ejercicios.filter((e) => e.exerciseId !== exerciseId);
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
