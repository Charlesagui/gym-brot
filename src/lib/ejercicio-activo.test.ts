import { describe, expect, it } from 'vitest';
import {
	etiquetaProximaSerie,
	metricaEfectivaEjercicio,
	metricaLabelEjercicio,
	modoEjercicioActivo,
	proximoEjercicioPendiente,
	unidadValorEjercicio
} from './ejercicio-activo';

describe('modoEjercicioActivo', () => {
	it('sin datos todavia asume peso para no rotular maquinas nuevas como reps', () => {
		expect(modoEjercicioActivo([], [{ hecha: false }])).toBe('peso');
		expect(modoEjercicioActivo([], [{ hecha: true }])).toBe('peso');
	});

	it('usa peso cuando el historial o la sesion actual tienen peso', () => {
		expect(modoEjercicioActivo([{ peso: 80 }], [{ hecha: false }])).toBe('peso');
		// Escribir lastre pendiente no debe relabelar por un instante el historial de reps como kg.
		expect(modoEjercicioActivo([], [{ peso: 40, reps: 10, hecha: false }])).toBe('reps');
		expect(modoEjercicioActivo([], [{ peso: 40, reps: 10, hecha: true }])).toBe('peso');
	});

	it('usa reps cuando la sesion activa ya muestra trabajo sin peso', () => {
		expect(modoEjercicioActivo([], [{ reps: 12, hecha: false }])).toBe('reps');
		expect(modoEjercicioActivo([], [{ reps: 12, hecha: true }])).toBe('reps');
	});
});

describe('etiquetaProximaSerie', () => {
	const press = (sets: { hecha: boolean }[], reciente: number) =>
		etiquetaProximaSerie(sets, reciente, 'Press pecho');

	it('apunta a la siguiente pendiente despues de la recien marcada', () => {
		expect(press([{ hecha: true }, { hecha: false }, { hecha: false }], 0)).toBe(
			'Press pecho · serie 2/3'
		);
	});

	it('saltea las que ya estan hechas', () => {
		expect(press([{ hecha: true }, { hecha: true }, { hecha: false }], 0)).toBe(
			'Press pecho · serie 3/3'
		);
	});

	it('si la recien marcada era la ultima, vuelve a la primera pendiente', () => {
		expect(press([{ hecha: false }, { hecha: true }, { hecha: true }], 2)).toBe(
			'Press pecho · serie 1/3'
		);
	});

	it('queda vacia cuando no falta ninguna', () => {
		expect(press([{ hecha: true }, { hecha: true }], 1)).toBe('');
		expect(press([], 0)).toBe('');
	});
});

describe('labels de ejercicio activo', () => {
	it('rotula metrica y unidad segun el modo efectivo', () => {
		expect(metricaEfectivaEjercicio('reps', 'e1rm')).toBe('reps');
		expect(metricaLabelEjercicio('peso', 'e1rm')).toBe('1RM estimado (1 Repetición Máxima)');
		expect(metricaLabelEjercicio('reps', 'peso')).toBe('reps máximas');
		expect(unidadValorEjercicio('reps', 'kg')).toBe('reps');
		expect(unidadValorEjercicio('peso', 'lb')).toBe('lb');
	});
});

describe('proximoEjercicioPendiente', () => {
	const nombres: Record<string, string> = {
		a: 'Prensa',
		b: 'Curl femoral',
		c: 'Gemelos'
	};
	const nombreDe = (id: string) => nombres[id];
	const dia = {
		ejercicios: [
			{ exerciseId: 'a', seriesObjetivo: 3, orden: 0 },
			{ exerciseId: 'b', seriesObjetivo: 3, orden: 1 },
			{ exerciseId: 'c', seriesObjetivo: 3, orden: 2 }
		]
	};
	const hecho = (exerciseId: string) => ({
		exerciseId,
		sets: [{ reps: 10, hecha: true }],
		saltado: false
	});
	const pendiente = (exerciseId: string) => ({
		exerciseId,
		sets: [{ reps: 10, hecha: false }],
		saltado: false
	});

	it('propone el siguiente de la rutina, no el primero de la lista', () => {
		expect(proximoEjercicioPendiente(dia, { ejercicios: [hecho('a')] }, 'a', nombreDe)).toEqual({
			exerciseId: 'b',
			nombre: 'Curl femoral'
		});
	});

	it('da la vuelta cuando terminaste el último y quedó algo arriba', () => {
		// 'a' ya está hecho: el que quedó colgado arriba es 'b', y es el que toca.
		const sesion = { ejercicios: [hecho('a'), pendiente('b'), hecho('c')] };
		expect(proximoEjercicioPendiente(dia, sesion, 'c', nombreDe)).toEqual({
			exerciseId: 'b',
			nombre: 'Curl femoral'
		});
	});

	it('saltea lo ya hecho, lo saltado y lo parcial: nada resuelto vuelve a proponerse', () => {
		const sesion = {
			ejercicios: [
				hecho('b'),
				{ exerciseId: 'c', sets: [{ reps: 10, hecha: true }, { hecha: false }], saltado: true }
			]
		};
		expect(proximoEjercicioPendiente(dia, sesion, 'a', nombreDe)).toBeNull();
	});

	it('devuelve null cuando no queda nada por hacer', () => {
		const sesion = { ejercicios: [hecho('a'), hecho('b'), hecho('c')] };
		expect(proximoEjercicioPendiente(dia, sesion, 'a', nombreDe)).toBeNull();
	});

	it('nunca se propone a sí mismo, ni siquiera si sigue pendiente', () => {
		const sesion = { ejercicios: [pendiente('a'), hecho('b'), hecho('c')] };
		expect(proximoEjercicioPendiente(dia, sesion, 'a', nombreDe)).toBeNull();
	});

	it('sin sesión todavía, el siguiente es simplemente el que sigue en la rutina', () => {
		expect(proximoEjercicioPendiente(dia, undefined, 'a', nombreDe)).toEqual({
			exerciseId: 'b',
			nombre: 'Curl femoral'
		});
	});

	it('si te quitaron el ejercicio de la rutina, recorre desde el principio', () => {
		const sesion = { ejercicios: [hecho('a')] };
		expect(proximoEjercicioPendiente(dia, sesion, 'borrado', nombreDe)).toEqual({
			exerciseId: 'b',
			nombre: 'Curl femoral'
		});
	});

	it('un ejercicio archivado cae al nombre congelado en la sesión', () => {
		const sesion = {
			ejercicios: [hecho('a'), { exerciseId: 'b', nombreSnapshot: 'Femoral viejo', sets: [] }]
		};
		expect(proximoEjercicioPendiente(dia, sesion, 'a', () => undefined)).toEqual({
			exerciseId: 'b',
			nombre: 'Femoral viejo'
		});
	});

	it('sin día no hay nada que proponer', () => {
		expect(proximoEjercicioPendiente(undefined, undefined, 'a', nombreDe)).toBeNull();
	});
});
