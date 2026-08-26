import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { RITMOS, type PerfilEnergia } from './energia';
import {
	borrarObjetivos,
	calcularYGuardar,
	guardarRevision,
	frecuenciaSemanalReciente,
	objetivoVigente,
	perfilGuardado,
	pesoRecienteGramos
} from './perfil-energia';
import { DatosReemplazadosError, invalidarEscriturasPendientes } from './revision-datos';

const PERFIL: PerfilEnergia = {
	edad: 32,
	alturaCm: 178,
	pesoGramos: 82_000,
	ecuacion: 'masculina',
	ocupacion: 'sentado',
	pasos: 'de4a7k',
	sesionesSemana: 4,
	duracion: 'media',
	densidad: 'normal'
};

beforeEach(async () => {
	await db.transaction('rw', [db.objetivosEnergia, db.pesosCorporales, db.sesiones], async () => {
		await Promise.all([
			db.objetivosEnergia.clear(),
			db.pesosCorporales.clear(),
			db.sesiones.clear()
		]);
	});
});

describe('guardar objetivos', () => {
	it('guarda el objetivo con su perfil congelado y sus cifras', async () => {
		const objetivo = await calcularYGuardar(PERFIL, 'bajar', -0.5);
		expect(objetivo).not.toBeNull();
		expect(objetivo).toMatchObject({
			tdeeKcal: 2890,
			objetivoKcal: 2440,
			proteinaG: 148,
			categoriaPal: 'poco',
			meta: 'bajar',
			perfil: PERFIL
		});
		expect(objetivo!.id.startsWith(objetivo!.creadoAt)).toBe(true);
	});

	it('el vigente es el más reciente, sin ninguna bandera que mantener', async () => {
		await calcularYGuardar(PERFIL, 'bajar', -0.5, { creadoAt: '2026-01-01T10:00:00.000Z' });
		const segundo = await calcularYGuardar(PERFIL, 'subir', 0.25, {
			creadoAt: '2026-02-01T10:00:00.000Z'
		});

		expect(await db.objetivosEnergia.count()).toBe(2);
		const vigente = await objetivoVigente();
		expect(vigente?.id).toBe(segundo!.id);
		expect(vigente?.meta).toBe('subir');
	});

	it('dos guardados en el mismo milisegundo no se pisan', async () => {
		const creadoAt = '2026-03-01T10:00:00.000Z';
		const uno = await calcularYGuardar(PERFIL, 'bajar', -0.5, { creadoAt });
		const dos = await calcularYGuardar(PERFIL, 'bajar', -0.25, { creadoAt });
		expect(uno!.id).not.toBe(dos!.id);
		expect(await db.objetivosEnergia.count()).toBe(2);
	});

	it('conserva el nivel, que es lo que rotula el objetivo en pantalla', async () => {
		// Guardar con el ritmo que devuelve el cálculo —redondeado por el objetivo en
		// kcal— en vez del canónico dejaba el nivel en null y la sección mostraba
		// "Déficit a medida" en vez de "Déficit moderado".
		const moderado = (await calcularYGuardar(PERFIL, 'bajar', RITMOS.bajar.moderado))!;
		expect(moderado.nivel).toBe('moderado');
		const agresivo = (await calcularYGuardar(PERFIL, 'bajar', RITMOS.bajar.agresivo))!;
		expect(agresivo.nivel).toBe('agresivo');
		const mantener = (await calcularYGuardar(PERFIL, 'mantener', 0))!;
		expect(mantener.nivel).toBeNull();
	});

	it('encadena la revisión con el objetivo que reemplaza', async () => {
		const original = await calcularYGuardar(PERFIL, 'bajar', -0.5, {
			creadoAt: '2026-01-01T10:00:00.000Z'
		});
		const revisado = await calcularYGuardar(PERFIL, 'bajar', -0.5, {
			creadoAt: '2026-02-01T10:00:00.000Z',
			calibradoDe: original!.id
		});
		expect(revisado!.calibradoDe).toBe(original!.id);
	});

	it('no guarda nada si el perfil no es válido', async () => {
		expect(await calcularYGuardar({ ...PERFIL, edad: 16 }, 'bajar', -0.5)).toBeNull();
		expect(await db.objetivosEnergia.count()).toBe(0);
	});

	it('no guarda nada si la meta está bloqueada para ese IMC', async () => {
		// 50 kg y 178 cm son IMC 15,8: la app no propone déficit y tampoco lo persiste.
		expect(await calcularYGuardar({ ...PERFIL, pesoGramos: 50_000 }, 'bajar', -0.25)).toBeNull();
		expect(await db.objetivosEnergia.count()).toBe(0);
	});

	it('rechaza una fecha de creación imposible', async () => {
		await expect(
			calcularYGuardar(PERFIL, 'bajar', -0.5, { creadoAt: 'ayer a la tarde' })
		).rejects.toThrow(RangeError);
		expect(await db.objetivosEnergia.count()).toBe(0);
	});

	it('rechaza una escritura que quedó en cola contra datos ya reemplazados', async () => {
		// `guardarObjetivo` captura la revisión de forma síncrona y la exige adentro de la
		// transacción. Invalidar entre las dos cosas reproduce el caso real: otra pestaña
		// restauró un backup mientras esta completaba el asistente.
		const promesa = calcularYGuardar(PERFIL, 'bajar', -0.5);
		invalidarEscriturasPendientes();
		await expect(promesa).rejects.toThrow(DatosReemplazadosError);
		expect(await db.objetivosEnergia.count()).toBe(0);
	});
});

describe('guardar una revisión', () => {
	it('encadena, usa el mantenimiento medido y el peso de hoy', async () => {
		const original = (await calcularYGuardar(PERFIL, 'bajar', -0.5, {
			creadoAt: '2026-03-01T10:00:00.000Z'
		}))!;
		expect(original.tdeeKcal).toBe(2890);

		// Un mes después pesa 1,4 kg menos y la balanza dice que su gasto era 2.700.
		const revisado = (await guardarRevision(original, 2700, 80_600, '2026-04-01T10:00:00.000Z'))!;

		expect(revisado.calibradoDe).toBe(original.id);
		expect(revisado.tdeeKcal).toBe(2700);
		expect(revisado.perfil.pesoGramos).toBe(80_600);
		// Mismo destino y mismo nivel: se revisa el número, no la decisión.
		expect(revisado.meta).toBe('bajar');
		expect(revisado.nivel).toBe('moderado');
		// Y el objetivo baja con el mantenimiento.
		expect(revisado.objetivoKcal).toBeLessThan(original.objetivoKcal);
		expect(await objetivoVigente()).toMatchObject({ id: revisado.id });
	});

	it('el resto del perfil viaja intacto', async () => {
		const original = (await calcularYGuardar({ ...PERFIL, ocupacion: 'fisico' }, 'subir', 0.25, {
			creadoAt: '2026-03-01T10:00:00.000Z'
		}))!;
		const revisado = (await guardarRevision(original, 3000, 83_000))!;
		expect(revisado.perfil.ocupacion).toBe('fisico');
		expect(revisado.meta).toBe('subir');
	});
});

describe('borrar objetivos', () => {
	it('borra la cadena entera: no revive el anterior', async () => {
		await calcularYGuardar(PERFIL, 'bajar', -0.5, { creadoAt: '2026-01-01T10:00:00.000Z' });
		await calcularYGuardar(PERFIL, 'subir', 0.25, { creadoAt: '2026-02-01T10:00:00.000Z' });
		await borrarObjetivos();
		expect(await db.objetivosEnergia.count()).toBe(0);
		expect(await objetivoVigente()).toBeNull();
	});
});

describe('prellenado del asistente', () => {
	it('devuelve el perfil del último objetivo', async () => {
		expect(await perfilGuardado()).toBeNull();
		await calcularYGuardar(PERFIL, 'bajar', -0.5, { creadoAt: '2026-01-01T10:00:00.000Z' });
		await calcularYGuardar({ ...PERFIL, ocupacion: 'fisico' }, 'mantener', 0, {
			creadoAt: '2026-02-01T10:00:00.000Z'
		});
		expect((await perfilGuardado())?.ocupacion).toBe('fisico');
	});

	it('promedia los pesos de la ventana y no la última medición', async () => {
		await db.pesosCorporales.bulkPut([
			{ fecha: '2026-03-10', pesoGramos: 82_000, registradoAt: '2026-03-10T08:00:00.000Z' },
			{ fecha: '2026-03-11', pesoGramos: 83_000, registradoAt: '2026-03-11T08:00:00.000Z' },
			{ fecha: '2026-03-12', pesoGramos: 81_000, registradoAt: '2026-03-12T08:00:00.000Z' }
		]);
		expect(await pesoRecienteGramos(7, '2026-03-12')).toBe(82_000);
	});

	it('ignora los pesos que quedaron fuera de la ventana', async () => {
		await db.pesosCorporales.bulkPut([
			{ fecha: '2026-01-01', pesoGramos: 95_000, registradoAt: '2026-01-01T08:00:00.000Z' },
			{ fecha: '2026-03-12', pesoGramos: 81_000, registradoAt: '2026-03-12T08:00:00.000Z' }
		]);
		expect(await pesoRecienteGramos(7, '2026-03-12')).toBe(81_000);
	});

	it('devuelve null sin mediciones', async () => {
		expect(await pesoRecienteGramos(7, '2026-03-12')).toBeNull();
	});

	it('estima la frecuencia semanal desde los días terminados', async () => {
		const sesion = (fecha: string, diaTerminado: boolean) => ({
			id: `${fecha}__push`,
			fecha,
			diaId: 'push',
			ejercicios: [],
			diaTerminado
		});
		await db.sesiones.bulkPut([
			sesion('2026-03-02', true),
			sesion('2026-03-04', true),
			sesion('2026-03-06', true),
			sesion('2026-03-09', true),
			// Empezada y no terminada: no cuenta como entrenamiento.
			sesion('2026-03-10', false)
		]);
		// 4 días terminados en una ventana de 28 -> 1 por semana.
		expect(await frecuenciaSemanalReciente(28, '2026-03-29')).toBe(1);
	});

	it('dos rutinas el mismo día son un solo día de entrenamiento', async () => {
		await db.sesiones.bulkPut([
			{
				id: '2026-03-02__push',
				fecha: '2026-03-02',
				diaId: 'push',
				ejercicios: [],
				diaTerminado: true
			},
			{
				id: '2026-03-02__pull',
				fecha: '2026-03-02',
				diaId: 'pull',
				ejercicios: [],
				diaTerminado: true
			}
		]);
		expect(await frecuenciaSemanalReciente(7, '2026-03-08')).toBe(1);
	});

	it('sin sesiones devuelve cero', async () => {
		expect(await frecuenciaSemanalReciente(28, '2026-03-29')).toBe(0);
	});
});
