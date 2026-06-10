import { liveQuery } from 'dexie';
import { db, type Dia, type Sesion } from './db';
import { ejercicioPorId } from './catalog';
import { pesoEfectivo } from './sesion';

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
}

export interface ResumenDiaSesion {
	setsHechos: number;
	volumen: number;
	/** Series ✓ sin peso o sin reps: quedan fuera del volumen (peso × reps) y la UI lo dice. */
	setsSinVolumen: number;
	prs: PrDelDia[];
}

const MS_DIA = 24 * 60 * 60 * 1000;

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

export function resumenDiaSesion(sesion: Sesion | undefined): ResumenDiaSesion {
	if (!sesion) return { setsHechos: 0, volumen: 0, setsSinVolumen: 0, prs: [] };
	let setsHechos = 0;
	let volumen = 0;
	let setsSinVolumen = 0;
	const prs: PrDelDia[] = [];

	for (const ejercicio of sesion.ejercicios) {
		for (const set of ejercicio.sets) {
			if (!set.hecha) continue;
			setsHechos++;
			const peso = pesoEfectivo(set);
			if (peso != null && set.reps != null) volumen += peso * set.reps;
			else setsSinVolumen++;
		}
		if (ejercicio.prCelebrado) {
			const ej = ejercicioPorId(ejercicio.exerciseId);
			prs.push({
				exerciseId: ejercicio.exerciseId,
				nombre: ej?.nombre ?? 'Ejercicio archivado',
				peso: ejercicio.prCelebrado.peso,
				reps: ejercicio.prCelebrado.reps,
				esMax: !!ejercicio.prCelebrado.esMax,
				extraKg: ejercicio.prCelebrado.extraKg
			});
		}
	}

	return { setsHechos, volumen, setsSinVolumen, prs };
}

function tieneEntrenamiento(sesion: Sesion): boolean {
	return sesion.ejercicios.some((e) => e.sets.some((s) => s.hecha));
}

function resumenSesionAgrupada(sesiones: Sesion[], dias: Dia[]): DiaEntrenado {
	const porDia = new Map(dias.map((d) => [d.id, d.nombre]));
	let sets = 0;
	let volumen = 0;
	let prs = 0;
	const nombres = new Set<string>();

	for (const sesion of sesiones) {
		const resumen = resumenDiaSesion(sesion);
		sets += resumen.setsHechos;
		volumen += resumen.volumen;
		prs += resumen.prs.length;
		const nombre = porDia.get(sesion.diaId);
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

export function crearHistorialResumen(sesiones: Sesion[], dias: Dia[]): HistorialResumen {
	const entrenadas = sesiones.filter(tieneEntrenamiento);
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
		.map((lista) => resumenSesionAgrupada(lista, dias))
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

export function resumenHistorialObs() {
	return liveQuery(async () => {
		const [sesiones, dias] = await Promise.all([
			db.sesiones.orderBy('fecha').toArray(),
			db.dias.toArray()
		]);
		return crearHistorialResumen(sesiones, dias);
	});
}
