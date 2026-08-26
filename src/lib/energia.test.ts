import { describe, expect, it } from 'vitest';
import {
	AJUSTE_MIN,
	calcularMantenimiento,
	calcularObjetivo,
	eerParaPal,
	eerPorCategoria,
	kcalEntrenoSesion,
	kcalPasos,
	macros,
	PESO_MAX_KG,
	proteinaGramos,
	restricciones,
	ritmosDisponibles,
	rmrMifflin,
	topeRitmoBajar,
	type Condicion,
	type Ecuacion,
	type Mantenimiento,
	type PerfilEnergia
} from './energia';

/** Devuelve el mantenimiento o falla el test: evita repetir el `estado !== 'calculado'`. */
function mantenimiento(perfil: PerfilEnergia): Mantenimiento {
	const resultado = calcularMantenimiento(perfil);
	if (resultado.estado !== 'calculado') {
		throw new Error(`perfil inválido: ${resultado.motivo}`);
	}
	return resultado;
}

/**
 * Los cinco perfiles de la revisión, traducidos a las opciones reales de la UI. Son
 * casos fijos a propósito: si un número de acá cambia, cambió el motor, y hay que
 * decidir si el cambio es correcto antes de tocar el test.
 */
const PERFILES: Record<string, PerfilEnergia> = {
	// Principiante de oficina: 32 a, 178 cm, 82 kg, sentado, ~4.000 pasos, 4x60' a ritmo normal.
	A: {
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
	// Intermedia activa: 28 a, 163 cm, 58 kg, trabajo mixto, ~11.000 pasos.
	B: {
		edad: 28,
		alturaCm: 163,
		pesoGramos: 58_000,
		ecuacion: 'femenina',
		ocupacion: 'mixto',
		pasos: 'de10a14k',
		sesionesSemana: 4,
		duracion: 'media',
		densidad: 'normal'
	},
	// Sobrepeso y sedentario: 45 a, 175 cm, 105 kg, ~3.000 pasos, 3 sesiones con descansos largos.
	C: {
		edad: 45,
		alturaCm: 175,
		pesoGramos: 105_000,
		ecuacion: 'masculina',
		ocupacion: 'sentado',
		pasos: 'menos4k',
		sesionesSemana: 3,
		duracion: 'media',
		densidad: 'descansos'
	},
	// Avanzada muy magra: 24 a, 170 cm, 55 kg, trabajo de pie, ~12.000 pasos, 5 sesiones en circuito.
	D: {
		edad: 24,
		alturaCm: 170,
		pesoGramos: 55_000,
		ecuacion: 'femenina',
		ocupacion: 'activo',
		pasos: 'de10a14k',
		sesionesSemana: 5,
		duracion: 'media',
		densidad: 'circuito'
	},
	// Trabajo físico: 38 a, 183 cm, 95 kg, obra, ~14.000 pasos, 4 sesiones en circuito.
	E: {
		edad: 38,
		alturaCm: 183,
		pesoGramos: 95_000,
		ecuacion: 'masculina',
		ocupacion: 'fisico',
		pasos: 'de10a14k',
		sesionesSemana: 4,
		duracion: 'media',
		densidad: 'circuito'
	}
};

describe('mantenimiento de los cinco perfiles', () => {
	const esperado = [
		{ id: 'A', pal: 1.555, categoria: 'poco', tdee: 2890, b68: [2550, 3230], b95: [2220, 3560] },
		{ id: 'B', pal: 1.714, categoria: 'activo', tdee: 2250, b68: [2010, 2490], b95: [1780, 2720] },
		{
			id: 'C',
			pal: 1.473,
			categoria: 'inactivo',
			tdee: 2970,
			b68: [2630, 3310],
			b95: [2300, 3640]
		},
		{ id: 'D', pal: 1.818, categoria: 'activo', tdee: 2380, b68: [2140, 2620], b95: [1910, 2850] },
		{ id: 'E', pal: 1.934, categoria: 'muy', tdee: 3620, b68: [3280, 3960], b95: [2950, 4290] }
	] as const;

	it.each(esperado)('perfil $id', ({ id, pal, categoria, tdee, b68, b95 }) => {
		const m = mantenimiento(PERFILES[id]!);
		expect(m.pal.valor).toBeCloseTo(pal, 3);
		expect(m.pal.categoria).toBe(categoria);
		expect(m.tdee).toBe(tdee);
		expect(m.banda68).toEqual({ desde: b68[0], hasta: b68[1] });
		expect(m.banda95).toEqual({ desde: b95[0], hasta: b95[1] });
	});

	it('el mantenimiento por kilo varía más del 40 % entre perfiles', () => {
		// Es la razón de ser de todo el módulo: un porcentaje fijo del mantenimiento
		// produce ritmos muy distintos según a quién se le aplique.
		const ratios = Object.values(PERFILES).map((perfil) => {
			const m = mantenimiento(perfil);
			return m.tdee / m.kg;
		});
		expect(Math.min(...ratios)).toBeLessThan(29);
		expect(Math.max(...ratios)).toBeGreaterThan(41);
	});

	it('el contraste con Mifflin no diverge en ningún perfil', () => {
		for (const perfil of Object.values(PERFILES)) {
			const m = mantenimiento(perfil);
			expect(m.avisos).not.toContainEqual(
				expect.objectContaining({ tipo: 'contraste-divergente' })
			);
		}
	});
});

describe('objetivo de los cinco perfiles al ritmo estándar', () => {
	const esperado = [
		{ id: 'A', objetivo: 2440, proteina: 148, kgSemana: -0.409 },
		{ id: 'B', objetivo: 1930, proteina: 104, kgSemana: -0.291 },
		{ id: 'C', objetivo: 2390, proteina: 189, kgSemana: -0.527 },
		{ id: 'D', objetivo: 2080, proteina: 99, kgSemana: -0.273 },
		{ id: 'E', objetivo: 3100, proteina: 171, kgSemana: -0.473 }
	] as const;

	it.each(esperado)('perfil $id', ({ id, objetivo, proteina, kgSemana }) => {
		const m = mantenimiento(PERFILES[id]!);
		const resultado = calcularObjetivo(m, 'bajar', -0.5);
		if (resultado.estado !== 'calculado') throw new Error(resultado.motivo);
		expect(resultado.objetivoKcal).toBe(objetivo);
		expect(resultado.proteinaG).toBe(proteina);
		expect(resultado.kgPorSemana).toBeCloseTo(kgSemana, 2);
		// El ritmo informado es el que produce el objetivo redondeado, no el pedido.
		expect(resultado.ritmoPctSemana).toBeCloseTo(-0.5, 1);
		expect(resultado.avisos).toEqual([]);
	});

	it('el mismo ritmo exige porcentajes muy distintos según el perfil', () => {
		const ajustes = Object.values(PERFILES).map((perfil) => {
			const resultado = calcularObjetivo(mantenimiento(perfil), 'bajar', -0.5);
			return resultado.estado === 'calculado' ? resultado.ajuste : Number.NaN;
		});
		// -12,6 % en la más magra contra -19,5 % en el de sobrepeso, para el mismo -0,5 %/semana.
		expect(Math.max(...ajustes)).toBeGreaterThan(-0.13);
		expect(Math.min(...ajustes)).toBeLessThan(-0.19);
	});
});

describe('interpolación entre categorías', () => {
	const { edad, alturaCm } = PERFILES.A!;
	const kg = 82;

	it('cruzar un corte de categoría no puede mover el resultado como un escalón', () => {
		const antes = eerParaPal('masculina', edad, alturaCm, kg, 1.529);
		const despues = eerParaPal('masculina', edad, alturaCm, kg, 1.531);
		expect(Math.abs(despues - antes)).toBeLessThan(20);
	});

	it('el escalón que evita es de cientos de kcal', () => {
		const porCategoria = eerPorCategoria('masculina', edad, alturaCm, kg);
		expect(porCategoria.poco - porCategoria.inactivo).toBeGreaterThan(200);
	});

	it('es monótona creciente en todo el rango de PAL', () => {
		let anterior = Number.NEGATIVE_INFINITY;
		for (let pal = 1.3; pal <= 2.4; pal += 0.01) {
			const valor = eerParaPal('masculina', edad, alturaCm, kg, pal);
			expect(valor).toBeGreaterThanOrEqual(anterior - 1e-9);
			anterior = valor;
		}
	});

	it('no extrapola fuera de las anclas', () => {
		const porCategoria = eerPorCategoria('masculina', edad, alturaCm, kg);
		expect(eerParaPal('masculina', edad, alturaCm, kg, 1.0)).toBeCloseTo(porCategoria.inactivo, 6);
		expect(eerParaPal('masculina', edad, alturaCm, kg, 3.0)).toBeCloseTo(porCategoria.muy, 6);
	});
});

describe('monotonía forzada entre categorías', () => {
	it('la ecuación cruda de NASEM sí se invierte, y por eso hace falta la guarda', () => {
		// Masculina, 18 años, 145 cm, 40 kg: el intercepto negativo de "muy activo"
		// (-517,88) y su coeficiente de altura (15,61) hacen que en gente muy baja y
		// liviana devuelva menos que "activo". Es un artefacto de que cada categoría es
		// una regresión independiente, no un hallazgo fisiológico.
		const activoCrudo = 1004.82 - 10.83 * 18 + 6.52 * 145 + 15.91 * 40;
		const muyCrudo = -517.88 - 10.83 * 18 + 15.61 * 145 + 19.11 * 40;
		expect(muyCrudo).toBeLessThan(activoCrudo);

		const corregido = eerPorCategoria('masculina', 18, 145, 40);
		expect(corregido.muy).toBeGreaterThanOrEqual(corregido.activo);
		expect(corregido.muy).toBeCloseTo(activoCrudo, 6);
	});

	it('nunca decrece, en todo el rango adulto y en las tres ecuaciones', () => {
		const ecuaciones: Ecuacion[] = ['masculina', 'femenina', 'promedio'];
		for (const ecuacion of ecuaciones) {
			for (let edad = 18; edad <= 90; edad += 6) {
				for (let alturaCm = 140; alturaCm <= 210; alturaCm += 10) {
					for (let kg = 40; kg <= 200; kg += 20) {
						const v = eerPorCategoria(ecuacion, edad, alturaCm, kg);
						expect(v.poco).toBeGreaterThanOrEqual(v.inactivo);
						expect(v.activo).toBeGreaterThanOrEqual(v.poco);
						expect(v.muy).toBeGreaterThanOrEqual(v.activo);
						expect(v.inactivo).toBeGreaterThan(800);
					}
				}
			}
		}
	});
});

describe('reglas contra el doble conteo', () => {
	it('el entrenamiento se cuenta con MET menos uno', () => {
		const kg = 82;
		const minutos = 60;
		const neto = kcalEntrenoSesion(4.5, kg, minutos);
		const bruto = ((4.5 * 3.5 * kg) / 200) * minutos;
		// El MET bruto arrastra el metabolismo de reposo, que el RMR ya contó.
		expect(bruto - neto).toBeCloseTo(((1 * 3.5 * kg) / 200) * minutos, 6);
		expect(Math.round(bruto - neto)).toBe(86);
	});

	it('la ocupación trae su base de pasos y solo se suma la diferencia', () => {
		const base: PerfilEnergia = { ...PERFILES.A!, pasos: 'menos4k' };
		// El ancla "sentado" implica 5.000 pasos; 3.000 tiene que restar, no sumar cero.
		expect(mantenimiento(base).pal.componentes.deltaPasos).toBeLessThan(0);
		expect(
			mantenimiento({ ...PERFILES.A!, pasos: 'mas14k' }).pal.componentes.deltaPasos
		).toBeGreaterThan(0);
	});

	it('"no sé" en pasos deja el ancla ocupacional intacta', () => {
		const m = mantenimiento({ ...PERFILES.A!, pasos: 'nose' });
		expect(m.pal.componentes.deltaPasos).toBeCloseTo(0, 12);
		expect(m.pal.valor).toBeCloseTo(1.45 + m.pal.componentes.deltaEntrenamiento, 12);
	});

	it('sin entrenamiento ni cardio el PAL es exactamente el ancla', () => {
		const m = mantenimiento({ ...PERFILES.A!, pasos: 'nose', sesionesSemana: 0 });
		expect(m.pal.valor).toBeCloseTo(1.45, 12);
	});

	it('el PAL se satura y avisa cuando la suma factorial se dispara', () => {
		const m = mantenimiento({
			...PERFILES.E!,
			pasos: 'mas14k',
			sesionesSemana: 14,
			duracion: 'larga',
			densidad: 'circuito',
			cardio: { tipo: 'trotar', minSemana: 600 }
		});
		expect(m.pal.valor).toBe(2.3);
		expect(m.pal.componentes.crudo).toBeGreaterThan(2.3);
		expect(m.avisos).toContainEqual(expect.objectContaining({ tipo: 'pal-fuera-de-rango' }));
	});
});

describe('ritmos disponibles', () => {
	it('el tope depende del IMC', () => {
		expect(topeRitmoBajar(19)).toBe(0.5);
		expect(topeRitmoBajar(22)).toBe(0.7);
		expect(topeRitmoBajar(27)).toBe(0.9);
		expect(topeRitmoBajar(34)).toBe(1);
	});

	it('siempre son los dos niveles, para cualquier IMC', () => {
		for (const imc of [19, 22, 27, 34]) {
			expect(ritmosDisponibles('bajar', imc).map((r) => r.id)).toEqual(['moderado', 'agresivo']);
			expect(ritmosDisponibles('subir', imc).map((r) => r.id)).toEqual(['moderado', 'agresivo']);
		}
	});

	it('el tope por IMC decide la advertencia, no si la opción existe', () => {
		// IMC 19 tolera 0,5 %/semana y el agresivo pide 0,75: la advertencia sube de tono.
		expect(ritmosDisponibles('bajar', 19).map((r) => r.aviso)).toEqual([null, 'sobre-tope-imc']);
		// IMC 34 tolera 1,0 %/semana: el agresivo entra, pero un déficit rápido siempre
		// cuesta algo de masa magra y eso se dice igual.
		expect(ritmosDisponibles('bajar', 34).map((r) => r.aviso)).toEqual([
			null,
			'musculo-y-rendimiento'
		]);
	});

	it('el volumen agresivo siempre avisa que lo que sobra es grasa', () => {
		for (const imc of [19, 25, 34]) {
			expect(ritmosDisponibles('subir', imc).map((r) => r.aviso)).toEqual([null, 'grasa-de-mas']);
		}
	});

	it('bajo IMC 18,5 no hay ninguna opción de déficit', () => {
		expect(ritmosDisponibles('bajar', 17.9)).toEqual([]);
	});

	it('no existe una categoría de volumen agresivo por encima de 0,5 %/semana', () => {
		for (const imc of [18, 19, 22, 28, 35]) {
			for (const opcion of ritmosDisponibles('subir', imc)) {
				expect(opcion.pctSemana).toBeLessThanOrEqual(0.5);
			}
		}
	});

	it('la predeterminada siempre es la moderada', () => {
		for (const imc of [19, 22, 27, 34]) {
			for (const meta of ['bajar', 'subir'] as const) {
				const opciones = ritmosDisponibles(meta, imc);
				expect(opciones.filter((o) => o.predeterminada)).toHaveLength(1);
				expect(opciones.find((o) => o.predeterminada)?.id).toBe('moderado');
			}
		}
	});

	it('mantener no ofrece ritmos', () => {
		expect(ritmosDisponibles('mantener', 25)).toEqual([]);
	});
});

describe('qué se le ofrece a cada persona', () => {
	it('sin nada declarado se ofrecen las tres metas', () => {
		expect(restricciones(25)).toEqual({
			metas: ['bajar', 'mantener', 'subir'],
			consultar: false,
			motivo: null
		});
	});

	it('bajo IMC 18,5 el déficit no aparece', () => {
		expect(restricciones(17.9).metas).toEqual(['mantener', 'subir']);
		expect(restricciones(17.9).motivo).toBe('imc-bajo');
	});

	it('en embarazo o lactancia solo queda mantenimiento', () => {
		const r = restricciones(24, ['embarazo']);
		expect(r.metas).toEqual(['mantener']);
		expect(r.consultar).toBe(true);
		expect(r.motivo).toBe('embarazo');
	});

	it('con historial de trastorno alimentario se retira el déficit', () => {
		const r = restricciones(24, ['trastorno-alimentario']);
		expect(r.metas).not.toContain('bajar');
		expect(r.metas).toEqual(['mantener', 'subir']);
		expect(r.consultar).toBe(true);
	});

	it('el embarazo manda sobre el resto de lo declarado', () => {
		expect(restricciones(24, ['medica', 'trastorno-alimentario', 'embarazo']).metas).toEqual([
			'mantener'
		]);
	});

	it('una condición médica no recorta metas pero pide consultar', () => {
		const r = restricciones(28, ['medica']);
		expect(r.metas).toEqual(['bajar', 'mantener', 'subir']);
		expect(r.consultar).toBe(true);
		expect(r.motivo).toBeNull();
	});

	it('el mantenimiento nunca se retira: es la salida que siempre queda', () => {
		const casos: Array<[number, Condicion[]]> = [
			[16, []],
			[24, ['embarazo']],
			[24, ['trastorno-alimentario']],
			[40, ['medica']],
			[17, ['trastorno-alimentario', 'medica']]
		];
		for (const [imc, condiciones] of casos) {
			expect(restricciones(imc, condiciones).metas).toContain('mantener');
		}
	});
});

describe('recortes y pisos del objetivo', () => {
	it('respeta el ritmo pedido aunque supere el tope, y avisa', () => {
		// La decisión quedó del lado del usuario: el botón hace lo que dice y la app
		// explica el costo. Los recortes que quedan son de otra naturaleza (ajuste, piso).
		const m = mantenimiento(PERFILES.D!); // IMC 19 -> tope 0,5 %/semana
		const resultado = calcularObjetivo(m, 'bajar', -0.75);
		if (resultado.estado !== 'calculado') throw new Error(resultado.motivo);
		expect(resultado.avisos).toContainEqual({ tipo: 'ritmo-sobre-tope', ritmo: -0.75, tope: -0.5 });
		expect(resultado.ritmoPctSemana).toBeCloseTo(-0.75, 1);
	});

	it('no avisa cuando el ritmo entra en el tope de esa composición', () => {
		const m = mantenimiento(PERFILES.C!); // IMC 34 -> tope 1,0 %/semana
		const resultado = calcularObjetivo(m, 'bajar', -0.75);
		if (resultado.estado !== 'calculado') throw new Error(resultado.motivo);
		expect(resultado.avisos).not.toContainEqual(
			expect.objectContaining({ tipo: 'ritmo-sobre-tope' })
		);
	});

	it('bloquea el déficit bajo IMC 18,5', () => {
		const m = mantenimiento({ ...PERFILES.D!, pesoGramos: 50_000 }); // IMC 17,3
		expect(calcularObjetivo(m, 'bajar', -0.25)).toEqual({
			estado: 'bloqueado',
			motivo: 'imc-bajo'
		});
	});

	it('recorta el ajuste al 25 % aunque el ritmo pedido pida más', () => {
		// Un mantenimiento bajo en relación al peso necesita un porcentaje enorme para
		// un ritmo dado; el recorte numérico es la última red antes del piso.
		const base = mantenimiento(PERFILES.C!);
		const m: Mantenimiento = { ...base, tdee: 2400, rmr: 1200 };
		const resultado = calcularObjetivo(m, 'bajar', -1);
		if (resultado.estado !== 'calculado') throw new Error(resultado.motivo);
		expect(resultado.ajuste).toBeCloseTo(AJUSTE_MIN, 6);
		expect(resultado.objetivoKcal).toBe(1800);
		expect(resultado.avisos).toContainEqual(expect.objectContaining({ tipo: 'ajuste-recortado' }));
	});

	it('el piso de ingesta manda incluso sobre el recorte del 25 %', () => {
		// Los dos recortes son independientes y el orden importa: primero el ajuste,
		// después el piso. Si el RMR queda por encima del -25 %, gana el RMR.
		const base = mantenimiento(PERFILES.C!);
		const m: Mantenimiento = { ...base, tdee: 2000 };
		const resultado = calcularObjetivo(m, 'bajar', -1);
		if (resultado.estado !== 'calculado') throw new Error(resultado.motivo);
		expect(resultado.objetivoKcal).toBe(Math.round(base.rmr));
		expect(resultado.ajuste).toBeGreaterThan(AJUSTE_MIN);
		expect(resultado.avisos).toContainEqual(expect.objectContaining({ tipo: 'ajuste-recortado' }));
		expect(resultado.avisos).toContainEqual(expect.objectContaining({ tipo: 'piso-ingesta' }));
	});

	it('nunca propone comer por debajo del RMR estimado', () => {
		const base = mantenimiento(PERFILES.C!);
		const m: Mantenimiento = { ...base, tdee: 2400, rmr: 2300 };
		const resultado = calcularObjetivo(m, 'bajar', -1);
		if (resultado.estado !== 'calculado') throw new Error(resultado.motivo);
		expect(resultado.objetivoKcal).toBe(2300);
		expect(resultado.avisos).toContainEqual({ tipo: 'piso-ingesta', sinPiso: 1800, piso: 2300 });
	});

	it('avisa —sin bloquear— bajo el umbral de disponibilidad energética', () => {
		// Mujer baja y muy musculosa con mucho volumen de entrenamiento: masa libre de
		// grasa alta y 600 kcal/día de ejercicio empujan el umbral por encima de lo que
		// deja un ritmo rápido. Es justo la población en la que se estudió el umbral.
		const base = mantenimiento(PERFILES.B!);
		const m: Mantenimiento = {
			...base,
			kg: 65,
			imc: 27,
			rmr: 1400,
			tdee: 2600,
			masaLibreDeGrasaKg: 52,
			pal: { ...base.pal, kcalEjercicioDia: 600 }
		};
		const resultado = calcularObjetivo(m, 'bajar', -0.75);
		if (resultado.estado !== 'calculado') throw new Error(resultado.motivo);
		expect(resultado.umbralDisponibilidadKcal).toBe(2160);
		expect(resultado.objetivoKcal).toBe(2060);
		expect(resultado.avisos).toContainEqual({ tipo: 'disponibilidad-energetica', umbral: 2160 });
	});

	it('en los cinco perfiles reales el recorte del 25 % ya deja el objetivo sobre el umbral', () => {
		// Vale documentarlo: el tope numérico hace casi todo el trabajo de seguridad, y
		// el aviso de disponibilidad energética queda para perfiles extremos.
		for (const perfil of Object.values(PERFILES)) {
			const m = mantenimiento(perfil);
			if (m.imc < 18.5) continue;
			const resultado = calcularObjetivo(m, 'bajar', -1);
			if (resultado.estado !== 'calculado') throw new Error(resultado.motivo);
			expect(resultado.objetivoKcal).toBeGreaterThan(resultado.umbralDisponibilidadKcal);
		}
	});
});

describe('mantener y subir', () => {
	it('mantener devuelve el mantenimiento sin tocar', () => {
		const m = mantenimiento(PERFILES.A!);
		const resultado = calcularObjetivo(m, 'mantener', 0);
		if (resultado.estado !== 'calculado') throw new Error(resultado.motivo);
		expect(resultado.objetivoKcal).toBe(m.tdee);
		expect(resultado.ajuste).toBe(0);
		expect(resultado.kgPorSemana).toBe(0);
	});

	it('el volumen estándar de A queda muy lejos del +15/20 % del informe original', () => {
		const m = mantenimiento(PERFILES.A!);
		const resultado = calcularObjetivo(m, 'subir', 0.25);
		if (resultado.estado !== 'calculado') throw new Error(resultado.motivo);
		expect(resultado.ajuste).toBeGreaterThan(0.06);
		expect(resultado.ajuste).toBeLessThan(0.09);
		expect(resultado.kgPorSemana).toBeCloseTo(0.205, 2);
	});

	it('el volumen agresivo existe para cualquiera y da lo que dice', () => {
		const m = mantenimiento(PERFILES.A!); // IMC 25,9
		const resultado = calcularObjetivo(m, 'subir', 0.5);
		if (resultado.estado !== 'calculado') throw new Error(resultado.motivo);
		expect(resultado.ritmoPctSemana).toBeCloseTo(0.5, 1);
		// +15,6 % sobre el mantenimiento: cae justo en la banda del informe original.
		expect(resultado.ajuste).toBeGreaterThan(0.14);
		expect(resultado.ajuste).toBeLessThan(0.17);
	});

	it('la proteína sube en déficit y baja en mantenimiento o volumen', () => {
		// 1,6 g/kg es el punto donde Morton 2018 ve que la curva se aplana; 1,8 en déficit
		// deja a los cinco perfiles dentro de la banda de Helms sin estimar masa magra.
		// Las kcal de estos casos son holgadas: mandan los g/kg, no el techo del AMDR.
		expect(proteinaGramos(82, 'bajar', 2400)).toBe(148);
		expect(proteinaGramos(82, 'mantener', 2800)).toBe(131);
		expect(proteinaGramos(82, 'subir', 3000)).toBe(131);
		// Y nunca depende de la composición corporal: mismo peso, mismo número.
		expect(proteinaGramos(105, 'bajar', 2600)).toBe(189);
	});

	it('el techo del AMDR corta la proteína cuando el peso total deja de servir', () => {
		// 180 kg en déficit pedirían 324 g por la regla de g/kg. Sobre 2.440 kcal eso es
		// el 53 % de la ingesta y deja los carbos en 0,46 g/kg: el peso total dejó de ser
		// un denominador útil. El 35 % del AMDR lo corta sin estimar masa magra.
		expect(1.8 * 180).toBeGreaterThan((2440 * 0.35) / 4);
		expect(proteinaGramos(180, 'bajar', 2440)).toBe(214);
		// Y no toca el caso normal: 148 g sobre 2.400 kcal son el 25 %, muy por debajo.
		expect(proteinaGramos(82, 'bajar', 2400)).toBe(148);
	});
});

describe('macros', () => {
	it('reparte los tres macros y la suma cierra contra el objetivo', () => {
		const { proteinaG, grasaG, carbosG } = macros(80, 2390, 'bajar');
		expect(proteinaG).toBe(144);
		expect(grasaG).toBe(66); // 25 % de 2.390 / 9
		expect(carbosG).toBe(305);
		// Cierra salvo el redondeo a gramo entero de cada macro.
		expect(Math.abs(proteinaG * 4 + grasaG * 9 + carbosG * 4 - 2390)).toBeLessThanOrEqual(5);
	});

	it('el piso de grasa manda cuando el 25 % se queda corto en gramos', () => {
		// 150 kg con 2.660 kcal: el 25 % son 73,9 g, menos que los 0,5 g/kg = 75 g.
		expect(macros(150, 2660, 'bajar').grasaG).toBe(75);
		// Con la misma ingesta y la mitad del peso manda el porcentaje, no el piso.
		expect(macros(75, 2660, 'bajar').grasaG).toBe(74);
	});

	it('los carbos nunca salen negativos', () => {
		// Ingesta mínima con peso máximo: el reparto queda apretado, no roto.
		const { carbosG } = macros(PESO_MAX_KG, 1200, 'bajar');
		expect(carbosG).toBeGreaterThanOrEqual(0);
	});

	it('la proteína del reparto es la misma que la del objetivo guardado', () => {
		// Las dos salen de proteinaGramos con las mismas kcal. Si divergen, la sección
		// muestra un número y la fila guardada otro.
		const mantenimiento = calcularMantenimiento(PERFILES.A!);
		if (mantenimiento.estado !== 'calculado') throw new Error('perfil de referencia inválido');
		const objetivo = calcularObjetivo(mantenimiento, 'bajar', -0.5);
		if (objetivo.estado !== 'calculado') throw new Error('objetivo de referencia inválido');
		expect(macros(mantenimiento.kg, objetivo.objetivoKcal, 'bajar').proteinaG).toBe(
			objetivo.proteinaG
		);
	});
});

describe('validación de entrada', () => {
	it('rechaza a menores de edad con un motivo propio', () => {
		expect(calcularMantenimiento({ ...PERFILES.A!, edad: 17 })).toEqual({
			estado: 'invalido',
			motivo: 'menor-de-edad'
		});
	});

	it.each([
		['edad', { edad: 91 }],
		['altura', { alturaCm: 129 }],
		['altura', { alturaCm: 221 }],
		['peso', { pesoGramos: 34_000 }],
		['peso', { pesoGramos: 251_000 }],
		['sesiones', { sesionesSemana: 15 }],
		['sesiones', { sesionesSemana: -1 }],
		['edad', { edad: Number.NaN }]
	])('rechaza fuera de rango: %s', (motivo, parche) => {
		expect(calcularMantenimiento({ ...PERFILES.A!, ...parche })).toEqual({
			estado: 'invalido',
			motivo
		});
	});

	it('rechaza cardio con minutos imposibles', () => {
		expect(
			calcularMantenimiento({ ...PERFILES.A!, cardio: { tipo: 'bici', minSemana: 1_001 } })
		).toEqual({ estado: 'invalido', motivo: 'cardio' });
	});
});

describe('piezas sueltas', () => {
	it('Mifflin–St Jeor reproduce los valores publicados', () => {
		expect(rmrMifflin('masculina', 32, 178, 82)).toBeCloseTo(1777.5, 1);
		expect(rmrMifflin('femenina', 28, 163, 58)).toBeCloseTo(1297.75, 2);
		// La variante "promedio" es exactamente el punto medio de las otras dos.
		expect(rmrMifflin('promedio', 32, 178, 82)).toBeCloseTo(
			(rmrMifflin('masculina', 32, 178, 82) + rmrMifflin('femenina', 32, 178, 82)) / 2,
			6
		);
	});

	it('los pasos valen unas 0,5 kcal por kilo y por kilómetro', () => {
		// 10.000 pasos x 0,7 m = 7 km; en 80 kg son ~280 kcal netas.
		expect(kcalPasos(10_000, 80)).toBeCloseTo(280, 6);
		// La diferencia entre los extremos de las bandas es del orden de un SEPV entero.
		expect(kcalPasos(16_000, 80) - kcalPasos(3_000, 80)).toBeGreaterThan(300);
	});

	it('la banda del 68 % es más angosta que la del 95 %, y ambas están declaradas', () => {
		const m = mantenimiento(PERFILES.A!);
		expect(m.sepv).toBe(342);
		expect(m.banda68.hasta - m.banda68.desde).toBeLessThan(m.banda95.hasta - m.banda95.desde);
		expect(m.banda95.hasta - m.banda95.desde).toBeGreaterThan(1_300);
	});

	it('la ecuación promedio cae entre la masculina y la femenina', () => {
		const comun = { ...PERFILES.A!, ecuacion: 'promedio' as const };
		const promedio = mantenimiento(comun).tdee;
		const masculina = mantenimiento({ ...comun, ecuacion: 'masculina' }).tdee;
		const femenina = mantenimiento({ ...comun, ecuacion: 'femenina' }).tdee;
		expect(promedio).toBeLessThan(masculina);
		expect(promedio).toBeGreaterThan(femenina);
	});
});
