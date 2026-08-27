import type { SetSesion, Ajustes } from './db';

type Unidad = Ajustes['unidad'];

/**
 * Entero sin decimales; si no, con un decimal (evita arrastre de flotantes).
 *
 * El separador es la coma, como en es-AR. Antes salía `62.5` mientras `formatoVolumen`
 * —que sí usa `Intl` en es-AR— escribía `12.450` para doce mil: el mismo punto era coma
 * decimal en un lado y separador de miles en el otro, en la misma pantalla.
 *
 * Es seguro para lo que vuelve a leerse desde un input: `leerPeso` normaliza la coma.
 */
export function formatoNumero(n: number): string {
	return (Number.isInteger(n) ? String(n) : n.toFixed(1)).replace('.', ',');
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
	if (set.peso == null)
		return set.reps != null ? `${set.reps} ${set.reps === 1 ? 'rep' : 'reps'}` : '—';
	const extra = set.esMax && set.extraKg ? ` +${formatoNumero(set.extraKg)}` : '';
	return `${formatoNumero(set.peso)}${extra} ${unidad}${set.reps ? ` × ${set.reps}` : ''}${set.esMax ? ' · MAX' : ''}`;
}

/** Separador entre cifras del mismo tipo dentro de un resumen. */
const SEP = ' · ';

/**
 * Resumen de un grupo de series hechas, en dos trozos con la unidad en el medio.
 *
 * La vista pinta `inicio`, después la unidad chica (`.cifra-u`) y después `resto`. Ese
 * único punto de anclaje alcanza para las cuatro formas del resumen porque la unidad
 * siempre cierra el bloque de cargas: "60ᴷᴳ × 10", "60 · 62,5 · 65ᴷᴳ × 10", "60ᴷᴳ×10 ·
 * 62,5×10" y, sin carga, "12 · 12 · 10ʳᵉᵖˢ".
 */
export interface ResumenSeries {
	/** Cifras hasta la unidad. */
	inicio: string;
	/** Cifras después de la unidad. Vacío cuando la unidad cierra el resumen. */
	resto: string;
	/** Qué rotula la unidad: la carga, las repeticiones, o nada (grupo vacío). */
	unidad: 'peso' | 'reps' | null;
}

/**
 * Se conservan las ÚLTIMAS: la pregunta del renglón es si la carga se sostuvo hasta acá.
 *
 * Cuántas quedaron afuera no se devuelve. Se devolvía, para pintar un "+N" adelante que
 * nadie entendía —el "+" ya significa otra cosa en la misma lista: "+2,5" son los kilos
 * que subiste respecto de la vez pasada—. El conteo del grupo ("5 series hechas") ya
 * dice cuántas hay.
 */
function recortar<T>(lista: T[], max: number): T[] {
	return lista.length <= max ? lista : lista.slice(-max);
}

/** La carga de una serie, con el extra del MAX incluido: la placa base sola miente. */
function cifraCarga(set: SetDescribible): string {
	if (set.peso == null) return '—';
	const extra = set.esMax && set.extraKg ? `+${formatoNumero(set.extraKg)}` : '';
	return `${formatoNumero(set.peso)}${extra}`;
}

/**
 * Resume las series hechas para el renglón agrupado, factorizando lo que se repite.
 *
 * Antes se imprimía una carga por serie —"60×10 · 62,5×10 · 65×8"—, que en el caso más
 * común (misma carga todas las series) eran seis cifras para decir dos. Si el peso o las
 * reps son iguales en todas, se nombran una sola vez.
 *
 * Cuando varían las dos NO se pueden separar: "60 · 65" al lado de "10 · 8" deja de
 * decir cuál fue con cuál, así que ahí cada serie conserva su par.
 *
 * `max` recorta la lista que efectivamente se imprime. Si todo se repite esa lista es de
 * un solo elemento y no se recorta nada, porque no hay nada que recortar: "60 kg × 10"
 * describe ocho series igual de bien que tres.
 */
export function resumenSeries(sets: SetDescribible[], max = 4): ResumenSeries {
	if (sets.length === 0) return { inicio: '', resto: '', unidad: null };

	const reps = sets.map((set) => (set.reps != null ? String(set.reps) : '—'));
	const mismasReps = reps.every((valor) => valor === reps[0]);

	// Ejercicio sin carga: sólo hay repeticiones que contar, y la unidad las cierra.
	if (sets.every((set) => set.peso == null)) {
		const visibles = recortar(mismasReps ? [reps[0]!] : reps, max);
		return { inicio: visibles.join(SEP), resto: '', unidad: 'reps' };
	}

	const pesos = sets.map(cifraCarga);
	const mismoPeso = pesos.every((valor) => valor === pesos[0]);

	if (mismoPeso) {
		const visibles = recortar(mismasReps ? [reps[0]!] : reps, max);
		return { inicio: pesos[0]!, resto: ` × ${visibles.join(SEP)}`, unidad: 'peso' };
	}

	if (mismasReps) {
		const visibles = recortar(pesos, max);
		return { inicio: visibles.join(SEP), resto: ` × ${reps[0]}`, unidad: 'peso' };
	}

	// Varían las dos: par por par, con la unidad pegada a la primera carga.
	const visibles = recortar(
		pesos.map((peso, indice) => ({ peso, reps: reps[indice]! })),
		max
	);
	const [primera, ...siguen] = visibles;
	const cola = siguen.map((par) => `${par.peso}×${par.reps}`);
	return {
		inicio: primera!.peso,
		resto: `×${primera!.reps}${cola.length ? SEP + cola.join(SEP) : ''}`,
		unidad: 'peso'
	};
}

/**
 * Resumen de una serie de la última vez, para la columna "Anterior". Incluye el MAX y su
 * extra: sin eso la referencia mostraba la placa base y ocultaba parte de lo levantado,
 * justo en las máquinas donde el MAX es la única forma de progresar.
 */
export function formatoAnterior(set: SetSesion | undefined, unidad: Unidad): string | null {
	if (!set || (set.peso == null && set.reps == null)) return null;
	const extra = set.esMax && set.extraKg ? ` +${formatoNumero(set.extraKg)}` : '';
	const peso = set.peso != null ? `${formatoNumero(set.peso)}${extra} ${unidad}` : '—';
	const reps = set.reps != null ? ` × ${set.reps}` : '';
	return `${peso}${reps}${set.esMax ? ' · MAX' : ''}`;
}

/** Fecha YYYY-MM-DD → "5 jun" (local, es). */
export function fechaCorta(f: string | null, incluirAno = false): string {
	if (!f) return '';
	const d = new Date(`${f}T00:00:00`);
	return d.toLocaleDateString('es', {
		day: 'numeric',
		month: 'short',
		...(incluirAno ? { year: 'numeric' } : {})
	});
}
