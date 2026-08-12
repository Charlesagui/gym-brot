import { describe, expect, it } from 'vitest';
import type { Ejercicio } from './catalog';
import { AJUSTES_DEFAULT } from './extras';
import { pasoPesoAutomatico, pasoPesoEfectivo } from './paso-peso';

const mancuerna: Ejercicio = {
	id: 'curl-mancuerna',
	nombre: 'Curl con mancuerna',
	grupo: 'brazos',
	musculo: 'Bíceps',
	demoVideo: '/curl.mp4',
	equipo: 'mancuerna'
};

describe('paso de peso por ejercicio', () => {
	it('sugiere 1 kg para mancuernas y conserva el global para el resto', () => {
		expect(pasoPesoAutomatico(mancuerna, AJUSTES_DEFAULT)).toBe(1);
		expect(
			pasoPesoAutomatico({ ...mancuerna, id: 'press', equipo: 'barra' }, AJUSTES_DEFAULT)
		).toBe(5);
	});

	it('usa una preferencia del ejercicio sin tocar la global', () => {
		const ajustes = {
			...AJUSTES_DEFAULT,
			pasosPesoEjercicio: { [mancuerna.id]: { kg: 2.5 } }
		};
		expect(pasoPesoEfectivo(mancuerna, ajustes)).toBe(2.5);
		expect(ajustes.pasoPeso).toBe(5);
	});

	it('mantiene preferencias independientes para kg y lb', () => {
		const ajustes = {
			...AJUSTES_DEFAULT,
			unidad: 'lb' as const,
			pasosPesoEjercicio: { [mancuerna.id]: { kg: 1, lb: 2.5 } }
		};
		expect(pasoPesoEfectivo(mancuerna, ajustes)).toBe(2.5);
	});
});
