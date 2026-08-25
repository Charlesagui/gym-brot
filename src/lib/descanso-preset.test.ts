import { describe, expect, it } from 'vitest';
import {
	PRESETS_DESCANSO,
	RUEDA_DESCANSO,
	segundosAMinutos,
	descansoEfectivo,
	descansoEnSegundos,
	descansoPersonalizado,
	etiquetaCortaDescanso,
	etiquetaDescanso
} from './descanso-preset';
import { AJUSTES_DEFAULT } from './extras';
import type { Ajustes } from './db';

function ajustes(parcial: Partial<Ajustes> = {}): Ajustes {
	return { ...AJUSTES_DEFAULT, ...parcial };
}

describe('descansoEfectivo', () => {
	it('sin personalización usa el descanso general, interruptor incluido', () => {
		const base = ajustes({ timer: { activo: true, minutos: 3 } });
		expect(descansoEfectivo('press-pecho', base)).toEqual({ activo: true, minutos: 3 });

		const apagado = ajustes({ timer: { activo: false, minutos: 3 } });
		expect(descansoEfectivo('press-pecho', apagado)).toEqual({ activo: false, minutos: 3 });
	});

	it('la personalización del ejercicio pisa al general', () => {
		const base = ajustes({
			timer: { activo: true, minutos: 3 },
			descansosEjercicio: { 'elevaciones-laterales': 0.75 }
		});
		expect(descansoEfectivo('elevaciones-laterales', base)).toEqual({
			activo: true,
			minutos: 0.75
		});
		// El de al lado no se entera: es justo el bug que motivó la separación.
		expect(descansoEfectivo('press-pecho', base)).toEqual({ activo: true, minutos: 3 });
	});

	it('una personalización encendida gana aunque el general esté apagado', () => {
		const base = ajustes({
			timer: { activo: false, minutos: 2 },
			descansosEjercicio: { sentadilla: 5 }
		});
		expect(descansoEfectivo('sentadilla', base)).toEqual({ activo: true, minutos: 5 });
	});

	it('0 apaga el descanso solo en ese ejercicio y conserva el valor general', () => {
		const base = ajustes({
			timer: { activo: true, minutos: 2 },
			descansosEjercicio: { abdominales: 0 }
		});
		// minutos sigue siendo el general: si lo vuelve a encender, no arranca en 0.
		expect(descansoEfectivo('abdominales', base)).toEqual({ activo: false, minutos: 2 });
	});

	it('sin ejercicio (vista de consulta) cae al general sin romperse', () => {
		const base = ajustes({ timer: { activo: true, minutos: 2 } });
		expect(descansoEfectivo(undefined, base)).toEqual({ activo: true, minutos: 2 });
		expect(descansoPersonalizado(undefined, base)).toBeUndefined();
	});
});

describe('descansoPersonalizado', () => {
	it('distingue "apagado acá" (0) de "sin configurar" (undefined)', () => {
		const base = ajustes({ descansosEjercicio: { abdominales: 0 } });
		expect(descansoPersonalizado('abdominales', base)).toBe(0);
		expect(descansoPersonalizado('press-pecho', base)).toBeUndefined();
	});
});

describe('descansoEnSegundos', () => {
	it('convierte los presets sub-minuto a segundos exactos', () => {
		expect(descansoEnSegundos(0.75)).toBe(45);
		expect(descansoEnSegundos(1.5)).toBe(90);
		expect(descansoEnSegundos(2)).toBe(120);
	});

	it('nunca devuelve 0: un descanso de duración nula no es un descanso', () => {
		expect(descansoEnSegundos(0)).toBe(1);
	});
});

describe('etiquetas', () => {
	it('escribe segundos abajo del minuto y minutos redondos arriba', () => {
		expect(etiquetaCortaDescanso(0.75)).toBe('45s');
		expect(etiquetaCortaDescanso(1.5)).toBe('90s');
		expect(etiquetaCortaDescanso(2)).toBe('2′');
		expect(etiquetaCortaDescanso(5)).toBe('5′');
	});

	it('la etiqueta hablada singulariza el minuto', () => {
		expect(etiquetaDescanso(0.75)).toBe('45 segundos');
		expect(etiquetaDescanso(1)).toBe('1 minuto');
		expect(etiquetaDescanso(3)).toBe('3 minutos');
	});
});

describe('PRESETS_DESCANSO', () => {
	it('deja cuatro atajos redondos y delega el resto en la rueda', () => {
		expect([...PRESETS_DESCANSO]).toEqual([1, 2, 4, 5]);
		// Todos tienen que poder escribirse sin ambigüedad en un chip angosto.
		expect(PRESETS_DESCANSO.map(etiquetaCortaDescanso)).toEqual(['1′', '2′', '4′', '5′']);
	});

	it('la rueda alcanza los descansos que salieron de la fila', () => {
		const { min, max, paso } = RUEDA_DESCANSO;
		for (const segundos of [45, 90, 180]) {
			expect(segundos).toBeGreaterThanOrEqual(min);
			expect(segundos).toBeLessThanOrEqual(max);
			expect(segundos % paso).toBe(0);
			// Y siguen guardándose en minutos, como todo lo demás.
			expect(descansoEnSegundos(segundosAMinutos(segundos))).toBe(segundos);
		}
	});
});
