import { liveQuery } from 'dexie';
import type { MetricaPr, PrCelebrado, Sesion, SetSesion } from './db';
import {
	historialPorModo,
	mejorSet,
	modoEjercicio,
	sesionesDe,
	hoyStr,
	valorSet,
	type MejorSet,
	type MetricaEfectiva,
	type ModoPr
} from './sesion';

export interface SerieDeSesion {
	set: SetSesion;
	setIndex: number;
	sesionId: string;
	fecha: string;
	diaId: string;
	/** Esta serie es la que celebró el PR de su sesión. */
	esPr: boolean;
	/** Métrica guardada al celebrar este PR. Indefinida en registros antiguos. */
	metricaPr?: MetricaEfectiva;
}

export interface SesionDeEjercicio {
	sesionId: string;
	fecha: string;
	diaId: string;
	series: SerieDeSesion[];
}

/** Estilo Hevy/FitNotes: para un nº de reps, el mejor peso efectivo logrado. */
export interface SetRecordPorReps {
	reps: number;
	set: SetSesion;
	fecha: string;
}

export interface ProgresoEjercicio {
	modo: ModoPr;
	/** Récords siempre rotulados: peso y e1RM en modo peso; reps en modo reps. */
	mejorPeso: MejorSet | null;
	mejorE1rm: MejorSet | null;
	mejorReps: MejorSet | null;
	setRecords: SetRecordPorReps[];
	/** Sesiones con series ✓ de este ejercicio, descendente por fecha. */
	sesiones: SesionDeEjercicio[];
	totalSeries: number;
}

/** Datos de la vista de progreso: una sola consulta para los tres resúmenes. */
export interface DatosProgresoEjercicio {
	progreso: ProgresoEjercicio;
	puntosCarga: MejorSet[];
	puntosReps: MejorSet[];
}

/**
 * Índice de la serie ✓ que celebró el PR de la sesión; -1 si ninguna.
 * Los PR nuevos guardan su `setIndex`. Para los viejos se busca por valor, que con
 * dos series idénticas puede marcar la otra: es lo mejor disponible sin el índice.
 */
export function indexSetPr(sets: SetSesion[], pr: PrCelebrado | undefined): number {
	if (!pr) return -1;
	if (pr.setIndex != null && sets[pr.setIndex]?.hecha) return pr.setIndex;
	return sets.findIndex(
		(s) =>
			s.hecha &&
			s.peso === pr.peso &&
			s.reps === pr.reps &&
			!!s.esMax === !!pr.esMax &&
			(s.extraKg ?? 0) === (pr.extraKg ?? 0)
	);
}

/**
 * Deriva récords, set records por reps e historial completo en una sola pasada
 * sobre las sesiones (escala personal: ~300 sesiones/año).
 */
export function crearProgresoEjercicio(sesiones: Sesion[], exerciseId: string): ProgresoEjercicio {
	// Una sesión marcada para una fecha futura sigue siendo planificación, no un récord histórico.
	const sesionesPasadas = sesiones.filter((sesion) => sesion.fecha <= hoyStr());
	const modo = modoEjercicio(sesionesPasadas, exerciseId);
	let mejorPeso: MejorSet | null = null;
	let mejorE1rm: MejorSet | null = null;
	let mejorReps: MejorSet | null = null;
	const records = new Map<number, SetRecordPorReps & { efectivo: number }>();
	const porSesion: SesionDeEjercicio[] = [];
	let totalSeries = 0;

	for (const s of sesionesPasadas) {
		const e = s.ejercicios.find((x) => x.exerciseId === exerciseId);
		if (!e) continue;
		const iPr = indexSetPr(e.sets, e.prCelebrado);
		const metricaPr = e.prCelebrado?.metrica;
		const series: SerieDeSesion[] = [];
		e.sets.forEach((set, setIndex) => {
			if (!set.hecha) return;
			series.push({
				set,
				setIndex,
				sesionId: s.id,
				fecha: s.fecha,
				diaId: s.diaId,
				esPr: setIndex === iPr,
				metricaPr: setIndex === iPr ? metricaPr : undefined
			});
			totalSeries++;
			const candidato = (valor: number): MejorSet => ({
				peso: set.peso,
				reps: set.reps,
				esMax: !!set.esMax,
				extraKg: set.extraKg,
				fecha: s.fecha,
				valor,
				sesionId: s.id,
				setIndex
			});
			const vPeso = valorSet(set, 'peso');
			if (vPeso != null) {
				mejorPeso = mejorSet(mejorPeso, candidato(vPeso));
				const vE1rm = valorSet(set, 'e1rm');
				if (vE1rm != null) mejorE1rm = mejorSet(mejorE1rm, candidato(vE1rm));
				if (set.reps != null) {
					const previo = records.get(set.reps);
					// Empate de peso → se conserva la primera vez que se logró.
					if (!previo || vPeso > previo.efectivo) {
						records.set(set.reps, { reps: set.reps, set, fecha: s.fecha, efectivo: vPeso });
					}
				}
			}
			const vReps = valorSet(set, 'peso', 'reps');
			if (vReps != null) mejorReps = mejorSet(mejorReps, candidato(vReps));
		});
		if (series.length) porSesion.push({ sesionId: s.id, fecha: s.fecha, diaId: s.diaId, series });
	}

	porSesion.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.sesionId.localeCompare(a.sesionId));
	const setRecords = [...records.values()]
		.sort((a, b) => a.reps - b.reps)
		.map(({ efectivo: _efectivo, ...r }) => r);

	return { modo, mejorPeso, mejorE1rm, mejorReps, setRecords, sesiones: porSesion, totalSeries };
}

export function progresoEjercicioObs(exerciseId: string) {
	return liveQuery(async () => crearProgresoEjercicio(await sesionesDe(exerciseId), exerciseId));
}

export function crearDatosProgresoEjercicio(
	sesiones: Sesion[],
	exerciseId: string,
	metrica: MetricaPr
): DatosProgresoEjercicio {
	return {
		progreso: crearProgresoEjercicio(sesiones, exerciseId),
		puntosCarga: historialPorModo(sesiones, exerciseId, metrica, 'peso'),
		puntosReps: historialPorModo(sesiones, exerciseId, metrica, 'reps')
	};
}

export function progresoPantallaObs(exerciseId: string, metrica: MetricaPr) {
	return liveQuery(async () =>
		crearDatosProgresoEjercicio(await sesionesDe(exerciseId), exerciseId, metrica)
	);
}
