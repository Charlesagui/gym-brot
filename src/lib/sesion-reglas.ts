import type { MetricaPr, PrCelebrado, Sesion, SetSesion } from './db';
import { conPesoCanonico, conPesoVisible, gramosAPeso, type UnidadPeso } from './unidades';

/** Cómo puntúa un ejercicio: por peso o por reps si nunca registró peso. */
export type ModoPr = 'peso' | 'reps';

/** Métrica que la UI rotula: la de ajustes, o reps máximas en ejercicios sin carga. */
export type MetricaEfectiva = MetricaPr | 'reps';
export type EstadoEjercicio = 'pendiente' | 'saltado' | 'parcial' | 'completado';

export interface MejorSet {
	/** Ausente en modo reps: el ejercicio no usa peso y el valor son las reps. */
	peso?: number;
	pesoGramos?: number;
	reps?: number;
	esMax: boolean;
	extraKg?: number;
	extraGramos?: number;
	fecha: string;
	valor: number;
	sesionId?: string;
	setIndex?: number;
}

export interface RecordEjercicio extends MejorSet {
	exerciseId: string;
	/** Con qué se midió el récord, para que la UI siempre rotule (kg vs reps). */
	modo: ModoPr;
	/**
	 * Nombre congelado en la sesión más reciente que lo registró. Va en el récord para
	 * que la pantalla de historial no tenga que cargar el catálogo entero (193 KB) solo
	 * para resolver un puñado de nombres.
	 */
	nombre?: string;
}

/** Epley sobreestima fuerte con reps altas → tope en 12 (por encima puntúa como 12). */
const TOPE_REPS_E1RM = 12;

/** La interfaz muestra un decimal: comparar el mismo valor evita PRs fantasma por IEEE-754. */
function normalizarValorPr(valor: number): number {
	return Math.round(valor * 10) / 10;
}

export const METRICAS_EFECTIVAS: MetricaEfectiva[] = ['peso', 'e1rm', 'reps'];

/** Peso ingresado más lo que haya encima de la placa si el set es MAX. */
export function pesoEfectivo(
	s: {
		peso?: number;
		pesoGramos?: number;
		esMax?: boolean;
		extraKg?: number;
		extraGramos?: number;
	},
	unidad: UnidadPeso = 'kg'
): number | null {
	if (s.pesoGramos != null) {
		const gramos = s.pesoGramos + (s.esMax ? (s.extraGramos ?? 0) : 0);
		return gramosAPeso(gramos, unidad) ?? null;
	}
	if (s.peso == null) return null;
	return normalizarValorPr(s.peso + (s.esMax ? (s.extraKg ?? 0) : 0));
}

/** Valor de una carga según peso directo o 1RM estimado de Epley. */
export function valorMetrica(
	peso: number,
	reps: number | undefined,
	metrica: MetricaPr
): number | null {
	if (metrica === 'e1rm') {
		if (reps == null || reps <= 0) return null;
		return normalizarValorPr(peso * (1 + Math.min(TOPE_REPS_E1RM, reps) / 30));
	}
	return normalizarValorPr(peso);
}

/** Las repeticiones son una cantidad discreta: positiva y sin fracciones. */
export function repeticionesValidas(reps: number | undefined): reps is number {
	return reps != null && Number.isInteger(reps) && reps > 0;
}

/** Valor de un set bajo métrica y modo; null si todavía no puntúa. */
export function valorSet(
	set: {
		peso?: number;
		pesoGramos?: number;
		reps?: number;
		esMax?: boolean;
		extraKg?: number;
		extraGramos?: number;
	},
	metrica: MetricaPr,
	modo: ModoPr = 'peso',
	unidad: UnidadPeso = 'kg'
): number | null {
	// Ninguna métrica puntúa una serie que el dominio no considera trabajo real.
	if (!repeticionesValidas(set.reps)) return null;
	if (modo === 'reps') return set.peso == null && set.pesoGramos == null ? set.reps : null;
	const efectivo = pesoEfectivo(set, unidad);
	return efectivo == null ? null : valorMetrica(efectivo, set.reps, metrica);
}

/** Explicación corta de cada métrica de PR — única fuente para toda la UI. */
export const DESCRIPCION_METRICA: Record<MetricaEfectiva, string> = {
	e1rm: 'El 1RM estimado (1 Repetición Máxima, fórmula de Epley) calcula tu fuerza máxima teórica a partir de peso y reps: 95 × 12 supera a 100 × 1. Premia la sobrecarga por repeticiones. Es fiable hasta ~12 reps: por encima se calcula como 12.',
	peso: 'El récord es la serie de mayor peso, sin importar las reps. Si el peso se repite, mostramos la que tuvo más reps.',
	reps: 'Este ejercicio se hace sin peso: el récord es la serie hecha con más repeticiones. La métrica de PR de Ajustes (peso/1RM) no aplica acá.'
};

/** Una serie cuenta como completa cuando fue confirmada y tiene repeticiones. */
export function serieCompleta(set: SetSesion): boolean {
	return set.hecha && repeticionesValidas(set.reps);
}

/** Estado visible sin convertir trabajo parcial ni un salto en un ejercicio completo. */
export function estadoEjercicioSesion(sets: SetSesion[], saltado = false): EstadoEjercicio {
	const hechas = sets.filter(serieCompleta).length;
	if (sets.length > 0 && hechas === sets.length) return 'completado';
	if (saltado && hechas > 0) return 'parcial';
	if (saltado) return 'saltado';
	return 'pendiente';
}

/** 'reps' si hay series hechas y ninguna registró peso; si no, 'peso'. */
export function modoEjercicio(sesiones: Sesion[], exerciseId: string): ModoPr {
	let tieneHechas = false;
	for (const sesion of sesiones) {
		const ejercicio = sesion.ejercicios.find((item) => item.exerciseId === exerciseId);
		for (const set of ejercicio?.sets ?? []) {
			if (!serieCompleta(set)) continue;
			if (set.peso != null || set.pesoGramos != null) return 'peso';
			tieneHechas = true;
		}
	}
	return tieneHechas ? 'reps' : 'peso';
}

/** El mejor de dos sets bajo `valor` (desempata por reps). */
export function mejorSet(a: MejorSet | null, b: MejorSet): MejorSet {
	if (!a) return b;
	if (b.valor > a.valor) return b;
	if (b.valor === a.valor && (b.reps ?? 0) > (a.reps ?? 0)) return b;
	return a;
}

/** Mejor set hecho de una sesión bajo una métrica y modo concretos. */
export function mejorSetDeSeries(
	sets: SetSesion[],
	fecha: string,
	metrica: MetricaPr,
	sesionIdFuente?: string,
	modo: ModoPr = 'peso',
	unidad: UnidadPeso = 'kg'
): MejorSet | null {
	return sets.reduce<MejorSet | null>((best, set, setIndex) => {
		if (!serieCompleta(set)) return best;
		const valor = valorSet(set, metrica, modo, unidad);
		if (valor == null) return best;
		return mejorSet(
			best,
			conPesoVisible(
				{
					peso: set.peso,
					pesoGramos: set.pesoGramos,
					reps: set.reps,
					esMax: !!set.esMax,
					extraKg: set.extraKg,
					extraGramos: set.extraGramos,
					fecha,
					valor,
					sesionId: sesionIdFuente,
					setIndex
				},
				unidad
			)
		);
	}, null);
}

export function metricaDeSnapshot(pr: PrCelebrado): MetricaEfectiva {
	return pr.metrica ?? (pr.peso == null ? 'reps' : 'peso');
}

export function modoDeMetrica(metrica: MetricaEfectiva): ModoPr {
	return metrica === 'reps' ? 'reps' : 'peso';
}

export function snapPr(
	set: MejorSet,
	metrica: MetricaEfectiva,
	unidad: UnidadPeso = 'kg'
): PrCelebrado {
	return conPesoCanonico(
		{
			peso: set.peso,
			reps: set.reps,
			esMax: set.esMax,
			extraKg: set.extraKg,
			setIndex: set.setIndex,
			metrica
		},
		unidad
	);
}
