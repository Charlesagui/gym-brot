import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { crearHistorialResumen, resumenDiaSesion } from './historial';
import { crearProgresoEjercicio } from './progreso';
import {
	modoEjercicio,
	pesoEfectivo,
	prRespaldado,
	serieCompleta,
	valorSet
} from './sesion-reglas';
import { normalizarAjustes } from './extras';
import * as S from './sesion';
import * as D from './dias';

/**
 * La persona real no va en línea recta: carga, se arrepiente, desmarca, quita la serie
 * del medio, reinicia, deshace, saca el ejercicio de la rutina y borra la rutina entera.
 *
 * Cada uno de esos caminos toca la sesión de una forma distinta, y lo que puede romperse
 * no es un número suelto sino la RELACIÓN entre dos pantallas. Por eso este archivo no
 * comprueba resultados concretos —de eso ya se ocupan `sesion-db` e `historial`— sino un
 * conjunto de invariantes que tienen que valer DESPUÉS DE CADA MUTACIÓN, sin importar
 * en qué orden se hicieron ni de cuál se volvió atrás.
 */

/**
 * Las fechas del fixture son del pasado a propósito: una sesión con fecha futura es
 * planificación y el historial la deja fuera, que es justo lo que estas invariantes NO
 * están probando. `HOY` es un centinela para el corte, no la fecha real.
 */
const HOY = '2100-01-01';

interface Violacion {
	paso: string;
	problema: string;
}

async function invariantes(paso: string): Promise<Violacion[]> {
	const todas = await db.sesiones.orderBy('fecha').toArray();
	const dias = await db.dias.toArray();
	const ajustes = normalizarAjustes(await db.ajustes.get('app'));
	const resumen = crearHistorialResumen(todas, dias, 'kg');
	const records = S.recordsGlobales(todas, ajustes, 'kg');
	const fallos: string[] = [];

	for (const sesion of todas) {
		// El índice derivado nunca puede desfasarse: una sesión invisible para
		// `where('exerciseIds')` desaparece del progreso y del cálculo de PR.
		const esperado = [...new Set(sesion.ejercicios.map((e) => e.exerciseId))].sort();
		const real = [...(sesion.exerciseIds ?? [])].sort();
		if (JSON.stringify(esperado) !== JSON.stringify(real))
			fallos.push(`exerciseIds desfasado en ${sesion.id}`);

		for (const ejercicio of sesion.ejercicios) {
			if (ejercicio.prCelebrado && !prRespaldado(ejercicio.sets, ejercicio.prCelebrado))
				fallos.push(`PR sin serie que lo respalde en ${sesion.id}/${ejercicio.exerciseId}`);
			for (const [i, set] of ejercicio.sets.entries())
				if (set.hecha && !serieCompleta(set))
					fallos.push(
						`serie ${i} marcada sin reps válidas en ${sesion.id}/${ejercicio.exerciseId}`
					);
		}

		const completas = sesion.ejercicios.reduce(
			(acumulado, e) => acumulado + e.sets.filter(serieCompleta).length,
			0
		);
		if (resumenDiaSesion(sesion, 'kg').setsHechos !== completas)
			fallos.push(`setsHechos no coincide con las series completas en ${sesion.id}`);
	}

	for (const dia of resumen.dias) {
		if (dia.sets === 0) fallos.push(`${dia.fecha} figura en el historial con 0 series`);
		let volumen = 0;
		for (const sesion of todas.filter((s) => s.fecha === dia.fecha))
			for (const ejercicio of sesion.ejercicios)
				for (const set of ejercicio.sets) {
					if (!serieCompleta(set)) continue;
					const peso = pesoEfectivo(set, 'kg');
					if (peso != null && set.reps != null) volumen += peso * set.reps;
				}
		if (Math.abs(volumen - dia.volumen) > 0.15)
			fallos.push(`volumen de ${dia.fecha}: ${dia.volumen} != ${volumen}`);
	}

	const fechasReales = new Set(
		todas
			.filter((s) => s.fecha <= HOY && s.ejercicios.some((e) => e.sets.some(serieCompleta)))
			.map((s) => s.fecha)
	);
	if (resumen.totalDias !== fechasReales.size)
		fallos.push(`totalDias ${resumen.totalDias} != ${fechasReales.size} fechas con series`);
	const suma = resumen.semanas.reduce((a, s) => a + s.diasEntrenados, 0);
	if (suma !== resumen.totalDias)
		fallos.push(`las semanas suman ${suma} y no ${resumen.totalDias}`);

	const conSeries = new Set<string>();
	for (const sesion of todas)
		for (const ejercicio of sesion.ejercicios)
			if (ejercicio.sets.some(serieCompleta)) conSeries.add(ejercicio.exerciseId);

	for (const record of records) {
		if (!conSeries.has(record.exerciseId))
			fallos.push(`${record.exerciseId} tiene récord sin ninguna serie completa`);
		const modo = modoEjercicio(todas, record.exerciseId);
		let maximo: number | null = null;
		for (const sesion of todas) {
			if (sesion.fecha > HOY) continue;
			for (const ejercicio of sesion.ejercicios.filter((e) => e.exerciseId === record.exerciseId))
				for (const set of ejercicio.sets) {
					// `valorSet` puntúa sin mirar `hecha` (también puntúa snapshots de PR):
					// una serie desmarcada no puede ser un récord.
					if (!serieCompleta(set)) continue;
					const valor = valorSet(set, 'peso', modo, 'kg');
					if (valor != null && (maximo == null || valor > maximo)) maximo = valor;
				}
		}
		if (record.valor !== maximo)
			fallos.push(`récord de ${record.exerciseId}: ${record.valor} != máximo real ${maximo}`);
		const progreso = crearProgresoEjercicio(todas, record.exerciseId, 'kg');
		const enLaPantalla = modo === 'reps' ? progreso.mejorReps?.valor : progreso.mejorPeso?.valor;
		if (record.valor !== enLaPantalla)
			fallos.push(
				`${record.exerciseId}: historial dice ${record.valor} y la pantalla del ejercicio ${enLaPantalla}`
			);
	}

	return fallos.map((problema) => ({ paso, problema }));
}

describe('invariantes tras arrepentirse', () => {
	const violaciones: Violacion[] = [];
	const tras = async (paso: string, accion: () => Promise<unknown>) => {
		await accion();
		violaciones.push(...(await invariantes(paso)));
	};

	beforeEach(async () => {
		await db.open();
		await db.sesiones.clear();
		await db.dias.clear();
		await db.ajustes.put(normalizarAjustes(null));
		violaciones.length = 0;
	});

	it('sobrevive a cargar, desmarcar, quitar, reiniciar, deshacer y borrar', async () => {
		const F = '2026-06-10';
		await db.dias.put({
			id: 'dia',
			nombre: 'Mi rutina',
			orden: 0,
			ejercicios: [
				{ exerciseId: 'press-pecho', seriesObjetivo: 3, orden: 0 },
				{ exerciseId: 'dominadas', seriesObjetivo: 3, orden: 1 }
			]
		});

		const cargar = async (i: number, peso: number, reps: number) => {
			await S.setPeso('dia', 'press-pecho', i, peso, F);
			await S.setReps('dia', 'press-pecho', i, reps, F);
			await S.setSerieHecha('dia', 'press-pecho', i, true, F);
		};

		await tras('crear el ejercicio', () => S.ensureEjercicio('dia', 'press-pecho', 3, F));
		await tras('serie 1 (80×10)', () => cargar(0, 80, 10));
		await tras('serie 2 (100×5), que celebra PR', () => cargar(1, 100, 5));
		await tras('serie 3 (90×8)', () => cargar(2, 90, 8));

		// Arrepentimientos sobre la serie que celebró el PR.
		await tras('desmarcar la serie del PR', () =>
			S.setSerieHecha('dia', 'press-pecho', 1, false, F)
		);
		await tras('volver a marcarla', () => S.setSerieHecha('dia', 'press-pecho', 1, true, F));
		await tras('quitar la serie del PR', () => S.removeSet('dia', 'press-pecho', 1, F));
		await tras('agregar una serie y dejarla vacía', () => S.addSet('dia', 'press-pecho', F));

		// Un ejercicio sin carga: convive con el otro sin contaminar su métrica.
		await tras('sumar dominadas (modo reps)', async () => {
			await S.ensureEjercicio('dia', 'dominadas', 3, F);
			await S.setReps('dia', 'dominadas', 0, 12, F);
			await S.setSerieHecha('dia', 'dominadas', 0, true, F);
		});

		let instantanea: Awaited<ReturnType<typeof S.reiniciarEjercicio>> = null;
		await tras('reiniciar el ejercicio', async () => {
			instantanea = await S.reiniciarEjercicio('dia', 'press-pecho', F);
		});
		expect(instantanea).not.toBeNull();
		await tras('deshacer el reinicio', () => S.restaurarInstantanea('dia', instantanea!, F));
		// Deshacer devuelve las series de verdad, no sólo el estado del día.
		expect(resumenDiaSesion(await db.sesiones.get(S.sesionId('dia', F)), 'kg').setsHechos).toBe(3);

		await tras('saltar dominadas', () => S.saltarEjercicio('dia', 'dominadas', F));

		// Sacar el ejercicio de la RUTINA no puede tocar lo ya entrenado.
		const antesDeQuitar = (await invariantes('x')).length;
		expect(antesDeQuitar).toBe(0);
		await tras('quitar el ejercicio de la rutina', () => D.quitarEjercicio('dia', 'press-pecho'));
		await tras('borrar la rutina entera', () => D.borrarDia('dia'));
		const trasBorrar = crearHistorialResumen(
			await db.sesiones.orderBy('fecha').toArray(),
			await db.dias.toArray(),
			'kg'
		);
		expect(trasBorrar.totalDias).toBe(1);
		expect(trasBorrar.dias[0]?.sets).toBe(3);

		// Y ahora se desarma el historial serie por serie, hasta vaciarlo.
		const id = S.sesionId('dia', F);
		for (let i = 2; i >= 0; i--) {
			await tras(`borrar la serie ${i} desde el historial`, () =>
				S.borrarSetHistorial(id, 'press-pecho', i)
			);
		}
		await tras('borrar la última serie que quedaba', () =>
			S.borrarSetHistorial(id, 'dominadas', 0)
		);
		const vacio = crearHistorialResumen(
			await db.sesiones.orderBy('fecha').toArray(),
			await db.dias.toArray(),
			'kg'
		);
		expect(vacio.totalDias).toBe(0);

		expect(violaciones).toEqual([]);
	}, 120_000);

	it('sobrevive a corregir un PR hacia abajo y hacia arriba desde el historial', async () => {
		await db.dias.put({
			id: 'dia',
			nombre: 'Mi rutina',
			orden: 0,
			ejercicios: [{ exerciseId: 'press-pecho', seriesObjetivo: 2, orden: 0 }]
		});
		const cargar = async (fecha: string, peso: number, reps: number) => {
			await S.ensureEjercicio('dia', 'press-pecho', 2, fecha);
			await S.setPeso('dia', 'press-pecho', 0, peso, fecha);
			await S.setReps('dia', 'press-pecho', 0, reps, fecha);
			await S.setSerieHecha('dia', 'press-pecho', 0, true, fecha);
		};
		await tras('día 1: 70×10', () => cargar('2026-06-01', 70, 10));
		await tras('día 2: 120×5, nuevo PR', () => cargar('2026-06-02', 120, 5));

		const id = S.sesionId('dia', '2026-06-02');
		await tras('corregir el PR a 60', () =>
			S.actualizarSetHistorial(id, 'press-pecho', 0, { peso: 60, reps: 5 }, 'kg')
		);
		// El récord vuelve al día anterior, que es el mayor que queda en pie.
		const ajustes = normalizarAjustes(await db.ajustes.get('app'));
		const bajado = S.recordsGlobales(await db.sesiones.orderBy('fecha').toArray(), ajustes, 'kg');
		expect(bajado[0]?.valor).toBe(70);
		expect(bajado[0]?.fecha).toBe('2026-06-01');

		await tras('subirlo a 130', () =>
			S.actualizarSetHistorial(id, 'press-pecho', 0, { peso: 130, reps: 5 }, 'kg')
		);
		const subido = S.recordsGlobales(await db.sesiones.orderBy('fecha').toArray(), ajustes, 'kg');
		expect(subido[0]?.valor).toBe(130);
		expect(violaciones).toEqual([]);
	}, 120_000);

	it('sobrevive a dos rutinas el mismo día cuando se borra la más fuerte', async () => {
		await db.dias.bulkPut([
			{
				id: 'x',
				nombre: 'X',
				orden: 0,
				ejercicios: [{ exerciseId: 'press-pecho', seriesObjetivo: 1, orden: 0 }]
			},
			{
				id: 'y',
				nombre: 'Y',
				orden: 1,
				ejercicios: [{ exerciseId: 'press-pecho', seriesObjetivo: 1, orden: 0 }]
			}
		]);
		const F = '2026-06-05';
		for (const [dia, peso] of [
			['x', 80],
			['y', 110]
		] as const) {
			await S.ensureEjercicio(dia, 'press-pecho', 1, F);
			await S.setPeso(dia, 'press-pecho', 0, peso, F);
			await S.setReps(dia, 'press-pecho', 0, 6, F);
			await S.setSerieHecha(dia, 'press-pecho', 0, true, F);
		}
		violaciones.push(...(await invariantes('dos rutinas el mismo día')));
		const resumen = crearHistorialResumen(
			await db.sesiones.orderBy('fecha').toArray(),
			await db.dias.toArray(),
			'kg'
		);
		// Un solo día en el calendario, con las series de las dos rutinas sumadas.
		expect(resumen.totalDias).toBe(1);
		expect(resumen.dias[0]?.sets).toBe(2);

		await tras('borrar la serie de la rutina más fuerte', () =>
			S.borrarSetHistorial(S.sesionId('y', F), 'press-pecho', 0)
		);
		const ajustes = normalizarAjustes(await db.ajustes.get('app'));
		expect(
			S.recordsGlobales(await db.sesiones.orderBy('fecha').toArray(), ajustes, 'kg')[0]?.valor
		).toBe(80);

		await tras('borrar la rutina Y entera', () => D.borrarDia('y'));
		// Borrar la rutina no borra lo entrenado: el día sigue, con lo que quedó.
		const final = crearHistorialResumen(
			await db.sesiones.orderBy('fecha').toArray(),
			await db.dias.toArray(),
			'kg'
		);
		expect(final.totalDias).toBe(1);
		expect(final.dias[0]?.sets).toBe(1);
		expect(violaciones).toEqual([]);
	}, 120_000);

	it('reiniciar el día y deshacerlo devuelve las series, no sólo el estado', async () => {
		const F = '2026-06-07';
		await db.dias.put({
			id: 'dia',
			nombre: 'Mi rutina',
			orden: 0,
			ejercicios: [{ exerciseId: 'press-pecho', seriesObjetivo: 1, orden: 0 }]
		});
		await S.ensureEjercicio('dia', 'press-pecho', 1, F);
		await S.setPeso('dia', 'press-pecho', 0, 80, F);
		await S.setReps('dia', 'press-pecho', 0, 6, F);
		await S.setSerieHecha('dia', 'press-pecho', 0, true, F);

		const instantanea = await S.reiniciarDia('dia', F);
		expect(instantanea).not.toBeNull();
		violaciones.push(...(await invariantes('día reiniciado')));
		let resumen = crearHistorialResumen(
			await db.sesiones.orderBy('fecha').toArray(),
			await db.dias.toArray(),
			'kg'
		);
		expect(resumen.totalDias).toBe(0);

		await tras('deshacer el reinicio del día', () =>
			S.restaurarInstantanea('dia', instantanea!, F)
		);
		resumen = crearHistorialResumen(
			await db.sesiones.orderBy('fecha').toArray(),
			await db.dias.toArray(),
			'kg'
		);
		expect(resumen.totalDias).toBe(1);
		expect(resumen.dias[0]?.sets).toBe(1);
		expect(violaciones).toEqual([]);
	}, 120_000);

	it('el detalle del día no canta un PR que ninguna serie respalda', async () => {
		// Sólo alcanzable escribiendo fuera de la app (backup adulterado, o un camino de
		// escritura futuro que se olvide de limpiar el snapshot). Las dos pantallas tienen
		// que coincidir igual: antes la del ejercicio lo ocultaba y ésta lo mostraba.
		await db.sesiones.put({
			id: '2026-06-09__dia',
			fecha: '2026-06-09',
			diaId: 'dia',
			exerciseIds: ['press-pecho'],
			ejercicios: [
				{
					exerciseId: 'press-pecho',
					nombreSnapshot: 'Press de pecho',
					prCelebrado: { pesoGramos: 500_000, peso: 500, reps: 5, setIndex: 0, metrica: 'peso' },
					sets: [{ pesoGramos: 70_000, peso: 70, reps: 5, hecha: true }]
				}
			]
		});
		const sesion = await db.sesiones.get('2026-06-09__dia');
		expect(resumenDiaSesion(sesion, 'kg').prs).toEqual([]);
		expect(resumenDiaSesion(sesion, 'kg').setsHechos).toBe(1);
		// Y un PR que SÍ tiene su serie detrás se sigue mostrando.
		await db.sesiones.put({
			id: '2026-06-10__dia',
			fecha: '2026-06-10',
			diaId: 'dia',
			exerciseIds: ['press-pecho'],
			ejercicios: [
				{
					exerciseId: 'press-pecho',
					nombreSnapshot: 'Press de pecho',
					prCelebrado: { pesoGramos: 90_000, peso: 90, reps: 5, setIndex: 0, metrica: 'peso' },
					sets: [{ pesoGramos: 90_000, peso: 90, reps: 5, hecha: true }]
				}
			]
		});
		expect(resumenDiaSesion(await db.sesiones.get('2026-06-10__dia'), 'kg').prs).toMatchObject([
			{ exerciseId: 'press-pecho', peso: 90, reps: 5 }
		]);
	});
});
