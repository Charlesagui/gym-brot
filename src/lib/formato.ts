import type { SetSesion, Ajustes } from './db';

type Unidad = Ajustes['unidad'];

/** Entero sin decimales; si no, con un decimal (evita arrastre de flotantes). */
export function formatoNumero(n: number): string {
	return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const FMT_VOLUMEN = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

/** Volumen con separador de miles es-AR: 12450 → "12.450". */
export function formatoVolumen(n: number): string {
	return FMT_VOLUMEN.format(n);
}

/** Lo mínimo de un set que hace falta para describirlo (MejorSet, SetSesion o PrCelebrado). */
interface SetDescribible {
	peso?: number;
	reps?: number;
	esMax?: boolean;
	extraKg?: number;
}

/** Resumen de un set (peso + extra MAX + reps + etiqueta MAX). La unidad solo aplica con peso. */
export function formatoSet(set: SetDescribible, unidad: string): string {
	// Modo reps (ejercicio sin peso): el set se describe solo por sus repeticiones.
	if (set.peso == null) return set.reps != null ? `${set.reps} reps` : '—';
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
