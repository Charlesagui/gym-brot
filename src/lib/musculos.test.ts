import { describe, expect, it } from 'vitest';
import type { Sesion } from './db';
import { catalogo } from './catalog';
import { MUSCULOS_COMPACTOS } from './data/exercise-muscles';
import { COLORES_INTENSIDAD } from './escala-intensidad';
import {
	colorCarga,
	CORTES_CARGA,
	crearDistribucionMuscular,
	ETIQUETAS_CARGA,
	intensidadMuscular,
	METADATA_MUSCULAR,
	nivelCarga,
	porSemana,
	ROTULOS_CARGA,
	SERIES_SEMANA_LLENO,
	type MetadataMuscular
} from './musculos';

const metadata: Record<string, MetadataMuscular> = {
	press: { principal: 'chest', secundarios: ['triceps', 'deltoids'], aliasesNoRepresentados: [] },
	remo: { principal: 'upper-back', secundarios: ['biceps'], aliasesNoRepresentados: [] },
	cardio: { principal: null, secundarios: [], aliasesNoRepresentados: ['cardiovascular-system'] }
};

function sesion(fecha: string): Sesion {
	return {
		id: `${fecha}__a`,
		fecha,
		diaId: 'a',
		ejercicios: [
			{
				exerciseId: 'press',
				sets: [
					{ reps: 10, hecha: true, rir: 1.5 },
					{ reps: 8, hecha: true, rir: 3 },
					{ reps: 12, hecha: false, rir: 1 }
				]
			},
			{ exerciseId: 'remo', sets: [{ reps: 10, hecha: true }] },
			{ exerciseId: 'cardio', sets: [{ reps: 1, hecha: true }] }
		]
	};
}

describe('distribución muscular estimada', () => {
	it('cuenta sólo series completadas y pondera secundarios a 0,4', () => {
		const resultado = crearDistribucionMuscular(
			[sesion('2026-08-24')],
			'2026-08-24',
			1,
			false,
			metadata
		);
		expect(resultado.seriesCompletadas).toBe(4);
		expect(resultado.seriesSinRepresentacion).toBe(1);
		expect(resultado.cargas).toEqual([
			expect.objectContaining({ musculo: 'chest', seriesEstimadas: 2, seriesPrimarias: 2 }),
			expect.objectContaining({ musculo: 'upper-back', seriesEstimadas: 1 }),
			expect.objectContaining({ musculo: 'deltoids', seriesEstimadas: 0.8 }),
			expect.objectContaining({ musculo: 'triceps', seriesEstimadas: 0.8 }),
			expect.objectContaining({ musculo: 'biceps', seriesEstimadas: 0.4 })
		]);
	});

	it('respeta el período e ignora sesiones futuras', () => {
		const resultado = crearDistribucionMuscular(
			[sesion('2026-08-17'), sesion('2026-08-18'), sesion('2026-08-25')],
			'2026-08-24',
			1,
			false,
			metadata
		);
		expect(resultado.desde).toBe('2026-08-18');
		expect(resultado.seriesCompletadas).toBe(4);
	});

	it('el filtro de series duras exige RIR y no confunde pendientes con trabajo', () => {
		const resultado = crearDistribucionMuscular(
			[sesion('2026-08-24')],
			'2026-08-24',
			1,
			true,
			metadata
		);
		expect(resultado.cargas).toEqual([
			expect.objectContaining({ musculo: 'chest', seriesEstimadas: 1 }),
			expect.objectContaining({ musculo: 'deltoids', seriesEstimadas: 0.4 }),
			expect.objectContaining({ musculo: 'triceps', seriesEstimadas: 0.4 })
		]);
		expect(resultado.seriesConRir).toBe(2);
		expect(resultado.puedeFiltrarDuras).toBe(false);
		// La cabecera muestra este número: con el filtro puesto tiene que contar lo que el
		// mapa realmente representa, no todas las series completas del período.
		expect(resultado.seriesConsideradas).toBe(1);
		expect(resultado.seriesCompletadas).toBe(4);
	});

	it('sin filtro, lo considerado más lo no representado da el total completado', () => {
		const resultado = crearDistribucionMuscular(
			[sesion('2026-08-24')],
			'2026-08-24',
			1,
			false,
			metadata
		);
		// `seriesConsideradas` es lo que el dibujo sostiene, no todo lo que se entrenó:
		// 'cardio' no tiene músculos asignados y por eso no puede pintar nada. Que ambos
		// números coincidieran sólo era cierto con el catálogo entero mapeado, y dejaba
		// al encabezado contando series que el mapa no mostraba.
		expect(resultado.seriesCompletadas).toBe(4);
		expect(resultado.seriesSinRepresentacion).toBe(1);
		expect(resultado.seriesConsideradas).toBe(3);
		expect(resultado.seriesConsideradas + resultado.seriesSinRepresentacion).toBe(
			resultado.seriesCompletadas
		);
	});

	it('editar o borrar una serie cambia el resultado derivado de los datos crudos', () => {
		const original = sesion('2026-08-24');
		const antes = crearDistribucionMuscular([original], '2026-08-24', 1, false, metadata);
		original.ejercicios[0]!.sets[1]!.hecha = false;
		const despues = crearDistribucionMuscular([original], '2026-08-24', 1, false, metadata);
		expect(antes.cargas.find((item) => item.musculo === 'chest')?.seriesEstimadas).toBe(2);
		expect(despues.cargas.find((item) => item.musculo === 'chest')?.seriesEstimadas).toBe(1);
	});
});

describe('metadata muscular generada', () => {
	// `METADATA_MUSCULAR` empareja el sidecar con el catálogo por posición. Si alguien edita
	// `exercises.json` sin regenerar, todas las asignaciones se corren de lugar y el mapa
	// muestra datos plausibles y falsos, sin fallar en ningún lado. Esta es la única guarda.
	it('está alineada con el catálogo, ejercicio por ejercicio', () => {
		expect(MUSCULOS_COMPACTOS).toHaveLength(catalogo.length);
		expect(Object.keys(METADATA_MUSCULAR)).toHaveLength(catalogo.length);
	});

	it('no deja ningún ejercicio sin músculo asignado', () => {
		const huerfanos = catalogo.filter((ejercicio) => {
			const meta = METADATA_MUSCULAR[ejercicio.id];
			return !meta || (!meta.principal && meta.secundarios.length === 0);
		});
		expect(huerfanos.map((ejercicio) => ejercicio.id)).toEqual([]);
	});

	it('sólo usa códigos de músculo representables en el mapa', () => {
		const desconocidos = Object.entries(METADATA_MUSCULAR).filter(([, meta]) =>
			meta.secundarios.some((musculo) => musculo == null)
		);
		expect(desconocidos.map(([id]) => id)).toEqual([]);
	});
});

describe('escala absoluta del mapa', () => {
	it('la unidad es series por semana, con un decimal', () => {
		expect(porSemana(14.4, 1)).toBe(14.4);
		expect(porSemana(57.6, 4)).toBe(14.4);
		expect(porSemana(172.8, 12)).toBe(14.4);
		// Un decimal y no más: la cifra que se muestra y la que pinta son la misma.
		expect(porSemana(11, 12)).toBe(0.9);
	});

	it('no divide por cero', () => {
		expect(porSemana(10, 0)).toBe(0);
	});

	it('la intensidad no depende del período, sólo del ritmo semanal', () => {
		const semanal = 10;
		expect(intensidadMuscular(semanal, 1)).toBe(0.5);
		expect(intensidadMuscular(semanal * 4, 4)).toBe(0.5);
		expect(intensidadMuscular(semanal * 12, 12)).toBe(0.5);
	});

	it('cero pinta cero y el tope satura sin pasarse', () => {
		expect(intensidadMuscular(0, 4)).toBe(0);
		expect(intensidadMuscular(SERIES_SEMANA_LLENO, 1)).toBe(1);
		expect(intensidadMuscular(SERIES_SEMANA_LLENO * 5, 1)).toBe(1);
	});

	/**
	 * La prueba que define el cambio. Antes la intensidad era `series / máximo del
	 * período`: entrenar OTRO músculo movía el denominador y apagaba éste sin quitarle
	 * una sola serie. Con escala fija, lo que no se tocó no cambia.
	 */
	it('entrenar otro músculo no apaga al que no se tocó', () => {
		const piernas: Sesion = {
			id: '2026-08-24__p',
			fecha: '2026-08-24',
			diaId: 'p',
			ejercicios: [
				{
					exerciseId: 'sentadilla',
					sets: Array.from({ length: 8 }, () => ({ reps: 10, hecha: true }))
				}
			]
		};
		const empuje: Sesion = {
			id: '2026-08-25__e',
			fecha: '2026-08-25',
			diaId: 'e',
			ejercicios: [
				{ exerciseId: 'press', sets: Array.from({ length: 12 }, () => ({ reps: 10, hecha: true })) }
			]
		};
		const meta: Record<string, MetadataMuscular> = {
			sentadilla: { principal: 'quadriceps', secundarios: [], aliasesNoRepresentados: [] },
			press: { principal: 'chest', secundarios: ['triceps'], aliasesNoRepresentados: [] }
		};
		const solo = crearDistribucionMuscular([piernas], '2026-08-25', 1, false, meta);
		const despues = crearDistribucionMuscular([piernas, empuje], '2026-08-25', 1, false, meta);
		const cuadSolo = solo.cargas.find((c) => c.musculo === 'quadriceps')!;
		const cuadDespues = despues.cargas.find((c) => c.musculo === 'quadriceps')!;
		expect(cuadSolo.seriesEstimadas).toBe(8);
		expect(cuadDespues.seriesEstimadas).toBe(8);
		expect(intensidadMuscular(cuadDespues.seriesEstimadas, 1)).toBe(
			intensidadMuscular(cuadSolo.seriesEstimadas, 1)
		);
		// Y el pecho, que sí se entrenó, pinta más que el cuádriceps.
		const pecho = despues.cargas.find((c) => c.musculo === 'chest')!;
		expect(intensidadMuscular(pecho.seriesEstimadas, 1)).toBeGreaterThan(
			intensidadMuscular(cuadDespues.seriesEstimadas, 1)
		);
	});

	it('el dibujo se llena a medida que se entrena, en vez de normalizarse', () => {
		const dia = (fecha: string): Sesion => ({
			id: `${fecha}__p`,
			fecha,
			diaId: 'p',
			ejercicios: [
				{
					exerciseId: 'sentadilla',
					sets: Array.from({ length: 5 }, () => ({ reps: 10, hecha: true }))
				}
			]
		});
		const meta: Record<string, MetadataMuscular> = {
			sentadilla: { principal: 'quadriceps', secundarios: [], aliasesNoRepresentados: [] }
		};
		const intensidades = ['2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25'].map(
			(_, i, fechas) => {
				const hasta = '2026-08-25';
				const d = crearDistribucionMuscular(fechas.slice(0, i + 1).map(dia), hasta, 1, false, meta);
				return intensidadMuscular(d.cargas[0]!.seriesEstimadas, 1);
			}
		);
		expect(intensidades).toEqual([0.25, 0.5, 0.75, 1]);
	});
});

describe('escalones de color del mapa', () => {
	it('los cortes caen donde dice la leyenda', () => {
		expect(CORTES_CARGA).toEqual([5, 10, 15]);
		expect(nivelCarga(0, 1)).toBe(0);
		expect(nivelCarga(0.4, 1)).toBe(1);
		expect(nivelCarga(4.9, 1)).toBe(1);
		expect(nivelCarga(5, 1)).toBe(2);
		expect(nivelCarga(9.9, 1)).toBe(2);
		expect(nivelCarga(10, 1)).toBe(3);
		expect(nivelCarga(15, 1)).toBe(4);
		expect(nivelCarga(SERIES_SEMANA_LLENO * 3, 1)).toBe(4);
	});

	it('el escalón no depende del período, sólo del ritmo semanal', () => {
		expect(nivelCarga(12, 1)).toBe(nivelCarga(48, 4));
		expect(nivelCarga(12, 1)).toBe(nivelCarga(144, 12));
	});

	it('la leyenda deriva de los mismos cortes, sin huecos ni sobrantes', () => {
		expect(ETIQUETAS_CARGA).toHaveLength(COLORES_INTENSIDAD.length);
		expect(ROTULOS_CARGA).toHaveLength(COLORES_INTENSIDAD.length);
		expect(ETIQUETAS_CARGA).toEqual([
			'sin series',
			'menos de 5',
			'5 o más',
			'10 o más',
			'15 o más'
		]);
		expect(ROTULOS_CARGA).toEqual(['0', '<5', '5', '10', '15+']);
	});

	it('el color que pinta es el del escalón en el que cayó la cifra que se muestra', () => {
		// 47 series en 4 semanas son 11,8 por semana: lo que dice la lista y lo que pinta el
		// dibujo tienen que salir del mismo redondeo.
		expect(porSemana(47, 4)).toBe(11.8);
		expect(colorCarga(47, 4)).toBe(COLORES_INTENSIDAD[3]);
	});
});
