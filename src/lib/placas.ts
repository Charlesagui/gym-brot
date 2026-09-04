import type { HistorialResumen } from './historial';

/**
 * Placas de tablero: los logros de la app.
 *
 * Una placa es una fila de serie: tiene los mismos tres estados que `SetRow` —lo que
 * falta se insinúa con su objetivo, lo que estás haciendo se muestra entero, lo hecho se
 * contrae a la cifra que lograste— y se lee igual de reojo.
 *
 * **Una placa es una derivación pura, jamás un contador.** No se guarda "llevo cuatro
 * semanas": se recalcula desde el resumen del historial cada vez. Así marcar y desmarcar
 * cien veces devuelve exactamente lo mismo sin una sola línea anti-repetición, que es la
 * única forma de que la regla de "ir y venir no acumula" no se rompa dentro de seis meses.
 *
 * Tampoco se persiste un "ya la celebré": la placa sabe QUÉ DÍA se ganó (`ganadaEl`), y
 * el cierre del día celebra las que se ganaron ese día. Corregir el pasado puede hacer
 * aparecer una placa en la lista, pero nunca dispara una fanfarria que no viviste —
 * el mismo criterio de "sólo degrada, nunca promueve" que rige los PR.
 *
 * Por ahora una sola familia, Constancia. Las otras cuatro son estas mismas tres reglas
 * aplicadas a otro campo.
 */

export type FamiliaPlaca = 'constancia';
export type EstadoPlaca = 'falta' | 'en-curso' | 'ganada';

export interface Placa {
	id: string;
	familia: FamiliaPlaca;
	/** Rótulo corto y sobrio: "Un mes sin faltar". Sin mitología. */
	nombre: string;
	/** La cifra que manda: el umbral. */
	objetivo: number;
	/** De qué está hecho el objetivo, en plural: "semanas seguidas", "días completos". */
	medida: string;
	/** Dónde estás hoy respecto del objetivo; va en el anillo. Nunca supera `objetivo`. */
	progreso: number;
	estado: EstadoPlaca;
	/** Fecha (YYYY-MM-DD) del día que la ganó. Sólo en estado `ganada`. */
	ganadaEl?: string;
}

/**
 * Escalones de la racha. Cuatro y no seis: el manifiesto pide breve e intenso, y una
 * escalera con peldaños cada dos semanas convierte el logro en rutina.
 */
const ESCALONES_RACHA: ReadonlyArray<{ semanas: number; nombre: string }> = [
	{ semanas: 4, nombre: 'Un mes sin faltar' },
	{ semanas: 13, nombre: 'Un trimestre entero' },
	{ semanas: 26, nombre: 'Medio año sin cortar' },
	{ semanas: 52, nombre: 'Un año seguido' }
];

/**
 * Escalones de días completos. Cuentan sólo los días con calidad `completa`, igual que la
 * cifra "días entrenados" del historial: la racha protege, este contador informa.
 */
const ESCALONES_DIAS: ReadonlyArray<{ dias: number; nombre: string }> = [
	{ dias: 10, nombre: 'Los primeros diez' },
	{ dias: 50, nombre: 'Cincuenta completos' },
	{ dias: 100, nombre: 'Cien días completos' }
];

/**
 * Primer día entrenado de cada semana del historial, en orden cronológico, junto con
 * la corrida de semanas seguidas que llega hasta ella.
 *
 * `resumen.semanas` viene de la más nueva a la más vieja y `resumen.dias` igual: acá se
 * dan vuelta una sola vez. Una semana sin entrenar corta la corrida; la semana en curso
 * sin entrenar también la corta ACÁ, pero eso no importa: el largo histórico no cambia,
 * y para el progreso de hoy manda `rachaSemanal`, que ya trae la gracia.
 */
function corridasSemanales(resumen: HistorialResumen): { corrida: number; primerDia: string }[] {
	const fechas = resumen.dias.map((d) => d.fecha).sort();
	const semanas = [...resumen.semanas].reverse();
	const salida: { corrida: number; primerDia: string }[] = [];
	let corrida = 0;
	for (const semana of semanas) {
		if (!semana.entrenada) {
			corrida = 0;
			continue;
		}
		corrida++;
		// Una semana `entrenada` tiene por definición al menos una fecha adentro.
		const primerDia = fechas.find((f) => f >= semana.inicio && f <= semana.fin)!;
		salida.push({ corrida, primerDia });
	}
	return salida;
}

/** Fecha en que una corrida alcanzó `n` semanas por primera vez, o null si nunca. */
function rachaAlcanzadaEl(corridas: { corrida: number; primerDia: string }[], n: number) {
	return corridas.find((c) => c.corrida === n)?.primerDia ?? null;
}

/**
 * Las placas de Constancia, derivadas del resumen. Cada escalera tiene a lo sumo UNA
 * placa en curso: la siguiente que todavía no ganaste. Es "lo que estás haciendo es lo
 * único abierto", aplicado a los logros.
 */
export function placasConstancia(resumen: HistorialResumen): Placa[] {
	const corridas = corridasSemanales(resumen);
	const completosAsc = resumen.dias
		.filter((d) => d.calidad === 'completa')
		.map((d) => d.fecha)
		.sort();

	const racha = escalera(
		ESCALONES_RACHA.map((e) => ({
			id: `racha-${e.semanas}`,
			nombre: e.nombre,
			objetivo: e.semanas,
			medida: 'semanas seguidas',
			ganadaEl: rachaAlcanzadaEl(corridas, e.semanas)
		})),
		resumen.rachaSemanal
	);
	const dias = escalera(
		ESCALONES_DIAS.map((e) => ({
			id: `dias-${e.dias}`,
			nombre: e.nombre,
			objetivo: e.dias,
			medida: 'días completos',
			ganadaEl: completosAsc[e.dias - 1] ?? null
		})),
		resumen.totalDias
	);
	return [...racha, ...dias];
}

interface Peldano {
	id: string;
	nombre: string;
	objetivo: number;
	medida: string;
	ganadaEl: string | null;
}

/** Sella el estado de cada peldaño: ganado si tiene fecha; si no, en curso el primero y falta el resto. */
function escalera(peldanos: Peldano[], progresoActual: number): Placa[] {
	let enCursoAsignada = false;
	return peldanos.map((p) => {
		const base = {
			id: p.id,
			familia: 'constancia' as const,
			nombre: p.nombre,
			objetivo: p.objetivo,
			medida: p.medida
		};
		if (p.ganadaEl) {
			return { ...base, progreso: p.objetivo, estado: 'ganada', ganadaEl: p.ganadaEl };
		}
		const progreso = Math.min(progresoActual, p.objetivo);
		if (!enCursoAsignada) {
			enCursoAsignada = true;
			return { ...base, progreso, estado: 'en-curso' };
		}
		return { ...base, progreso, estado: 'falta' };
	});
}

/** Las que se ganaron exactamente ese día: lo que el cierre del día tiene para celebrar. */
export function placasGanadasEl(placas: Placa[], fecha: string): Placa[] {
	return placas.filter((p) => p.estado === 'ganada' && p.ganadaEl === fecha);
}

/** Texto del pie de una placa, según su estado. Vive acá para que el cierre y la lista digan lo mismo. */
export function pieDePlaca(placa: Placa, fechaGanada: (f: string) => string): string {
	switch (placa.estado) {
		case 'ganada':
			return `Ganada el ${fechaGanada(placa.ganadaEl!)}`;
		case 'en-curso':
			return `Vas ${placa.progreso} de ${placa.objetivo} ${placa.medida}`;
		case 'falta':
			return `${placa.objetivo} ${placa.medida}`;
	}
}
