/**
 * Lado navegador del banco: siembra la base sintética y cronometra el código real.
 * Lo carga `run.mjs`, que expone estas funciones en `globalThis.bench`.
 */
import { db, type Dia, type Sesion, type SetSesion } from '$lib/db';
import { catalogo } from '$lib/catalog';
import { rachaSemanalActual, resumenHistorialObs } from '$lib/historial';
import {
	historialObs,
	hoyStr,
	prepararEjercicioSesion,
	recordsGlobalesObs,
	registrarPrSiSupera,
	setPeso,
	setSerieHecha
} from '$lib/sesion';

const RUTINAS = 4;
const EJERCICIOS_POR_RUTINA = 6;
const SERIES = 4;

function fechaStr(d: Date): string {
	return d.toLocaleDateString('sv');
}

/** PRNG determinista: la misma base sintética en cada corrida. */
function azarDesde(semilla: number): () => number {
	let estado = semilla >>> 0;
	return () => {
		estado = (estado * 1664525 + 1013904223) >>> 0;
		return estado / 4294967296;
	};
}

function mediana(valores: number[]): number {
	const ordenados = [...valores].sort((a, b) => a - b);
	return ordenados[Math.floor(ordenados.length / 2)]!;
}

interface Observable<T> {
	subscribe: (siguiente: (valor: T) => void) => { unsubscribe(): void };
}

function primeraEmision<T>(obs: Observable<T>): Promise<number> {
	const inicio = performance.now();
	return new Promise((resolver) => {
		const sub = obs.subscribe(() => {
			const ms = performance.now() - inicio;
			queueMicrotask(() => sub.unsubscribe());
			resolver(ms);
		});
	});
}

/** Ninguna espera puede colgar la corrida: si algo no emite, se avisa y sigue. */
function conLimite(promesa: Promise<void>, ms: number, etiqueta: string): Promise<boolean> {
	return Promise.race([
		promesa.then(() => true),
		new Promise<boolean>((resolver) =>
			setTimeout(() => {
				console.warn(`timeout esperando ${etiqueta}`);
				resolver(false);
			}, ms)
		)
	]);
}

async function repetir(veces: number, fn: (i: number) => Promise<unknown>): Promise<number> {
	const tiempos: number[] = [];
	for (let i = 0; i < veces; i++) {
		const inicio = performance.now();
		await fn(i);
		tiempos.push(performance.now() - inicio);
	}
	return mediana(tiempos);
}

/**
 * Base sintética: rotación de 4 rutinas, 3,5 sesiones por semana, 6 ejercicios de 4
 * series, progresión lenta con ruido y dos ejercicios sin carga (para ejercitar el modo
 * reps). La sesión de hoy queda a medio hacer, como durante un entrenamiento.
 */
export async function sembrar(anios: number) {
	await db.delete();
	await db.open();

	const ids = catalogo.slice(0, RUTINAS * EJERCICIOS_POR_RUTINA).map((e) => e.id);
	const nombresRutina = ['Empuje', 'Tirón', 'Piernas', 'Full body'];
	const dias: Dia[] = Array.from({ length: RUTINAS }, (_, r) => ({
		id: `rutina-${r}`,
		nombre: nombresRutina[r]!,
		orden: r,
		ejercicios: ids
			.slice(r * EJERCICIOS_POR_RUTINA, (r + 1) * EJERCICIOS_POR_RUTINA)
			.map((exerciseId, orden) => ({ exerciseId, seriesObjetivo: SERIES, orden }))
	}));
	await db.dias.bulkAdd(dias);
	await db.ajustes.put({
		id: 'app',
		unidad: 'kg',
		timer: { activo: true, minutos: 2 },
		sonido: true,
		sonidoLogros: true,
		volumen: 0.8,
		vibracion: true,
		descansoPantallaCompleta: false,
		metricaPr: 'peso',
		pasoPeso: 2.5
	});

	const sinCarga = new Set([ids[5]!, ids[11]!]);
	const cargaBase = new Map(ids.map((id, i) => [id, 20 + ((i * 7) % 60)]));
	const mejorPorEjercicio = new Map<string, number>();
	const azar = azarDesde(20260815);

	const hoy = new Date();
	hoy.setHours(0, 0, 0, 0);
	const desde = new Date(hoy);
	desde.setDate(desde.getDate() - Math.round(anios * 365.25));

	const sesiones: Sesion[] = [];
	let indice = 0;
	for (const d = new Date(desde); d <= hoy; d.setDate(d.getDate() + 1)) {
		const diaSemana = d.getDay();
		const semana = Math.floor((+d - +desde) / (7 * 86400000));
		// Lunes, miércoles y viernes fijos + sábado por medio → 3,5 por semana. Hoy
		// entrena siempre: la medición necesita la sesión en curso.
		const entrena =
			diaSemana === 1 ||
			diaSemana === 3 ||
			diaSemana === 5 ||
			(diaSemana === 6 && semana % 2 === 0) ||
			+d === +hoy;
		if (!entrena) continue;

		const rutina = dias[indice % RUTINAS]!;
		const fecha = fechaStr(d);
		const esHoy = fecha === fechaStr(hoy);
		const sesion: Sesion = {
			id: `${fecha}__${rutina.id}`,
			fecha,
			diaId: rutina.id,
			diaNombre: rutina.nombre,
			ordenEnDia: 0,
			ejercicios: [],
			diaTerminado: !esHoy
		};

		for (const item of rutina.ejercicios) {
			const id = item.exerciseId;
			const usaCarga = !sinCarga.has(id);
			const carga = usaCarga
				? Math.max(
						2.5,
						Math.round(((cargaBase.get(id) ?? 20) + indice * 0.06 + (azar() - 0.4) * 5) * 2) / 2
					)
				: undefined;
			const series: SetSesion[] = Array.from({ length: SERIES }, (_, i) => ({
				peso: carga,
				pesoGramos: carga == null ? undefined : Math.round(carga * 1000),
				reps: 8 + Math.floor(azar() * 5),
				hecha: !esHoy || i < 2
			}));

			const hechas = series.filter((s) => s.hecha);
			const valor = Math.max(...hechas.map((s) => (usaCarga ? (s.peso ?? 0) : (s.reps ?? 0))));
			const ejercicio: Sesion['ejercicios'][number] = {
				exerciseId: id,
				nombreSnapshot: catalogo.find((e) => e.id === id)?.nombre,
				sets: series
			};
			const previo = mejorPorEjercicio.get(id);
			if (Number.isFinite(valor) && (previo == null || valor > previo)) {
				mejorPorEjercicio.set(id, valor);
				const ganadora = hechas.find((s) => (usaCarga ? s.peso : s.reps) === valor)!;
				ejercicio.prCelebrado = {
					peso: ganadora.peso,
					pesoGramos: ganadora.pesoGramos,
					reps: ganadora.reps,
					esMax: false,
					setIndex: series.indexOf(ganadora),
					metrica: usaCarga ? 'peso' : 'reps'
				};
			}
			sesion.ejercicios.push(ejercicio);
		}
		sesion.exerciseIds = [...new Set(sesion.ejercicios.map((e) => e.exerciseId))];
		sesiones.push(sesion);
		indice++;
	}

	await db.sesiones.bulkAdd(sesiones);
	return {
		sesiones: sesiones.length,
		sets: sesiones.reduce((n, s) => n + s.ejercicios.reduce((m, e) => m + e.sets.length, 0), 0),
		prs: sesiones.reduce((n, s) => n + s.ejercicios.filter((e) => e.prCelebrado).length, 0)
	};
}

/** Las consultas que recorren la tabla entera: la pantalla /historial y el cierre del día. */
export async function medirHistorial(veces = 5) {
	const salida: Record<string, number | null> = {};

	console.log('· deserializar la tabla');
	let bytes = 0;
	salida.lecturaTabla = await repetir(veces, async (i) => {
		const todas = await db.sesiones.orderBy('fecha').toArray();
		if (i === 0) bytes = JSON.stringify(todas).length;
	});
	salida.bytesJson = bytes;

	console.log('· rachaSemanalActual');
	salida.rachaSemanalActual = await repetir(veces, () => rachaSemanalActual());
	console.log('· resumenHistorialObs');
	salida.resumenHistorialObs = await repetir(veces, () => primeraEmision(resumenHistorialObs()));
	console.log('· recordsGlobalesObs');
	salida.recordsGlobalesObs = await repetir(veces, () => primeraEmision(recordsGlobalesObs()));

	// Recálculo por escritura con las dos liveQuery de /historial suscriptas. En la app
	// esto solo se alcanza con dos pestañas abiertas: /historial es una página hoja y
	// navegar a editar una serie la desmonta.
	console.log('· escritura con /historial montada');
	const sesion = (await db.sesiones.where('fecha').equals(hoyStr()).toArray())[0];
	const ejercicio = sesion?.ejercicios[0]?.exerciseId;
	salida.escrituraConHistorialMontada = null;
	if (sesion && ejercicio) {
		let emisiones = 0;
		const subs = [
			resumenHistorialObs().subscribe(() => emisiones++),
			recordsGlobalesObs().subscribe(() => emisiones++)
		];
		await new Promise((listo) => setTimeout(listo, 1500));
		const tiempos: number[] = [];
		for (let i = 0; i < veces; i++) {
			const base = emisiones;
			const inicio = performance.now();
			// Índices 2 y 3 quedan sin marcar en la siembra, así que alternarlos siempre
			// escribe: un toggle que no cambia nada no invalida los liveQuery.
			await setSerieHecha(sesion.diaId, ejercicio, 3, i % 2 === 0, sesion.fecha);
			const ambas = new Promise<void>((resolver) => {
				const revisar = () => (emisiones >= base + 2 ? resolver() : setTimeout(revisar, 0));
				revisar();
			});
			const emitio = await conLimite(ambas, 30_000, 'liveQuery de /historial');
			if (emitio) tiempos.push(performance.now() - inicio);
		}
		for (const sub of subs) sub.unsubscribe();
		salida.escrituraConHistorialMontada = tiempos.length ? mediana(tiempos) : null;
	}
	return salida;
}

/** El camino caliente: lo que se paga entre serie y serie, con /historial desmontada. */
export async function medirEntrenamiento(veces = 5) {
	const salida: Record<string, number | null> = {};
	const hoy = hoyStr();
	const sesion = (await db.sesiones.where('fecha').equals(hoy).toArray())[0];
	const ejercicio = sesion?.ejercicios[0]?.exerciseId;
	if (!sesion || !ejercicio) return salida;
	const { diaId } = sesion;

	console.log('· camino de entrenamiento');
	salida.prepararEjercicioSesion = await repetir(veces, () =>
		prepararEjercicioSesion(diaId, ejercicio, hoy, 'kg')
	);
	salida.historialObs = await repetir(veces, () => primeraEmision(historialObs(ejercicio)));
	salida.setPeso = await repetir(veces, (i) =>
		setPeso(diaId, ejercicio, 2, 40 + i, hoy, 'peso', 'kg')
	);
	await setSerieHecha(diaId, ejercicio, 2, true, hoy);
	salida.registrarPrSiSupera = await repetir(veces, () =>
		registrarPrSiSupera(diaId, ejercicio, 2, 'peso', hoy, 'kg')
	);
	salida.desmarcarSerie = await repetir(veces, (i) =>
		setSerieHecha(diaId, ejercicio, 2, i % 2 === 1, hoy)
	);

	// Lo que de verdad se siente al tocar −/+: la pantalla de ejercicio tiene
	// `historialObs` suscripta y cualquier escritura la invalida y la recalcula entera.
	console.log('· toque con la pantalla de ejercicio montada');
	let emisiones = 0;
	const sub = historialObs(ejercicio).subscribe(() => emisiones++);
	await new Promise((listo) => setTimeout(listo, 1500));
	const tiempos: number[] = [];
	for (let i = 0; i < veces; i++) {
		const base = emisiones;
		const inicio = performance.now();
		await setPeso(diaId, ejercicio, 2, 60 + i, hoy, 'peso', 'kg');
		const emitio = await conLimite(
			new Promise<void>((resolver) => {
				const revisar = () => (emisiones > base ? resolver() : setTimeout(revisar, 0));
				revisar();
			}),
			30_000,
			'historialObs'
		);
		if (emitio) tiempos.push(performance.now() - inicio);
	}
	sub.unsubscribe();
	salida.toqueConPantallaEjercicio = tiempos.length ? mediana(tiempos) : null;
	return salida;
}

(globalThis as Record<string, unknown>).bench = { sembrar, medirHistorial, medirEntrenamiento };
