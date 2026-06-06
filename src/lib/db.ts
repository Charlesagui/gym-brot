import Dexie, { type EntityTable } from 'dexie';

/** Un día de entrenamiento (ej. "Piernas") con sus ejercicios. */
export interface Dia {
	id: string;
	nombre: string;
	color?: string;
	diaSemana?: number; // 0 (dom) - 6 (sáb)
	orden: number;
	ejercicios: { exerciseId: string; seriesObjetivo: number; orden: number }[];
}

/** Progreso de una sesión (se resetea por sesión). */
export interface Sesion {
	id: string;
	fecha: string; // ISO
	diaId: string;
	progreso: { exerciseId: string; seriesHechas: number; completado: boolean }[];
}

/** Registro de peso por ejercicio (de acá sale el PR automático). */
export interface Registro {
	id: string;
	exerciseId: string;
	fecha: string; // ISO
	peso: number;
	reps: number;
	esMax: boolean;
	extraKg?: number;
}

/** Nota personal por ejercicio (colapsada en la UI). */
export interface Nota {
	exerciseId: string;
	texto: string;
}

/** Ajustes globales (única fila, id = 'app'). */
export interface Ajustes {
	id: string;
	darkMode: boolean;
	unidad: 'kg' | 'lb';
	timer: { activo: boolean; minutos: number };
}

export const db = new Dexie('gym-brot') as Dexie & {
	dias: EntityTable<Dia, 'id'>;
	sesiones: EntityTable<Sesion, 'id'>;
	registros: EntityTable<Registro, 'id'>;
	notas: EntityTable<Nota, 'exerciseId'>;
	ajustes: EntityTable<Ajustes, 'id'>;
};

db.version(1).stores({
	dias: 'id, diaSemana, orden',
	sesiones: 'id, diaId, fecha',
	registros: 'id, exerciseId, fecha',
	notas: 'exerciseId',
	ajustes: 'id'
});

/** Mejor marca histórica (PR) de un ejercicio. */
export async function prDe(exerciseId: string): Promise<Registro | undefined> {
	const regs = await db.registros.where('exerciseId').equals(exerciseId).toArray();
	if (regs.length === 0) return undefined;
	return regs.reduce((mejor, r) => (r.peso > mejor.peso ? r : mejor));
}
