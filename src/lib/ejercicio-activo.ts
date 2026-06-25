import type { Ajustes, MetricaPr, SetSesion } from './db';
import type { MejorSet, MetricaEfectiva, ModoPr } from './sesion';

type PuntoConPeso = Pick<MejorSet, 'peso'>;
type SetActivo = Pick<SetSesion, 'peso' | 'reps' | 'hecha'>;

/**
 * Modo para la pantalla de ejercicio en vivo.
 * Sin datos todavía asumimos peso: evita rotular una máquina nueva como "reps máximas"
 * antes de que el usuario cargue su primer set.
 */
export function modoEjercicioActivo(puntos: PuntoConPeso[], sets: SetActivo[]): ModoPr {
	if (puntos.some((p) => p.peso != null) || sets.some((s) => s.peso != null)) return 'peso';
	if (sets.some((s) => s.reps != null)) return 'reps';
	return 'peso';
}

/** true si marcar esta serie completa todas las series del ejercicio. */
export function completaEjercicioAlMarcar(
	sets: Pick<SetSesion, 'hecha'>[],
	index: number
): boolean {
	const set = sets[index];
	if (!set || set.hecha || sets.length === 0) return false;
	return sets.filter((s) => s.hecha).length === sets.length - 1;
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
