import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * El salto que ocurre DE VERDAD cuando se publica una versión: alguien que ya venía
 * usando la app (base en v9, con los datos que las migraciones anteriores dejaron
 * en su forma final) abre el deploy nuevo.
 *
 * `db-migracion.test.ts` cubre el otro extremo —una base v2 primitiva— y por eso no
 * detecta este caso: ahí ninguna sesión trae todavía `pesoGramos`, `ordenEnDia` ni
 * `nombreSnapshot`, así que no puede afirmar nada sobre qué le pasa a esos campos
 * cuando ya existen. Acá se parte del estado real de producción y se exige que el
 * historial cruce entero: series, PR, índice por ejercicio, notas y ajustes.
 */
function baseComoEnProduccion() {
	const legacy = new Dexie('gym-brot');
	legacy.version(1).stores({
		dias: 'id, diaSemana, orden',
		sesiones: 'id, diaId, fecha',
		registros: 'id, exerciseId, fecha',
		notas: 'exerciseId',
		ajustes: 'id'
	});
	legacy.version(2).stores({ registros: null });
	legacy.version(3).stores({ dias: 'id, orden' });
	for (const version of [4, 5, 6, 7]) {
		legacy.version(version).stores({ sesiones: 'id, diaId, fecha, *exerciseIds' });
	}
	legacy.version(8);
	legacy.version(9);
	return legacy;
}

describe('actualización de una base ya en uso', () => {
	// Cada caso arma su propia base en v9: fake-indexeddb es un único almacén para todo
	// el archivo, y sin esto el historial de un test se cuela en las cuentas del siguiente.
	beforeEach(async () => {
		const { db } = await import('./db');
		db.close();
		await Dexie.delete('gym-brot');
	});

	it('cruza el historial entero de v9 a la versión actual', async () => {
		const legacy = baseComoEnProduccion();
		await legacy.open();
		expect(legacy.verno).toBe(9);

		await legacy.table('dias').put({
			id: 'd1',
			nombre: 'Piernas',
			diasSemana: [1, 4],
			orden: 0,
			color: '130 104 255',
			ejercicios: [{ exerciseId: 'extension-cuadriceps', seriesObjetivo: 4, orden: 0 }]
		});
		await legacy.table('ajustes').put({
			id: 'app',
			unidad: 'kg',
			timer: { activo: true, minutos: 2 },
			sonido: true,
			sonidoLogros: true,
			volumen: 1,
			vibracion: true,
			descansoPantallaCompleta: true,
			metricaPr: 'peso',
			pasoPeso: 5,
			seedInicialHecho: true,
			ultimoBackup: '2026-05-01T10:00:00.000Z'
		});
		await legacy.table('notas').put({ exerciseId: 'extension-cuadriceps', texto: 'asiento en 4' });

		// Un año de entrenamiento, ya en la forma que dejan las migraciones hasta v9.
		const sesiones = Array.from({ length: 200 }, (_, i) => {
			const fecha = new Date(2025, 0, 1 + i).toLocaleDateString('sv');
			return {
				id: `${fecha}__d1`,
				fecha,
				diaId: 'd1',
				diaNombre: 'Piernas',
				ordenEnDia: 0,
				diaTerminado: true,
				diaTerminadoAt: `${fecha}T19:00:00.000Z`,
				exerciseIds: ['extension-cuadriceps'],
				ejercicios: [
					{
						exerciseId: 'extension-cuadriceps',
						nombreSnapshot: 'Extensión de cuádriceps',
						prCelebrado:
							i === 199
								? { peso: 100, pesoGramos: 100_000, reps: 8, setIndex: 0, metrica: 'peso' }
								: undefined,
						sets: [
							{ peso: 100, pesoGramos: 100_000, reps: 8, hecha: true },
							{ peso: 90, pesoGramos: 90_000, reps: 10, hecha: true }
						]
					}
				]
			};
		});
		await legacy.table('sesiones').bulkPut(sesiones);
		legacy.close();

		const { completarNombresSnapshotFaltantes, db } = await import('./db');
		await db.open();
		await completarNombresSnapshotFaltantes();

		// Nada se perdió ni se reescribió por el camino.
		expect(await db.sesiones.count()).toBe(200);
		expect(await db.dias.count()).toBe(1);
		expect((await db.notas.get('extension-cuadriceps'))?.texto).toBe('asiento en 4');

		const ultima = await db.sesiones.get(sesiones.at(-1)!.id);
		expect(ultima?.ejercicios[0]?.sets[0]).toMatchObject({
			pesoGramos: 100_000,
			reps: 8,
			hecha: true
		});
		// El PR sigue en pie: v5 y v6 lo retiran si no encuentran la serie que lo logró.
		expect(ultima?.ejercicios[0]?.prCelebrado?.pesoGramos).toBe(100_000);
		// Sin el índice por ejercicio al día, esa sesión sería invisible para el historial.
		expect(ultima?.exerciseIds).toEqual(['extension-cuadriceps']);

		// Las preferencias sobreviven y las nuevas toman su valor por defecto al leerlas,
		// no un `undefined` que un toggle convertiría en lo contrario de lo que se ve.
		const { normalizarAjustes } = await import('./extras');
		const ajustes = normalizarAjustes(await db.ajustes.get('app'));
		expect(ajustes.ultimoBackup).toBe('2026-05-01T10:00:00.000Z');
		expect(ajustes.pasoPeso).toBe(5);
		expect(ajustes.ejercicioPantallaEncendida).toBe(true);
		expect(ajustes.modoEsfuerzo).toBe('off');

		// Las tablas nuevas existen y la migración no inventa datos en ellas.
		expect(await db.pesosCorporales.count()).toBe(0);
		expect(await db.objetivosEnergia.count()).toBe(0);

		// Y el historial se calcula sobre esos datos migrados, que es lo que ve la persona.
		const { crearHistorialResumen } = await import('./historial');
		const resumen = crearHistorialResumen(
			await db.sesiones.orderBy('fecha').toArray(),
			await db.dias.toArray(),
			'kg'
		);
		expect(resumen.totalDias).toBe(200);
		expect(resumen.dias[0]?.sets).toBe(2);
		db.close();
	}, 60_000);

	it('el mapa corporal lee el historial migrado, sin RIR ni gramos', async () => {
		// Datos con la forma ANTERIOR a v7: sólo `peso` visible, sin `pesoGramos`, y sin
		// `rir` (el campo no existía). El mapa se apoya en `serieCompleta`, que sólo mira
		// `hecha` y las repeticiones, así que tiene que verlos igual.
		const legacy = baseComoEnProduccion();
		await legacy.open();
		await legacy
			.table('ajustes')
			.put({ id: 'app', unidad: 'kg', timer: { activo: true, minutos: 2 } });
		await legacy.table('dias').put({ id: 'd1', nombre: 'Full', orden: 0, ejercicios: [] });
		const sesionVieja = (fecha: string) => ({
			id: `${fecha}__d1`,
			fecha,
			diaId: 'd1',
			ejercicios: [
				{
					exerciseId: 'extension-cuadriceps',
					sets: [
						{ peso: 60, reps: 10, hecha: true },
						{ peso: 65, reps: 8, hecha: true }
					]
				},
				{ exerciseId: 'press-pecho', sets: [{ peso: 50, reps: 10, hecha: true }] }
			]
		});
		await legacy.table('sesiones').bulkPut([
			// Dentro de la ventana de 4 semanas que mira el mapa…
			sesionVieja('2026-08-20'),
			sesionVieja('2026-08-18'),
			// …y una vieja, que el calendario sí muestra y el mapa deja fuera a propósito.
			sesionVieja('2025-03-01')
		]);
		legacy.close();

		const { completarNombresSnapshotFaltantes, db } = await import('./db');
		await db.open();
		await completarNombresSnapshotFaltantes();

		const { crearDistribucionMuscular, desdeDistribucion } = await import('./musculos');
		const hasta = '2026-08-25';
		const desde = desdeDistribucion(hasta, 4);
		const distribucion = crearDistribucionMuscular(
			await db.sesiones.where('fecha').between(desde, hasta, true, true).toArray(),
			hasta,
			4
		);

		// Las 6 series de las dos sesiones recientes entran y pintan músculos reales.
		expect(distribucion.seriesCompletadas).toBe(6);
		expect(distribucion.seriesSinRepresentacion).toBe(0);
		expect(distribucion.seriesConsideradas).toBe(6);
		expect(distribucion.cargas.length).toBeGreaterThan(0);
		expect(distribucion.cargas.map((carga) => carga.musculo)).toContain('quadriceps');
		expect(distribucion.cargas[0]!.seriesEstimadas).toBeGreaterThan(0);
		// Sin RIR en el historial viejo, el filtro de series duras no se ofrece: no puede
		// inventar un dato que nadie registró.
		expect(distribucion.coberturaRir).toBe(0);
		expect(distribucion.puedeFiltrarDuras).toBe(false);

		// El calendario, en cambio, sigue mostrando los tres días: son ventanas distintas
		// del mismo historial, no dos verdades.
		const { crearHistorialResumen } = await import('./historial');
		const resumen = crearHistorialResumen(
			await db.sesiones.orderBy('fecha').toArray(),
			await db.dias.toArray(),
			'kg'
		);
		expect(resumen.totalDias).toBe(3);
		db.close();
	}, 60_000);

	it('el código viejo no rompe contra una base ya migrada', async () => {
		// Pasa cuando la app instalada quedó con el shell viejo cacheado y otra pestaña
		// ya migró. Dexie reintenta sin versión, así que la copia vieja abre y lee: el
		// layout sólo tiene que evitar ofrecer borrar los datos en ese caso.
		const { db } = await import('./db');
		await db.open();
		await db.dias.put({ id: 'd1', nombre: 'Piernas', orden: 0, ejercicios: [] });
		await db.sesiones.put({
			id: '2026-08-01__d1',
			fecha: '2026-08-01',
			diaId: 'd1',
			exerciseIds: ['x'],
			ejercicios: [{ exerciseId: 'x', sets: [{ pesoGramos: 100_000, reps: 8, hecha: true }] }]
		});
		db.close();

		const viejo = baseComoEnProduccion();
		await viejo.open();
		expect(await viejo.table('sesiones').count()).toBe(1);
		expect(
			(await viejo.table('sesiones').get('2026-08-01__d1'))?.ejercicios[0]?.sets[0]
		).toMatchObject({ pesoGramos: 100_000, reps: 8, hecha: true });
		viejo.close();
	}, 30_000);
});
