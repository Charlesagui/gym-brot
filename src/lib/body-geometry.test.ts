import { describe, expect, it } from 'vitest';
import { GEOMETRIA_CUERPO } from './body-geometry';
import { MUSCULOS, type MusculoMapa } from './musculos';

/**
 * Estas pruebas existen por una razón concreta: cuatro de las seis rutas del serrato
 * llegaron al repo con comandos de cinco números en vez de seis. Un `d` inválido no
 * lanza ningún error — el navegador dibuja hasta el comando roto y abandona el resto
 * en silencio, así que el músculo aparecía como una astilla y nadie se enteraba.
 */

/** Cuántos números lleva cada comando de `d`. */
const ARGUMENTOS: Record<string, number> = {
	M: 2,
	L: 2,
	H: 1,
	V: 1,
	C: 6,
	S: 4,
	Q: 4,
	T: 2,
	A: 7,
	Z: 0
};

interface Caja {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/**
 * Recorre un `d` como lo haría el navegador y devuelve la caja que ocupa. Lanza si la
 * ruta no es válida. La caja incluye los puntos de control, así que puede ser algo más
 * grande que el dibujo real: para verificar que algo entra en el `viewBox` eso juega a
 * favor, porque el error es hacia el lado seguro.
 */
function recorrer(d: string): Caja {
	const piezas = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
	let i = 0;
	let comando: string | null = null;
	let x = 0;
	let y = 0;
	let inicioX = 0;
	let inicioY = 0;
	const caja: Caja = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
	const marcar = (px: number, py: number) => {
		caja.x0 = Math.min(caja.x0, px);
		caja.x1 = Math.max(caja.x1, px);
		caja.y0 = Math.min(caja.y0, py);
		caja.y1 = Math.max(caja.y1, py);
	};

	while (i < piezas.length) {
		if (/^[a-zA-Z]$/.test(piezas[i]!)) comando = piezas[i++]!;
		if (!comando) throw new Error(`empieza sin comando: ${d}`);
		// A una copia sí le estrecha el tipo: `comando` se reasigna más abajo y TypeScript
		// lo ve como circular si se lo lee y se lo escribe en la misma vuelta.
		const actual: string = comando;
		const tipo = actual.toUpperCase();
		const relativo = actual === actual.toLowerCase();
		const espera = ARGUMENTOS[tipo];
		if (espera === undefined) throw new Error(`comando desconocido "${actual}": ${d}`);
		if (espera === 0) {
			x = inicioX;
			y = inicioY;
			continue;
		}
		const numeros: number[] = [];
		while (numeros.length < espera && i < piezas.length && !/^[a-zA-Z]$/.test(piezas[i]!)) {
			numeros.push(Number(piezas[i++]));
		}
		if (numeros.length < espera) {
			throw new Error(`"${actual}" esperaba ${espera} números y recibió ${numeros.length}: ${d}`);
		}
		// De un par de coordenadas al punto absoluto que representa.
		const punto = (dx: number, dy: number) => [relativo ? x + dx : dx, relativo ? y + dy : dy];
		if (tipo === 'H') {
			x = relativo ? x + numeros[0]! : numeros[0]!;
		} else if (tipo === 'V') {
			y = relativo ? y + numeros[0]! : numeros[0]!;
		} else {
			// Los intermedios son puntos de control; el último siempre es el destino.
			const pares = tipo === 'A' ? [numeros.slice(5)] : [];
			if (tipo !== 'A') {
				for (let k = 0; k < numeros.length; k += 2) pares.push(numeros.slice(k, k + 2));
			}
			for (const [dx, dy] of pares) marcar(...(punto(dx!, dy!) as [number, number]));
			const [ux, uy] = punto(pares.at(-1)![0]!, pares.at(-1)![1]!);
			x = ux!;
			y = uy!;
		}
		marcar(x, y);
		if (tipo === 'M') {
			inicioX = x;
			inicioY = y;
			// Tras un `moveto`, los pares que siguen son `lineto` (regla de SVG 1.1).
			comando = relativo ? 'l' : 'L';
		}
	}
	return caja;
}

const LADOS = ['front', 'back'] as const;

describe('geometría del cuerpo', () => {
	it('recorrer detecta un comando incompleto', () => {
		// La forma exacta en la que llegaron las rutas del serrato: "8 0" comido a "80".
		expect(() => recorrer('M227 432c-2-1-3-4-3-6q1-5 4-8c2-2 5-2 80z')).toThrow(/esperaba 6/);
		expect(() => recorrer('M227 432c-2-1-3-4-3-6q1-5 4-8c2-2 5-2 8 0z')).not.toThrow();
	});

	for (const lado of LADOS) {
		const cuerpo = GEOMETRIA_CUERPO[lado];

		it(`${lado}: todas las rutas son válidas`, () => {
			for (const zona of cuerpo.zones) {
				for (const ruta of zona.paths) {
					expect(() => recorrer(ruta), `${lado}/${zona.slug}`).not.toThrow();
				}
			}
		});

		it(`${lado}: el dibujo entra entero en el viewBox`, () => {
			const [vx, vy, ancho, alto] = cuerpo.viewBox.split(' ').map(Number) as [
				number,
				number,
				number,
				number
			];
			for (const zona of cuerpo.zones) {
				for (const ruta of zona.paths) {
					const caja = recorrer(ruta);
					expect(caja.x0, `${lado}/${zona.slug} se sale por la izquierda`).toBeGreaterThanOrEqual(
						vx
					);
					expect(caja.y0, `${lado}/${zona.slug} se sale por arriba`).toBeGreaterThanOrEqual(vy);
					expect(caja.x1, `${lado}/${zona.slug} se sale por la derecha`).toBeLessThanOrEqual(
						vx + ancho
					);
					expect(caja.y1, `${lado}/${zona.slug} se sale por abajo`).toBeLessThanOrEqual(vy + alto);
				}
			}
		});
	}

	it('los dos lados comparten escala y alto', () => {
		const [, frenteY, frenteAncho, frenteAlto] = GEOMETRIA_CUERPO.front.viewBox
			.split(' ')
			.map(Number);
		const [, espaldaY, espaldaAncho, espaldaAlto] = GEOMETRIA_CUERPO.back.viewBox
			.split(' ')
			.map(Number);
		expect([espaldaY, espaldaAncho, espaldaAlto]).toEqual([frenteY, frenteAncho, frenteAlto]);
	});

	it('cada músculo del mapa tiene su zona dibujada', () => {
		const dibujadas = new Set(
			LADOS.flatMap((lado) => GEOMETRIA_CUERPO[lado].zones.map((z) => z.slug))
		);
		const musculos = Object.keys(MUSCULOS) as MusculoMapa[];
		for (const musculo of musculos) {
			expect(dibujadas, `${musculo} no tiene geometría`).toContain(MUSCULOS[musculo].geometria);
		}
	});

	it('las zonas sin músculo son sólo las decorativas conocidas', () => {
		const conMusculo = new Set(Object.values(MUSCULOS).map((m) => m.geometria));
		const sueltas = LADOS.flatMap((lado) =>
			GEOMETRIA_CUERPO[lado].zones.map((z) => z.slug).filter((slug) => !conMusculo.has(slug))
		);
		// El cuello se dibuja para que la espalda no arranque en los hombros, pero no
		// es un músculo del mapa: no se toca ni se cuenta.
		expect([...new Set(sueltas)]).toEqual(['neck']);
	});
});
