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

/** Una serie hecha, con su propio peso (permite rampa/pirámide). */
export interface SetSesion {
	peso?: number;
	reps?: number;
	hecha: boolean;
	esMax?: boolean;
}

/** Progreso de una sesión (id = `${fecha}__${diaId}`, se resetea por día). */
export interface Sesion {
	id: string;
	fecha: string; // YYYY-MM-DD
	diaId: string;
	ejercicios: { exerciseId: string; sets: SetSesion[] }[];
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

// v2: el PR se deriva de las sesiones → la tabla `registros` ya no hace falta.
db.version(2).stores({
	registros: null
});

// Atajo solo-desarrollo para inspeccionar/sembrar datos desde la consola.
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).gdb = db;
