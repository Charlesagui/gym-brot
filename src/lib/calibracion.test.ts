import { describe, expect, it } from 'vitest';
import {
	calibrar,
	DIAS_MIN_BAJAR,
	DIAS_MIN_SUBIR,
	estadoCalibracion,
	regresionLineal,
	type Medicion,
	type ObjetivoVigente
} from './calibracion';

const INICIO = '2026-03-01T10:00:00.000Z';

const OBJETIVO: ObjetivoVigente = {
	creadoAt: INICIO,
	meta: 'bajar',
	objetivoKcal: 2440,
	tdeeKcal: 2890
};

function sumarDias(fecha: string, dias: number): string {
	const valor = new Date(`${fecha}T12:00:00Z`);
	valor.setUTCDate(valor.getUTCDate() + dias);
	return valor.toISOString().slice(0, 10);
}

/**
 * Serie sintética: arranca en `kgInicial` y baja `kgPorDia`, con un ruido determinista
 * que imita el vaivén diario de agua y digestión. El ruido es una senoidal y no un
 * random para que el test no sea distinto en cada corrida.
 */
function serie(opciones: {
	dias: number;
	kgInicial: number;
	kgPorDia: number;
	ruidoKg?: number;
	desde?: number;
	cada?: number;
}): Medicion[] {
	const { dias, kgInicial, kgPorDia, ruidoKg = 0, desde = 0, cada = 1 } = opciones;
	const puntos: Medicion[] = [];
	for (let d = desde; d < dias; d += cada) {
		const ruido = ruidoKg * Math.sin(d * 1.7);
		puntos.push({
			fecha: sumarDias('2026-03-01', d),
			pesoGramos: Math.round((kgInicial + kgPorDia * d + ruido) * 1000)
		});
	}
	return puntos;
}

describe('regresión lineal', () => {
	it('recupera la pendiente de una serie limpia', () => {
		const ajuste = regresionLineal(serie({ dias: 30, kgInicial: 82, kgPorDia: -0.06 }))!;
		expect(ajuste.pendienteKgDia).toBeCloseTo(-0.06, 6);
		expect(ajuste.errorEstandarKgDia).toBeCloseTo(0, 6);
		expect(ajuste.n).toBe(30);
	});

	it('el error estándar crece cuando la serie es corta', () => {
		const corta = regresionLineal(
			serie({ dias: 14, kgInicial: 82, kgPorDia: -0.06, ruidoKg: 0.7 })
		)!;
		const larga = regresionLineal(
			serie({ dias: 42, kgInicial: 82, kgPorDia: -0.06, ruidoKg: 0.7 })
		)!;
		expect(corta.errorEstandarKgDia).toBeGreaterThan(larga.errorEstandarKgDia);
	});

	it('devuelve null sin puntos suficientes o sin dispersión en el tiempo', () => {
		expect(regresionLineal([])).toBeNull();
		expect(regresionLineal(serie({ dias: 2, kgInicial: 82, kgPorDia: -0.06 }))).toBeNull();
		expect(
			regresionLineal([
				{ fecha: '2026-03-01', pesoGramos: 82_000 },
				{ fecha: '2026-03-01', pesoGramos: 82_100 },
				{ fecha: '2026-03-01', pesoGramos: 81_900 }
			])
		).toBeNull();
	});
});

describe('cuándo se puede calibrar', () => {
	it('espera 28 días para un déficit', () => {
		const pesos = serie({ dias: 20, kgInicial: 82, kgPorDia: -0.06 });
		expect(estadoCalibracion(OBJETIVO, pesos, sumarDias('2026-03-01', 20))).toEqual({
			estado: 'esperando',
			diasRestantes: DIAS_MIN_BAJAR - 20
		});
	});

	it('espera 42 días para un volumen, porque la señal es tres veces menor', () => {
		const subir: ObjetivoVigente = { ...OBJETIVO, meta: 'subir', objetivoKcal: 3120 };
		const pesos = serie({ dias: 30, kgInicial: 82, kgPorDia: 0.03 });
		expect(estadoCalibracion(subir, pesos, sumarDias('2026-03-01', 30))).toEqual({
			estado: 'esperando',
			diasRestantes: DIAS_MIN_SUBIR - 30
		});
	});

	it('pide más pesajes cuando la ventana está vacía', () => {
		// Una medición cada cinco días: pasan los 28 días pero no hay con qué trazar nada.
		const pesos = serie({ dias: 30, kgInicial: 82, kgPorDia: -0.06, cada: 5 });
		const estado = estadoCalibracion(OBJETIVO, pesos, sumarDias('2026-03-01', 30));
		expect(estado.estado).toBe('pocos-pesajes');
	});

	it('descarta la primera semana: ahí se mueve agua, no grasa', () => {
		// 25 mediciones diarias, pero solo desde el día 8 en adelante entran al ajuste.
		const pesos = serie({ dias: 33, kgInicial: 82, kgPorDia: -0.06 });
		const conPrimeraSemana = regresionLineal(pesos)!;
		const estado = estadoCalibracion(OBJETIVO, pesos, sumarDias('2026-03-01', 32));
		if (estado.estado !== 'listo') throw new Error(estado.estado);
		// El ajuste real usa menos días que la serie entera.
		expect(estado.dias).toBeLessThan(32);
		expect(conPrimeraSemana.n).toBeGreaterThan(estado.dias);
	});
});

describe('la señal tiene que superar al ruido', () => {
	it('con una tendencia clara propone la revisión', () => {
		const pesos = serie({ dias: 33, kgInicial: 82, kgPorDia: -0.06, ruidoKg: 0.3 });
		const estado = estadoCalibracion(OBJETIVO, pesos, sumarDias('2026-03-01', 32));
		if (estado.estado !== 'listo') throw new Error(estado.estado);
		expect(estado.kgPorSemana).toBeCloseTo(-0.42, 1);
		expect(estado.cambioKg).toBeLessThan(0);
	});

	it('con el peso plano no inventa una tendencia', () => {
		const pesos = serie({ dias: 33, kgInicial: 82, kgPorDia: 0, ruidoKg: 0.7 });
		const estado = estadoCalibracion(OBJETIVO, pesos, sumarDias('2026-03-01', 32));
		expect(estado.estado).toBe('sin-senal');
	});

	it('una tendencia real enterrada en ruido tampoco alcanza', () => {
		// Un volumen de +0,15 %/semana en 55 kg son 0,08 kg/semana: por debajo del ruido
		// de la balanza aunque la persona se pese todos los días durante seis semanas.
		const subir: ObjetivoVigente = { ...OBJETIVO, meta: 'subir', objetivoKcal: 2530 };
		const pesos = serie({ dias: 45, kgInicial: 55, kgPorDia: 0.011, ruidoKg: 0.9 });
		const estado = estadoCalibracion(subir, pesos, sumarDias('2026-03-01', 44));
		expect(estado.estado).toBe('sin-senal');
	});

	it('el estado sin señal informa igual la tendencia y su error', () => {
		const pesos = serie({ dias: 33, kgInicial: 82, kgPorDia: 0, ruidoKg: 0.7 });
		const estado = estadoCalibracion(OBJETIVO, pesos, sumarDias('2026-03-01', 32));
		if (estado.estado !== 'sin-senal') throw new Error(estado.estado);
		expect(Math.abs(estado.kgPorSemana)).toBeLessThan(estado.errorKgPorSemana * 1.5);
	});
});

describe('qué mantenimiento se deduce del peso', () => {
	it('bajar más rápido de lo previsto implica un mantenimiento mayor', () => {
		const pesos = serie({ dias: 33, kgInicial: 82, kgPorDia: -0.08, ruidoKg: 0.2 });
		const estado = estadoCalibracion(OBJETIVO, pesos, sumarDias('2026-03-01', 32));
		if (estado.estado !== 'listo') throw new Error(estado.estado);
		// Comiendo 2.440 y bajando 0,08 kg/día, el gasto tiene que ser mayor al estimado.
		expect(estado.tdeeMedido).toBeGreaterThan(OBJETIVO.objetivoKcal);
		expect(estado.tdeeMedido).toBeGreaterThan(OBJETIVO.tdeeKcal);
	});

	it('no moverse comiendo el objetivo implica que el mantenimiento era el objetivo', () => {
		// Una serie plana no pasa el umbral de señal, así que se comprueba la aritmética
		// con una pendiente mínima pero limpia: sin ruido, cualquier pendiente es señal.
		const pesos = serie({ dias: 33, kgInicial: 82, kgPorDia: -0.001 });
		const estado = estadoCalibracion(OBJETIVO, pesos, sumarDias('2026-03-01', 32));
		if (estado.estado !== 'listo') throw new Error(estado.estado);
		expect(estado.tdeeMedido).toBeCloseTo(OBJETIVO.objetivoKcal, -2);
	});
});

describe('la corrección', () => {
	it('no toca nada si la adherencia fue baja', () => {
		// Sin observar la ingesta, "no bajaste" y "no comiste el objetivo" son la misma
		// observación. Corregir ahí aleja la estimación de la verdad en cada ciclo.
		expect(calibrar(2890, 2500, 'menos_de_la_mitad')).toBeNull();
	});

	it('mezcla en vez de reemplazar', () => {
		const alta = calibrar(2890, 2600, 'casi_todos')!;
		const media = calibrar(2890, 2600, 'la_mayoria')!;
		// Con adherencia alta se le hace más caso a la balanza, pero nunca el 100 %.
		expect(alta.tdeeNuevo).toBeLessThan(media.tdeeNuevo);
		expect(alta.tdeeNuevo).toBeGreaterThan(2600);
		expect(media.tdeeNuevo).toBeLessThan(2890);
	});

	it('recorta a ±15 % por ciclo y lo dice', () => {
		const absurdo = calibrar(2890, 1000, 'casi_todos')!;
		expect(absurdo.tdeeNuevo).toBe(2460); // 2890 x 0,85
		expect(absurdo.recortado).toBe(true);

		const razonable = calibrar(2890, 2800, 'casi_todos')!;
		expect(razonable.recortado).toBe(false);
	});

	it('informa el delta con signo', () => {
		expect(calibrar(2890, 2600, 'casi_todos')!.deltaKcal).toBeLessThan(0);
		expect(calibrar(2890, 3100, 'casi_todos')!.deltaKcal).toBeGreaterThan(0);
	});

	it('converge sin saltar de golpe', () => {
		// La mezcla es lo que evita que el objetivo pegue un salto el primer mes y otro al
		// revés el siguiente. Llega igual, pero por escalones.
		const uno = calibrar(2890, 2500, 'casi_todos')!.tdeeNuevo;
		expect(uno).toBeGreaterThan(2500);
		expect(uno).toBeLessThan(2890);

		let tdee = 2890;
		for (let i = 0; i < 4; i++) tdee = calibrar(tdee, 2500, 'casi_todos')!.tdeeNuevo;
		expect(tdee).toBe(2500);
	});
});
