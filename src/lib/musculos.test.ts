import { describe, expect, it } from 'vitest';
import type { Sesion } from './db';
import { catalogo } from './catalog';
import { MUSCULOS_COMPACTOS } from './data/exercise-muscles';
import { crearDistribucionMuscular, METADATA_MUSCULAR, type MetadataMuscular } from './musculos';

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

	it('sin filtro, consideradas y completadas coinciden', () => {
		const resultado = crearDistribucionMuscular(
			[sesion('2026-08-24')],
			'2026-08-24',
			1,
			false,
			metadata
		);
		expect(resultado.seriesConsideradas).toBe(resultado.seriesCompletadas);
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
