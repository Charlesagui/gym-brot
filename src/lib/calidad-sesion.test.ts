import { describe, expect, it } from 'vitest';
import type { Sesion } from './db';
import {
	calidadDeSesiones,
	calidadDesde,
	estadoSesion,
	mismoPlan,
	planDeDia,
	sumarTotales,
	totalesSesion,
	UMBRAL_DIA_COMPLETO
} from './sesion-reglas';

/**
 * Rutina de referencia: 3 ejercicios x 4 series = 12 planeadas.
 * `porEjercicio` dice cuántas series reales entraron en cada uno.
 */
function sesion(porEjercicio: number[], extra: Partial<Sesion> = {}): Sesion {
	return {
		id: '2026-01-06__piernas',
		fecha: '2026-01-06',
		diaId: 'piernas',
		plan: { ejercicios: 3, series: 12 },
		ejercicios: ['sentadilla', 'prensa', 'curl'].map((exerciseId, i) => ({
			exerciseId,
			sets: Array.from({ length: 4 }, (_, s) => ({
				peso: 100,
				reps: 5,
				hecha: s < (porEjercicio[i] ?? 0)
			}))
		})),
		...extra
	};
}

describe('calidad de una sesión', () => {
	it('sin una sola serie hecha el día es nulo, aunque esté cerrado a mano', () => {
		expect(estadoSesion(sesion([0, 0, 0])).calidad).toBe('nula');
		expect(estadoSesion(sesion([0, 0, 0], { diaTerminado: true })).calidad).toBe('nula');
	});

	it('una serie de doce es un día PARCIAL, no un día entrenado', () => {
		// El bug que originó todo esto: en el historial valía lo mismo que entrenar entero.
		const estado = estadoSesion(sesion([1, 0, 0]));
		expect(estado.calidad).toBe('parcial');
		expect(estado.seriesHechas).toBe(1);
		expect(estado.seriesPlan).toBe(12);
	});

	it('cerrar a mano NO convierte una serie con el resto saltado en día completo', () => {
		// La otra mitad del bug: por acá se inflaba el objetivo calórico.
		const s = sesion([1, 0, 0], { diaTerminado: true, diaTerminadoConPendientes: true });
		s.ejercicios[1]!.saltado = true;
		s.ejercicios[2]!.saltado = true;
		expect(estadoSesion(s).calidad).toBe('parcial');
	});

	it('entrenar completo sin tocar ningún botón es un día completo', () => {
		expect(estadoSesion(sesion([4, 4, 4])).calidad).toBe('completa');
	});

	it('dos de tres ejercicios enteros alcanzan el umbral sin cerrar el día', () => {
		// 8 de 12 = 67 % >= 60 %.
		expect(estadoSesion(sesion([4, 4, 0])).calidad).toBe('completa');
	});

	it('dos series por ejercicio en TODOS cuenta si además cerraste el día', () => {
		// 6 de 12 series (50 %) no alcanza por series, pero 3 de 3 ejercicios sí, y el
		// usuario dijo explícitamente que había terminado.
		expect(estadoSesion(sesion([2, 2, 2])).calidad).toBe('parcial');
		expect(estadoSesion(sesion([2, 2, 2], { diaTerminado: true })).calidad).toBe('completa');
	});

	it('una serie en cada ejercicio sin cerrar sigue siendo parcial', () => {
		// 3 de 12 series: el cierre a mano es lo único que puede subirlo, y no está.
		expect(estadoSesion(sesion([1, 1, 1])).calidad).toBe('parcial');
	});

	it('las series de más no rompen nada: siguen contando como día completo', () => {
		const s = sesion([4, 4, 4]);
		s.ejercicios[0]!.sets.push({ peso: 100, reps: 5, hecha: true });
		expect(estadoSesion(s).calidad).toBe('completa');
		expect(estadoSesion(s).seriesHechas).toBe(13);
	});

	it('una sesión sin plan no se juzga: conserva el trato que ya tenía', () => {
		// Sesiones anteriores al congelado del plan. Inventarles un denominador con la
		// rutina de hoy es exactamente el error que `Sesion.plan` existe para evitar.
		const vieja = sesion([1, 0, 0]);
		delete vieja.plan;
		const estado = estadoSesion(vieja);
		expect(estado.calidad).toBe('completa');
		expect(estado.seriesPlan).toBeNull();
	});

	it('un plan vacío no divide por cero', () => {
		expect(estadoSesion(sesion([1, 0, 0], { plan: { ejercicios: 0, series: 0 } })).calidad).toBe(
			'completa'
		);
	});

	it('el umbral es exactamente inclusivo', () => {
		const justo = Math.ceil(12 * UMBRAL_DIA_COMPLETO); // 8
		expect(
			calidadDesde({
				seriesHechas: justo,
				seriesPlan: 12,
				ejerciciosTrabajados: 2,
				ejerciciosPlan: 3,
				cerradaAMano: false
			})
		).toBe('completa');
		expect(
			calidadDesde({
				seriesHechas: justo - 1,
				seriesPlan: 12,
				ejerciciosTrabajados: 2,
				ejerciciosPlan: 3,
				cerradaAMano: false
			})
		).toBe('parcial');
	});
});

describe('una fecha con dos rutinas', () => {
	it('empezar una segunda rutina NUNCA baja el día que ya estaba completo', () => {
		// Con el veredicto sumado esto daba 13 de 24 (54 %) y perdía el día ganado.
		const entera = sesion([4, 4, 4]);
		const apenasEmpezada = { ...sesion([1, 0, 0]), id: '2026-01-06__brazos', diaId: 'brazos' };
		expect(calidadDeSesiones([entera, apenasEmpezada])).toBe('completa');
		expect(calidadDeSesiones([apenasEmpezada, entera])).toBe('completa');
	});

	it('dos rutinas apenas empezadas siguen siendo un día parcial', () => {
		const a = sesion([1, 0, 0]);
		const b = { ...sesion([1, 0, 0]), id: '2026-01-06__brazos', diaId: 'brazos' };
		expect(calidadDeSesiones([a, b])).toBe('parcial');
	});

	it('sin ninguna serie la fecha es nula', () => {
		expect(calidadDeSesiones([sesion([0, 0, 0])])).toBe('nula');
		expect(calidadDeSesiones([])).toBe('nula');
	});

	it('las cifras visibles sí se suman, y una sesión sin plan deja el total sin denominador', () => {
		const conPlan = totalesSesion(sesion([2, 0, 0]));
		const otra = totalesSesion({ ...sesion([3, 0, 0]), diaId: 'brazos' });
		expect(sumarTotales(conPlan, otra).seriesHechas).toBe(5);
		expect(sumarTotales(conPlan, otra).seriesPlan).toBe(24);

		const vieja = sesion([1, 0, 0]);
		delete vieja.plan;
		const total = sumarTotales(conPlan, totalesSesion(vieja));
		expect(total.seriesPlan).toBeNull();
		expect(total.ejerciciosPlan).toBeNull();
	});
});

describe('plan de una rutina', () => {
	it('suma las series objetivo y cuenta los ejercicios', () => {
		expect(
			planDeDia([{ seriesObjetivo: 4 }, { seriesObjetivo: 3 }, { seriesObjetivo: 5 }])
		).toEqual({ ejercicios: 3, series: 12 });
	});

	it('un objetivo de cero igual reserva una serie, como la creación de la sesión', () => {
		expect(planDeDia([{ seriesObjetivo: 0 }])).toEqual({ ejercicios: 1, series: 1 });
	});

	it('mismoPlan detecta el cambio y tolera el plan ausente', () => {
		expect(mismoPlan({ ejercicios: 3, series: 12 }, { ejercicios: 3, series: 12 })).toBe(true);
		expect(mismoPlan({ ejercicios: 3, series: 12 }, { ejercicios: 3, series: 11 })).toBe(false);
		expect(mismoPlan(undefined, { ejercicios: 3, series: 12 })).toBe(false);
	});
});
