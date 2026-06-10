import type { SetSesion, Ajustes } from './db';
import type { MejorSet } from './sesion';

type Unidad = Ajustes['unidad'];

/** Entero sin decimales; si no, con un decimal (evita arrastre de flotantes). */
export function formatoNumero(n: number): string {
	return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Resumen de un set (peso + extra MAX + reps + etiqueta MAX). */
export function formatoSet(set: MejorSet, unidad: Unidad): string {
	const extra = set.esMax && set.extraKg ? ` +${formatoNumero(set.extraKg)}` : '';
	return `${formatoNumero(set.peso)}${extra} ${unidad}${set.reps ? ` × ${set.reps}` : ''}${set.esMax ? ' · MAX' : ''}`;
}

/** Resumen de una serie de la última vez, para la columna "Anterior". */
export function formatoAnterior(set: SetSesion | undefined, unidad: Unidad): string | null {
	if (!set || (set.peso == null && set.reps == null)) return null;
	const peso = set.peso != null ? `${formatoNumero(set.peso)} ${unidad}` : '—';
	const reps = set.reps != null ? ` × ${set.reps}` : '';
	return `${peso}${reps}`;
}

/** Fecha YYYY-MM-DD → "5 jun" (local, es). */
export function fechaCorta(f: string | null): string {
	if (!f) return '';
	const d = new Date(`${f}T00:00:00`);
	return d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
