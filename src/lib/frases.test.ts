import { describe, expect, it } from 'vitest';
import type { ObjetivoEnergia } from './db';
import { fraseProteina, frasesPara, type DatosFrases } from './frases';

function objetivo(parche: Partial<ObjetivoEnergia> = {}): ObjetivoEnergia {
	return {
		id: '2026-03-01T10:00:00.000Z-abc123',
		creadoAt: '2026-03-01T10:00:00.000Z',
		perfil: {
			edad: 32,
			alturaCm: 178,
			pesoGramos: 82_000,
			ecuacion: 'masculina',
			ocupacion: 'sentado',
			pasos: 'de4a7k',
			sesionesSemana: 4,
			duracion: 'media',
			densidad: 'normal'
		},
		palEstimado: 1.555,
		categoriaPal: 'poco',
		tdeeKcal: 2890,
		sepvKcal: 342,
		meta: 'bajar',
		nivel: 'moderado',
		ritmoPctSemana: -0.5,
		objetivoKcal: 2440,
		proteinaG: 148,
		...parche
	};
}

function datos(parche: Partial<DatosFrases> = {}): DatosFrases {
	return {
		objetivo: objetivo(),
		pesoActualGramos: 82_000,
		fechaUltimoPeso: '2026-03-15',
		calibracion: null,
		tdeeAnteriorKcal: null,
		unidad: 'kg',
		hoy: '2026-03-16',
		...parche
	};
}

const ids = (d: DatosFrases) => frasesPara(d).map((f) => f.id);

describe('sin objetivo no hay nada que decir', () => {
	it('devuelve la lista vacía', () => {
		expect(frasesPara(datos({ objetivo: null }))).toEqual([]);
	});
});

describe('el objetivo se quedó viejo', () => {
	it('avisa cuando el peso bajó más del 2 %', () => {
		const frases = frasesPara(datos({ pesoActualGramos: 78_900 }));
		expect(frases[0]!.id).toBe('viejo-bajaste');
		expect(frases[0]!.texto).toContain('3,10 kg');
		expect(frases[0]!.texto).toContain('te queda alto');
	});

	it('avisa cuando el peso subió más del 2 %', () => {
		const frases = frasesPara(datos({ pesoActualGramos: 84_500 }));
		expect(frases[0]!.id).toBe('viejo-subiste');
		expect(frases[0]!.texto).toContain('te queda corto');
	});

	it('no avisa por un cambio dentro del ruido', () => {
		expect(ids(datos({ pesoActualGramos: 83_000 }))).not.toContain('viejo-subiste');
	});

	it('es lo primero de todo: es lo único que dice algo que no sabías', () => {
		const frases = frasesPara(
			datos({
				pesoActualGramos: 78_900,
				calibracion: {
					estado: 'sin-senal',
					ventana: { pesajes: 10, dias: 28 },
					kgPorSemana: -0.1,
					errorKgPorSemana: 0.2
				}
			})
		);
		expect(frases[0]!.id).toBe('viejo-bajaste');
	});

	it('avisa por antigüedad aunque el peso no se haya movido', () => {
		const frases = frasesPara(datos({ hoy: '2026-06-10' }));
		expect(frases.map((f) => f.id)).toContain('viejo-tiempo');
		expect(frases.find((f) => f.id === 'viejo-tiempo')!.texto).toContain('3 meses');
	});
});

describe('un peso viejo no es un dato', () => {
	it('apaga la comparación contra el peso congelado', () => {
		// El pesaje dice que bajó 3,1 kg, pero es de hace tres semanas: puede haberlos
		// recuperado. Decirle "bajaste 3,1 kg" sería cierto y estar desactualizado.
		const salida = ids(datos({ pesoActualGramos: 78_900, fechaUltimoPeso: '2026-02-20' }));
		expect(salida).not.toContain('viejo-bajaste');
	});

	it('y en su lugar dice exactamente por qué no puede decir nada', () => {
		const frases = frasesPara(datos({ pesoActualGramos: 78_900, fechaUltimoPeso: '2026-03-01' }));
		const rancio = frases.find((f) => f.id === 'peso-rancio')!;
		expect(rancio.texto).toContain('Hace 15 días');
		// Y va antes que cualquier predicción, porque la desactiva.
		expect(frases.indexOf(rancio)).toBeLessThan(frases.findIndex((f) => f.id === 'esperar-bajar'));
	});

	it('sin ninguna medición lo dice de otra forma', () => {
		const frases = frasesPara(datos({ pesoActualGramos: null, fechaUltimoPeso: null }));
		expect(frases.map((f) => f.id)).toContain('sin-pesos');
		expect(frases.map((f) => f.id)).not.toContain('peso-rancio');
	});
});

describe('calibración', () => {
	it('cuando la corrección fue grande dice cuánto', () => {
		const frases = frasesPara(
			datos({
				objetivo: objetivo({ calibradoDe: 'anterior', tdeeKcal: 2600 }),
				tdeeAnteriorKcal: 2890
			})
		);
		const f = frases.find((x) => x.id === 'correccion-grande')!;
		expect(f.texto).toContain('290 kcal');
		expect(f.texto).toContain('por debajo');
	});

	it('cuando fue chica solo dice que se ajustó', () => {
		const salida = ids(
			datos({
				objetivo: objetivo({ calibradoDe: 'anterior', tdeeKcal: 2850 }),
				tdeeAnteriorKcal: 2890
			})
		);
		expect(salida).toContain('calibrado');
		expect(salida).not.toContain('correccion-grande');
	});

	it('no inventa una corrección si no hay con qué compararla', () => {
		const salida = ids(
			datos({ objetivo: objetivo({ calibradoDe: 'anterior' }), tdeeAnteriorKcal: null })
		);
		expect(salida).toContain('calibrado');
	});

	it('el estado sin señal se explica en vez de esconderse', () => {
		const salida = ids(
			datos({
				calibracion: {
					estado: 'sin-senal',
					ventana: { pesajes: 10, dias: 28 },
					kgPorSemana: -0.08,
					errorKgPorSemana: 0.2
				}
			})
		);
		expect(salida).toContain('sin-senal');
	});

	it('cuenta los pesajes que faltan con el número real', () => {
		const frases = frasesPara(
			datos({
				calibracion: { estado: 'pocos-pesajes', ventana: { pesajes: 4, dias: 21 }, minimo: 12 }
			})
		);
		expect(frases.find((f) => f.id === 'pocos-pesajes')!.texto).toContain('4 veces');
		expect(frases.find((f) => f.id === 'pocos-pesajes')!.texto).toContain('Con 12');
	});

	it('reconoce la racha buena', () => {
		const frases = frasesPara(
			datos({
				calibracion: {
					estado: 'listo',
					ventana: { pesajes: 22, dias: 28 },
					kgPorSemana: -0.4,
					errorKgPorSemana: 0.1,
					cambioKg: -1.6,
					dias: 28,
					tdeeMedido: 2800
				}
			})
		);
		expect(frases.find((f) => f.id === 'buena-racha')!.texto).toContain('22 de los últimos 28');
	});

	it('los pesajes que dice la frase son los de la ventana real, no los que cargó la pantalla', () => {
		// El bug: la sección contaba sobre 63 días y lo rotulaba «en este período», mientras
		// la tarjeta de arriba mostraba el conteo verdadero de la ventana. Con un objetivo de
		// 30 días la ventana son 23, no 56, y los dos números convivían en pantalla.
		const frases = frasesPara(
			datos({
				calibracion: { estado: 'pocos-pesajes', ventana: { pesajes: 8, dias: 23 }, minimo: 12 }
			})
		);
		const texto = frases.find((f) => f.id === 'pocos-pesajes')!.texto;
		expect(texto).toContain('8 veces');
		expect(texto).not.toContain('19');
	});

	it('sin ventana no promete que alcanza para corregir', () => {
		// `esperando` no tiene período que contar: el objetivo es demasiado joven. Antes
		// bastaba con tener 20 pesajes cargados para prometer una corrección imposible.
		const salida = ids(datos({ calibracion: { estado: 'esperando', diasRestantes: 12 } }));
		expect(salida).not.toContain('buena-racha');
	});
});

describe('qué va a costar y qué esperar', () => {
	it('el déficit moderado promete que la fuerza se sostiene, y da el síntoma', () => {
		const f = frasesPara(datos()).find((x) => x.id === 'costo-deficit-moderado')!;
		expect(f.texto).toContain('la fuerza se sostiene');
		expect(f.tono).toBe('neutro');
	});

	it('el déficit agresivo avisa el costo', () => {
		const salida = ids(datos({ objetivo: objetivo({ nivel: 'agresivo' }) }));
		expect(salida).toContain('costo-deficit-agresivo');
		expect(salida).not.toContain('costo-deficit-moderado');
	});

	it('el volumen agresivo suma su propia advertencia', () => {
		const salida = ids(
			datos({ objetivo: objetivo({ meta: 'subir', nivel: 'agresivo', ritmoPctSemana: 0.5 }) })
		);
		expect(salida).toContain('costo-volumen-agresivo');
		expect(salida).toContain('costo-volumen');
	});

	it('la predicción trae el ritmo en la unidad del usuario', () => {
		expect(frasesPara(datos()).find((f) => f.id === 'esperar-bajar')!.texto).toContain('0,41 kg');
		expect(
			frasesPara(datos({ unidad: 'lb' })).find((f) => f.id === 'esperar-bajar')!.texto
		).toContain('lb');
	});

	it('mantenimiento tiene su propia forma de fallar', () => {
		const salida = ids(datos({ objetivo: objetivo({ meta: 'mantener', nivel: null }) }));
		expect(salida).toContain('esperar-mantener');
		expect(salida).not.toContain('costo-deficit-moderado');
	});
});

describe('la proteína explica su número donde está el número', () => {
	it('cambia con la meta', () => {
		expect(fraseProteina(objetivo())).toContain('grasa y no músculo');
		expect(fraseProteina(objetivo({ meta: 'subir' }))).toContain('piso');
	});
});

describe('lo que ve el usuario son las dos primeras', () => {
	it('con todo mal, las dos primeras son las que importan', () => {
		const frases = frasesPara(
			datos({
				pesoActualGramos: 78_900,
				hoy: '2026-06-10',
				fechaUltimoPeso: '2026-06-09',
				calibracion: {
					estado: 'sin-senal',
					ventana: { pesajes: 10, dias: 28 },
					kgPorSemana: -0.05,
					errorKgPorSemana: 0.2
				}
			})
		);
		expect(frases.slice(0, 2).map((f) => f.id)).toEqual(['viejo-bajaste', 'viejo-tiempo']);
	});

	it('en el mejor caso las dos primeras siguen diciendo algo', () => {
		const frases = frasesPara(
			datos({
				calibracion: {
					estado: 'listo',
					ventana: { pesajes: 22, dias: 28 },
					kgPorSemana: -0.4,
					errorKgPorSemana: 0.1,
					cambioKg: -1.6,
					dias: 28,
					tdeeMedido: 2800
				}
			})
		);
		expect(frases.length).toBeGreaterThanOrEqual(2);
		expect(frases[0]!.id).toBe('buena-racha');
	});
});
