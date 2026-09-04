import { liveQuery } from 'dexie';
import { db, type Ajustes, type Dia, type Sesion } from './db';
import { ejercicioPorId } from './catalog';
import { normalizarAjustes } from './extras';
import { hoyStr, recordsGlobales } from './sesion';
import {
	calidadDeSesiones,
	calidadDesde,
	pesoEfectivo,
	prRespaldado,
	serieCompleta,
	sumarTotales,
	totalesSesion,
	type CalidadSesion,
	type MetricaEfectiva,
	type RecordEjercicio,
	type TotalesSesion
} from './sesion-reglas';
import { conPesoVisible, type UnidadPeso } from './unidades';

export interface DiaEntrenado {
	fecha: string;
	sets: number;
	volumen: number;
	prs: number;
	dias: string[];
	/** Veredicto único del producto: ver `calidadDesde` en sesion-reglas. */
	calidad: CalidadSesion;
	/** Series planeadas ese día, o null si es anterior al congelado del plan. */
	seriesPlan: number | null;
	cerradoAMano: boolean;
}

export interface SemanaHistorial {
	inicio: string;
	fin: string;
	/** Días con trabajo real, completos y parciales: es lo que sostiene la racha. */
	diasEntrenados: number;
	diasCompletos: number;
	diasParciales: number;
	entrenada: boolean;
}

/**
 * Una fecha con trabajo cargado y ninguna serie marcada: se murió el teléfono, o te
 * fuiste del gimnasio sin cerrar la última tanda.
 *
 * NO es un día entrenado y no cuenta en ningún lado —ni racha, ni total, ni intensidad
 * del calendario—, porque nadie confirmó que esas series se hicieran. Existe sólo para
 * que el calendario pueda ofrecer la puerta de entrada: hasta acá el detalle del día
 * sabía arreglar exactamente este caso y no había forma de llegar, porque la celda de
 * esa fecha no era un enlace.
 */
export interface DiaSinMarcar {
	fecha: string;
	/** Series con peso o reps cargados que quedaron sin marcar. */
	sets: number;
	dias: string[];
}

export interface HistorialResumen {
	dias: DiaEntrenado[];
	/** Fechas alcanzables pero no entrenadas: ver `DiaSinMarcar`. */
	sinMarcar: DiaSinMarcar[];
	semanas: SemanaHistorial[];
	rachaSemanal: number;
	/** Días COMPLETOS de la semana en curso. */
	diasEstaSemana: number;
	parcialesEstaSemana: number;
	/** Días COMPLETOS de todo el historial: la cifra que la pantalla llama "días entrenados". */
	totalDias: number;
	totalParciales: number;
}

export interface PrDelDia {
	exerciseId: string;
	nombre: string;
	/** Ausente en ejercicios sin peso (modo reps). */
	peso?: number;
	reps?: number;
	esMax: boolean;
	extraKg?: number;
	metrica?: MetricaEfectiva;
}

export interface ResumenDiaSesion {
	setsHechos: number;
	volumen: number;
	/** Series ✓ sin peso: quedan fuera del volumen (peso × reps) y la UI lo dice. */
	setsSinVolumen: number;
	prs: PrDelDia[];
}

function fechaLocal(fecha: string): Date {
	return new Date(`${fecha}T00:00:00`);
}

function fechaStr(d: Date): string {
	return d.toLocaleDateString('sv');
}

function inicioSemana(fecha: string): Date {
	const d = fechaLocal(fecha);
	const lunesCero = (d.getDay() + 6) % 7;
	d.setDate(d.getDate() - lunesCero);
	return d;
}

function finSemana(inicio: Date): string {
	const d = new Date(inicio);
	d.setDate(d.getDate() + 6);
	return fechaStr(d);
}

function addDias(d: Date, dias: number): Date {
	const nuevo = new Date(d);
	nuevo.setDate(nuevo.getDate() + dias);
	return nuevo;
}

export function resumenDiaSesion(
	sesion: Sesion | undefined,
	unidad: UnidadPeso = 'kg'
): ResumenDiaSesion {
	if (!sesion) return { setsHechos: 0, volumen: 0, setsSinVolumen: 0, prs: [] };
	let setsHechos = 0;
	let volumen = 0;
	let setsSinVolumen = 0;
	const prs: PrDelDia[] = [];

	for (const ejercicio of sesion.ejercicios) {
		for (const set of ejercicio.sets) {
			if (!serieCompleta(set)) continue;
			setsHechos++;
			const peso = pesoEfectivo(set, unidad);
			if (peso != null && set.reps != null) volumen += peso * set.reps;
			else setsSinVolumen++;
		}
		// Un PR sólo se muestra si TODAVÍA hay una serie hecha que lo respalde. La
		// pantalla del ejercicio ya exigía esto (marca la serie con `indexSetPr`), pero
		// acá el snapshot se mostraba sin preguntar: si un residuo llegara a quedar —por
		// un backup adulterado, o por un camino de escritura futuro que se olvide de
		// limpiarlo— el detalle del día cantaría un PR que el resto de la app no reconoce.
		// Contra un dato honesto no cambia nada; contra uno roto, las dos pantallas mienten
		// o dicen la verdad juntas, que es lo que hace detectable el problema.
		if (ejercicio.prCelebrado && prRespaldado(ejercicio.sets, ejercicio.prCelebrado)) {
			const ej = ejercicioPorId(ejercicio.exerciseId);
			const prVisible = conPesoVisible(ejercicio.prCelebrado, unidad);
			prs.push({
				exerciseId: ejercicio.exerciseId,
				nombre: ejercicio.nombreSnapshot ?? ej?.nombre ?? 'Ejercicio archivado',
				peso: prVisible.peso,
				reps: ejercicio.prCelebrado.reps,
				esMax: !!ejercicio.prCelebrado.esMax,
				extraKg: prVisible.extraKg,
				metrica: ejercicio.prCelebrado.metrica
			});
		}
	}

	volumen = Math.round(volumen * 10) / 10;
	return { setsHechos, volumen, setsSinVolumen, prs };
}

/** Una sesión aporta al historial cuando tiene trabajo real, completa o parcial. */
function tieneEntrenamiento(sesion: Sesion): boolean {
	return totalesSesion(sesion).seriesHechas > 0;
}

/**
 * Series con datos cargados que no llegaron a marcarse.
 *
 * Exige peso o reps a propósito: abrir un día de rutina para mirarlo ya crea su sesión,
 * y contar esas sesiones vacías haría que el calendario marcara como "pendiente" cada
 * fecha que alguna vez se espió. Sin un número cargado no hay trabajo que rescatar.
 */
function seriesCargadasSinMarcar(sesion: Sesion): number {
	let n = 0;
	for (const ejercicio of sesion.ejercicios) {
		for (const set of ejercicio.sets) {
			if (serieCompleta(set)) continue;
			if (set.peso != null || set.pesoGramos != null || set.reps != null) n++;
		}
	}
	return n;
}

/**
 * Fechas pasadas con trabajo cargado y sin marcar, agrupadas por día.
 *
 * Se piden dos condiciones más allá de tener datos: que la fecha no sea ya un día
 * entrenado (si lo es, el calendario la abre por el camino normal) y que su rutina siga
 * existiendo. Lo segundo es porque el único arreglo posible es reabrir esa rutina en esa
 * fecha; si la rutina se borró, el enlace llevaría a una pantalla sin salida.
 */
function diasSinMarcar(
	sesiones: Sesion[],
	dias: Dia[],
	hoy: string,
	fechasEntrenadas: Set<string>
): DiaSinMarcar[] {
	const porDia = new Map(dias.map((d) => [d.id, d.nombre]));
	const vigentes = new Set(dias.map((d) => d.id));
	const porFecha = new Map<string, DiaSinMarcar>();

	for (const sesion of sesiones) {
		if (sesion.fecha > hoy) continue;
		if (fechasEntrenadas.has(sesion.fecha)) continue;
		if (!vigentes.has(sesion.diaId)) continue;
		const sets = seriesCargadasSinMarcar(sesion);
		if (sets === 0) continue;
		const actual = porFecha.get(sesion.fecha) ?? { fecha: sesion.fecha, sets: 0, dias: [] };
		actual.sets += sets;
		const nombre = sesion.diaNombre ?? porDia.get(sesion.diaId);
		if (nombre && !actual.dias.includes(nombre)) actual.dias.push(nombre);
		porFecha.set(sesion.fecha, actual);
	}

	return [...porFecha.values()].sort((a, b) => b.fecha.localeCompare(a.fecha));
}

export interface ComparacionSesion {
	fechaAnterior: string;
	deltaVolumen: number;
	deltaSets: number;
}

/**
 * Compara una sesión contra la más reciente sesión comparable anterior: mismo día de
 * rutina, fecha estrictamente anterior, con actividad real. Sin eso, no hay con qué
 * comparar (primera vez, o entrenaste ese día suelto sin rutina) y devuelve null — el
 * manifiesto pide no inventar comparaciones donde no hay base real.
 *
 * Sólo compara días COMPLETOS contra días COMPLETOS. Un día en el que hiciste un
 * ejercicio y te fuiste tiene menos volumen que uno entero por definición, y mostrar ese
 * "−2.400 kg" al lado de la fecha lee como retroceso cuando en realidad son dos cosas
 * distintas. Cuando alguno de los dos lados es parcial, no hay comparación honesta.
 */
export function compararConAnterior(
	actual: Sesion,
	candidatas: Sesion[],
	unidad: UnidadPeso = 'kg'
): ComparacionSesion | null {
	if (calidadDesde(totalesSesion(actual)) !== 'completa') return null;
	const previa = candidatas
		.filter(
			(s) =>
				s.diaId === actual.diaId &&
				s.fecha < actual.fecha &&
				calidadDesde(totalesSesion(s)) === 'completa'
		)
		.sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
	if (!previa) return null;
	const resumenActual = resumenDiaSesion(actual, unidad);
	const resumenPrevio = resumenDiaSesion(previa, unidad);
	return {
		fechaAnterior: previa.fecha,
		deltaVolumen: resumenActual.volumen - resumenPrevio.volumen,
		deltaSets: resumenActual.setsHechos - resumenPrevio.setsHechos
	};
}

const TOTALES_CERO: TotalesSesion = {
	seriesHechas: 0,
	seriesPlan: 0,
	ejerciciosTrabajados: 0,
	ejerciciosPlan: 0,
	cerradaAMano: false
};

/**
 * Una fecha con dos rutinas es UN día entrenado. Las cifras se suman (para mostrar
 * "9 de 24 series") pero el veredicto lo da la mejor sesión: ver `mejorCalidad`.
 */
function resumenSesionAgrupada(sesiones: Sesion[], dias: Dia[], unidad: UnidadPeso): DiaEntrenado {
	const porDia = new Map(dias.map((d) => [d.id, d.nombre]));
	let sets = 0;
	let volumen = 0;
	let prs = 0;
	let totales = TOTALES_CERO;
	const nombres = new Set<string>();

	for (const sesion of sesiones) {
		const resumen = resumenDiaSesion(sesion, unidad);
		sets += resumen.setsHechos;
		volumen += resumen.volumen;
		prs += resumen.prs.length;
		totales = sumarTotales(totales, totalesSesion(sesion));
		const nombre = sesion.diaNombre ?? porDia.get(sesion.diaId);
		if (nombre) nombres.add(nombre);
	}

	return {
		fecha: sesiones[0]?.fecha ?? '',
		sets,
		volumen,
		prs,
		dias: [...nombres],
		calidad: calidadDeSesiones(sesiones),
		seriesPlan: totales.seriesPlan,
		cerradoAMano: totales.cerradaAMano
	};
}

export function crearHistorialResumen(
	sesiones: Sesion[],
	dias: Dia[],
	unidad: UnidadPeso = 'kg'
): HistorialResumen {
	// Las sesiones cargadas para una fecha futura son planificación, no entrenamiento pasado.
	const hoy = hoyStr();
	const entrenadas = sesiones.filter((sesion) => sesion.fecha <= hoy && tieneEntrenamiento(sesion));
	if (entrenadas.length === 0) {
		// Sin días entrenados todavía puede haber trabajo cargado sin marcar, y ése es
		// justamente el caso en que más importa poder llegar.
		return {
			dias: [],
			sinMarcar: diasSinMarcar(sesiones, dias, hoy, new Set()),
			semanas: [],
			rachaSemanal: 0,
			diasEstaSemana: 0,
			parcialesEstaSemana: 0,
			totalDias: 0,
			totalParciales: 0
		};
	}

	const porFecha = new Map<string, Sesion[]>();
	for (const sesion of entrenadas) {
		const lista = porFecha.get(sesion.fecha) ?? [];
		lista.push(sesion);
		porFecha.set(sesion.fecha, lista);
	}

	const diasEntrenados = [...porFecha.values()]
		.map((lista) => resumenSesionAgrupada(lista, dias, unidad))
		.sort((a, b) => b.fecha.localeCompare(a.fecha));

	const fechas = [...porFecha.keys()].sort();
	const primeraSemana = inicioSemana(fechas[0]!);
	const semanaActual = inicioSemana(new Date().toLocaleDateString('sv'));
	const semanas: SemanaHistorial[] = [];

	const porFechaResumen = new Map(diasEntrenados.map((d) => [d.fecha, d]));

	for (let cursor = new Date(primeraSemana); cursor <= semanaActual; cursor = addDias(cursor, 7)) {
		const inicio = fechaStr(cursor);
		const fin = finSemana(cursor);
		const deLaSemana = fechas.filter((f) => f >= inicio && f <= fin);
		const completos = deLaSemana.filter(
			(f) => porFechaResumen.get(f)?.calidad === 'completa'
		).length;
		semanas.push({
			inicio,
			fin,
			diasEntrenados: deLaSemana.length,
			diasCompletos: completos,
			diasParciales: deLaSemana.length - completos,
			// La racha la sostiene cualquier día con trabajo real, parcial incluido. Es
			// deliberado, y es la única asimetría del modelo: la racha protege la motivación
			// (el manifiesto pide que nada importante vuelva de forma abrupta) mientras que
			// el contador de "días entrenados" tiene que decir la verdad. Antes un solo
			// predicado hacía los dos trabajos y por eso ninguno salía bien.
			entrenada: deLaSemana.length > 0
		});
	}

	// Racha con gracia: la semana en curso suma si entrenaste, pero mientras esté
	// incompleta no corta la racha que traen las semanas anteriores.
	let rachaSemanal = semanas[semanas.length - 1]?.entrenada ? 1 : 0;
	for (let i = semanas.length - 2; i >= 0; i--) {
		if (!semanas[i]!.entrenada) break;
		rachaSemanal++;
	}
	const ultima = semanas[semanas.length - 1];

	return {
		dias: diasEntrenados,
		sinMarcar: diasSinMarcar(sesiones, dias, hoy, new Set(fechas)),
		semanas: semanas.reverse(),
		rachaSemanal,
		diasEstaSemana: ultima?.diasCompletos ?? 0,
		parcialesEstaSemana: ultima?.diasParciales ?? 0,
		totalDias: diasEntrenados.filter((d) => d.calidad === 'completa').length,
		totalParciales: diasEntrenados.filter((d) => d.calidad === 'parcial').length
	};
}

/**
 * Racha semanal actual, para el resumen puntual de "día terminado". Es una lectura
 * única (no un liveQuery suscripto): pedirla solo en el momento de cerrar el día evita
 * pagar un escaneo completo del historial en cada toque, como sí hace la pantalla de
 * Historial (que la necesita siempre visible).
 */
export async function rachaSemanalActual(): Promise<number> {
	return (await resumenHistorialActual()).rachaSemanal;
}

/**
 * El resumen entero, en una lectura única. Es lo que el cierre del día necesita para la
 * racha y para las placas juntas: dos lecturas separadas deserializarían la tabla dos
 * veces en el momento en que la persona está mirando la pantalla de recompensa.
 */
export async function resumenHistorialActual(): Promise<HistorialResumen> {
	const [sesiones, dias] = await Promise.all([
		db.sesiones.orderBy('fecha').toArray(),
		db.dias.toArray()
	]);
	return crearHistorialResumen(sesiones, dias);
}

export function resumenHistorialObs() {
	return liveQuery(async () => {
		const [sesiones, dias, ajustes] = await Promise.all([
			db.sesiones.orderBy('fecha').toArray(),
			db.dias.toArray(),
			db.ajustes.get('app')
		]);
		return crearHistorialResumen(sesiones, dias, ajustes?.unidad ?? 'kg');
	});
}

export interface HistorialPantalla {
	resumen: HistorialResumen;
	records: RecordEjercicio[];
	ajustes: Ajustes;
}

/**
 * Todo lo que /historial necesita, con UNA sola lectura de `sesiones`.
 *
 * Antes la pantalla abría dos liveQuery independientes —el resumen y los récords— y
 * cada uno deserializaba la tabla entera por su cuenta: con tres años de entrenamiento
 * son ~15.000 series leídas dos veces en cada apertura y en cada escritura que
 * invalidara cualquiera de las dos consultas.
 *
 * Los ajustes viajan en el mismo objeto a propósito. El volumen del resumen se calcula
 * con una unidad y la pantalla rotulaba con otra leída aparte, así que al cambiar
 * kg↔lb quedaba un instante con el número en una unidad y el rótulo en la otra.
 */
export function historialPantallaObs() {
	return liveQuery(async () => {
		const [sesiones, dias, fila] = await Promise.all([
			db.sesiones.orderBy('fecha').toArray(),
			db.dias.toArray(),
			db.ajustes.get('app')
		]);
		const ajustes = normalizarAjustes(fila);
		return {
			resumen: crearHistorialResumen(sesiones, dias, ajustes.unidad),
			records: recordsGlobales(sesiones, ajustes, ajustes.unidad),
			ajustes
		} satisfies HistorialPantalla;
	});
}
