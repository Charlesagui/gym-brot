import Dexie, { type EntityTable } from 'dexie';

/** Un día de entrenamiento (ej. "Piernas") con sus ejercicios. */
export interface Dia {
	id: string;
	nombre: string;
	color?: string;
	/** Días de la semana agendados, 0 (dom) - 6 (sáb). Una rutina puede repetirse. */
	diasSemana?: number[];
	orden: number;
	ejercicios: { exerciseId: string; seriesObjetivo: number; orden: number }[];
}

/** Una serie hecha, con su propio peso (permite rampa/pirámide). */
export interface SetSesion {
	peso?: number;
	reps?: number;
	hecha: boolean;
	esMax?: boolean;
	/** Kg sumados encima de la placa full cuando es MAX (progresión más allá del tope). */
	extraKg?: number;
}

/** Snapshot del set que ya disparó la celebración de PR en esta sesión (anti-repetición). */
export interface PrCelebrado {
	/** Ausente en ejercicios sin peso (modo reps): el récord es por repeticiones. */
	peso?: number;
	reps?: number;
	esMax?: boolean;
	extraKg?: number;
}

export interface EjercicioSesion {
	exerciseId: string;
	sets: SetSesion[];
	/** Guarda el set, no un escalar, para recomputar su valor al cambiar métrica o unidad. */
	prCelebrado?: PrCelebrado;
	/** Saltado solo en esta sesión (p. ej. máquina ocupada): no bloquea terminar el día. */
	saltado?: boolean;
}

/** Progreso de una sesión (id = `${fecha}__${diaId}`, se resetea por día). */
export interface Sesion {
	id: string;
	fecha: string; // YYYY-MM-DD
	diaId: string;
	ejercicios: EjercicioSesion[];
	diaTerminado?: boolean;
	diaTerminadoAt?: string;
}

/** Nota personal por ejercicio (colapsada en la UI). */
export interface Nota {
	exerciseId: string;
	texto: string;
}

/** Métrica con la que se calcula el PR: peso máximo o 1RM estimado (Epley). */
export type MetricaPr = 'peso' | 'e1rm';

/** Ajustes globales (única fila, id = 'app'). */
export interface Ajustes {
	id: string;
	darkMode: boolean;
	unidad: 'kg' | 'lb';
	timer: { activo: boolean; minutos: number };
	sonido: boolean;
	vibracion: boolean;
	metricaPr: MetricaPr;
	/** Cuánto suma/resta cada toque de −/+ al cargar peso. */
	pasoPeso: number;
	/** ISO del último export de backup: alimenta el recordatorio en /historial. */
	ultimoBackup?: string;
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

// v3: una rutina puede agendarse varios días por semana → diaSemana pasa a diasSemana[].
db.version(3)
	.stores({
		dias: 'id, orden'
	})
	.upgrade(async (tx) => {
		await tx
			.table('dias')
			.toCollection()
			.modify((d: Dia & { diaSemana?: number }) => {
				if (d.diaSemana != null && d.diasSemana == null) d.diasSemana = [d.diaSemana];
				delete d.diaSemana;
			});
	});

// Multi-pestaña: cuando otra instancia migra el esquema, soltar la conexión y
// recargar para tomar el código nuevo; si no, esta pestaña vieja bloquea la
// migración y la otra queda esperando en "Cargando…" para siempre.
db.on('versionchange', () => {
	db.close();
	if (typeof location !== 'undefined') location.reload();
});

// Atajo solo-desarrollo para inspeccionar/sembrar datos desde la consola.
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).gdb = db;
