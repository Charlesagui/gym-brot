import type { DiaEntrenado } from './historial';

/** Topes de cada nivel: 0, 1–4, 5–8, 9–12 y 13+. Fijos, explicables y testeados. */
export const BUCKETS_HEATMAP = [0, 4, 8, 12] as const;

export interface CeldaHeatmap {
	fecha: string;
	sets: number;
	volumen: number;
	dias: string[];
	nivel: 0 | 1 | 2 | 3 | 4;
	esHoy: boolean;
	futura: boolean;
}

export interface SemanaHeatmap {
	inicio: string;
	mes?: string;
	celdas: CeldaHeatmap[];
}

export interface HeatmapAnual {
	semanas: SemanaHeatmap[];
	diasEntrenados: number;
	totalSets: number;
	mejorRacha: number;
}

function fechaStr(fecha: Date): string {
	return fecha.toLocaleDateString('sv');
}

function sumarDias(fecha: Date, dias: number): Date {
	const resultado = new Date(fecha);
	resultado.setDate(resultado.getDate() + dias);
	return resultado;
}

function lunesDe(fecha: Date): Date {
	const resultado = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), 12);
	resultado.setDate(resultado.getDate() - ((resultado.getDay() + 6) % 7));
	return resultado;
}

export function nivelActividad(sets: number): CeldaHeatmap['nivel'] {
	if (sets <= 0) return 0;
	if (sets <= BUCKETS_HEATMAP[1]) return 1;
	if (sets <= BUCKETS_HEATMAP[2]) return 2;
	if (sets <= BUCKETS_HEATMAP[3]) return 3;
	return 4;
}

/** Rótulos de la leyenda, derivados de los mismos topes que `nivelActividad`. */
export const ETIQUETAS_NIVEL: string[] = [
	'sin series',
	...BUCKETS_HEATMAP.slice(0, -1).map(
		(tope, indice) => `${tope + 1} a ${BUCKETS_HEATMAP[indice + 1]}`
	),
	`${BUCKETS_HEATMAP[BUCKETS_HEATMAP.length - 1]! + 1} o más`
];

export function crearHeatmapAnual(dias: DiaEntrenado[], referencia = new Date()): HeatmapAnual {
	const hoy = fechaStr(referencia);
	const inicio = sumarDias(lunesDe(referencia), -52 * 7);
	const porFecha = new Map(dias.map((dia) => [dia.fecha, dia]));
	const semanas: SemanaHeatmap[] = [];
	let mesAnterior = '';
	let diasEntrenados = 0;
	let totalSets = 0;
	let racha = 0;
	let mejorRacha = 0;

	for (let semanaIndex = 0; semanaIndex < 53; semanaIndex++) {
		const inicioSemana = sumarDias(inicio, semanaIndex * 7);
		const celdas: CeldaHeatmap[] = [];
		for (let diaIndex = 0; diaIndex < 7; diaIndex++) {
			const fecha = fechaStr(sumarDias(inicioSemana, diaIndex));
			const dato = porFecha.get(fecha);
			const futura = fecha > hoy;
			const sets = futura ? 0 : (dato?.sets ?? 0);
			if (sets > 0) {
				diasEntrenados++;
				totalSets += sets;
				racha++;
				mejorRacha = Math.max(mejorRacha, racha);
			} else if (!futura) {
				racha = 0;
			}
			celdas.push({
				fecha,
				sets,
				volumen: futura ? 0 : (dato?.volumen ?? 0),
				dias: futura ? [] : (dato?.dias ?? []),
				nivel: nivelActividad(sets),
				esHoy: fecha === hoy,
				futura
			});
		}
		const mesActual = inicioSemana.toLocaleDateString('es-AR', { month: 'short' });
		const cambiaMes = inicioSemana.getDate() <= 7 && mesActual !== mesAnterior;
		semanas.push({
			inicio: fechaStr(inicioSemana),
			mes: cambiaMes ? mesActual.replace('.', '') : undefined,
			celdas
		});
		if (cambiaMes) mesAnterior = mesActual;
	}

	return { semanas, diasEntrenados, totalSets, mejorRacha };
}
