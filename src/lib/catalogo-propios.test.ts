import { describe, expect, it } from 'vitest';
import { ejerciciosPropios } from './catalogo-propios';

const dia = (...ids: string[]) => ({
	ejercicios: ids.map((exerciseId, orden) => ({ exerciseId, seriesObjetivo: 3, orden }))
});
const sesion = (...ids: string[]) => ({
	ejercicios: ids.map((exerciseId) => ({ exerciseId, sets: [] }))
});

describe('ejerciciosPropios', () => {
	it('junta lo de las rutinas con lo entrenado, sin repetir', () => {
		const ids = ejerciciosPropios([dia('press', 'prensa')], [sesion('press', 'curl')]);
		expect([...ids].sort()).toEqual(['curl', 'prensa', 'press']);
	});

	it('incluye lo entrenado suelto aunque ya no esté en ninguna rutina', () => {
		// Sacar un ejercicio del día no debería esconderlo cuando querés volver a agregarlo.
		const ids = ejerciciosPropios([dia('press')], [sesion('remo-archivado')]);
		expect(ids.has('remo-archivado')).toBe(true);
	});

	it('sin rutinas ni historial devuelve un conjunto vacío, no todo el catálogo', () => {
		expect(ejerciciosPropios([], []).size).toBe(0);
	});

	it('una rutina vacía no aporta nada', () => {
		expect(ejerciciosPropios([dia()], []).size).toBe(0);
	});
});
