import type { MetricaPr, PrCelebrado, Sesion, SetSesion } from './db';

/** Cómo puntúa un ejercicio: por peso o por reps si nunca registró peso. */
export type ModoPr = 'peso' | 'reps';

/** Métrica que la UI rotula: la de ajustes, o reps máximas en ejercicios sin carga. */
export type MetricaEfectiva = MetricaPr | 'reps';

export interface MejorSet {
	/** Ausente en modo reps: el ejercicio no usa peso y el valor son las reps. */
	peso?: number;
	reps?: number;
	esMax: boolean;
	extraKg?: number;
	fecha: string;
	valor: number;
	sesionId?: string;
	setIndex?: number;
}

export interface RecordEjercicio extends MejorSet {
	exerciseId: string;
	/** Con qué se midió el récord, para que la UI siempre rotule (kg vs reps). */
	modo: ModoPr;
}

/** Epley sobreestima fuerte con reps altas → tope en 12 (por encima puntúa como 12). */
const TOPE_REPS_E1RM = 12;

/** La interfaz muestra un decimal: comparar el mismo valor evita PRs fantasma por IEEE-754. */
function normalizarValorPr(valor: number): number {
	return Math.round(valor * 10) / 10;
}

export const METRICAS_EFECTIVAS: MetricaEfectiva[] = ['peso', 'e1rm', 'reps'];

/** Peso ingresado más lo que haya encima de la placa si el set es MAX. */
export function pesoEfectivo(s: {
	peso?: number;
	esMax?: boolean;
	extraKg?: number;
}): number | null {
	if (s.peso == null) return null;
	return s.peso + (s.esMax ? (s.extraKg ?? 0) : 0);
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
	return peso;
}

/** Valor de un set bajo métrica y modo; null si todavía no puntúa. */
export function valorSet(
	set: { peso?: number; reps?: number; esMax?: boolean; extraKg?: number },
	metrica: MetricaPr,
	modo: ModoPr = 'peso'
): number | null {
	if (modo === 'reps') return set.peso == null ? (set.reps ?? null) : null;
	const efectivo = pesoEfectivo(set);
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
	return set.hecha && set.reps != null;
}

/** 'reps' si hay series hechas y ninguna registró peso; si no, 'peso'. */
export function modoEjercicio(sesiones: Sesion[], exerciseId: string): ModoPr {
	let tieneHechas = false;
	for (const sesion of sesiones) {
		const ejercicio = sesion.ejercicios.find((item) => item.exerciseId === exerciseId);
		for (const set of ejercicio?.sets ?? []) {
			if (!set.hecha) continue;
			if (set.peso != null) return 'peso';
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
	modo: ModoPr = 'peso'
): MejorSet | null {
	return sets.reduce<MejorSet | null>((best, set, setIndex) => {
		if (!set.hecha) return best;
		const valor = valorSet(set, metrica, modo);
		if (valor == null) return best;
		return mejorSet(best, {
			peso: set.peso,
			reps: set.reps,
			esMax: !!set.esMax,
			extraKg: set.extraKg,
			fecha,
			valor,
			sesionId: sesionIdFuente,
			setIndex
		});
	}, null);
}

export function metricaDeSnapshot(pr: PrCelebrado): MetricaEfectiva {
	return pr.metrica ?? (pr.peso == null ? 'reps' : 'peso');
}

export function modoDeMetrica(metrica: MetricaEfectiva): ModoPr {
	return metrica === 'reps' ? 'reps' : 'peso';
}

export function snapPr(set: MejorSet, metrica: MetricaEfectiva): PrCelebrado {
	return {
		peso: set.peso,
		reps: set.reps,
		esMax: set.esMax,
		extraKg: set.extraKg,
		setIndex: set.setIndex,
		metrica
	};
}
