import type { Ajustes, Dia, MetricaPr, Sesion, SetSesion } from './db';
import {
	estadoEjercicioSesion,
	serieCompleta,
	type MejorSet,
	type MetricaEfectiva,
	type ModoPr
} from './sesion-reglas';

type PuntoConPeso = Pick<MejorSet, 'peso'>;
type SetActivo = Pick<SetSesion, 'peso' | 'reps' | 'hecha'>;

/**
 * Modo para la pantalla de ejercicio en vivo.
 * Sin datos todavía asumimos peso: evita rotular una máquina nueva como "reps máximas"
 * antes de que el usuario cargue su primer set.
 */
export function modoEjercicioActivo(puntos: PuntoConPeso[], sets: SetActivo[]): ModoPr {
	if (puntos.some((p) => p.peso != null) || sets.some((s) => serieCompleta(s) && s.peso != null))
		return 'peso';
	if (sets.some((s) => s.reps != null)) return 'reps';
	return 'peso';
}

/**
 * Etiqueta de lo que sigue tras el descanso ("Press pecho · serie 3/4"), para no perder
 * el hilo al volver. Busca la próxima pendiente después de `reciente` y, si esa era la
 * última, vuelve a la primera pendiente. Vacío si no queda ninguna.
 */
export function etiquetaProximaSerie(
	sets: Pick<SetSesion, 'hecha'>[],
	reciente: number,
	nombre: string
): string {
	const pendientes = sets
		.map((s, idx) => ({ hecha: s.hecha, idx }))
		.filter((p) => p.idx !== reciente && !p.hecha);
	const prox = pendientes.find((p) => p.idx > reciente) ?? pendientes[0];
	return prox ? `${nombre} · serie ${prox.idx + 1}/${sets.length}` : '';
}

/** El que sigue en la rutina, para poder encadenar ejercicios sin volver al día. */
export interface ProximoEjercicio {
	exerciseId: string;
	nombre: string;
}

/**
 * Próximo ejercicio sin resolver del día, empezando después de `actual` y dando la
 * vuelta al final de la lista: si entraste por el tercero, lo que sigue es el cuarto,
 * y recién cuando no queda nada abajo se vuelve a los de arriba que quedaron pendientes.
 *
 * "Resuelto" es lo mismo que para terminar el día (hecho o saltado): un ejercicio
 * saltado no puede volver a proponerse como si nada hubiera pasado.
 */
export function proximoEjercicioPendiente(
	dia: Pick<Dia, 'ejercicios'> | undefined,
	sesion: Pick<Sesion, 'ejercicios'> | undefined,
	actual: string,
	nombreDe: (exerciseId: string) => string | undefined
): ProximoEjercicio | null {
	if (!dia) return null;
	const orden = [...dia.ejercicios].sort((a, b) => a.orden - b.orden);
	const desde = orden.findIndex((item) => item.exerciseId === actual);
	// Sin el actual en la lista (lo quitaron mientras entrenabas) recorremos desde el principio.
	const inicio = desde < 0 ? 0 : desde + 1;
	for (let salto = 0; salto < orden.length; salto++) {
		const item = orden[(inicio + salto) % orden.length]!;
		if (item.exerciseId === actual) continue;
		const enSesion = sesion?.ejercicios.find((e) => e.exerciseId === item.exerciseId);
		const estado = estadoEjercicioSesion(enSesion?.sets ?? [], enSesion?.saltado);
		if (estado === 'completado' || estado === 'saltado' || estado === 'parcial') continue;
		return {
			exerciseId: item.exerciseId,
			nombre: nombreDe(item.exerciseId) ?? enSesion?.nombreSnapshot ?? 'Siguiente ejercicio'
		};
	}
	return null;
}

export function metricaEfectivaEjercicio(modo: ModoPr, metrica: MetricaPr): MetricaEfectiva {
	return modo === 'reps' ? 'reps' : metrica;
}

export function metricaLabelEjercicio(modo: ModoPr, metrica: MetricaPr): string {
	if (modo === 'reps') return 'reps máximas';
	return metrica === 'e1rm' ? '1RM estimado (1 Repetición Máxima)' : 'peso máximo';
}

export function unidadValorEjercicio(modo: ModoPr, unidad: Ajustes['unidad']): string {
	return modo === 'reps' ? 'reps' : unidad;
}
