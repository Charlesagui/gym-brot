import { liveQuery } from 'dexie';
import {
	compararSesiones,
	type MetricaPr,
	type PrCelebrado,
	type Sesion,
	type SetSesion
} from './db';
import { historialPorModo, sesionesDe, hoyStr } from './sesion';
import {
	indexSetPr,
	mejorSet,
	modoEjercicio,
	serieCompleta,
	valorSet,
	type MejorSet,
	type MetricaEfectiva,
	type ModoPr
} from './sesion-reglas';
import { conPesoVisible, type UnidadPeso } from './unidades';

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

// La regla vive en `sesion-reglas` (la comparten esta pantalla y el resumen del día);
// se reexporta para no romper a quien ya la importaba desde acá.
export { indexSetPr } from './sesion-reglas';

/**
 * Deriva récords, set records por reps e historial completo en una sola pasada
 * sobre las sesiones (escala personal: ~300 sesiones/año).
 */
export function crearProgresoEjercicio(
	sesiones: Sesion[],
	exerciseId: string,
	unidad: UnidadPeso = 'kg'
): ProgresoEjercicio {
	// Una sesión marcada para una fecha futura sigue siendo planificación, no un récord histórico.
	const hoy = hoyStr();
	const sesionesPasadas = sesiones.filter((sesion) => sesion.fecha <= hoy).sort(compararSesiones);
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
			if (!serieCompleta(set)) return;
			const setVisible = conPesoVisible(set, unidad);
			series.push({
				set: setVisible,
				setIndex,
				sesionId: s.id,
				fecha: s.fecha,
				diaId: s.diaId,
				esPr: setIndex === iPr,
				metricaPr: setIndex === iPr ? metricaPr : undefined
			});
			totalSeries++;
			const candidato = (valor: number): MejorSet => ({
				peso: setVisible.peso,
				reps: set.reps,
				esMax: !!set.esMax,
				extraKg: setVisible.extraKg,
				fecha: s.fecha,
				valor,
				sesionId: s.id,
				setIndex
			});
			const vPeso = valorSet(set, 'peso', 'peso', unidad);
			if (vPeso != null) {
				mejorPeso = mejorSet(mejorPeso, candidato(vPeso));
				const vE1rm = valorSet(set, 'e1rm', 'peso', unidad);
				if (vE1rm != null) mejorE1rm = mejorSet(mejorE1rm, candidato(vE1rm));
				if (set.reps != null) {
					const previo = records.get(set.reps);
					// Empate de peso → se conserva la primera vez que se logró.
					if (!previo || vPeso > previo.efectivo) {
						records.set(set.reps, {
							reps: set.reps,
							set: setVisible,
							fecha: s.fecha,
							efectivo: vPeso
						});
					}
				}
			}
			const vReps = valorSet(set, 'peso', 'reps', unidad);
			if (vReps != null) mejorReps = mejorSet(mejorReps, candidato(vReps));
		});
		if (series.length) porSesion.push({ sesionId: s.id, fecha: s.fecha, diaId: s.diaId, series });
	}

	// `sesionesPasadas` ya está en orden cronológico real; la UI muestra recientes primero.
	porSesion.reverse();
	const setRecords = [...records.values()]
		.sort((a, b) => a.reps - b.reps)
		.map(({ efectivo: _efectivo, ...r }) => r);

	return { modo, mejorPeso, mejorE1rm, mejorReps, setRecords, sesiones: porSesion, totalSeries };
}

export function crearDatosProgresoEjercicio(
	sesiones: Sesion[],
	exerciseId: string,
	metrica: MetricaPr,
	unidad: UnidadPeso = 'kg'
): DatosProgresoEjercicio {
	return {
		progreso: crearProgresoEjercicio(sesiones, exerciseId, unidad),
		puntosCarga: historialPorModo(sesiones, exerciseId, metrica, 'peso', unidad),
		puntosReps: historialPorModo(sesiones, exerciseId, metrica, 'reps', unidad)
	};
}

export function progresoPantallaObs(
	exerciseId: string,
	metrica: MetricaPr,
	unidad: UnidadPeso = 'kg'
) {
	return liveQuery(async () =>
		crearDatosProgresoEjercicio(await sesionesDe(exerciseId), exerciseId, metrica, unidad)
	);
}
