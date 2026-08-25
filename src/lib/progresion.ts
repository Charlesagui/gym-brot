import type { ProgresionDoble, SetSesion } from './db';
import { serieCompleta } from './sesion-reglas';
import { pesoAGramos, type UnidadPeso } from './unidades';

export interface RecomendacionDoble {
	sesionId: string;
	seriesEvaluadas: number;
	repsMax: number;
	incrementoGramos: number;
	pesoActualGramos: number;
	pesoObjetivoGramos: number;
	esMax: boolean;
	extraActualGramos: number;
	extraObjetivoGramos: number;
	explicacion: string;
}

export interface EvaluacionSinRecomendacion {
	recomendacion: null;
	motivo: 'inactiva' | 'incompleta' | 'reps' | 'sin-carga' | 'cargas-variadas' | 'ya-resuelta';
}

export type EvaluacionProgresion =
	{ recomendacion: RecomendacionDoble; motivo: null } | EvaluacionSinRecomendacion;

function cargaCanonica(set: SetSesion, unidad: UnidadPeso) {
	const pesoGramos = set.pesoGramos ?? pesoAGramos(set.peso, unidad);
	const extraGramos = set.extraGramos ?? pesoAGramos(set.extraKg, unidad) ?? 0;
	return pesoGramos == null
		? null
		: { pesoGramos, esMax: !!set.esMax, extraGramos: set.esMax ? extraGramos : 0 };
}

/** Algoritmo puro: recomienda sólo cuando todas las series válidas llegan al techo con la misma carga. */
export function evaluarDobleProgresion(
	config: ProgresionDoble | undefined,
	sets: SetSesion[],
	sesionId: string,
	incrementoFallbackGramos: number,
	unidad: UnidadPeso = 'kg'
): EvaluacionProgresion {
	if (!config?.activa) return { recomendacion: null, motivo: 'inactiva' };
	if (config.decisionSesionId === sesionId) return { recomendacion: null, motivo: 'ya-resuelta' };
	if (sets.length === 0 || sets.some((set) => !serieCompleta(set)))
		return { recomendacion: null, motivo: 'incompleta' };
	if (sets.some((set) => (set.reps ?? 0) < config.repsMax))
		return { recomendacion: null, motivo: 'reps' };
	const cargas = sets.map((set) => cargaCanonica(set, unidad));
	if (cargas.some((carga) => carga == null)) return { recomendacion: null, motivo: 'sin-carga' };
	const primera = cargas[0]!;
	if (
		cargas.some(
			(carga) =>
				carga!.pesoGramos !== primera.pesoGramos ||
				carga!.esMax !== primera.esMax ||
				carga!.extraGramos !== primera.extraGramos
		)
	)
		return { recomendacion: null, motivo: 'cargas-variadas' };

	const incrementoGramos = config.incrementoGramos ?? incrementoFallbackGramos;
	if (!Number.isInteger(incrementoGramos) || incrementoGramos <= 0)
		return { recomendacion: null, motivo: 'sin-carga' };
	const extraObjetivoGramos = primera.esMax
		? primera.extraGramos + incrementoGramos
		: primera.extraGramos;
	const pesoObjetivoGramos = primera.esMax
		? primera.pesoGramos
		: primera.pesoGramos + incrementoGramos;
	return {
		motivo: null,
		recomendacion: {
			sesionId,
			seriesEvaluadas: sets.length,
			repsMax: config.repsMax,
			incrementoGramos,
			pesoActualGramos: primera.pesoGramos,
			pesoObjetivoGramos,
			esMax: primera.esMax,
			extraActualGramos: primera.extraGramos,
			extraObjetivoGramos,
			explicacion: `Las ${sets.length} series completadas llegaron a ${config.repsMax} reps con la misma carga.`
		}
	};
}
