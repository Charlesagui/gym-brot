import { describe, expect, it } from 'vitest';
import { colorDisco } from './discos-color';

/** Luminancia relativa WCAG de un triplete "r g b". */
function luminancia(rgb: string): number {
	const canal = (v: number) => {
		const c = v / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const [r, g, b] = rgb.split(' ').map(Number) as [number, number, number];
	return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function contraste(a: string, b: string): number {
	const [alta, baja] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
	return (alta + 0.05) / (baja + 0.05);
}

/** `--surface-3`, la tarjeta en foco donde vive el dibujo. */
const TARJETA = '32 32 45';
/** `--on-bright`, la tinta oscura que va escrita sobre la placa. */
const TINTA = '8 8 12';

const CATALOGO_KG = [25, 20, 15, 10, 5, 2.5, 1.25];
const CATALOGO_LB = [45, 35, 25, 10, 5, 2.5];

describe('paleta de discos', () => {
	it('le da un color propio a cada peso del catálogo', () => {
		for (const catalogo of [CATALOGO_KG, CATALOGO_LB]) {
			const unidad = catalogo === CATALOGO_KG ? 'kg' : 'lb';
			const colores = catalogo.map((peso) => colorDisco(peso, unidad));
			expect(new Set(colores).size).toBe(catalogo.length);
		}
	});

	it('mantiene la tinta oscura legible sobre cada placa', () => {
		for (const peso of CATALOGO_KG) {
			expect(contraste(TINTA, colorDisco(peso, 'kg'))).toBeGreaterThanOrEqual(4.5);
		}
	});

	/**
	 * El motivo de que la paleta no sea la real: los colores de competición están
	 * pensados para la luz del día, y sobre este fondo el azul de 20 kg da 2,26:1.
	 */
	it('sigue siendo visible como tinte sobre la tarjeta oscura', () => {
		for (const peso of CATALOGO_KG) {
			expect(contraste(colorDisco(peso, 'kg'), TARJETA)).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('separa el 2,5 del 25, que en la vida real comparten el rojo', () => {
		expect(colorDisco(2.5, 'kg')).not.toBe(colorDisco(25, 'kg'));
	});

	it('cae en el acento para un peso que no está en el catálogo', () => {
		expect(colorDisco(7.5, 'kg')).toBe('var(--accent-rgb)');
	});
});
