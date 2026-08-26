import { liveQuery } from 'dexie';
import { db, type Ajustes, type Dia, type Sesion } from './db';
import { ejercicioPorId } from './catalog';
import { normalizarAjustes } from './extras';
import { hoyStr, recordsGlobales } from './sesion';
import {
	pesoEfectivo,
	prRespaldado,
	serieCompleta,
	type MetricaEfectiva,
	type RecordEjercicio
} from './sesion-reglas';
import { conPesoVisible, type UnidadPeso } from './unidades';

export interface DiaEntrenado {
	fecha: string;
	sets: number;
	volumen: number;
	prs: number;
	dias: string[];
}

export interface SemanaHistorial {
	inicio: string;
	fin: string;
	diasEntrenados: number;
	entrenada: boolean;
}

export interface HistorialResumen {
	dias: DiaEntrenado[];
	semanas: SemanaHistorial[];
	rachaSemanal: number;
	diasEstaSemana: number;
	totalDias: number;
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

function tieneEntrenamiento(sesion: Sesion): boolean {
	return sesion.ejercicios.some((e) => e.sets.some(serieCompleta));
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
 */
export function compararConAnterior(
	actual: Sesion,
	candidatas: Sesion[],
	unidad: UnidadPeso = 'kg'
): ComparacionSesion | null {
	const previa = candidatas
		.filter((s) => s.diaId === actual.diaId && s.fecha < actual.fecha && tieneEntrenamiento(s))
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

function resumenSesionAgrupada(sesiones: Sesion[], dias: Dia[], unidad: UnidadPeso): DiaEntrenado {
	const porDia = new Map(dias.map((d) => [d.id, d.nombre]));
	let sets = 0;
	let volumen = 0;
	let prs = 0;
	const nombres = new Set<string>();

	for (const sesion of sesiones) {
		const resumen = resumenDiaSesion(sesion, unidad);
		sets += resumen.setsHechos;
		volumen += resumen.volumen;
		prs += resumen.prs.length;
		const nombre = sesion.diaNombre ?? porDia.get(sesion.diaId);
		if (nombre) nombres.add(nombre);
	}

	return {
		fecha: sesiones[0]?.fecha ?? '',
		sets,
		volumen,
		prs,
		dias: [...nombres]
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
		return { dias: [], semanas: [], rachaSemanal: 0, diasEstaSemana: 0, totalDias: 0 };
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

	for (let cursor = new Date(primeraSemana); cursor <= semanaActual; cursor = addDias(cursor, 7)) {
		const inicio = fechaStr(cursor);
		const fin = finSemana(cursor);
		const diasEntrenadosSemana = fechas.filter((f) => f >= inicio && f <= fin).length;
		semanas.push({
			inicio,
			fin,
			diasEntrenados: diasEntrenadosSemana,
			entrenada: diasEntrenadosSemana > 0
		});
	}

	// Racha con gracia: la semana en curso suma si entrenaste, pero mientras esté
	// incompleta no corta la racha que traen las semanas anteriores.
	let rachaSemanal = semanas[semanas.length - 1]?.entrenada ? 1 : 0;
	for (let i = semanas.length - 2; i >= 0; i--) {
		if (!semanas[i]!.entrenada) break;
		rachaSemanal++;
	}
	const diasEstaSemana = semanas[semanas.length - 1]?.diasEntrenados ?? 0;

	return {
		dias: diasEntrenados,
		semanas: semanas.reverse(),
		rachaSemanal,
		diasEstaSemana,
		totalDias: diasEntrenados.length
	};
}

/**
 * Racha semanal actual, para el resumen puntual de "día terminado". Es una lectura
 * única (no un liveQuery suscripto): pedirla solo en el momento de cerrar el día evita
 * pagar un escaneo completo del historial en cada toque, como sí hace la pantalla de
 * Historial (que la necesita siempre visible).
 */
export async function rachaSemanalActual(): Promise<number> {
	const [sesiones, dias] = await Promise.all([
		db.sesiones.orderBy('fecha').toArray(),
		db.dias.toArray()
	]);
	return crearHistorialResumen(sesiones, dias).rachaSemanal;
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
