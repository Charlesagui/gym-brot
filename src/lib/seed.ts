import { db, type Dia } from './db';
import { normalizarAjustes } from './extras';

/** Días de ejemplo precargados al primer arranque (editables en Fase 2). */
const ejemplos: Dia[] = [
	{
		id: 'dia-piernas',
		nombre: 'Piernas',
		color: '255 111 174',
		diasSemana: [1],
		orden: 0,
		ejercicios: [
			{ exerciseId: 'prensa-pierna-45', seriesObjetivo: 4, orden: 0 },
			{ exerciseId: 'extension-cuadriceps', seriesObjetivo: 4, orden: 1 },
			{ exerciseId: 'curl-femoral', seriesObjetivo: 4, orden: 2 },
			{ exerciseId: 'abductores', seriesObjetivo: 3, orden: 3 },
			{ exerciseId: 'aductores', seriesObjetivo: 3, orden: 4 },
			{ exerciseId: 'gemelos-sentado', seriesObjetivo: 4, orden: 5 }
		]
	},
	{
		id: 'dia-pecho-triceps-hombro',
		nombre: 'Pecho · Tríceps · Hombro',
		color: '255 122 92',
		diasSemana: [3],
		orden: 1,
		ejercicios: [
			{ exerciseId: 'press-pecho', seriesObjetivo: 4, orden: 0 },
			{ exerciseId: 'press-inclinado', seriesObjetivo: 4, orden: 1 },
			{ exerciseId: 'aperturas-pec', seriesObjetivo: 3, orden: 2 },
			{ exerciseId: 'press-hombro', seriesObjetivo: 4, orden: 3 },
			{ exerciseId: 'elevaciones-laterales', seriesObjetivo: 3, orden: 4 },
			{ exerciseId: 'triceps-soga', seriesObjetivo: 4, orden: 5 },
			{ exerciseId: 'triceps-sobre-cabeza', seriesObjetivo: 3, orden: 6 }
		]
	},
	{
		id: 'dia-espalda-biceps',
		nombre: 'Espalda · Bíceps',
		color: '52 211 153',
		diasSemana: [5],
		orden: 2,
		ejercicios: [
			{ exerciseId: 'jalon-pecho', seriesObjetivo: 4, orden: 0 },
			{ exerciseId: 'remo-sentado', seriesObjetivo: 4, orden: 1 },
			{ exerciseId: 'remo-alto-v', seriesObjetivo: 3, orden: 2 },
			{ exerciseId: 'jalon-brazos-rectos', seriesObjetivo: 3, orden: 3 },
			{ exerciseId: 'curl-biceps', seriesObjetivo: 4, orden: 4 },
			{ exerciseId: 'curl-martillo', seriesObjetivo: 3, orden: 5 },
			{ exerciseId: 'curl-concentrado', seriesObjetivo: 3, orden: 6 }
		]
	}
];

/** Crea los días de ejemplo solo una vez, en el primer arranque real de la app. */
export async function seedSiVacio(): Promise<void> {
	await db.transaction('rw', db.dias, db.ajustes, async () => {
		const ajustes = normalizarAjustes(await db.ajustes.get('app'));
		if (ajustes.seedInicialHecho) return;

		const n = await db.dias.count();
		if (n === 0) await db.dias.bulkAdd(ejemplos);
		await db.ajustes.put({ ...ajustes, seedInicialHecho: true });
	});
}
