import type { Ajustes, MetricaPr, SetSesion } from './db';
import type { MejorSet, MetricaEfectiva, ModoPr } from './sesion-reglas';

type PuntoConPeso = Pick<MejorSet, 'peso'>;
type SetActivo = Pick<SetSesion, 'peso' | 'reps' | 'hecha'>;

/**
 * Modo para la pantalla de ejercicio en vivo.
 * Sin datos todavía asumimos peso: evita rotular una máquina nueva como "reps máximas"
 * antes de que el usuario cargue su primer set.
 */
export function modoEjercicioActivo(puntos: PuntoConPeso[], sets: SetActivo[]): ModoPr {
	if (puntos.some((p) => p.peso != null) || sets.some((s) => s.hecha && s.peso != null))
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
