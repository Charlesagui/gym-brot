import { liveQuery } from 'dexie';
import { catalogo } from './catalog';
import { MUSCULOS_COMPACTOS } from './data/exercise-muscles';
import { db, type Sesion } from './db';
import { serieCompleta } from './sesion-reglas';

export type MusculoMapa =
	| 'chest'
	| 'abs'
	| 'obliques'
	| 'biceps'
	| 'triceps'
	| 'deltoids'
	| 'forearms'
	| 'quadriceps'
	| 'adductors'
	| 'calves'
	| 'tibialis'
	| 'serratus'
	| 'hip-flexors'
	| 'trapezius'
	| 'upper-back'
	| 'lower-back'
	| 'glutes'
	| 'hamstrings';

export interface MetadataMuscular {
	principal: MusculoMapa | null;
	secundarios: MusculoMapa[];
	aliasesNoRepresentados: string[];
}

const MUSCULO_POR_CODIGO: Record<string, MusculoMapa> = {
	a: 'abs',
	b: 'biceps',
	c: 'chest',
	d: 'deltoids',
	f: 'forearms',
	g: 'glutes',
	h: 'hamstrings',
	i: 'hip-flexors',
	l: 'lower-back',
	o: 'obliques',
	q: 'quadriceps',
	r: 'adductors',
	s: 'serratus',
	t: 'triceps',
	u: 'upper-back',
	v: 'calves',
	w: 'tibialis',
	z: 'trapezius'
};

export const METADATA_MUSCULAR = Object.fromEntries(
	catalogo.map((ejercicio, indice) => {
		const [principal, secundarios, noRepresentados] = MUSCULOS_COMPACTOS[indice] ?? ['', '', ''];
		return [
			ejercicio.id,
			{
				principal: MUSCULO_POR_CODIGO[principal] ?? null,
				secundarios: [...secundarios].map((codigo) => MUSCULO_POR_CODIGO[codigo]!),
				aliasesNoRepresentados: noRepresentados ? noRepresentados.split('|') : []
			}
		];
	})
) as Record<string, MetadataMuscular>;

export const MUSCULOS: Record<MusculoMapa, { label: string; geometria: string }> = {
	chest: { label: 'Pectorales', geometria: 'chest' },
	abs: { label: 'Abdominales', geometria: 'abs' },
	obliques: { label: 'Oblicuos', geometria: 'obliques' },
	biceps: { label: 'Bíceps', geometria: 'biceps' },
	triceps: { label: 'Tríceps', geometria: 'triceps' },
	deltoids: { label: 'Deltoides', geometria: 'deltoids' },
	forearms: { label: 'Antebrazos', geometria: 'forearm' },
	quadriceps: { label: 'Cuádriceps', geometria: 'quadriceps' },
	adductors: { label: 'Aductores', geometria: 'adductors' },
	calves: { label: 'Gemelos', geometria: 'calves' },
	tibialis: { label: 'Tibial anterior', geometria: 'tibialis' },
	serratus: { label: 'Serrato anterior', geometria: 'serratus' },
	'hip-flexors': { label: 'Flexores de cadera', geometria: 'hipFlexors' },
	trapezius: { label: 'Trapecios', geometria: 'trapezius' },
	'upper-back': { label: 'Espalda alta y dorsales', geometria: 'upperBack' },
	'lower-back': { label: 'Espalda baja', geometria: 'lowerBack' },
	glutes: { label: 'Glúteos', geometria: 'gluteal' },
	hamstrings: { label: 'Isquiotibiales', geometria: 'hamstring' }
};

export interface CargaMuscular {
	musculo: MusculoMapa;
	label: string;
	seriesEstimadas: number;
	seriesPrimarias: number;
	seriesSecundarias: number;
}

export interface DistribucionMuscular {
	desde: string;
	hasta: string;
	semanas: number;
	soloDuras: boolean;
	/** Todas las series completas del período: es el denominador de `coberturaRir`. */
	seriesCompletadas: number;
	/** Las que el filtro vigente deja pasar y por lo tanto sostienen el mapa. */
	seriesConsideradas: number;
	seriesConRir: number;
	coberturaRir: number;
	puedeFiltrarDuras: boolean;
	seriesSinRepresentacion: number;
	cargas: CargaMuscular[];
}

/**
 * Series estimadas por semana con las que un músculo se pinta lleno.
 *
 * El color era relativo al músculo más cargado del período, y eso tenía tres
 * consecuencias que ninguna cifra de la pantalla desmentía:
 *
 * - El cuerpo no se llenaba nunca. El músculo top se pintaba al 100 % con un día suelto
 *   de entrenamiento y con doce semanas: el dibujo se ve igual el primer lunes que en
 *   marzo, porque el denominador crece junto con el numerador.
 * - El denominador se movía solo. Con sólo el día de piernas hecho, el cuádriceps (8
 *   series) se pintaba al máximo; al hacer el día de empuje, el mismo cuádriceps con las
 *   mismas 8 series bajaba de alfa 0,96 a 0,71. Hacer pecho apagaba las piernas.
 * - El máximo casi siempre era un brazo. En una rutina empuje/tracción el bíceps termina
 *   primero con 10 series directas y 11 asistencias de 0,4, por encima de los dorsales
 *   que tienen 14 directas. Todo lo demás se medía contra ese número inflado.
 *
 * Ahora la escala es fija: el verde lleno son 20 series estimadas por semana, y el
 * período sólo decide sobre cuánto tiempo se promedia. Eso hace que 1, 4 y 12 semanas
 * sean comparables entre sí —es la misma unidad— y que el dibujo se llene de verdad a
 * medida que se entrena.
 *
 * El 20 no es una recomendación de dosis: es dónde termina la rampa. Se eligió porque es
 * el techo del rango que la literatura de hipertrofia maneja como semanal productivo
 * (~10 a 20 series por músculo), así que la mayoría de las semanas cae adentro de la
 * rampa en vez de saturarla. La app describe la escala al pie del mapa y no prescribe
 * nada: no mide fatiga ni recuperación.
 */
export const SERIES_SEMANA_LLENO = 20;

/** Series estimadas por semana: la unidad en la que el mapa habla. */
export function porSemana(seriesDelPeriodo: number, semanas: number): number {
	if (semanas <= 0) return 0;
	// Un decimal, igual que `seriesEstimadas`: la cifra que se muestra y la que pinta
	// tienen que ser la misma, si no el color contradice al número que lo explica.
	return Math.round((seriesDelPeriodo / semanas) * 10) / 10;
}

/**
 * Intensidad del relleno, de 0 a 1. Absoluta: no depende de los otros músculos ni del
 * largo del período, sólo de cuántas series por semana recibió éste.
 */
export function intensidadMuscular(seriesDelPeriodo: number, semanas: number): number {
	return Math.min(1, Math.max(0, porSemana(seriesDelPeriodo, semanas) / SERIES_SEMANA_LLENO));
}

function sumarDias(fecha: string, delta: number): string {
	const date = new Date(`${fecha}T12:00:00`);
	date.setDate(date.getDate() + delta);
	return date.toLocaleDateString('sv');
}

/** Primer día del período, para que la consulta pueda acotarse por el índice `fecha`. */
export function desdeDistribucion(hasta: string, semanas: 1 | 4 | 12): string {
	return sumarDias(hasta, -(semanas * 7 - 1));
}

/** Distribución estimada: 1 serie al músculo principal y 0,4 a cada secundario. */
export function crearDistribucionMuscular(
	sesiones: Sesion[],
	hasta: string,
	semanas: 1 | 4 | 12,
	soloDuras = false,
	metadata: Record<string, MetadataMuscular> = METADATA_MUSCULAR
): DistribucionMuscular {
	const desde = desdeDistribucion(hasta, semanas);
	const cargas = new Map<MusculoMapa, Omit<CargaMuscular, 'musculo' | 'label'>>();
	let seriesCompletadas = 0;
	let seriesConsideradas = 0;
	let seriesConRir = 0;
	let seriesSinRepresentacion = 0;

	for (const sesion of sesiones) {
		if (sesion.fecha < desde || sesion.fecha > hasta) continue;
		for (const ejercicio of sesion.ejercicios) {
			const meta = metadata[ejercicio.exerciseId];
			for (const set of ejercicio.sets) {
				if (!serieCompleta(set)) continue;
				seriesCompletadas++;
				if (set.rir != null) seriesConRir++;
				if (soloDuras && (set.rir == null || set.rir > 2)) continue;
				// Un ejercicio sin músculo mapeado (típicamente uno archivado del catálogo)
				// no pinta nada. Contarlo antes de este chequeo hacía que el encabezado
				// dijera "84 series" con 36 de ellas fuera del dibujo: `seriesConsideradas`
				// son las que SOSTIENEN el mapa, y las descartadas se declaran aparte.
				if (!meta || (!meta.principal && meta.secundarios.length === 0)) {
					seriesSinRepresentacion++;
					continue;
				}
				seriesConsideradas++;
				if (meta.principal) {
					const actual = cargas.get(meta.principal) ?? {
						seriesEstimadas: 0,
						seriesPrimarias: 0,
						seriesSecundarias: 0
					};
					actual.seriesEstimadas += 1;
					actual.seriesPrimarias += 1;
					cargas.set(meta.principal, actual);
				}
				for (const secundario of meta.secundarios) {
					const actual = cargas.get(secundario) ?? {
						seriesEstimadas: 0,
						seriesPrimarias: 0,
						seriesSecundarias: 0
					};
					actual.seriesEstimadas += 0.4;
					actual.seriesSecundarias += 1;
					cargas.set(secundario, actual);
				}
			}
		}
	}

	const lista = [...cargas].map(([musculo, carga]) => ({
		musculo,
		label: MUSCULOS[musculo].label,
		seriesEstimadas: Number(carga.seriesEstimadas.toFixed(1)),
		seriesPrimarias: carga.seriesPrimarias,
		seriesSecundarias: carga.seriesSecundarias
	}));
	lista.sort((a, b) => b.seriesEstimadas - a.seriesEstimadas || a.label.localeCompare(b.label));
	const coberturaRir = seriesCompletadas ? seriesConRir / seriesCompletadas : 0;
	return {
		desde,
		hasta,
		semanas,
		soloDuras,
		seriesCompletadas,
		seriesConsideradas,
		seriesConRir,
		coberturaRir,
		puedeFiltrarDuras: seriesConRir >= 3 && coberturaRir >= 0.5,
		seriesSinRepresentacion,
		cargas: lista
	};
}

/**
 * Live query separada del bundle inicial: el componente que la usa se importa dinámicamente.
 * El período se acota con el índice `fecha`, así que un historial largo no se deserializa
 * entero en cada toque de período ni en cada escritura que invalida la consulta.
 */
export function distribucionMuscularObs(hasta: string, semanas: 1 | 4 | 12, soloDuras = false) {
	const desde = desdeDistribucion(hasta, semanas);
	return liveQuery(async () =>
		crearDistribucionMuscular(
			await db.sesiones.where('fecha').between(desde, hasta, true, true).toArray(),
			hasta,
			semanas,
			soloDuras
		)
	);
}
