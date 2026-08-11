import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

/**
 * Simula la base REAL de un usuario existente (creada con el esquema v1/v2,
 * días con diaSemana único) y la abre con el módulo actual: las migraciones
 * tienen que completarse sin colgarse — v3 convierte diaSemana → diasSemana[]
 * y v4 rellena el índice `exerciseIds` de las sesiones que ya existían.
 */
describe('migración de esquema', () => {
	it('abre una base v2 existente y migra diaSemana a diasSemana[]', async () => {
		const legacy = new Dexie('gym-brot');
		legacy.version(1).stores({
			dias: 'id, diaSemana, orden',
			sesiones: 'id, diaId, fecha',
			registros: 'id, exerciseId, fecha',
			notas: 'exerciseId',
			ajustes: 'id'
		});
		legacy.version(2).stores({ registros: null });
		await legacy.open();
		await legacy.table('dias').bulkPut([
			{ id: 'd1', nombre: 'Piernas', diaSemana: 1, orden: 0, ejercicios: [] },
			{ id: 'd2', nombre: 'Empuje', orden: 1, ejercicios: [] }
		]);
		await legacy.table('sesiones').put({
			id: '2026-06-10__d1',
			fecha: '2026-06-10',
			diaId: 'd1',
			ejercicios: [{ exerciseId: 'press', sets: [{ peso: 80, reps: 10, hecha: true }] }]
		});
		legacy.close();

		const { db } = await import('./db');
		// Si la migración se cuelga, este open() no resuelve y el test vence por timeout.
		await db.open();

		const d1 = await db.dias.get('d1');
		const d2 = await db.dias.get('d2');
		expect(d1?.diasSemana).toEqual([1]);
		expect(d1 && 'diaSemana' in d1).toBe(false);
		expect(d2?.diasSemana).toBeUndefined();
		// El resto de los datos sobrevive intacto.
		expect((await db.sesiones.get('2026-06-10__d1'))?.ejercicios[0]?.sets[0]?.peso).toBe(80);
		expect(await db.dias.orderBy('orden').toArray()).toHaveLength(2);

		// v4: la sesión vieja quedó indexada por ejercicio. Se comprueba el campo Y la
		// consulta: si el índice no se hubiera poblado, esa sesión sería invisible para
		// el historial y para el cálculo de PR, que es el peor fallo posible acá.
		expect((await db.sesiones.get('2026-06-10__d1'))?.exerciseIds).toEqual(['press']);
		const { sesionesDe } = await import('./sesion');
		expect((await sesionesDe('press')).map((s) => s.id)).toEqual(['2026-06-10__d1']);
		db.close();
	});
});
