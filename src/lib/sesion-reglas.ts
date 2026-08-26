import type { Ajustes, MetricaPr, PlanSesion, PrCelebrado, Sesion, SetSesion } from './db';
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
	metrica: MetricaEfectiva;
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

/**
 * Métrica configurada para un ejercicio con carga: su override si lo tiene y, si no, el
 * ajuste global. Separada de `resolverMetricaPr` porque algunas pantallas necesitan la
 * métrica antes de saber si el ejercicio puntúa por peso o por reps: el modo depende del
 * historial, que a su vez se consulta con esta métrica. Es la única búsqueda del override.
 */
export function metricaConfigurada(
	ajustes: Pick<Ajustes, 'metricaPr' | 'metricasPrEjercicio'>,
	exerciseId: string
): MetricaPr {
	return ajustes.metricasPrEjercicio?.[exerciseId] ?? ajustes.metricaPr;
}

/**
 * Única resolución de métrica para todo el producto: ejercicios sin carga siempre
 * usan reps; el resto toma primero el override y después el ajuste global.
 */
export function resolverMetricaPr(
	ajustes: Pick<Ajustes, 'metricaPr' | 'metricasPrEjercicio'>,
	exerciseId: string,
	modo: ModoPr
): MetricaEfectiva {
	if (modo === 'reps') return 'reps';
	return metricaConfigurada(ajustes, exerciseId);
}

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

/**
 * Si esta serie hecha es exactamente la que describe el snapshot de PR.
 *
 * Única definición para todo el producto: la usan el marcado de la serie en pantalla,
 * el resumen del día y la reparación al importar un backup. Cuando vivía duplicada, la
 * copia del import comparaba los valores y la de pantalla se conformaba con que el
 * índice apuntara a una serie completa — así un snapshot adulterado marcaba como PR una
 * serie que no lo era.
 */
export function coincideConPr(set: SetSesion | undefined, pr: PrCelebrado): boolean {
	return (
		!!set &&
		serieCompleta(set) &&
		(set.pesoGramos != null || pr.pesoGramos != null
			? set.pesoGramos === pr.pesoGramos
			: set.peso === pr.peso) &&
		set.reps === pr.reps &&
		!!set.esMax === !!pr.esMax &&
		(set.extraGramos != null || pr.extraGramos != null
			? (set.extraGramos ?? 0) === (pr.extraGramos ?? 0)
			: (set.extraKg ?? 0) === (pr.extraKg ?? 0))
	);
}

/**
 * Índice de la serie ✓ que celebró el PR de la sesión; -1 si ninguna.
 *
 * `setIndex` sólo se respeta si esa serie SIGUE coincidiendo con el snapshot: es un
 * desempate entre series idénticas, no una autorización para saltear la comprobación.
 * Sin ese índice —los PR viejos no lo traen— se busca la primera que coincida, que con
 * dos series iguales puede marcar la otra: es lo mejor disponible.
 */
export function indexSetPr(sets: SetSesion[], pr: PrCelebrado | undefined): number {
	if (!pr) return -1;
	if (pr.setIndex != null && coincideConPr(sets[pr.setIndex], pr)) return pr.setIndex;
	return sets.findIndex((set) => coincideConPr(set, pr));
}

/** Un PR celebrado que ya no tiene una serie hecha detrás no es un PR: es un residuo. */
export function prRespaldado(sets: SetSesion[], pr: PrCelebrado | undefined): boolean {
	return indexSetPr(sets, pr) >= 0;
}

/**
 * Un día terminado deja de estarlo cuando aparece trabajo sin resolver.
 *
 * El motivo se persiste, no se pasa por parámetro de navegación: la reapertura casi
 * siempre se dispara desde la pantalla de ejercicio y se lee después, al volver al día.
 * Sin él, la app se lleva en silencio una celebración que acababa de dar.
 *
 * Solo escribe el motivo si REALMENTE había un día terminado que romper: reabrir lo ya
 * abierto no es una novedad y no tiene por qué dejar un cartel.
 */
export function reabrirSesion(
	sesion: Pick<
		Sesion,
		| 'diaTerminado'
		| 'diaTerminadoAt'
		| 'diaTerminadoConPendientes'
		| 'reaperturaMotivo'
		| 'reaperturaAt'
	>,
	motivo: string
): boolean {
	if (!sesion.diaTerminado) return false;
	sesion.diaTerminado = false;
	sesion.diaTerminadoAt = undefined;
	sesion.diaTerminadoConPendientes = undefined;
	sesion.reaperturaMotivo = motivo;
	sesion.reaperturaAt = new Date().toISOString();
	return true;
}

/** Cierra el cartel de reapertura: el día volvió a terminarse o se descartó el aviso. */
export function limpiarReapertura(sesion: Pick<Sesion, 'reaperturaMotivo' | 'reaperturaAt'>): void {
	sesion.reaperturaMotivo = undefined;
	sesion.reaperturaAt = undefined;
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

/**
 * ============================================================================
 * Qué cuenta como "día entrenado" — definición única de todo el producto.
 * ============================================================================
 *
 * Antes había dos, y se contradecían al revés: el historial contaba cualquier
 * sesión con UNA serie hecha, y el objetivo calórico sólo contaba las cerradas a
 * mano. Así, entrenar completo sin tocar "Terminar día" valía cero para las
 * calorías, y una serie con el resto saltado valía un entrenamiento entero.
 */

/**
 * Fracción del plan que hay que cumplir para que el día cuente como entrenado.
 *
 * Fijo, explicable y testeado, como los topes del heatmap. Deliberadamente NO es un
 * ajuste: un umbral por usuario vuelve incomparables dos historiales y nadie podría
 * decir qué significa su propia racha.
 */
export const UMBRAL_DIA_COMPLETO = 0.6;

export type CalidadSesion = 'nula' | 'parcial' | 'completa';

/** Lo que hizo una sesión contra lo que planeaba, sin veredicto todavía. */
export interface TotalesSesion {
	seriesHechas: number;
	/** Series planeadas, o null si la sesión es anterior al congelado del plan. */
	seriesPlan: number | null;
	/** Ejercicios con al menos una serie real. */
	ejerciciosTrabajados: number;
	ejerciciosPlan: number | null;
	/** El usuario cerró el día a mano (con o sin pendientes). */
	cerradaAMano: boolean;
}

export interface EstadoSesion extends TotalesSesion {
	calidad: CalidadSesion;
}

/**
 * El veredicto, en dos cláusulas y ninguna más:
 *
 * 1. Hiciste al menos el 60 % de las series planeadas. No depende de tocar ningún
 *    botón: quien entrena completo y se va del gym queda bien contado igual.
 * 2. O cerraste el día a mano habiendo trabajado en al menos el 60 % de los
 *    ejercicios. Cubre al que hace dos series por ejercicio en vez de cuatro y
 *    termina de verdad — y no cubre al que hizo un ejercicio y saltó el resto,
 *    porque ahí el cierre a mano no alcanza el 60 % de ejercicios tampoco.
 *
 * El cierre a mano sólo puede subir el veredicto, nunca es el único camino. Que el
 * dato dependiera de un toque haría que midiera disciplina con la app en vez de
 * entrenamiento, que es como nació el bug que esto reemplaza.
 */
export function calidadDesde(totales: TotalesSesion): CalidadSesion {
	if (totales.seriesHechas <= 0) return 'nula';
	// Sin denominador no hay porcentaje que calcular, y estimarlo con la rutina de hoy
	// reescribiría el pasado. No juzgamos: la sesión conserva el trato que ya tenía.
	if (totales.seriesPlan == null || totales.seriesPlan <= 0) return 'completa';
	if (totales.seriesHechas / totales.seriesPlan >= UMBRAL_DIA_COMPLETO) return 'completa';
	if (
		totales.cerradaAMano &&
		totales.ejerciciosPlan != null &&
		totales.ejerciciosPlan > 0 &&
		totales.ejerciciosTrabajados / totales.ejerciciosPlan >= UMBRAL_DIA_COMPLETO
	)
		return 'completa';
	return 'parcial';
}

const ORDEN_CALIDAD: Record<CalidadSesion, number> = { nula: 0, parcial: 1, completa: 2 };

/**
 * Veredicto de una FECHA con varias rutinas: manda la mejor de sus sesiones, no la suma.
 *
 * Sumar parecía lo natural y era un error: quien hacía una rutina entera y después
 * empezaba otra y marcaba una serie terminaba con 13 de 24 series —un 54 %— y perdía el
 * día completo que ya se había ganado. Empezar algo más nunca puede restar. La otra cara
 * es que dos medias rutinas no se suman hasta un día completo, que es un caso raro y
 * mucho menos grave que castigar al que entrenó de más.
 */
export function mejorCalidad(calidades: CalidadSesion[]): CalidadSesion {
	return calidades.reduce<CalidadSesion>(
		(mejor, actual) => (ORDEN_CALIDAD[actual] > ORDEN_CALIDAD[mejor] ? actual : mejor),
		'nula'
	);
}

/** Veredicto de una fecha entera a partir de sus sesiones. */
export function calidadDeSesiones(sesiones: Sesion[]): CalidadSesion {
	return mejorCalidad(sesiones.map((sesion) => calidadDesde(totalesSesion(sesion))));
}

/**
 * Suma las cifras visibles de las sesiones de una misma fecha ("9 de 24 series"). Es
 * presentación: el veredicto sale de `calidadDeSesiones`, que toma la mejor y no la suma.
 */
export function sumarTotales(a: TotalesSesion, b: TotalesSesion): TotalesSesion {
	// Un plan ausente contamina la suma: con una sesión vieja adentro, el total deja de
	// tener denominador en vez de fingir uno más chico del real.
	return {
		seriesHechas: a.seriesHechas + b.seriesHechas,
		seriesPlan: a.seriesPlan == null || b.seriesPlan == null ? null : a.seriesPlan + b.seriesPlan,
		ejerciciosTrabajados: a.ejerciciosTrabajados + b.ejerciciosTrabajados,
		ejerciciosPlan:
			a.ejerciciosPlan == null || b.ejerciciosPlan == null
				? null
				: a.ejerciciosPlan + b.ejerciciosPlan,
		cerradaAMano: a.cerradaAMano || b.cerradaAMano
	};
}

export function totalesSesion(sesion: Sesion): TotalesSesion {
	let seriesHechas = 0;
	let ejerciciosTrabajados = 0;
	for (const ejercicio of sesion.ejercicios) {
		const hechas = ejercicio.sets.filter(serieCompleta).length;
		seriesHechas += hechas;
		if (hechas > 0) ejerciciosTrabajados++;
	}
	return {
		seriesHechas,
		seriesPlan: sesion.plan?.series ?? null,
		ejerciciosTrabajados,
		ejerciciosPlan: sesion.plan?.ejercicios ?? null,
		cerradaAMano: !!sesion.diaTerminado
	};
}

/** Estado completo de una sesión: sus totales y el veredicto que sale de ellos. */
export function estadoSesion(sesion: Sesion): EstadoSesion {
	const totales = totalesSesion(sesion);
	return { ...totales, calidad: calidadDesde(totales) };
}

/**
 * El plan de una rutina, para congelarlo en la sesión. `Math.max(1, …)` replica lo que
 * hace la creación de series: una rutina con objetivo 0 igual reserva una serie.
 */
export function planDeDia(ejercicios: { seriesObjetivo: number }[]): PlanSesion {
	return {
		ejercicios: ejercicios.length,
		series: ejercicios.reduce((total, e) => total + Math.max(1, e.seriesObjetivo), 0)
	};
}

/** Si el plan cambió de verdad: evita una escritura por cada toque en la rutina. */
export function mismoPlan(a: PlanSesion | undefined, b: PlanSesion): boolean {
	return a?.ejercicios === b.ejercicios && a?.series === b.series;
}
