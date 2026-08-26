import Dexie, { type EntityTable } from 'dexie';
import { pesoAGramos } from './unidades';
import type { CategoriaPal, Meta, NivelRitmo, PerfilEnergia } from './energia';

/** Un día de entrenamiento (ej. "Piernas") con sus ejercicios. */
export interface Dia {
	id: string;
	nombre: string;
	color?: string;
	/** Días de la semana agendados, 0 (dom) - 6 (sáb). Una rutina puede repetirse. */
	diasSemana?: number[];
	orden: number;
	ejercicios: EjercicioRutina[];
}

export interface EjercicioRutina {
	exerciseId: string;
	seriesObjetivo: number;
	orden: number;
}

/** Una serie hecha, con su propio peso (permite rampa/pirámide). */
export interface SetSesion {
	peso?: number;
	/** Fuente de verdad independiente de la unidad visible (milésimas de kg). */
	pesoGramos?: number;
	reps?: number;
	hecha: boolean;
	esMax?: boolean;
	/** Kg sumados encima de la placa full cuando es MAX (progresión más allá del tope). */
	extraKg?: number;
	extraGramos?: number;
	/** Esfuerzo canónico opcional: repeticiones en reserva, de 0 a 5 en pasos de 0,5. */
	rir?: number;
}

/** Snapshot del set que ya disparó la celebración de PR en esta sesión (anti-repetición). */
export interface PrCelebrado {
	/** Ausente en ejercicios sin peso (modo reps): el récord es por repeticiones. */
	peso?: number;
	pesoGramos?: number;
	reps?: number;
	esMax?: boolean;
	extraKg?: number;
	extraGramos?: number;
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
	/** Nombre congelado al crear la entrada; sobrevive a renombres o archivados. */
	nombreSnapshot?: string;
	sets: SetSesion[];
	/** Guarda el set, no un escalar, para recomputar su valor al cambiar métrica o unidad. */
	prCelebrado?: PrCelebrado;
	/** Saltado solo en esta sesión (p. ej. máquina ocupada): no bloquea terminar el día. */
	saltado?: boolean;
}

/**
 * El plan del día, congelado: cuántos ejercicios y cuántas series tenía la rutina
 * cuando se creó la sesión.
 *
 * Es el denominador de "4 de 12 series", y tiene que vivir acá porque `Dia.ejercicios`
 * muta: calcular el cumplimiento contra la rutina de hoy haría que editar una rutina
 * reescribiera el pasado, que es justo lo que los snapshots de nombre evitan.
 */
export interface PlanSesion {
	ejercicios: number;
	series: number;
}

/** Progreso de una sesión (id = `${fecha}__${diaId}`, se resetea por día). */
export interface Sesion {
	id: string;
	fecha: string; // YYYY-MM-DD
	diaId: string;
	/** Nombre de la rutina al crear la sesión; el historial no depende del nombre actual. */
	diaNombre?: string;
	/** Orden real de creación dentro de la fecha (0..n); desempata PRs del mismo día. */
	ordenEnDia?: number;
	ejercicios: EjercicioSesion[];
	/**
	 * Plan congelado del día. Ausente en las sesiones anteriores a que existiera: esos
	 * días no muestran porcentaje y se siguen contando como entrenados, porque estimarles
	 * un denominador con la rutina actual es exactamente el error que este campo evita.
	 * No hay migración que lo rellene por el mismo motivo.
	 */
	plan?: PlanSesion;
	diaTerminado?: boolean;
	diaTerminadoAt?: string;
	/**
	 * El día se cerró a mano dejando trabajo sin resolver. No es lo mismo que cerrarlo
	 * con todo hecho o saltado: sirve para que el historial no le regale a un día de un
	 * ejercicio el mismo estado que a uno completo.
	 */
	diaTerminadoConPendientes?: boolean;
	/**
	 * Por qué este día dejó de estar terminado, para que la pantalla pueda decirlo.
	 * Sobrevive a la navegación a propósito: la reapertura casi siempre se dispara en la
	 * pantalla de ejercicio y se lee después, al volver al día.
	 */
	reaperturaMotivo?: string;
	reaperturaAt?: string;
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
export type ModoEsfuerzo = 'off' | 'rir' | 'rpe';

/** Una medición principal de peso corporal por fecha local. */
export interface PesoCorporal {
	fecha: string;
	/** Fuente de verdad: gramos enteros; la unidad visible es solo presentación. */
	pesoGramos: number;
	registradoAt: string;
}

/**
 * Un objetivo calórico guardado, con su perfil congelado.
 *
 * El perfil viaja adentro y no se recalcula: revisar dentro de tres meses un objetivo
 * de hoy con el peso de mañana daría un número que nunca existió. Congelarlo también
 * hace reproducible cada revisión de la cadena.
 */
export interface ObjetivoEnergia {
	/**
	 * `${creadoAt}-${sufijo}`. El prefijo ISO es de ancho fijo, así que el orden
	 * lexicográfico por clave primaria es el cronológico y el vigente es el último.
	 * El sufijo aleatorio evita que dos guardados en el mismo milisegundo se pisen:
	 * un `put` con id repetido borraría un eslabón de la cadena en silencio.
	 */
	id: string;
	creadoAt: string;
	perfil: PerfilEnergia;
	palEstimado: number;
	categoriaPal: CategoriaPal;
	/** Mantenimiento estimado, o ya calibrado si viene de una revisión. */
	tdeeKcal: number;
	/** El ancho de la banda del 68 %, para no recalcularlo al leer. */
	sepvKcal: number;
	meta: Meta;
	/** Cuál de los cinco botones fue: alimenta el rótulo sin recalcular nada. */
	nivel: NivelRitmo | null;
	/** Ritmo aplicado, en % de peso corporal por semana. Negativo al bajar. */
	ritmoPctSemana: number;
	objetivoKcal: number;
	proteinaG: number;
	/** Id del objetivo que esta revisión reemplaza: deja la cadena completa. */
	calibradoDe?: string;
}

/** Ajustes globales (única fila, id = 'app'). */
export interface Ajustes {
	id: string;
	unidad: 'kg' | 'lb';
	timer: { activo: boolean; minutos: number };
	/** Interruptor maestro: apagado, la app no suena nunca. */
	sonido: boolean;
	/**
	 * Beeps de serie hecha, PR, ejercicio y día terminado. Separado del maestro porque
	 * la alarma de descanso es funcional (te dice cuándo volver) y esto es celebratorio:
	 * querer una sin la otra es un pedido razonable y antes compartían un solo botón.
	 */
	sonidoLogros: boolean;
	/** Volumen general (0–1) aplicado al master de audio. */
	volumen: number;
	vibracion: boolean;
	/** Abre el descanso como pantalla enfocada al marcar una serie. */
	descansoPantallaCompleta: boolean;
	/**
	 * Mantiene la pantalla encendida mientras hay un ejercicio en curso. El descanso ya
	 * la sostenía solo (la alarma depende de eso); esto cubre el resto de la serie, que
	 * es donde el teléfono se apagaba entre repetición y repetición. Se puede apagar
	 * porque un ejercicio largo con la pantalla encendida se come batería.
	 */
	ejercicioPantallaEncendida: boolean;
	metricaPr: MetricaPr;
	/** Sobrescritura por ejercicio; ausente = usa `metricaPr`. */
	metricasPrEjercicio?: Record<string, MetricaPr>;
	/** Captura de esfuerzo desactivada por defecto; el dato persistido siempre es RIR. */
	modoEsfuerzo?: ModoEsfuerzo;
	/** Meta de peso personal opcional en gramos canónicos. */
	metaPesoGramos?: number;
	/** Cuánto suma/resta cada toque de −/+ al cargar peso. */
	pasoPeso: number;
	/** Sobrescrituras por ejercicio y unidad; no alteran los pesos ya registrados. */
	pasosPesoEjercicio?: Record<string, Partial<Record<'kg' | 'lb', number>>>;
	/**
	 * Descanso propio de un ejercicio, en minutos, que pisa a `timer`. Un press pesado
	 * y unas elevaciones laterales no descansan lo mismo, y antes cambiar uno cambiaba
	 * el otro. `0` significa "sin descanso en este ejercicio"; ausente = usa `timer`.
	 */
	descansosEjercicio?: Record<string, number>;
	/** ISO del último export de backup: alimenta el recordatorio en /historial. */
	ultimoBackup?: string;
	/** Evita volver a crear rutinas de ejemplo si el usuario borró todas. */
	seedInicialHecho?: boolean;
	/** El backfill de `nombreSnapshot` ya corrió: no hace falta recorrer sesiones al abrir. */
	snapshotsCompletados?: boolean;
}

/** Violeta que no llegaba a AA como texto; se conserva solo para migrar el valor viejo. */
const VIOLETA_LEGADO = '124 92 255';
/** Violeta de rutina accesible: mismo tono que `--accent-text` (5,12:1 sobre --surface). */
export const VIOLETA_RUTINA = '130 104 255';

export const db = new Dexie('gym-brot') as Dexie & {
	dias: EntityTable<Dia, 'id'>;
	sesiones: EntityTable<Sesion, 'id'>;
	notas: EntityTable<Nota, 'exerciseId'>;
	ajustes: EntityTable<Ajustes, 'id'>;
	pesosCorporales: EntityTable<PesoCorporal, 'fecha'>;
	objetivosEnergia: EntityTable<ObjetivoEnergia, 'id'>;
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
 * v5: las versiones anteriores aceptaban `reps: 0` en datos importados o escritos
 * a mano. Cero no representa una serie hecha: podía cerrar un ejercicio y hasta
 * quedar como PR de peso. Lo convertimos en serie pendiente y retiramos cualquier
 * snapshot de PR que ya no tenga una serie real detrás.
 */
db.version(5)
	.stores({
		sesiones: 'id, diaId, fecha, *exerciseIds'
	})
	.upgrade(async (tx) => {
		await tx
			.table('sesiones')
			.toCollection()
			.modify((sesion: Sesion) => {
				for (const ejercicio of sesion.ejercicios) {
					for (const set of ejercicio.sets) {
						if (set.reps === 0) {
							set.reps = undefined;
							set.hecha = false;
						}
					}

					const pr = ejercicio.prCelebrado;
					if (!pr) continue;
					const coincide = (set: SetSesion | undefined) =>
						!!set?.hecha &&
						set.reps !== 0 &&
						set.peso === pr.peso &&
						set.reps === pr.reps &&
						!!set.esMax === !!pr.esMax &&
						(set.extraKg ?? 0) === (pr.extraKg ?? 0);
					const indice =
						pr.setIndex != null && coincide(ejercicio.sets[pr.setIndex])
							? pr.setIndex
							: ejercicio.sets.findIndex(coincide);
					if (indice < 0) ejercicio.prCelebrado = undefined;
					else if (pr.setIndex !== indice) ejercicio.prCelebrado = { ...pr, setIndex: indice };
				}
				sesion.exerciseIds = [...new Set(sesion.ejercicios.map((e) => e.exerciseId))];
			});
	});

/**
 * v6: dos rutinas pueden compartir un ejercicio en la misma fecha. Hasta ahora sus
 * PR se ordenaban por `diaId` (muchas veces un UUID), que no representa qué sesión
 * ocurrió primero. Asignamos una secuencia estable por fecha y, de paso, reparamos
 * series antiguas marcadas sin una cantidad entera y positiva de repeticiones.
 */
db.version(6)
	.stores({
		sesiones: 'id, diaId, fecha, *exerciseIds'
	})
	.upgrade(async (tx) => {
		const tabla = tx.table('sesiones');
		const sesiones = (await tabla.toArray()) as Sesion[];
		const porFecha = new Map<string, Sesion[]>();
		for (const sesion of sesiones) {
			const grupo = porFecha.get(sesion.fecha) ?? [];
			grupo.push(sesion);
			porFecha.set(sesion.fecha, grupo);
		}

		for (const grupo of porFecha.values()) {
			grupo.sort((a, b) => {
				const finA = a.diaTerminadoAt ? Date.parse(a.diaTerminadoAt) : Number.NaN;
				const finB = b.diaTerminadoAt ? Date.parse(b.diaTerminadoAt) : Number.NaN;
				if (Number.isFinite(finA) && Number.isFinite(finB) && finA !== finB) return finA - finB;
				if (Number.isFinite(finA) !== Number.isFinite(finB)) return Number.isFinite(finA) ? -1 : 1;
				return a.id.localeCompare(b.id);
			});

			grupo.forEach((sesion, ordenEnDia) => {
				sesion.ordenEnDia = ordenEnDia;
				for (const ejercicio of sesion.ejercicios) {
					for (const set of ejercicio.sets) {
						const repsValidas = set.reps != null && Number.isInteger(set.reps) && set.reps > 0;
						if (set.hecha && !repsValidas) set.hecha = false;
					}

					const pr = ejercicio.prCelebrado;
					if (!pr) continue;
					const coincide = (set: SetSesion | undefined) =>
						!!set?.hecha &&
						set.reps != null &&
						Number.isInteger(set.reps) &&
						set.reps > 0 &&
						set.peso === pr.peso &&
						set.reps === pr.reps &&
						!!set.esMax === !!pr.esMax &&
						(set.extraKg ?? 0) === (pr.extraKg ?? 0);
					const indice =
						pr.setIndex != null && coincide(ejercicio.sets[pr.setIndex])
							? pr.setIndex
							: ejercicio.sets.findIndex(coincide);
					if (indice < 0) ejercicio.prCelebrado = undefined;
					else if (pr.setIndex !== indice) ejercicio.prCelebrado = { ...pr, setIndex: indice };
				}
				sesion.exerciseIds = [...new Set(sesion.ejercicios.map((e) => e.exerciseId))];
			});
		}

		await tabla.bulkPut(sesiones);
	});

/**
 * v7: los valores visibles dejaron de ser la fuente de verdad. Guardarlos como gramos
 * enteros permite alternar kg/lb sin modificar el historial ni acumular redondeos.
 * También congelamos el nombre de la rutina para que un renombre futuro no reescriba
 * implícitamente lo que el usuario entrenó aquel día.
 */
db.version(7)
	.stores({
		sesiones: 'id, diaId, fecha, *exerciseIds'
	})
	.upgrade(async (tx) => {
		const ajustes = (await tx.table('ajustes').get('app')) as Ajustes | undefined;
		const unidad = ajustes?.unidad === 'lb' ? 'lb' : 'kg';
		const dias = (await tx.table('dias').toArray()) as Dia[];
		const nombres = new Map(dias.map((dia) => [dia.id, dia.nombre]));
		await tx
			.table('sesiones')
			.toCollection()
			.modify((sesion: Sesion) => {
				sesion.diaNombre ??= nombres.get(sesion.diaId);
				for (const ejercicio of sesion.ejercicios) {
					for (const set of ejercicio.sets) {
						const peso = pesoAGramos(set.peso, unidad);
						const extra = pesoAGramos(set.extraKg, unidad);
						if (set.pesoGramos == null && peso != null) set.pesoGramos = peso;
						if (set.extraGramos == null && extra != null) set.extraGramos = extra;
					}
					if (ejercicio.prCelebrado) {
						const peso = pesoAGramos(ejercicio.prCelebrado.peso, unidad);
						const extra = pesoAGramos(ejercicio.prCelebrado.extraKg, unidad);
						if (ejercicio.prCelebrado.pesoGramos == null && peso != null)
							ejercicio.prCelebrado.pesoGramos = peso;
						if (ejercicio.prCelebrado.extraGramos == null && extra != null)
							ejercicio.prCelebrado.extraGramos = extra;
					}
				}
			});
	});

/**
 * v8: el violeta por defecto de las rutinas (124 92 255) daba 4,21:1 sobre la superficie
 * oscura, por debajo del 4,5 que pide AA para texto normal — y es justo el color con el
 * que se pintan "Hoy entrenás" y el contador de ejercicios a 11-12 px. Se sube al mismo
 * tono que la app ya usaba como tinta de acento (130 104 255 = --accent-text, 5,12:1).
 * Solo se toca el valor viejo exacto: un color elegido a mano por el usuario no se pisa.
 */
db.version(8).upgrade(async (tx) =>
	tx
		.table('dias')
		.toCollection()
		.modify((dia: Dia) => {
			if (dia.color === VIOLETA_LEGADO) dia.color = VIOLETA_RUTINA;
		})
);

/** v9: el índice por ejercicio ya estaba; la versión sólo la consume la migración. */
db.version(9).stores({
	sesiones: 'id, diaId, fecha, *exerciseIds'
});

/**
 * v10: seguimiento de peso corporal separado de las sesiones. RIR, overrides de PR y
 * progresión viven en objetos ya persistidos, por lo que no requieren índices nuevos.
 */
db.version(10).stores({
	dias: 'id, orden',
	sesiones: 'id, diaId, fecha, *exerciseIds',
	notas: 'exerciseId',
	ajustes: 'id',
	pesosCorporales: 'fecha, registradoAt'
});

/**
 * v11: objetivos calóricos. Tabla propia y no un campo en `ajustes` porque lo valioso
 * es el historial de revisiones, no solo el objetivo vigente: sin la cadena no se puede
 * mostrar cómo se fue corrigiendo la estimación contra el peso real.
 *
 * No hay bandera `activo` ni índice sobre ella. IndexedDB no acepta booleanos como
 * clave, así que indexarla no habría hecho nada, y un flag mantenido a mano permite
 * el estado imposible de dos objetivos vigentes. Con el id ordenado en el tiempo, el
 * vigente es `orderBy('id').last()`: una lectura por clave primaria, y la unicidad
 * deja de depender de que una transacción se acuerde de apagar el anterior.
 */
db.version(11).stores({
	dias: 'id, orden',
	sesiones: 'id, diaId, fecha, *exerciseIds',
	notas: 'exerciseId',
	ajustes: 'id',
	pesosCorporales: 'fecha, registradoAt',
	objetivosEnergia: 'id'
});

/**
 * Rellena `nombreSnapshot` en las sesiones anteriores a que existiera. Sin esto, el
 * historial no puede dejar de importar el catálogo (193 KB solo para resolver nombres):
 * un ejercicio entrenado antes de los snapshots aparecería como "Ejercicio archivado"
 * aunque siga estando en el catálogo.
 *
 * Corre fuera de la transacción de migración a propósito: importar un chunk durante
 * `versionchange` puede dejar IndexedDB esperando indefinidamente si esa ruta todavía no
 * cargó el catálogo (por ejemplo, al abrir `/peso` directamente).
 *
 * Y corre una sola vez. Detectar si falta algún snapshot obliga a un cursor con predicado
 * en JS sobre `sesiones`: cuando no falta ninguno —el estado permanente después de la
 * primera pasada— eso deserializa la tabla entera, y esto está en el camino del arranque.
 * El flag lo convierte en una lectura por clave primaria.
 */
export async function completarNombresSnapshotFaltantes(): Promise<void> {
	const ajustes = await db.ajustes.get('app');
	if (ajustes?.snapshotsCompletados) return;

	const faltaAlguno = await db.sesiones
		.filter((sesion) => sesion.ejercicios.some((ejercicio) => !ejercicio.nombreSnapshot))
		.first();

	if (faltaAlguno) {
		const { ejercicioPorId } = await import('./catalog');
		await db.transaction('rw', db.sesiones, async () => {
			await db.sesiones.toCollection().modify((sesion) => {
				for (const ejercicio of sesion.ejercicios) {
					// Un ejercicio ya borrado del catálogo se queda sin nombre y la pantalla lo
					// rotula como archivado: es la verdad, no una degradación.
					ejercicio.nombreSnapshot ??= ejercicioPorId(ejercicio.exerciseId)?.nombre;
				}
			});
		});
	}
	// Si todavía no hay fila de ajustes (primera apertura, antes del seed) esto no hace
	// nada y el backfill se vuelve a intentar: sobre una base recién creada es gratis.
	await db.ajustes.update('app', { snapshotsCompletados: true });
}

/** Orden cronológico estable usado por progreso y PR, incluida la misma fecha. */
export function compararSesiones(a: Sesion, b: Sesion): number {
	const porFecha = a.fecha.localeCompare(b.fecha);
	if (porFecha) return porFecha;
	const ordenA =
		a.ordenEnDia != null && Number.isInteger(a.ordenEnDia) && a.ordenEnDia >= 0
			? a.ordenEnDia
			: Number.MAX_SAFE_INTEGER;
	const ordenB =
		b.ordenEnDia != null && Number.isInteger(b.ordenEnDia) && b.ordenEnDia >= 0
			? b.ordenEnDia
			: Number.MAX_SAFE_INTEGER;
	return ordenA - ordenB || a.id.localeCompare(b.id);
}

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
