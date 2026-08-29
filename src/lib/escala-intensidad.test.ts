import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLORES_INTENSIDAD, TINTA_INTENSIDAD } from './escala-intensidad';

type Rgb = [number, number, number];

/**
 * El verde tope sale del token real de la app y no de una copia acá adentro: si alguien
 * cambia `--exito`, la escala cambia con él y estas pruebas de contraste tienen que
 * enterarse. Es justo el escenario en el que una escala se rompe sin que nadie toque ni
 * el calendario ni el mapa.
 */
function tokenExito(): Rgb {
	const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
	const match = css.match(/--exito:\s*(\d+)\s+(\d+)\s+(\d+)/);
	if (!match) throw new Error('no se encontró el token --exito en app.css');
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** El fondo sobre el que se dibujan las dos escalas: la tarjeta de /historial. */
const FONDO: Rgb = [0x14, 0x14, 0x1d];

function mezclar(frente: Rgb, fondo: Rgb, alfa: number): Rgb {
	return frente.map((canal, i) => Math.round(alfa * canal + (1 - alfa) * fondo[i]!)) as Rgb;
}

/** El color de un paso, ya resuelto contra el fondo real. */
function resolver(color: string): Rgb {
	if (color === 'rgb(var(--exito))') return tokenExito();
	const hex = color.match(/^#([0-9a-f]{6})$/i);
	if (hex) {
		const n = parseInt(hex[1]!, 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	const rgba = color.match(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/);
	if (!rgba) throw new Error(`color de paso no reconocido: ${color}`);
	return mezclar([Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], FONDO, Number(rgba[4]));
}

function tintaRgb(nivel: number): Rgb {
	const [r, g, b] = TINTA_INTENSIDAD[nivel]!.split(' ').map(Number);
	return [r!, g!, b!];
}

function luminancia([r, g, b]: Rgb): number {
	const [lr, lg, lb] = [r, g, b].map((v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
}

function ratio(a: Rgb, b: Rgb): number {
	const [alto, bajo] = [luminancia(a) + 0.05, luminancia(b) + 0.05].sort((x, y) => y - x);
	return alto! / bajo!;
}

const contraste = (a: string, b: string) => ratio(resolver(a), resolver(b));

describe('escala de intensidad de /historial', () => {
	/**
	 * La prueba que define el cambio.
	 *
	 * Con la rampa continua anterior, dos músculos separados por una serie por semana
	 * quedaban a 1,1:1, y un historial de tres sesiones dejaba el cuerpo entero en 1,4:1
	 * de punta a punta. Sin este piso, cualquier retoque de la paleta puede volver a
	 * dejar el dibujo en un solo verde sin romper ninguna otra prueba.
	 */
	it('cada paso se distingue del vecino', () => {
		for (let nivel = 1; nivel < COLORES_INTENSIDAD.length; nivel++) {
			const salto = contraste(COLORES_INTENSIDAD[nivel]!, COLORES_INTENSIDAD[nivel - 1]!);
			expect(salto, `paso ${nivel} contra ${nivel - 1}`).toBeGreaterThanOrEqual(1.5);
		}
	});

	/**
	 * Lo no entrenado no puede ser verde. Era el otro motivo de que el cuerpo se viera
	 * teñido entero: entre cero series y unas pocas no había cambio de tono.
	 */
	it('el paso vacío no es verde y se separa del primero con carga', () => {
		// Medido contra el sesgo del propio fondo y no contra un número al aire: la regla
		// es que lo vacío no esté MÁS verde que la tarjeta sobre la que se dibuja. Con un
		// umbral suelto, el verde al 7 % de antes pasaba —a esa opacidad casi no se lee
		// como verde— y el paso vacío seguía teñido igual.
		const [r, g, b] = resolver(COLORES_INTENSIDAD[0]!);
		const sesgoDelFondo = FONDO[1] - Math.max(FONDO[0], FONDO[2]);
		expect(g - Math.max(r, b)).toBeLessThanOrEqual(sesgoDelFondo);
		expect(contraste(COLORES_INTENSIDAD[1]!, COLORES_INTENSIDAD[0]!)).toBeGreaterThanOrEqual(1.5);
	});

	it('el paso lleno es el verde de logro de la app, no una tonalidad más', () => {
		expect(COLORES_INTENSIDAD.at(-1)).toBe('rgb(var(--exito))');
	});

	/**
	 * El calendario escribe el número del día ENCIMA del relleno. La escala anterior se
	 * cortaba en alfa 0,55 justamente por esto, y llegar hasta el verde pleno sólo es
	 * posible porque los pasos claros cambian a tinta oscura. Si alguien aclara un paso
	 * sin mover su tinta, el número se vuelve ilegible y esta prueba lo dice.
	 */
	it('el número del día se lee sobre los cinco pasos', () => {
		expect(TINTA_INTENSIDAD).toHaveLength(COLORES_INTENSIDAD.length);
		COLORES_INTENSIDAD.forEach((color, nivel) => {
			const legibilidad = ratio(resolver(color), tintaRgb(nivel));
			expect(legibilidad, `texto sobre el paso ${nivel}`).toBeGreaterThanOrEqual(4.5);
		});
	});

	/**
	 * En un teléfono el calendario va con `gap-0`, así que dos días pegados se separan
	 * sólo por el contorno. El borde verde fijo que había antes se apagaba sobre los
	 * pasos claros y sobre el paso 4 era exactamente el color del relleno.
	 */
	it('el contorno de la celda se ve sobre su propio relleno', () => {
		COLORES_INTENSIDAD.forEach((color, nivel) => {
			const fondo = resolver(color);
			const borde = mezclar(tintaRgb(nivel), fondo, 0.28);
			expect(ratio(fondo, borde), `contorno del paso ${nivel}`).toBeGreaterThanOrEqual(1.5);
			const hoy = mezclar(tintaRgb(nivel), fondo, 0.9);
			expect(ratio(fondo, hoy), `anillo de hoy en el paso ${nivel}`).toBeGreaterThanOrEqual(3);
		});
	});
});
