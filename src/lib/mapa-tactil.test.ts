import { describe, expect, it } from 'vitest';
import { distanciaACaja, musculoMasCercano, type CajaMuscular } from './mapa-tactil';

/** Trapecio del frente a escala real: 12×8 px en un teléfono de 390. */
const trapecio: CajaMuscular = { musculo: 'trapezius', x0: 241, y0: 271, x1: 287, y1: 302 };
const deltoides: CajaMuscular = { musculo: 'deltoids', x0: 167, y0: 282, x1: 240, y1: 373 };
/** Los oblicuos envuelven al recto abdominal: sus cajas se pisan casi enteras. */
const oblicuos: CajaMuscular = { musculo: 'obliques', x0: 222, y0: 413, x1: 417, y1: 617 };
const abdominales: CajaMuscular = { musculo: 'abs', x0: 255, y0: 438, x1: 386, y1: 680 };

describe('distancia a la caja', () => {
	it('es cero adentro y en el borde', () => {
		expect(distanciaACaja(260, 290, trapecio)).toBe(0);
		expect(distanciaACaja(241, 271, trapecio)).toBe(0);
	});

	it('mide sólo el eje por el que se salió', () => {
		expect(distanciaACaja(260, 261, trapecio)).toBe(10);
		expect(distanciaACaja(231, 290, trapecio)).toBe(10);
	});

	it('mide en diagonal cuando se salió por los dos ejes', () => {
		expect(distanciaACaja(238, 268, trapecio)).toBeCloseTo(Math.hypot(3, 3));
	});
});

describe('músculo más cercano', () => {
	const cajas = [trapecio, deltoides, oblicuos, abdominales];

	it('el toque adentro gana', () => {
		expect(musculoMasCercano(260, 290, cajas, 40)).toBe('trapezius');
	});

	it('el toque errado por poco cae en el músculo de al lado', () => {
		// 8 unidades arriba del trapecio: en pantalla son 2 px de error.
		expect(musculoMasCercano(260, 263, cajas, 40)).toBe('trapezius');
	});

	it('el toque lejos de todo no elige nada', () => {
		expect(musculoMasCercano(600, 100, cajas, 40)).toBeNull();
	});

	it('el radio es el límite y no una sugerencia', () => {
		expect(musculoMasCercano(260, 231, cajas, 40)).toBe('trapezius');
		expect(musculoMasCercano(260, 230, cajas, 40)).toBeNull();
	});

	it('entre dos que contienen el punto gana la caja más chica', () => {
		// El punto cae adentro de los oblicuos Y de los abdominales.
		expect(distanciaACaja(300, 500, oblicuos)).toBe(0);
		expect(distanciaACaja(300, 500, abdominales)).toBe(0);
		expect(musculoMasCercano(300, 500, cajas, 40)).toBe('abs');
	});

	it('a igual distancia afuera también gana la más chica', () => {
		const grande: CajaMuscular = { musculo: 'forearms', x0: 0, y0: 0, x1: 100, y1: 100 };
		const chica: CajaMuscular = { musculo: 'biceps', x0: 40, y0: 0, x1: 60, y1: 100 };
		expect(musculoMasCercano(50, 110, [grande, chica], 20)).toBe('biceps');
		expect(musculoMasCercano(50, 110, [chica, grande], 20)).toBe('biceps');
	});

	it('sin cajas no explota', () => {
		expect(musculoMasCercano(10, 10, [], 40)).toBeNull();
	});
});
