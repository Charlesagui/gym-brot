import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Ajustes, type Dia, type Nota, type Sesion } from './db';
import {
	AJUSTES_DEFAULT,
	borrarTodo,
	exportarJSON,
	importarBackup,
	necesitaBackup,
	normalizarAjustes,
	parseBackup,
	prepararImport,
	setUnidad
} from './extras';

const dia: Dia = {
	id: 'push',
	nombre: 'Push',
	color: '255 122 92',
	diasSemana: [1, 4],
	orden: 1,
	ejercicios: [{ exerciseId: 'press', seriesObjetivo: 3, orden: 1 }]
};

const sesion: Sesion = {
	id: '2026-01-05__push',
	fecha: '2026-01-05',
	diaId: 'push',
	diaTerminado: true,
	diaTerminadoAt: '2026-01-05T20:00:00.000Z',
	ejercicios: [
		{
			exerciseId: 'press',
			prCelebrado: { peso: 100, reps: 6, esMax: true, extraKg: 5 },
			sets: [
				{ peso: 80, reps: 10, hecha: true },
				{ peso: 100, reps: 6, hecha: true, esMax: true, extraKg: 5 }
			]
		}
	]
};

const nota: Nota = { exerciseId: 'press', texto: 'Banco en 4' };

const ajustes: Ajustes = {
	...AJUSTES_DEFAULT,
	unidad: 'kg',
	pasoPeso: 2.5
};

async function limpiarDb() {
	await db.open();
	await Promise.all([db.dias.clear(), db.sesiones.clear(), db.notas.clear(), db.ajustes.clear()]);
}

describe('normalizarAjustes', () => {
	it('rellena defaults de campos faltantes', () => {
		expect(
			normalizarAjustes({
				id: 'app',
				unidad: 'kg',
				timer: { activo: false, minutos: 1 }
			} as Ajustes)
		).toEqual({
			...AJUSTES_DEFAULT,
			unidad: 'kg',
			timer: { activo: false, minutos: 1 }
		});
	});
});

describe('backup', () => {
	beforeEach(async () => {
		await limpiarDb();
	});

	it('exportarJSON -> parseBackup -> importarBackup reproduce los datos', async () => {
		await db.dias.put(dia);
		await db.sesiones.put(sesion);
		await db.notas.put(nota);
		await db.ajustes.put(ajustes);

		const backup = parseBackup(await exportarJSON());
		await limpiarDb();
		await importarBackup(backup);

		expect(await db.dias.toArray()).toEqual([dia]);
		expect(await db.sesiones.toArray()).toEqual([sesion]);
		expect(await db.notas.toArray()).toEqual([nota]);
		expect(await db.ajustes.toArray()).toEqual([ajustes]);
	});

	it('setUnidad lb -> kg conserva pesos con redondeo a 1 decimal', async () => {
		await db.sesiones.put(structuredClone(sesion));
		await db.ajustes.put(ajustes);

		await setUnidad('lb');
		await setUnidad('kg');

		const vuelta = await db.sesiones.get(sesion.id);
		expect(vuelta?.ejercicios[0]?.sets[0]?.peso).toBeCloseTo(80, 1);
		expect(vuelta?.ejercicios[0]?.sets[1]?.peso).toBeCloseTo(100, 1);
		expect(vuelta?.ejercicios[0]?.sets[1]?.extraKg).toBeCloseTo(5, 1);
		expect(vuelta?.ejercicios[0]?.prCelebrado?.peso).toBeCloseTo(100, 1);
		expect(vuelta?.ejercicios[0]?.prCelebrado?.extraKg).toBeCloseTo(5, 1);
	});

	it('importarBackup migra el diaSemana único de backups viejos a diasSemana[]', async () => {
		const legacy = { ...dia, diasSemana: undefined, diaSemana: 1 };
		const backup = parseBackup(
			JSON.stringify({
				app: 'gym-brot',
				dias: [legacy],
				sesiones: [],
				notas: [],
				ajustes: []
			})
		);
		await importarBackup(backup);

		const vuelta = await db.dias.get('push');
		expect(vuelta?.diasSemana).toEqual([1]);
		expect(vuelta && 'diaSemana' in vuelta).toBe(false);
	});

	it('parseBackup rechaza JSON malformado o ajeno y tolera prPesoCelebrado legacy', () => {
		expect(() => parseBackup('{')).toThrow();
		expect(() => parseBackup(JSON.stringify({ app: 'otra-app' }))).toThrow();
		expect(() =>
			parseBackup(
				JSON.stringify({
					app: 'gym-brot',
					dias: [dia],
					sesiones: [
						{
							...sesion,
							ejercicios: [{ ...sesion.ejercicios[0], prPesoCelebrado: 100 }]
						}
					],
					notas: [nota],
					ajustes: [ajustes]
				})
			)
		).not.toThrow();
	});
});

/**
 * `parseBackup` valida formas; esto valida coherencia. Una sesión cuyo id no sea
 * `${fecha}__${diaId}` se ve bien en el historial pero la app nunca puede volver a
 * escribirla, porque `sesionId()` arma otro id.
 */
describe('prepararImport', () => {
	beforeEach(limpiarDb);

	function sesionCon(id: string, fecha: string, diaId: string): Sesion {
		return { id, fecha, diaId, ejercicios: [] };
	}

	it('corrige el id de sesiones inconsistentes y lo avisa', () => {
		const { datos, avisos } = prepararImport({
			sesiones: [sesionCon('cualquier-cosa', '2026-01-05', 'push')],
			dias: [dia],
			notas: [],
			ajustes: []
		});
		expect(datos.sesiones[0]?.id).toBe('2026-01-05__push');
		expect(avisos.join(' ')).toContain('id inconsistente');
	});

	it('descarta fechas inválidas y sesiones duplicadas', () => {
		const { datos, avisos } = prepararImport({
			sesiones: [
				sesionCon('a', 'ayer', 'push'),
				sesionCon('2026-01-05__push', '2026-01-05', 'push'),
				sesionCon('otro', '2026-01-05', 'push')
			],
			dias: [dia],
			notas: [],
			ajustes: []
		});
		expect(datos.sesiones).toHaveLength(1);
		expect(avisos.join(' ')).toContain('fecha inválida');
		expect(avisos.join(' ')).toContain('duplicadas');
	});

	it('avisa cuando una sesión apunta a una rutina que no vino en el backup', () => {
		const { avisos } = prepararImport({
			sesiones: [sesionCon('2026-01-05__fantasma', '2026-01-05', 'fantasma')],
			dias: [],
			notas: [],
			ajustes: []
		});
		expect(avisos.join(' ')).toContain('no está en el backup');
	});

	it('ignora días y notas con id repetido', () => {
		const { datos, avisos } = prepararImport({
			dias: [dia, { ...dia, nombre: 'Otro' }],
			sesiones: [],
			notas: [nota, { ...nota, texto: 'otra' }],
			ajustes: []
		});
		expect(datos.dias).toHaveLength(1);
		expect(datos.dias[0]?.nombre).toBe('Push');
		expect(datos.notas).toHaveLength(1);
		expect(avisos.join(' ')).toContain('id repetido');
	});

	it('un backup sano no genera ningún aviso', () => {
		const { avisos } = prepararImport({
			dias: [dia],
			sesiones: [sesion],
			notas: [nota],
			ajustes: [ajustes]
		});
		expect(avisos).toEqual([]);
	});
});

describe('borrarTodo', () => {
	beforeEach(limpiarDb);

	it('deja las cuatro tablas vacías', async () => {
		await db.dias.put(dia);
		await db.sesiones.put(sesion);
		await db.notas.put(nota);
		await db.ajustes.put(ajustes);

		await borrarTodo();

		expect(await db.dias.count()).toBe(0);
		expect(await db.sesiones.count()).toBe(0);
		expect(await db.notas.count()).toBe(0);
		expect(await db.ajustes.count()).toBe(0);
	});
});

describe('necesitaBackup', () => {
	const ahora = new Date('2026-06-10T12:00:00');

	it('sin entrenamientos nunca recuerda', () => {
		expect(necesitaBackup(undefined, [], ahora)).toBe(false);
	});

	it('sin backup previo recuerda recien con >30 dias de historial', () => {
		expect(necesitaBackup(undefined, ['2026-06-01'], ahora)).toBe(false);
		expect(necesitaBackup(undefined, ['2026-04-01', '2026-06-01'], ahora)).toBe(true);
	});

	it('con backup reciente no recuerda aunque haya sesiones nuevas', () => {
		expect(necesitaBackup('2026-06-01T10:00:00.000Z', ['2026-06-05'], ahora)).toBe(false);
	});

	it('con backup viejo recuerda solo si hay sesiones posteriores al backup', () => {
		expect(necesitaBackup('2026-01-01T10:00:00.000Z', ['2026-03-01'], ahora)).toBe(true);
		expect(necesitaBackup('2026-01-01T10:00:00.000Z', ['2025-12-20'], ahora)).toBe(false);
	});
});
