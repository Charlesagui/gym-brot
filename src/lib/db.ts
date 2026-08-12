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
	/**
	 * Índice de la serie que logró el récord. Ausente en sesiones viejas: ahí el set
	 * se ubica comparando valores, que con dos series idénticas puede marcar la otra.
	 */
	setIndex?: number;
	/** Métrica usada al celebrar/recalcular el PR; ausente en sesiones viejas. */
	metrica?: MetricaPr | 'reps';
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
	/**
	 * Índice multiEntry derivado de `ejercicios`: permite traer solo las sesiones de un
	 * ejercicio en vez de deserializar toda la tabla. NUNCA se escribe a mano — lo
	 * recalcula `conIndice()` justo antes de cada persistencia (ver más abajo).
	 */
	exerciseIds?: string[];
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
	unidad: 'kg' | 'lb';
	timer: { activo: boolean; minutos: number };
	sonido: boolean;
	vibracion: boolean;
	/** Abre el descanso como pantalla enfocada al marcar una serie. */
	descansoPantallaCompleta: boolean;
	metricaPr: MetricaPr;
	/** Cuánto suma/resta cada toque de −/+ al cargar peso. */
	pasoPeso: number;
	/** Sobrescrituras por ejercicio y unidad; no alteran los pesos ya registrados. */
	pasosPesoEjercicio?: Record<string, Partial<Record<'kg' | 'lb', number>>>;
	/** ISO del último export de backup: alimenta el recordatorio en /historial. */
	ultimoBackup?: string;
	/** Evita volver a crear rutinas de ejemplo si el usuario borró todas. */
	seedInicialHecho?: boolean;
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

// v4: leer el historial de UN ejercicio no puede costar toda la tabla. Como cualquier
// escritura invalida los liveQuery, ese escaneo se pagaba en cada toque de peso y crecía
// sin techo con los años. `*exerciseIds` es un índice multiEntry derivado.
db.version(4)
	.stores({
		sesiones: 'id, diaId, fecha, *exerciseIds'
	})
	.upgrade(async (tx) => {
		await tx
			.table('sesiones')
			.toCollection()
			.modify((s: Sesion) => {
				s.exerciseIds = [...new Set(s.ejercicios.map((e) => e.exerciseId))];
			});
	});

/**
 * Recalcula el índice por ejercicio a partir de `ejercicios`, que es la única fuente de
 * verdad. Se aplica SIEMPRE justo antes de persistir: si el índice quedara desfasado, las
 * consultas dejarían de ver una sesión y un PR podría desaparecer del historial o
 * celebrarse de más. Por eso nadie debería llamar a `db.sesiones.put` directamente.
 */
export function conIndice(sesion: Sesion): Sesion {
	sesion.exerciseIds = [...new Set(sesion.ejercicios.map((e) => e.exerciseId))];
	return sesion;
}

/** Único camino para persistir una sesión: deja el índice por ejercicio al día. */
export function guardarSesion(sesion: Sesion): Promise<string> {
	return db.sesiones.put(conIndice(sesion));
}

// Multi-pestaña: cuando otra instancia migra el esquema, soltar la conexión y
// recargar para tomar el código nuevo; si no, esta pestaña vieja bloquea la
// migración y la otra queda esperando en "Cargando…" para siempre.
db.on('versionchange', () => {
	db.close();
	if (typeof location !== 'undefined') location.reload();
});

let avisarBloqueo: (() => void) | undefined;

// Dexie avisa explícitamente cuando otra conexión impide abrir o migrar. Se registra
// a nivel de módulo (una sola vez): hacerlo dentro de `onMount` acumulaba un handler
// por cada montaje del layout.
db.on('blocked', () => avisarBloqueo?.());

/**
 * La pantalla de carga usa esto para ofrecer una salida en vez de esperar para siempre.
 * Reemplaza el callback anterior en vez de sumar otro.
 */
export function onDbBloqueada(fn: () => void): void {
	avisarBloqueo = fn;
}

// Atajo solo-desarrollo para inspeccionar/sembrar datos desde la consola.
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).gdb = db;
