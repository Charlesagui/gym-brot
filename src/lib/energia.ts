/**
 * Cálculo puro de mantenimiento energético y objetivo calórico.
 *
 * Tres capas, y cada una hace una sola cosa:
 *
 *   1. Un PAL factorial explícito (ocupación + pasos + entrenamiento). Solo se usa
 *      para *clasificar*, nunca para producir la cifra: es una decisión de cuatro
 *      valores y por eso resiste el error de sus componentes.
 *   2. Las ecuaciones NASEM 2023, interpoladas entre categorías. La magnitud sale
 *      siempre de acá, que es la única fuente con incertidumbre individual publicada
 *      (SEPV 342 kcal/d en hombres, 241 en mujeres).
 *   3. El objetivo, derivado de un *ritmo* de cambio de peso y no de un porcentaje.
 *      Un porcentaje fijo del mantenimiento produce ritmos que varían más del doble
 *      entre personas, porque el mantenimiento por kilo va de ~27 a ~42 kcal.
 *
 * NASEM aclara que sus ecuaciones estiman el mantenimiento de peso y *no* predicen
 * requerimientos de quien busca perder o ganar. Restarle un porcentaje es una capa
 * de producto, no NASEM, y por eso todo lo que sale de acá viaja con su banda.
 *
 * Sin Dexie y sin efectos: todo lo que persiste vive en perfil-energia.ts.
 */

export type Ecuacion = 'masculina' | 'femenina' | 'promedio';
export type Ocupacion = 'sentado' | 'mixto' | 'activo' | 'fisico';
export type BandaPasos = 'menos4k' | 'de4a7k' | 'de7a10k' | 'de10a14k' | 'mas14k' | 'nose';
export type Duracion = 'corta' | 'media' | 'larga';
export type Densidad = 'descansos' | 'normal' | 'circuito';
export type TipoCardio = 'trotar' | 'bici';
export type Meta = 'bajar' | 'mantener' | 'subir';
export type CategoriaPal = 'inactivo' | 'poco' | 'activo' | 'muy';

export interface PerfilEnergia {
	edad: number;
	alturaCm: number;
	/** Canónico como el resto de la app: gramos enteros. */
	pesoGramos: number;
	ecuacion: Ecuacion;
	ocupacion: Ocupacion;
	pasos: BandaPasos;
	sesionesSemana: number;
	duracion: Duracion;
	densidad: Densidad;
	cardio?: { tipo: TipoCardio; minSemana: number };
}

/**
 * Los valores válidos de cada unión, en runtime. Existen porque el import de un backup
 * tiene que rechazar lo que el motor no sabe interpretar: un `ocupacion` desconocido no
 * es un dato raro que se muestra tal cual, es un `undefined` que revienta `estimarPal`.
 */
export const ECUACIONES: readonly Ecuacion[] = ['masculina', 'femenina', 'promedio'];
export const OCUPACIONES_VALIDAS: readonly Ocupacion[] = ['sentado', 'mixto', 'activo', 'fisico'];
export const PASOS_VALIDOS: readonly BandaPasos[] = [
	'menos4k',
	'de4a7k',
	'de7a10k',
	'de10a14k',
	'mas14k',
	'nose'
];
export const DURACIONES_VALIDAS: readonly Duracion[] = ['corta', 'media', 'larga'];
export const DENSIDADES_VALIDAS: readonly Densidad[] = ['descansos', 'normal', 'circuito'];
export const METAS_VALIDAS: readonly Meta[] = ['bajar', 'mantener', 'subir'];
export const NIVELES_VALIDOS: readonly NivelRitmo[] = ['moderado', 'agresivo'];
export const CATEGORIAS_VALIDAS: readonly CategoriaPal[] = ['inactivo', 'poco', 'activo', 'muy'];

export const EDAD_MIN = 18;
export const EDAD_MAX = 90;
export const ALTURA_MIN_CM = 130;
export const ALTURA_MAX_CM = 220;
export const PESO_MIN_KG = 35;
export const PESO_MAX_KG = 250;
export const SESIONES_MAX_SEMANA = 14;
export const CARDIO_MAX_MIN_SEMANA = 1_000;

/**
 * Coste neto de caminar en llano. La ecuación de marcha del ACSM da un VO₂ neto de
 * 0,1 ml/kg por metro; a 5 kcal por litro de O₂ eso son 0,5 kcal/kg/km. "Neto" es la
 * palabra importante: ya descuenta el metabolismo de reposo, que el RMR cuenta aparte.
 */
const KCAL_POR_KG_POR_METRO = 0.0005;
/** Zancada media adulta. Heurística declarada: mueve el resultado poco y linealmente. */
const ZANCADA_M = 0.7;

/**
 * Anclas de PAL por ocupación (FAO/WHO/UNU 2004) con la base de pasos que cada una
 * ya trae incorporada. Solo se suma la *diferencia* contra esa base, con signo: un
 * oficinista con 3.000 pasos resta. Es la regla 4 contra el doble conteo.
 */
const OCUPACIONES: Record<Ocupacion, { pal: number; pasosBase: number }> = {
	sentado: { pal: 1.45, pasosBase: 5_000 },
	mixto: { pal: 1.55, pasosBase: 7_500 },
	activo: { pal: 1.65, pasosBase: 10_000 },
	fisico: { pal: 1.8, pasosBase: 12_000 }
};

/** Punto representativo de cada banda. `nose` usa la base de la ocupación. */
const PASOS_BANDA: Record<Exclude<BandaPasos, 'nose'>, number> = {
	menos4k: 3_000,
	de4a7k: 5_500,
	de7a10k: 8_500,
	de10a14k: 12_000,
	mas14k: 16_000
};

const MINUTOS_SESION: Record<Duracion, number> = { corta: 35, media: 60, larga: 85 };

/**
 * MET por densidad, no por "intensidad". Zanuso 2016 midió el gasto de entrenamientos
 * al 60 % y al 80 % de 1RM y no encontró diferencia: lo que mueve el MET es cuánto
 * tiempo estás en movimiento, no cuánto pesa la barra.
 */
const MET_DENSIDAD: Record<Densidad, number> = { descansos: 3.5, normal: 4.5, circuito: 5.5 };

/**
 * No hay pregunta de cardio: son cuatro pantallas y esta era la quinta. La consecuencia
 * es concreta y conviene tenerla escrita: quien corre tres veces por semana recibe una
 * estimación baja, del orden de 150–250 kcal/día. La calibración contra el peso real lo
 * corrige entero, porque no le importa de dónde salió el gasto.
 */

/**
 * Caminar queda deliberadamente afuera: la pregunta de pasos ya lo cuenta, y ofrecerlo
 * acá sería la forma más fácil de contar dos veces la misma caminata (regla 3).
 */
const MET_CARDIO: Record<TipoCardio, number> = { trotar: 7, bici: 6 };

export const PAL_MIN = 1.35;
export const PAL_MAX = 2.3;

/**
 * Cortes de categoría de NASEM 2023, verbatim de los pies de las tablas 7-9, 7-10,
 * 7-13 y 7-14: «inactive: 1.0 ≤ PAL < 1.53; low active: 1.53 ≤ PAL < 1.69; active:
 * 1.69 ≤ PAL < 1.85; very active: 1.85 ≤ PAL < 2.5».
 *
 * Los números son raros porque no son redondos por diseño: NASEM definió las categorías
 * de adultos por los **percentiles 25, 50 y 75** de la base de agua doblemente marcada
 * (19–70 años), no por los cortes de convención. Por eso son distintos de los de la
 * edición 2005 (1,4 / 1,6 / 1,9), que sí eran redondos, y por eso no hay que
 * "corregirlos" a esos: cambiarlos mueve el mantenimiento de todo el mundo.
 */
const CORTES_PAL: Array<{ hasta: number; categoria: CategoriaPal }> = [
	{ hasta: 1.53, categoria: 'inactivo' },
	{ hasta: 1.69, categoria: 'poco' },
	{ hasta: 1.85, categoria: 'activo' },
	{ hasta: Number.POSITIVE_INFINITY, categoria: 'muy' }
];

/**
 * Punto medio aproximado de cada banda de PAL, usado para interpolar. Sin esto el
 * resultado es escalonado y cruzar un corte mueve entre 136 y 506 kcal: mil pasos de
 * diferencia no pueden cambiar el objetivo de alguien en medio plato de comida.
 */
const ANCLAS_INTERPOLACION: Array<{ pal: number; categoria: CategoriaPal }> = [
	{ pal: 1.4, categoria: 'inactivo' },
	{ pal: 1.6, categoria: 'poco' },
	{ pal: 1.77, categoria: 'activo' },
	{ pal: 2.0, categoria: 'muy' }
];

type EcuacionNasem = (edad: number, alturaCm: number, kg: number) => number;

/** NASEM 2023, adultos de 19 años en adelante. Tabla 5-16 del informe. */
const NASEM: Record<'masculina' | 'femenina', Record<CategoriaPal, EcuacionNasem>> = {
	masculina: {
		inactivo: (e, a, k) => 753.07 - 10.83 * e + 6.5 * a + 14.1 * k,
		poco: (e, a, k) => 581.47 - 10.83 * e + 8.3 * a + 14.94 * k,
		activo: (e, a, k) => 1004.82 - 10.83 * e + 6.52 * a + 15.91 * k,
		muy: (e, a, k) => -517.88 - 10.83 * e + 15.61 * a + 19.11 * k
	},
	femenina: {
		inactivo: (e, a, k) => 584.9 - 7.01 * e + 5.72 * a + 11.71 * k,
		poco: (e, a, k) => 575.77 - 7.01 * e + 6.6 * a + 12.14 * k,
		activo: (e, a, k) => 710.25 - 7.01 * e + 6.54 * a + 12.34 * k,
		muy: (e, a, k) => 511.83 - 7.01 * e + 9.07 * a + 12.56 * k
	}
};

/**
 * Error estándar de predicción publicado por NASEM. ~68 % de las personas con un
 * perfil dado caen dentro de 1 SEPV y ~95 % dentro de 1,96. El de `promedio` es la
 * media de los dos: heurística, no un valor publicado.
 */
export const SEPV: Record<Ecuacion, number> = { masculina: 342, femenina: 241, promedio: 292 };

const CATEGORIAS: CategoriaPal[] = ['inactivo', 'poco', 'activo', 'muy'];

/** Piso clínico de convención, con respaldo débil. Queda como red, no como criterio. */
const PISO_ABSOLUTO: Record<Ecuacion, number> = {
	masculina: 1_500,
	femenina: 1_200,
	promedio: 1_350
};

/** Umbral de baja disponibilidad energética, en kcal por kg de masa libre de grasa. */
export const UMBRAL_DISPONIBILIDAD = 30;

/** El ajuste porcentual nunca sale de acá, pase lo que pase con el ritmo pedido. */
export const AJUSTE_MIN = -0.25;
export const AJUSTE_MAX = 0.2;

/** Energía por kilo de peso corporal. Aproximación de corto plazo; ver calibracion.ts. */
export const KCAL_POR_KG = 7_700;

function limitar(valor: number, minimo: number, maximo: number): number {
	return Math.min(maximo, Math.max(minimo, valor));
}

/** Las cifras que ve el usuario van redondeadas a 10 kcal: a 50 fingirían precisión. */
export function redondearKcal(valor: number): number {
	return Math.round(valor / 10) * 10;
}

/**
 * Las dos bandas de incertidumbre alrededor de un mantenimiento. Se exporta porque la
 * sección las recalcula desde el objetivo guardado, y hacerlo a mano en cada pantalla
 * es la forma más fácil de que una diga 68 % donde la otra dice 95 %.
 */
export function bandas(tdee: number, sepv: number) {
	return {
		banda68: { desde: redondearKcal(tdee - sepv), hasta: redondearKcal(tdee + sepv) },
		banda95: { desde: redondearKcal(tdee - 1.96 * sepv), hasta: redondearKcal(tdee + 1.96 * sepv) }
	};
}

/** Mifflin–St Jeor (1990). Es la más fiable de las de RMR en población general. */
export function rmrMifflin(ecuacion: Ecuacion, edad: number, alturaCm: number, kg: number): number {
	const base = 10 * kg + 6.25 * alturaCm - 5 * edad;
	if (ecuacion === 'masculina') return base + 5;
	if (ecuacion === 'femenina') return base - 161;
	return base - 78;
}

/** Coste neto diario de una cantidad de pasos, en kcal. */
export function kcalPasos(pasos: number, kg: number): number {
	return pasos * ZANCADA_M * KCAL_POR_KG_POR_METRO * kg;
}

/**
 * Coste neto de una sesión, en kcal. El `MET - 1` es la regla 2 contra el doble
 * conteo: el MET bruto incluye el metabolismo de reposo, que el RMR ya contó.
 */
export function kcalEntrenoSesion(met: number, kg: number, minutos: number): number {
	return (((met - 1) * 3.5 * kg) / 200) * minutos;
}

export function categoriaDePal(pal: number): CategoriaPal {
	return CORTES_PAL.find((corte) => pal < corte.hasta)!.categoria;
}

/**
 * Los cuatro valores de NASEM para una antropometría, con la monotonía forzada.
 *
 * Hace falta forzarla: en cerca del 0,7 % de las antropometrías del rango adulto la
 * ecuación masculina de "muy activo" devuelve *menos* que la de "activo" (el peor caso
 * medido son 77 kcal, en gente muy baja y muy liviana). Es un artefacto de que cada
 * categoría es una regresión independiente, con su propio intercepto. Mostrar que
 * moverse más consume menos sería un error visible.
 */
export function eerPorCategoria(
	ecuacion: Ecuacion,
	edad: number,
	alturaCm: number,
	kg: number
): Record<CategoriaPal, number> {
	const crudo = (variante: 'masculina' | 'femenina') =>
		CATEGORIAS.map((categoria) => NASEM[variante][categoria](edad, alturaCm, kg));
	const valores =
		ecuacion === 'promedio'
			? crudo('masculina').map((valor, indice) => (valor + crudo('femenina')[indice]!) / 2)
			: crudo(ecuacion);

	const resultado = {} as Record<CategoriaPal, number>;
	let piso = Number.NEGATIVE_INFINITY;
	CATEGORIAS.forEach((categoria, indice) => {
		piso = Math.max(piso, valores[indice]!);
		resultado[categoria] = piso;
	});
	return resultado;
}

/** Interpola entre las dos categorías vecinas. Fuera de las anclas no extrapola. */
function eerInterpolado(porCategoria: Record<CategoriaPal, number>, pal: number): number {
	const primera = ANCLAS_INTERPOLACION[0]!;
	const ultima = ANCLAS_INTERPOLACION[ANCLAS_INTERPOLACION.length - 1]!;
	const p = limitar(pal, primera.pal, ultima.pal);
	for (let i = 0; i < ANCLAS_INTERPOLACION.length - 1; i++) {
		const desde = ANCLAS_INTERPOLACION[i]!;
		const hasta = ANCLAS_INTERPOLACION[i + 1]!;
		if (p <= hasta.pal) {
			const t = (p - desde.pal) / (hasta.pal - desde.pal);
			return porCategoria[desde.categoria] * (1 - t) + porCategoria[hasta.categoria] * t;
		}
	}
	// Inalcanzable: el recorte previo garantiza que el bucle sale por el `return` de
	// adentro. Está para que TypeScript vea un retorno en todos los caminos.
	return porCategoria[ultima.categoria];
}

/**
 * El EER para un PAL arbitrario, ya con la monotonía forzada y la interpolación.
 * La UI lo usa para responder "¿y si caminara más?" sin recalcular todo el perfil.
 */
export function eerParaPal(
	ecuacion: Ecuacion,
	edad: number,
	alturaCm: number,
	kg: number,
	pal: number
): number {
	return eerInterpolado(
		eerPorCategoria(ecuacion, edad, alturaCm, kg),
		limitar(pal, PAL_MIN, PAL_MAX)
	);
}

export interface ComponentesPal {
	anclaOcupacion: number;
	deltaPasos: number;
	deltaEntrenamiento: number;
	/** Antes de recortar a [PAL_MIN, PAL_MAX]. */
	crudo: number;
}

export interface Pal {
	valor: number;
	categoria: CategoriaPal;
	componentes: ComponentesPal;
	kcalPasosDia: number;
	kcalEjercicioDia: number;
	kcalEntrenoSesion: number;
}

/**
 * Construye el PAL sumando por partes sobre el ancla ocupacional. Es la ruta factorial,
 * y por eso todo lo que se suma acá es *neto*. Se recorta a [1,35 · 2,30]: por encima
 * NASEM declara que sus ecuaciones no predicen, y la compensación energética (~28 %
 * del gasto extra por actividad, Careau 2021) es razón adicional para no dejar que una
 * suma factorial escale sin techo.
 */
export function estimarPal(perfil: PerfilEnergia): Pal {
	const kg = perfil.pesoGramos / 1000;
	const rmr = rmrMifflin(perfil.ecuacion, perfil.edad, perfil.alturaCm, kg);
	const ocupacion = OCUPACIONES[perfil.ocupacion];
	const pasos = perfil.pasos === 'nose' ? ocupacion.pasosBase : PASOS_BANDA[perfil.pasos];

	const kcalPasosDia = kcalPasos(pasos, kg);
	const deltaPasos = (kcalPasosDia - kcalPasos(ocupacion.pasosBase, kg)) / rmr;

	const porSesion = kcalEntrenoSesion(
		MET_DENSIDAD[perfil.densidad],
		kg,
		MINUTOS_SESION[perfil.duracion]
	);
	const kcalEntrenoDia = (porSesion * perfil.sesionesSemana) / 7;
	const deltaEntrenamiento = kcalEntrenoDia / rmr;

	const crudo = ocupacion.pal + deltaPasos + deltaEntrenamiento;
	const valor = limitar(crudo, PAL_MIN, PAL_MAX);

	return {
		valor,
		categoria: categoriaDePal(valor),
		componentes: {
			anclaOcupacion: ocupacion.pal,
			deltaPasos,
			deltaEntrenamiento,
			crudo
		},
		kcalPasosDia,
		kcalEjercicioDia: kcalEntrenoDia,
		kcalEntrenoSesion: porSesion
	};
}

/**
 * Grasa corporal por Deurenberg (1991), solo para ubicar el umbral de disponibilidad
 * energética. NO se muestra nunca: su error individual es demasiado grande para
 * imprimirlo como un dato del usuario, y acá alcanza con que ordene bien.
 */
function masaLibreDeGrasaKg(ecuacion: Ecuacion, edad: number, imc: number, kg: number): number {
	const sexo = ecuacion === 'masculina' ? 1 : ecuacion === 'femenina' ? 0 : 0.5;
	const grasaPct = 1.2 * imc + 0.23 * edad - 10.8 * sexo - 5.4;
	return kg * (1 - limitar(grasaPct, 5, 60) / 100);
}

export type MotivoInvalido =
	'menor-de-edad' | 'edad' | 'altura' | 'peso' | 'sesiones' | 'cardio' | 'ecuacion';

export interface Mantenimiento {
	estado: 'calculado';
	ecuacion: Ecuacion;
	kg: number;
	imc: number;
	rmr: number;
	pal: Pal;
	/** Redondeado a 10 kcal: todo lo demás se deriva de este número, no del crudo,
	 *  para que la cuenta que ve el usuario cierre si la rehace a mano. */
	tdee: number;
	sepv: number;
	banda68: { desde: number; hasta: number };
	banda95: { desde: number; hasta: number };
	porCategoria: Record<CategoriaPal, number>;
	/** Mifflin × el mismo PAL. Control interno; nunca se muestra como segunda cifra. */
	contrasteMifflin: number;
	masaLibreDeGrasaKg: number;
	avisos: AvisoEnergia[];
}

export type ResultadoMantenimiento = { estado: 'invalido'; motivo: MotivoInvalido } | Mantenimiento;

export type AvisoEnergia =
	| { tipo: 'pal-fuera-de-rango'; pal: number }
	| { tipo: 'contraste-divergente'; nasem: number; mifflin: number }
	| { tipo: 'ritmo-sobre-tope'; ritmo: number; tope: number }
	| { tipo: 'ajuste-recortado'; pedido: number; aplicado: number }
	| { tipo: 'piso-ingesta'; sinPiso: number; piso: number }
	| { tipo: 'disponibilidad-energetica'; umbral: number };

function validar(perfil: PerfilEnergia): MotivoInvalido | null {
	const kg = perfil.pesoGramos / 1000;
	if (!Number.isFinite(perfil.edad)) return 'edad';
	if (perfil.edad < EDAD_MIN) return 'menor-de-edad';
	if (perfil.edad > EDAD_MAX) return 'edad';
	if (
		!Number.isFinite(perfil.alturaCm) ||
		perfil.alturaCm < ALTURA_MIN_CM ||
		perfil.alturaCm > ALTURA_MAX_CM
	)
		return 'altura';
	if (!Number.isFinite(kg) || kg < PESO_MIN_KG || kg > PESO_MAX_KG) return 'peso';
	if (
		!Number.isFinite(perfil.sesionesSemana) ||
		perfil.sesionesSemana < 0 ||
		perfil.sesionesSemana > SESIONES_MAX_SEMANA
	)
		return 'sesiones';
	if (
		perfil.cardio &&
		(!Number.isFinite(perfil.cardio.minSemana) ||
			perfil.cardio.minSemana < 0 ||
			perfil.cardio.minSemana > CARDIO_MAX_MIN_SEMANA)
	)
		return 'cardio';
	if (!(perfil.ecuacion in SEPV)) return 'ecuacion';
	return null;
}

export function calcularMantenimiento(perfil: PerfilEnergia): ResultadoMantenimiento {
	const motivo = validar(perfil);
	if (motivo) return { estado: 'invalido', motivo };

	const kg = perfil.pesoGramos / 1000;
	const imc = kg / (perfil.alturaCm / 100) ** 2;
	const rmr = rmrMifflin(perfil.ecuacion, perfil.edad, perfil.alturaCm, kg);
	const pal = estimarPal(perfil);
	const porCategoria = eerPorCategoria(perfil.ecuacion, perfil.edad, perfil.alturaCm, kg);
	const tdee = redondearKcal(eerInterpolado(porCategoria, pal.valor));
	const sepv = SEPV[perfil.ecuacion];
	const contrasteMifflin = redondearKcal(rmr * pal.valor);

	const avisos: AvisoEnergia[] = [];
	if (pal.componentes.crudo > PAL_MAX)
		avisos.push({ tipo: 'pal-fuera-de-rango', pal: pal.componentes.crudo });
	if (Math.abs(tdee - contrasteMifflin) / tdee > 0.15)
		avisos.push({ tipo: 'contraste-divergente', nasem: tdee, mifflin: contrasteMifflin });

	return {
		estado: 'calculado',
		ecuacion: perfil.ecuacion,
		kg,
		imc,
		rmr,
		pal,
		tdee,
		sepv,
		...bandas(tdee, sepv),
		porCategoria,
		contrasteMifflin,
		masaLibreDeGrasaKg: masaLibreDeGrasaKg(perfil.ecuacion, perfil.edad, imc, kg),
		avisos
	};
}

/**
 * Tope de pérdida semanal según IMC. Cuanto más magra la persona, más conservador:
 * Ruiz-Castellano 2021 lo dice explícitamente, y Garthe 2011 lo mostró con 0,7 % vs
 * 1,4 % semanal (masa magra +2,1 % contra -0,2 %).
 */
export function topeRitmoBajar(imc: number): number {
	if (imc < 20) return 0.5;
	if (imc < 25) return 0.7;
	if (imc < 30) return 0.9;
	return 1;
}

/** Bajo 18,5 la app no propone déficit. No es una advertencia: es una ausencia. */
export const IMC_SIN_DEFICIT = 18.5;

export interface Restricciones {
	/** Las metas que se ofrecen. Las que no están, no aparecen: no se deshabilitan. */
	metas: Meta[];
	/** Qué recortó las metas, para poder decirlo en una línea. */
	motivo: 'imc-bajo' | null;
}

/**
 * Qué se le puede ofrecer a esta persona.
 *
 * Vive en el motor y no en la pantalla a propósito: es la única regla de la app cuyo
 * olvido tiene consecuencias sobre alguien, y una pantalla nueva que no la consulte
 * sería un error silencioso. El criterio es asimétrico por diseño — equivocarse
 * ofreciendo de menos cuesta una molestia; de más, bastante más que eso.
 *
 * **Acá hubo una segunda regla y ya no está.** El asistente preguntaba por embarazo,
 * lactancia y antecedente de trastorno alimentario, y con eso retiraba el déficit o
 * todo. Se sacó por decisión de producto: era la única pregunta que el usuario tenía que
 * contestar sobre sí mismo para que la app no le ofreciera algo, no se guardaba en
 * ninguna parte —así que había que volver a contestarla cada vez— y en una app personal
 * el que la contesta y el que decide son la misma persona.
 *
 * Lo que sigue en pie es lo que no depende de que nadie declare nada: bajo IMC 18,5 no
 * se propone déficit, y el descargo de que esto es una estimación y no una indicación
 * médica está siempre a la vista. Si la app alguna vez sale de un uso personal, esta es
 * la primera decisión para revisar.
 */
export function restricciones(imc: number): Restricciones {
	if (imc < IMC_SIN_DEFICIT) {
		return { metas: ['mantener', 'subir'], motivo: 'imc-bajo' };
	}

	return { metas: ['bajar', 'mantener', 'subir'], motivo: null };
}

export type NivelRitmo = 'moderado' | 'agresivo';

/**
 * Los cinco de siempre. Los nombres son los que la gente ya usa; lo que cambia respecto
 * de una calculadora común es que detrás de cada nombre no hay un porcentaje fijo sino
 * un ritmo, y el porcentaje sale de ahí para cada persona.
 *
 * Dos niveles por dirección y no cuatro: la pantalla son cinco botones, no un menú.
 */
export const RITMOS: Record<'bajar' | 'subir', Record<NivelRitmo, number>> = {
	bajar: { moderado: -0.5, agresivo: -0.75 },
	subir: { moderado: 0.25, agresivo: 0.5 }
};

/** Los cinco rótulos. Viven acá porque los comparten el asistente y la sección. */
export function rotuloObjetivo(meta: Meta, nivel: NivelRitmo | null): string {
	if (meta === 'mantener') return 'Mantenimiento';
	const direccion = meta === 'bajar' ? 'Déficit' : 'Volumen';
	return `${direccion} ${nivel ?? 'a medida'}`;
}

/**
 * Cuánto empuja una opción, que es lo único que el color tiene permitido decir. Tres
 * tonos y no cinco a propósito: déficit agresivo y volumen agresivo comparten el naranja
 * porque comparten la advertencia, no porque sean lo mismo.
 */
export type TonoObjetivo = 'calmo' | 'normal' | 'fuerte';

export interface OpcionObjetivo {
	id: string;
	/**
	 * El nombre corto, para cuando el largo no entra. Una muesca de riel son ~64 px: ahí
	 * "Déficit agresivo" entra partido en dos renglones, pero "Mantenimiento" no entra ni
	 * partido, y por eso el suyo es otra palabra y no un recorte del mismo.
	 *
	 * Antes acá había una marca de dos caracteres (`−−`, `=`, `++`). Se leía como escala y
	 * ocupaba nada, pero no decía qué era cada posición: había que tocarla para saberlo.
	 */
	corto: string;
	meta: Meta;
	nivel: NivelRitmo | null;
}

/**
 * Las cinco posiciones, en el orden de la conversación: bajar, quedarse, subir — que es
 * también el del riel, y por eso se lo puede recorrer con el dedo sin reordenar nada.
 *
 * Viven acá por la misma razón que `rotuloObjetivo`: las comparten el asistente y la
 * sección, y dos copias de esta tabla es la forma más fácil de que una pantalla ofrezca
 * un objetivo que la otra no. El rótulo **no** está en la tabla justamente por eso:
 * `rotuloObjetivo(meta, nivel)` ya lo arma, y escribirlo acá sería la tercera copia.
 *
 * El corto sí, porque no se deduce: "Mantenimiento" no se abrevia solo.
 */
export const OPCIONES_OBJETIVO: readonly OpcionObjetivo[] = [
	{ id: 'bajar-agresivo', corto: 'Déficit agresivo', meta: 'bajar', nivel: 'agresivo' },
	{ id: 'bajar-moderado', corto: 'Déficit moderado', meta: 'bajar', nivel: 'moderado' },
	{ id: 'mantener', corto: 'Mantener', meta: 'mantener', nivel: null },
	{ id: 'subir-moderado', corto: 'Volumen moderado', meta: 'subir', nivel: 'moderado' },
	{ id: 'subir-agresivo', corto: 'Volumen agresivo', meta: 'subir', nivel: 'agresivo' }
];

/** El tono es el nivel: son la misma información y dos copias se despegan. */
export function tonoObjetivo(nivel: NivelRitmo | null): TonoObjetivo {
	if (nivel === null) return 'calmo';
	return nivel === 'moderado' ? 'normal' : 'fuerte';
}

/**
 * El ritmo canónico de una opción, que es el que hay que pasarle a `calcularObjetivo` y
 * el que hay que guardar. Sale de la tabla y no del cálculo: el ritmo que devuelve
 * `calcularObjetivo` puede venir movido por el piso de ingesta, y guardar ése deja al
 * objetivo sin nivel —rotulado "a medida"— aunque se haya tocado uno de los cinco.
 */
export function ritmoDeOpcion(opcion: OpcionObjetivo): number {
	if (opcion.meta === 'mantener' || opcion.nivel === null) return 0;
	return RITMOS[opcion.meta === 'bajar' ? 'bajar' : 'subir'][opcion.nivel];
}

export type MotivoAviso =
	/** El ritmo supera lo que tolera esa composición corporal. El más serio de los tres. */
	| 'sobre-tope-imc'
	/** Todo déficit rápido cuesta algo de masa magra y de rendimiento. */
	| 'musculo-y-rendimiento'
	/** Subir más rápido no compra más músculo, solo más grasa (Helms 2023). */
	| 'grasa-de-mas';

export interface OpcionRitmo {
	id: NivelRitmo;
	/** Porcentaje de peso corporal por semana. Negativo al bajar. */
	pctSemana: number;
	predeterminada: boolean;
	/** Por qué esta opción merece una advertencia, si la merece. */
	aviso: MotivoAviso | null;
}

/**
 * Las dos opciones de cada dirección, siempre. Ninguna se esconde ni se deshabilita: la
 * que no corresponde llega con su advertencia y el usuario decide. La única ausencia real
 * es el déficit bajo IMC 18,5, que no es un ritmo agresivo sino otra cosa.
 *
 * El tope por IMC dejó de filtrar y ahora decide qué advertencia se muestra. Es el mismo
 * número y la misma evidencia; cambió quién toma la decisión.
 */
export function ritmosDisponibles(meta: Meta, imc: number): OpcionRitmo[] {
	if (meta === 'mantener') return [];
	if (meta === 'bajar' && imc < IMC_SIN_DEFICIT) return [];

	const direccion = meta === 'bajar' ? 'bajar' : 'subir';
	const tope = topeRitmoBajar(imc);
	return (['moderado', 'agresivo'] as const).map((id) => {
		const pctSemana = RITMOS[direccion][id];
		let aviso: MotivoAviso | null = null;
		if (id === 'agresivo') {
			if (direccion === 'subir') aviso = 'grasa-de-mas';
			else aviso = Math.abs(pctSemana) > tope ? 'sobre-tope-imc' : 'musculo-y-rendimiento';
		}
		return { id, pctSemana, predeterminada: id === 'moderado', aviso };
	});
}

/**
 * Gramos de proteína por día, como piso.
 *
 * Dos constantes y el peso corporal. Nada más — en particular, **nada de masa libre de
 * grasa**: la app no la mide, solo la estima con Deurenberg, y su error individual es
 * demasiado grande para que de ahí salga un número que alguien va a comprar y comer.
 *
 *   - **1,6 g/kg en balance energético.** No es una elección: Morton et al. 2018
 *     (metaanálisis de 49 estudios, 1.863 personas) encuentra que la curva se aplana en
 *     ~1,62 g/kg/día — por encima de eso no hay más ganancia de masa magra por entrenar.
 *
 *   - **1,8 g/kg en déficit.** La literatura de déficit (Helms 2014) recomienda
 *     2,3–3,1 g/kg de masa *magra*, que es un denominador que no tenemos. Pero al
 *     comprobarlo contra los cinco perfiles de referencia, 1,8 g/kg de peso total cae
 *     dentro de esa banda en los cinco: 2,31 en el más magro y 2,78 en el de más grasa.
 *     La constante hace sola el trabajo, y así el número no depende de una estimación.
 *
 * Antes acá había un 2,0 g/kg, que es el techo de la banda general del ISSN usado como
 * valor por defecto sin razón para estar arriba en vez de abajo.
 *
 * **El techo.** `objetivoKcal` entra para no dejar que la proteína pase del 35 % de la
 * energía, que es el borde superior del AMDR (IOM 2002). Muerde solo arriba de IMC ~37,
 * que es exactamente donde el peso total deja de ser un buen denominador: sin el techo,
 * un perfil de 180 kg pedía 324 g —el 53 % de la ingesta— y dejaba los carbos en
 * 0,46 g/kg. Es el mismo problema que el comentario de arriba evita nombrando masa
 * magra, resuelto sin estimarla: alcanza con la energía, que ya la tenemos medida.
 */
export const PCT_KCAL_PROTEINA_MAX = 0.35;

export function proteinaGramos(kg: number, meta: Meta, objetivoKcal: number): number {
	const porPeso = (meta === 'bajar' ? 1.8 : 1.6) * kg;
	return Math.round(Math.min(porPeso, (objetivoKcal * PCT_KCAL_PROTEINA_MAX) / 4));
}

/**
 * Fracción de las kcal que va a grasa antes de aplicar el piso.
 *
 * 25 % es el único punto que cae a la vez dentro del AMDR general (20–35 % de la
 * energía, IOM 2002) y del rango que la literatura de físico recomienda (10–25 %,
 * Iraki 2019). Abajo de esa banda no hay evidencia de beneficio y sí de incomodidad
 * sostenida; arriba, los carbos que sostienen el entrenamiento empiezan a faltar.
 */
const PCT_KCAL_GRASA = 0.25;

/**
 * Piso de grasa en g/kg de peso corporal. Actúa solo cuando el 25 % de un objetivo
 * bajo se queda corto en gramos: pasa en déficit con peso alto, que es donde la
 * proteína ya se comió media ingesta.
 */
const GRASA_MIN_G_KG = 0.5;

export interface Macros {
	proteinaG: number;
	grasaG: number;
	carbosG: number;
}

/**
 * Los tres macros del objetivo.
 *
 * El orden de resolución no es arbitrario y es la única decisión de diseño que hay acá:
 *
 *   1. **La proteína primero**, porque es la única con un objetivo propio —sostener masa
 *      magra— y la única cuyo número sale de un metaanálisis y no de un reparto.
 *   2. **La grasa después**, como porcentaje de la energía con un piso en g/kg. Como
 *      porcentaje sola se hunde en déficits agresivos; como g/kg sola crece sin razón
 *      en objetivos altos. Las dos reglas juntas se cubren los dos bordes.
 *   3. **Los carbos por diferencia.** No tienen requerimiento esencial y son la palanca
 *      que sostiene el entrenamiento: lo que sobra es exactamente lo que corresponde.
 *
 * Todo se calcula sobre el **peso corporal total**, igual que la proteína y por la misma
 * razón: la app no mide masa libre de grasa y estimarla con Deurenberg para repartir
 * comida sería vender precisión que no existe.
 *
 * Los tres se derivan del objetivo guardado en vez de persistirse. Son función pura de
 * (peso, kcal, meta) —los tres ya están en la fila— y guardarlos sería abrir la puerta
 * a que una fila vieja muestre un reparto que la versión actual ya no haría.
 */
export function macros(kg: number, objetivoKcal: number, meta: Meta): Macros {
	const proteinaG = proteinaGramos(kg, meta, objetivoKcal);
	const grasaG = Math.round(Math.max((objetivoKcal * PCT_KCAL_GRASA) / 9, GRASA_MIN_G_KG * kg));
	// El piso de grasa puede empujar el total por encima del objetivo en casos extremos
	// (peso muy alto con ingesta muy baja). Ahí los carbos son cero, no negativos: un
	// número negativo en pantalla es peor que un reparto apretado.
	const carbosG = Math.max(0, Math.round((objetivoKcal - proteinaG * 4 - grasaG * 9) / 4));
	return { proteinaG, grasaG, carbosG };
}

export interface Objetivo {
	estado: 'calculado';
	meta: Meta;
	/**
	 * Cuál de los cinco botones produjo esto. Viaja como dato y no se deduce después
	 * del ritmo: el ritmo final puede haber cambiado por el piso de ingesta, y entonces
	 * compararlo contra la tabla para recuperar el rótulo devolvería el equivocado.
	 */
	nivel: NivelRitmo | null;
	/** Ritmo efectivamente aplicado, en % de peso por semana. */
	ritmoPctSemana: number;
	kgPorSemana: number;
	/** Ajuste sobre el mantenimiento, como fracción con signo (-0,15 = -15 %). */
	ajuste: number;
	objetivoKcal: number;
	proteinaG: number;
	pisoKcal: number;
	umbralDisponibilidadKcal: number;
	avisos: AvisoEnergia[];
}

export type ResultadoObjetivo =
	{ estado: 'bloqueado'; motivo: 'imc-bajo' | 'sin-ritmos' } | Objetivo;

/**
 * Deriva el objetivo desde un ritmo. La conversión es directa:
 *
 *   factor = (tdee / kg) x 7 / 7700 x 100   -> % de peso/semana por cada 1,0 de ajuste
 *   ajuste = ritmo / factor
 *
 * y después el ajuste se recorta por sanidad numérica y la ingesta por los pisos. Los
 * tres recortes son visibles: si el ritmo pedido no se puede dar, el resultado dice
 * cuál se aplicó en vez de fingir que era el que se pidió.
 */
export function calcularObjetivo(
	mantenimiento: Mantenimiento,
	meta: Meta,
	ritmoPctSemana: number
): ResultadoObjetivo {
	const { kg, tdee, imc, rmr } = mantenimiento;
	const avisos: AvisoEnergia[] = [];

	const umbralDisponibilidadKcal = Math.round(
		UMBRAL_DISPONIBILIDAD * mantenimiento.masaLibreDeGrasaKg + mantenimiento.pal.kcalEjercicioDia
	);

	if (meta === 'mantener') {
		return {
			estado: 'calculado',
			meta,
			nivel: null,
			ritmoPctSemana: 0,
			kgPorSemana: 0,
			ajuste: 0,
			objetivoKcal: tdee,
			proteinaG: proteinaGramos(kg, meta, tdee),
			pisoKcal: Math.max(Math.round(rmr), PISO_ABSOLUTO[mantenimiento.ecuacion]),
			umbralDisponibilidadKcal,
			avisos
		};
	}

	if (meta === 'bajar' && imc < IMC_SIN_DEFICIT) return { estado: 'bloqueado', motivo: 'imc-bajo' };
	const opciones = ritmosDisponibles(meta, imc);
	if (opciones.length === 0) return { estado: 'bloqueado', motivo: 'sin-ritmos' };

	// El ritmo pedido se respeta. El tope por IMC ya no recorta: informa, y la decisión
	// queda del lado del usuario. Lo que sigue recortando son los límites duros de más
	// abajo —el ajuste máximo y el piso de ingesta—, que son de otra naturaleza.
	const ritmo = ritmoPctSemana;
	const tope = topeRitmoBajar(imc);
	if (meta === 'bajar' && Math.abs(ritmo) > tope)
		avisos.push({ tipo: 'ritmo-sobre-tope', ritmo, tope: -tope });

	const factor = ((tdee / kg) * 7 * 100) / KCAL_POR_KG;
	const ajustePedido = ritmo / factor;
	const ajuste = limitar(ajustePedido, AJUSTE_MIN, AJUSTE_MAX);
	if (Math.abs(ajuste - ajustePedido) > 1e-9)
		avisos.push({ tipo: 'ajuste-recortado', pedido: ajustePedido, aplicado: ajuste });

	const sinPiso = redondearKcal(tdee * (1 + ajuste));
	const pisoKcal = Math.max(Math.round(rmr), PISO_ABSOLUTO[mantenimiento.ecuacion]);
	const objetivoKcal = Math.max(sinPiso, pisoKcal);
	if (objetivoKcal !== sinPiso) avisos.push({ tipo: 'piso-ingesta', sinPiso, piso: pisoKcal });
	if (objetivoKcal < umbralDisponibilidadKcal)
		avisos.push({ tipo: 'disponibilidad-energetica', umbral: umbralDisponibilidadKcal });

	// El ritmo que se informa es el que produce el objetivo final, no el que se pidió.
	const ajusteReal = objetivoKcal / tdee - 1;
	const ritmoReal = ajusteReal * factor;

	const direccion = meta === 'bajar' ? 'bajar' : 'subir';
	const nivel =
		(['moderado', 'agresivo'] as const).find(
			(id) => Math.abs(RITMOS[direccion][id] - ritmoPctSemana) < 1e-9
		) ?? null;

	return {
		estado: 'calculado',
		meta,
		nivel,
		ritmoPctSemana: ritmoReal,
		kgPorSemana: (ritmoReal / 100) * kg,
		ajuste: ajusteReal,
		objetivoKcal,
		proteinaG: proteinaGramos(kg, meta, objetivoKcal),
		pisoKcal,
		umbralDisponibilidadKcal,
		avisos
	};
}
