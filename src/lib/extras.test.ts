import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Ajustes, type Dia, type Nota, type Sesion } from './db';
import { seedSiVacio } from './seed';
import {
	AJUSTES_DEFAULT,
	borrarTodo,
	exportarJSON,
	importarBackup,
	necesitaBackup,
	normalizarAjustes,
	parseBackup,
	prepararImport,
	setDescansoEjercicio,
	setMetricaPrEjercicio,
	setSonido,
	setPasoPesoEjercicio,
	setUnidad,
	setVibracion,
	toggleSonido
} from './extras';
import { conPesoCanonico, conPesoVisible } from './unidades';

const dia: Dia = {
	id: 'push',
	nombre: 'Push',
	color: '255 122 92',
	diasSemana: [1, 4],
	orden: 1,
	ejercicios: [
		{
			exerciseId: 'press',
			seriesObjetivo: 3,
			orden: 1
		}
	]
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
			prCelebrado: { peso: 100, reps: 6, esMax: true, extraKg: 5, setIndex: 1 },
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
	pasoPeso: 2.5,
	metaPesoGramos: 78_000,
	modoEsfuerzo: 'rir',
	metricasPrEjercicio: { press: 'e1rm' }
};

function sesionCanonica(origen = sesion, unidad: Ajustes['unidad'] = 'kg'): Sesion {
	const copia = structuredClone(origen);
	for (const ejercicio of copia.ejercicios) {
		ejercicio.sets = ejercicio.sets.map((set) => conPesoCanonico(set, unidad));
		if (ejercicio.prCelebrado)
			ejercicio.prCelebrado = conPesoCanonico(ejercicio.prCelebrado, unidad);
	}
	return copia;
}

async function limpiarDb() {
	await db.open();
	await Promise.all([
		db.dias.clear(),
		db.sesiones.clear(),
		db.notas.clear(),
		db.ajustes.clear(),
		db.pesosCorporales.clear()
	]);
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

	it('un ajuste anterior a los canales de sonido hereda el maestro en los logros', () => {
		// Sin esto, quien tenía el sonido apagado se encontraba de golpe con los beeps.
		const apagado = normalizarAjustes({
			id: 'app',
			unidad: 'kg',
			timer: { activo: true, minutos: 2 },
			sonido: false
		} as Ajustes);
		expect(apagado.sonidoLogros).toBe(false);

		const encendido = normalizarAjustes({
			id: 'app',
			unidad: 'kg',
			timer: { activo: true, minutos: 2 },
			sonido: true
		} as Ajustes);
		expect(encendido.sonidoLogros).toBe(true);
	});

	it('un volumen fuera de rango cae al predeterminado en vez de dejar la app muda', () => {
		const con = (volumen: unknown) =>
			normalizarAjustes({
				id: 'app',
				unidad: 'kg',
				timer: { activo: true, minutos: 2 },
				volumen
			} as unknown as Ajustes).volumen;

		expect(con(0.35)).toBe(0.35);
		expect(con(0)).toBe(AJUSTES_DEFAULT.volumen);
		expect(con(-1)).toBe(AJUSTES_DEFAULT.volumen);
		expect(con(4)).toBe(AJUSTES_DEFAULT.volumen);
		expect(con(Number.NaN)).toBe(AJUSTES_DEFAULT.volumen);
		expect(con('alto')).toBe(AJUSTES_DEFAULT.volumen);
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
		await db.pesosCorporales.put({
			fecha: '2026-01-05',
			pesoGramos: 80_500,
			registradoAt: '2026-01-05T08:00:00.000Z'
		});

		const backup = parseBackup(await exportarJSON());
		await limpiarDb();
		await importarBackup(backup);

		expect(await db.dias.toArray()).toEqual([dia]);
		expect(await db.notas.toArray()).toEqual([nota]);
		expect(await db.ajustes.toArray()).toEqual([ajustes]);
		expect(await db.pesosCorporales.toArray()).toEqual([
			{
				fecha: '2026-01-05',
				pesoGramos: 80_500,
				registradoAt: '2026-01-05T08:00:00.000Z'
			}
		]);
		// El backup no guarda `exerciseIds` (es índice derivado): se reconstruye al importar.
		expect(JSON.parse(await exportarJSON()).sesiones[0].exerciseIds).toBeUndefined();
		expect(await db.sesiones.toArray()).toMatchObject([
			{ ...sesion, ordenEnDia: 0, exerciseIds: sesion.ejercicios.map((e) => e.exerciseId) }
		]);
		expect((await db.sesiones.get(sesion.id))?.ejercicios[0]?.sets[1]).toMatchObject({
			pesoGramos: 100_000,
			extraGramos: 5_000
		});
	});

	it('un backup v1 sin pesos corporales sigue siendo aceptado', () => {
		expect(
			parseBackup(
				JSON.stringify({
					app: 'gym-brot',
					version: 1,
					dias: [],
					sesiones: [],
					notas: [],
					ajustes: []
				})
			).pesosCorporales
		).toBeUndefined();
	});

	it('el import elimina RIR fuera de rango sin descartar la serie', () => {
		const preparada = prepararImport({
			dias: [dia],
			notas: [],
			ajustes: [ajustes],
			pesosCorporales: [],
			sesiones: [
				{
					...sesion,
					ejercicios: [{ exerciseId: 'press', sets: [{ peso: 80, reps: 10, hecha: true, rir: 8 }] }]
				}
			]
		});
		expect(preparada.datos.sesiones[0]?.ejercicios[0]?.sets[0]?.rir).toBeUndefined();
		expect(preparada.avisos.join(' ')).toContain('RIR');
	});

	it('el import descarta mediciones de peso con fecha imposible', () => {
		const preparada = prepararImport({
			dias: [],
			sesiones: [],
			notas: [],
			ajustes: [ajustes],
			pesosCorporales: [
				{ fecha: 'no-es-una-fecha', pesoGramos: 80_000, registradoAt: '2026-08-24T10:00:00.000Z' },
				{ fecha: '2026-02-30', pesoGramos: 81_000, registradoAt: '2026-08-24T10:00:00.000Z' },
				{ fecha: '', pesoGramos: 82_000, registradoAt: '2026-08-24T10:00:00.000Z' },
				{ fecha: '2026-08-24', pesoGramos: 83_000, registradoAt: '2026-08-24T10:00:00.000Z' }
			]
		});
		expect(preparada.datos.pesosCorporales.map((peso) => peso.fecha)).toEqual(['2026-08-24']);
		expect(preparada.avisos.join(' ')).toContain('fecha inválida');
	});

	it('el import descarta mediciones de peso con fecha futura', () => {
		const preparada = prepararImport({
			dias: [],
			sesiones: [],
			notas: [],
			ajustes: [ajustes],
			pesosCorporales: [
				{ fecha: '9999-12-31', pesoGramos: 80_000, registradoAt: '2026-08-24T10:00:00.000Z' },
				{ fecha: '2026-08-24', pesoGramos: 83_000, registradoAt: '2026-08-24T10:00:00.000Z' }
			]
		});
		expect(preparada.datos.pesosCorporales.map((peso) => peso.fecha)).toEqual(['2026-08-24']);
		expect(preparada.avisos.join(' ')).toContain('fecha futura');
	});

	it('personalizar el paso de un ejercicio no modifica ninguna sesión histórica', async () => {
		await db.sesiones.put(sesionCanonica());
		await db.ajustes.put(ajustes);
		const historialAntes = structuredClone(await db.sesiones.toArray());

		await setPasoPesoEjercicio('press', 'kg', 1);

		expect(await db.sesiones.toArray()).toEqual(historialAntes);
		expect((await db.ajustes.get('app'))?.pasosPesoEjercicio).toEqual({ press: { kg: 1 } });
	});

	it('quitar el override de PR vuelve al ajuste global sin tocar sesiones', async () => {
		await db.sesiones.put(sesionCanonica());
		await db.ajustes.put({ ...ajustes, metricasPrEjercicio: {} });
		const historialAntes = structuredClone(await db.sesiones.toArray());

		await setMetricaPrEjercicio('press', 'e1rm');
		expect((await db.ajustes.get('app'))?.metricasPrEjercicio).toEqual({ press: 'e1rm' });
		await setMetricaPrEjercicio('press');

		expect((await db.ajustes.get('app'))?.metricasPrEjercicio).toEqual({});
		expect(await db.sesiones.toArray()).toEqual(historialAntes);
	});

	it('el descanso de un ejercicio no toca el de los demás ni el general', async () => {
		await db.ajustes.put(ajustes);

		await setDescansoEjercicio('elevaciones-laterales', 0.75);
		await setDescansoEjercicio('press', 3);

		const guardados = await db.ajustes.get('app');
		expect(guardados?.descansosEjercicio).toEqual({
			'elevaciones-laterales': 0.75,
			press: 3
		});
		// El general queda intacto: era justo lo que antes se pisaba sin querer.
		expect(guardados?.timer).toEqual(ajustes.timer);
	});

	it('0 apaga el descanso de un ejercicio y undefined lo devuelve a automático', async () => {
		await db.ajustes.put(ajustes);

		await setDescansoEjercicio('abdominales', 0);
		expect((await db.ajustes.get('app'))?.descansosEjercicio).toEqual({ abdominales: 0 });

		await setDescansoEjercicio('abdominales');
		expect((await db.ajustes.get('app'))?.descansosEjercicio).toEqual({});
	});

	it('rechaza un descanso negativo en vez de guardarlo', async () => {
		await db.ajustes.put(ajustes);
		await expect(setDescansoEjercicio('press', -1)).rejects.toThrow(RangeError);
		expect((await db.ajustes.get('app'))?.descansosEjercicio ?? {}).toEqual({});
	});

	it('el descanso por ejercicio viaja en el backup y vuelve igual', async () => {
		await db.ajustes.put(ajustes);
		await setDescansoEjercicio('press', 1.5);

		const backup = parseBackup(await exportarJSON());

		expect(backup.ajustes?.[0]?.descansosEjercicio).toEqual({ press: 1.5 });
	});

	it('setUnidad lb -> kg no reescribe el historial', async () => {
		await db.sesiones.put(sesionCanonica());
		await db.ajustes.put(ajustes);
		const historialAntes = structuredClone(await db.sesiones.toArray());

		await setUnidad('lb');
		await setUnidad('kg');

		expect(await db.sesiones.toArray()).toEqual(historialAntes);
	});

	it('serializa cambios de unidad concurrentes para no convertir dos veces el historial', async () => {
		await db.sesiones.put(sesionCanonica());
		await db.ajustes.put(ajustes);
		const historialAntes = structuredClone(await db.sesiones.toArray());

		await Promise.all([setUnidad('lb'), setUnidad('lb')]);

		const vuelta = await db.sesiones.get(sesion.id);
		expect((await db.ajustes.get('app'))?.unidad).toBe('lb');
		expect(await db.sesiones.toArray()).toEqual(historialAntes);
		expect(conPesoVisible(vuelta!.ejercicios[0]!.sets[1]!, 'lb').peso).toBeCloseTo(220.5, 1);
	});

	it('no pierde ajustes concurrentes mientras cambia la unidad', async () => {
		await db.sesiones.put(sesionCanonica());
		await db.ajustes.put(ajustes);
		const historialAntes = structuredClone(await db.sesiones.toArray());

		await Promise.all([setUnidad('lb'), setSonido(false), setVibracion(false)]);

		expect(await db.ajustes.get('app')).toMatchObject({
			unidad: 'lb',
			sonido: false,
			vibracion: false
		});
		expect(await db.sesiones.toArray()).toEqual(historialAntes);
	});

	it('dos toggles concurrentes se componen sobre el valor persistido', async () => {
		await db.ajustes.put(ajustes);
		await Promise.all([toggleSonido(), toggleSonido()]);
		expect((await db.ajustes.get('app'))?.sonido).toBe(true);
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

	it('rechaza versiones futuras y valores negativos antes de restaurar', () => {
		expect(() =>
			parseBackup(
				JSON.stringify({
					app: 'gym-brot',
					version: 999,
					dias: [],
					sesiones: [],
					notas: [],
					ajustes: []
				})
			)
		).toThrow('version');
		expect(() =>
			parseBackup(
				JSON.stringify({
					app: 'gym-brot',
					dias: [dia],
					sesiones: [
						{
							...sesion,
							ejercicios: [{ ...sesion.ejercicios[0], sets: [{ hecha: true, peso: -1 }] }]
						}
					],
					notas: [],
					ajustes: []
				})
			)
		).toThrow('sesiones');
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

	it('descarta fechas imposibles aunque cumplan el formato', () => {
		const { datos, avisos } = prepararImport({
			sesiones: [sesionCon('2026-99-99__push', '2026-99-99', 'push')],
			dias: [dia],
			notas: [],
			ajustes: []
		});
		expect(datos.sesiones).toEqual([]);
		expect(avisos.join(' ')).toContain('fecha inválida');
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

	it('avisa y elimina ejercicios repetidos dentro de una sesión', () => {
		const repetida: Sesion = {
			...sesion,
			ejercicios: [sesion.ejercicios[0]!, structuredClone(sesion.ejercicios[0]!)]
		};
		const { datos, avisos } = prepararImport({
			dias: [dia],
			sesiones: [repetida],
			notas: [],
			ajustes: [ajustes]
		});
		expect(datos.sesiones[0]?.ejercicios).toHaveLength(1);
		expect(avisos.join(' ')).toContain('duplicados dentro de una sesión');
	});

	it('acepta pesos decimales pero rechaza cantidades fraccionarias de series', () => {
		const base = {
			app: 'gym-brot',
			dias: [dia],
			sesiones: [
				{
					...sesion,
					ejercicios: [{ ...sesion.ejercicios[0]!, sets: [{ peso: 1.5, reps: 5, hecha: true }] }]
				}
			],
			notas: [],
			ajustes: [ajustes]
		};
		expect(() => parseBackup(JSON.stringify(base))).not.toThrow();
		expect(() =>
			parseBackup(
				JSON.stringify({
					...base,
					dias: [{ ...dia, ejercicios: [{ ...dia.ejercicios[0]!, seriesObjetivo: 1.5 }] }]
				})
			)
		).toThrow('dias');
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

	it('un backup sin ajustes conserva intencionalmente una lista de rutinas vacía', async () => {
		const avisos = await importarBackup({ dias: [], sesiones: [], notas: [], ajustes: [] });
		await seedSiVacio();

		expect(await db.dias.count()).toBe(0);
		expect((await db.ajustes.get('app'))?.seedInicialHecho).toBe(true);
		expect(avisos.join(' ')).toContain('no traía ajustes');
	});

	it('repara ajustes que dejarían inutilizables el timer o los controles de peso', () => {
		const { datos, avisos } = prepararImport({
			dias: [],
			sesiones: [],
			notas: [],
			ajustes: [{ ...ajustes, timer: { activo: true, minutos: 0 }, pasoPeso: 0 }]
		});

		expect(datos.ajustes[0]?.timer.minutos).toBe(AJUSTES_DEFAULT.timer.minutos);
		expect(datos.ajustes[0]?.pasoPeso).toBe(AJUSTES_DEFAULT.pasoPeso);
		expect(avisos.join(' ')).toContain('ajustes inválidos');
	});

	it('reubica un PR al set que lo respalda y descarta snapshots inventados', () => {
		const base: Sesion = {
			...sesion,
			ejercicios: [
				{
					exerciseId: 'press',
					sets: [
						{ peso: 80, reps: 10, hecha: true },
						{ peso: 100, reps: 6, hecha: true }
					],
					prCelebrado: { peso: 100, reps: 6, setIndex: 0 }
				}
			]
		};
		const falso: Sesion = {
			...base,
			id: '2026-01-06__push',
			fecha: '2026-01-06',
			ejercicios: [{ ...base.ejercicios[0]!, prCelebrado: { peso: 999, reps: 1 } }]
		};

		const { datos, avisos } = prepararImport({
			dias: [dia],
			sesiones: [base, falso],
			notas: [],
			ajustes: [ajustes]
		});

		expect(datos.sesiones[0]?.ejercicios[0]?.prCelebrado?.setIndex).toBe(1);
		expect(datos.sesiones[1]?.ejercicios[0]?.prCelebrado).toBeUndefined();
		expect(avisos.join(' ')).toContain('se reubicaron');
		expect(avisos.join(' ')).toContain('se descartaron');
	});

	it('recupera series antiguas con 0 reps sin contarlas ni conservar su PR', () => {
		const { datos, avisos } = prepararImport({
			dias: [dia],
			sesiones: [
				{
					...sesion,
					ejercicios: [
						{
							exerciseId: 'press',
							sets: [{ peso: 110, reps: 0, hecha: true }],
							prCelebrado: { peso: 110, reps: 0, setIndex: 0 }
						}
					]
				}
			],
			notas: [],
			ajustes: [ajustes]
		});

		expect(datos.sesiones[0]?.ejercicios[0]).toMatchObject({
			exerciseId: 'press',
			sets: [{ peso: 110, reps: undefined, hecha: false }],
			prCelebrado: undefined
		});
		expect(avisos.join(' ')).toContain('sin repeticiones válidas');
		expect(avisos.join(' ')).toContain('PR(s)');
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
