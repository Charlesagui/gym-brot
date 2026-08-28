import { describe, expect, it } from 'vitest';
import {
	mejorSet,
	estadoEjercicioSesion,
	modoEjercicio,
	pesoEfectivo,
	serieCompleta,
	resolverMetricaPr,
	sesionRecienteAOfrecer,
	sesionRecienteDeOtraFecha,
	valorMetrica,
	valorSet,
	VENTANA_SESION_RECIENTE_MS,
	type MejorSet
} from './sesion-reglas';
import type { Sesion } from './db';

describe('serieCompleta', () => {
	it('exige confirmación y repeticiones, pero permite ejercicios sin peso', () => {
		expect(serieCompleta({ hecha: true, reps: 10 })).toBe(true);
		expect(serieCompleta({ hecha: true, peso: 80, reps: 8 })).toBe(true);
		expect(serieCompleta({ hecha: true, peso: 80 })).toBe(false);
		expect(serieCompleta({ hecha: true, peso: 80, reps: 0 })).toBe(false);
		expect(serieCompleta({ hecha: true, peso: 80, reps: 2.5 })).toBe(false);
		expect(serieCompleta({ hecha: false, reps: 10 })).toBe(false);
	});
});

describe('resolverMetricaPr', () => {
	const ajustes = {
		metricaPr: 'peso' as const,
		metricasPrEjercicio: { press: 'e1rm' as const }
	};

	it('prioriza override, vuelve al global y fuerza reps sin carga', () => {
		expect(resolverMetricaPr(ajustes, 'press', 'peso')).toBe('e1rm');
		expect(resolverMetricaPr(ajustes, 'remo', 'peso')).toBe('peso');
		expect(resolverMetricaPr(ajustes, 'press', 'reps')).toBe('reps');
	});
});

describe('estadoEjercicioSesion', () => {
	it('distingue pendiente, saltado, parcial y completado sin inventar series', () => {
		const pendiente = { peso: 80, reps: 8, hecha: false };
		const hecha = { peso: 80, reps: 8, hecha: true };
		expect(estadoEjercicioSesion([pendiente], false)).toBe('pendiente');
		expect(estadoEjercicioSesion([pendiente], true)).toBe('saltado');
		expect(estadoEjercicioSesion([hecha, pendiente, pendiente, pendiente], true)).toBe('parcial');
		expect(estadoEjercicioSesion([hecha], true)).toBe('completado');
	});
});

describe('pesoEfectivo', () => {
	it('devuelve null si el peso no esta cargado', () => {
		expect(pesoEfectivo({})).toBeNull();
		expect(pesoEfectivo({ peso: undefined, esMax: true, extraKg: 10 })).toBeNull();
	});

	it('suma extraKg solo cuando el set es MAX', () => {
		expect(pesoEfectivo({ peso: 80, esMax: true })).toBe(80);
		expect(pesoEfectivo({ peso: 80, esMax: true, extraKg: 5 })).toBe(85);
		expect(pesoEfectivo({ peso: 80, esMax: false, extraKg: 5 })).toBe(80);
	});

	it('normaliza la suma a la misma precisión que ve el usuario', () => {
		expect(pesoEfectivo({ peso: 20.1, esMax: true, extraKg: 0.1 })).toBe(20.2);
		expect(valorSet({ peso: 20.1, reps: 8, esMax: true, extraKg: 0.1 }, 'peso')).toBe(20.2);
	});
});

describe('valorMetrica', () => {
	it('usa el peso directo para la metrica peso', () => {
		expect(valorMetrica(100, 12, 'peso')).toBe(100);
	});

	it('calcula Epley sólo con reps válidas y redondea al valor visible', () => {
		expect(valorMetrica(100, undefined, 'e1rm')).toBeNull();
		expect(valorMetrica(100, 0, 'e1rm')).toBeNull();
		expect(valorMetrica(100, 12, 'e1rm')).toBe(140);
		expect(valorMetrica(70, 10, 'e1rm')).toBe(93.3);
		expect(valorMetrica(80, 5, 'e1rm')).toBe(93.3);
	});

	it('Epley con tope: por encima de 12 reps puntua igual que 12', () => {
		expect(valorMetrica(100, 20, 'e1rm')).toBe(valorMetrica(100, 12, 'e1rm'));
		expect(valorMetrica(100, 20, 'e1rm')).toBe(140);
	});
});

describe('valorSet', () => {
	it('en modo peso usa el peso efectivo y la metrica; sin peso no puntua', () => {
		expect(valorSet({ peso: 80, reps: 10 }, 'peso')).toBe(80);
		expect(valorSet({ peso: 80, reps: 10, esMax: true, extraKg: 5 }, 'peso')).toBe(85);
		expect(valorSet({ reps: 10 }, 'peso')).toBeNull();
		expect(valorSet({ peso: 120, reps: 0 }, 'peso')).toBeNull();
	});

	it('en modo reps el valor son las reps, sin importar la metrica de ajustes', () => {
		expect(valorSet({ reps: 14 }, 'peso', 'reps')).toBe(14);
		expect(valorSet({ reps: 14 }, 'e1rm', 'reps')).toBe(14);
		expect(valorSet({}, 'peso', 'reps')).toBeNull();
		expect(valorSet({ peso: 5, reps: 8 }, 'peso', 'reps')).toBeNull();
		expect(valorSet({ reps: 0 }, 'peso', 'reps')).toBeNull();
	});
});

describe('modoEjercicio', () => {
	function sesionCon(sets: { peso?: number; reps?: number; hecha: boolean }[]): Sesion {
		return {
			id: '2026-01-01__push',
			fecha: '2026-01-01',
			diaId: 'push',
			ejercicios: [{ exerciseId: 'dominadas', sets }]
		};
	}

	it('es reps solo si hay series hechas y ninguna registro peso', () => {
		expect(modoEjercicio([sesionCon([{ reps: 10, hecha: true }])], 'dominadas')).toBe('reps');
		expect(
			modoEjercicio(
				[
					sesionCon([
						{ reps: 10, hecha: true },
						{ peso: 5, reps: 8, hecha: true }
					])
				],
				'dominadas'
			)
		).toBe('peso');
		// Sin series hechas (o sin historial) el default es peso.
		expect(modoEjercicio([sesionCon([{ reps: 10, hecha: false }])], 'dominadas')).toBe('peso');
		expect(modoEjercicio([], 'dominadas')).toBe('peso');
	});
});

describe('mejorSet', () => {
	const base: MejorSet = {
		peso: 100,
		reps: 6,
		esMax: false,
		fecha: '2026-01-01',
		valor: 100
	};

	it('elige el mayor valor', () => {
		expect(mejorSet(base, { ...base, peso: 105, valor: 105 })).toMatchObject({ peso: 105 });
	});

	it('desempata por reps', () => {
		expect(mejorSet(base, { ...base, peso: 100, reps: 8, valor: 100 })).toMatchObject({
			reps: 8
		});
	});

	it('conserva el anterior si no mejora', () => {
		expect(mejorSet(base, { ...base, peso: 95, reps: 20, valor: 95 })).toBe(base);
	});
});

describe('sesionRecienteDeOtraFecha', () => {
	const AHORA = Date.parse('2026-08-28T00:05:00Z');
	const base = (extra: Partial<Sesion> = {}): Sesion => ({
		id: '2026-08-27__push',
		fecha: '2026-08-27',
		diaId: 'push',
		tocadaAt: '2026-08-27T23:50:00Z',
		ejercicios: [{ exerciseId: 'press', sets: [{ hecha: true, reps: 10, peso: 80 }] }],
		...extra
	});

	it('reconoce el trabajo que se estaba escribiendo del otro lado de la medianoche', () => {
		expect(sesionRecienteDeOtraFecha(base(), '2026-08-28', AHORA)).toBe(true);
	});

	it('no ofrece la sesión de hoy: no hay nada que explicar', () => {
		expect(sesionRecienteDeOtraFecha(base(), '2026-08-27', AHORA)).toBe(false);
	});

	it('no ofrece una sesión sin series marcadas', () => {
		const soloCargada = base({
			ejercicios: [{ exerciseId: 'press', sets: [{ hecha: false, reps: 10, peso: 80 }] }]
		});
		expect(sesionRecienteDeOtraFecha(soloCargada, '2026-08-28', AHORA)).toBe(false);
	});

	it('no molesta con el día abierto de la semana pasada', () => {
		const vieja = base({ tocadaAt: '2026-08-21T20:00:00Z' });
		expect(sesionRecienteDeOtraFecha(vieja, '2026-08-28', AHORA)).toBe(false);
		// Justo en el borde de la ventana entra; un milisegundo más, no.
		const borde = base({ tocadaAt: new Date(AHORA - VENTANA_SESION_RECIENTE_MS).toISOString() });
		expect(sesionRecienteDeOtraFecha(borde, '2026-08-28', AHORA)).toBe(true);
		const pasada = base({
			tocadaAt: new Date(AHORA - VENTANA_SESION_RECIENTE_MS - 1).toISOString()
		});
		expect(sesionRecienteDeOtraFecha(pasada, '2026-08-28', AHORA)).toBe(false);
	});

	it('ignora sesiones sin sello y sellos imposibles', () => {
		expect(sesionRecienteDeOtraFecha(base({ tocadaAt: undefined }), '2026-08-28', AHORA)).toBe(
			false
		);
		expect(sesionRecienteDeOtraFecha(base({ tocadaAt: 'ayer' }), '2026-08-28', AHORA)).toBe(false);
		// Reloj movido a mano hacia adelante: no habilita nada.
		expect(
			sesionRecienteDeOtraFecha(base({ tocadaAt: '2026-09-01T10:00:00Z' }), '2026-08-28', AHORA)
		).toBe(false);
	});

	it('un día cerrado pasada la medianoche también se ofrece', () => {
		expect(sesionRecienteDeOtraFecha(base({ diaTerminado: true }), '2026-08-28', AHORA)).toBe(true);
	});
});

describe('sesionRecienteAOfrecer', () => {
	const AHORA = Date.parse('2026-08-28T00:05:00Z');
	const sesion = (fecha: string, exerciseId: string): Sesion => ({
		id: `${fecha}__push`,
		fecha,
		diaId: 'push',
		tocadaAt: `${fecha}T23:50:00Z`,
		ejercicios: [{ exerciseId, sets: [{ hecha: true, reps: 10, peso: 80 }] }]
	});

	it('se queda con la más reciente y cuenta las series marcadas', () => {
		const elegida = sesionRecienteAOfrecer(
			[sesion('2026-08-26', 'press'), sesion('2026-08-27', 'press')],
			'press',
			'2026-08-28',
			AHORA
		);
		expect(elegida).toEqual({ fecha: '2026-08-27', seriesHechas: 1, tieneEjercicio: true });
	});

	it('avisa cuando el ejercicio abierto no estuvo en esa sesión', () => {
		const elegida = sesionRecienteAOfrecer(
			[sesion('2026-08-27', 'press')],
			'sentadilla',
			'2026-08-28',
			AHORA
		);
		expect(elegida?.tieneEjercicio).toBe(false);
	});

	it('sin candidatas devuelve null', () => {
		expect(sesionRecienteAOfrecer([], 'press', '2026-08-28', AHORA)).toBeNull();
	});
});
