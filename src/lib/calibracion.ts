import { KCAL_POR_KG, redondearKcal } from './energia';

/**
 * Calibración del objetivo contra el peso real.
 *
 * Es la única parte de todo esto que una calculadora web no puede hacer: usar cuatro
 * semanas de peso ya registrado para reemplazar una estimación con ±670 kcal de
 * incertidumbre por un número que sí es de esta persona.
 *
 * Dos cosas que el módulo se toma en serio, porque son las que hacen honesto el ajuste:
 *
 *   1. **La señal tiene que superar al ruido.** El peso diario varía entre medio kilo y
 *      un kilo por agua, glucógeno y digestión. Con una desviación de 0,7 kg, el error
 *      estándar de la tendencia a 14 días es ±0,33 kg/semana: más grande que la señal
 *      completa de un déficit del 0,5 % en una persona de 55 kg. Por eso la ventana
 *      mínima es de 28 días para bajar y 42 para subir, y aun así se exige que la
 *      pendiente supere 1,5 errores estándar antes de proponer nada.
 *
 *   2. **La adherencia no se observa.** Sin registro de comidas, "no bajaste" tiene dos
 *      causas indistinguibles: la estimación estaba alta, o no se siguió el objetivo.
 *      Por eso la corrección pide una declaración y pesa distinto según la respuesta, y
 *      con adherencia baja no toca el número.
 */

/** Días de ventana mínima antes de proponer una revisión. */
export const DIAS_MIN_BAJAR = 28;
/** La señal de un volumen es unas tres veces menor: hace falta más tiempo. */
export const DIAS_MIN_SUBIR = 42;
/** Se descarta la primera semana: ahí se mueve glucógeno y agua, no grasa. */
export const DIAS_DESCARTE = 7;
/** Con menos mediciones la pendiente es una recta entre dos ruidos. */
export const PESAJES_MIN = 12;
/** Proporción de días de la ventana que tienen que tener medición. */
export const COBERTURA_MIN = 0.4;
/** Cuántos errores estándar tiene que superar la pendiente para ser señal. */
export const UMBRAL_SENAL = 1.5;
/**
 * Tope de la ventana hacia atrás. Un objetivo de hace seis meses no se revisa con la
 * tendencia de hace seis meses: interesa la reciente. Fijarlo acá y no en quien llama
 * hace que cuántos pesajes cargue la pantalla sea una cuestión de rendimiento y no de
 * qué número sale.
 */
export const DIAS_VENTANA_MAX = 56;
/** Tope de corrección por ciclo: una ventana mala no puede volar la estimación. */
export const RECORTE_POR_CICLO = 0.15;

export type Adherencia = 'casi_todos' | 'la_mayoria' | 'menos_de_la_mitad';

/** Cuánto pesa lo medido contra la estimación previa, según lo que declaró el usuario. */
const PESO_ADHERENCIA: Record<Adherencia, number> = {
	casi_todos: 0.7,
	la_mayoria: 0.45,
	menos_de_la_mitad: 0
};

export interface Medicion {
	fecha: string;
	pesoGramos: number;
}

export interface Regresion {
	/** Pendiente en kg por día. Negativa al bajar. */
	pendienteKgDia: number;
	/** Error estándar de la pendiente, en kg por día. */
	errorEstandarKgDia: number;
	n: number;
}

function maximo(a: string, b: string): string {
	return a >= b ? a : b;
}

function diasEntre(desde: string, hasta: string): number {
	const a = Date.parse(`${desde}T12:00:00Z`);
	const b = Date.parse(`${hasta}T12:00:00Z`);
	return Math.round((b - a) / 86_400_000);
}

function sumarDias(fecha: string, dias: number): string {
	const valor = new Date(`${fecha}T12:00:00Z`);
	valor.setUTCDate(valor.getUTCDate() + dias);
	return valor.toISOString().slice(0, 10);
}

/**
 * Mínimos cuadrados sobre (día, kg). Devuelve también el error estándar de la pendiente,
 * que es lo que separa una tendencia de una racha de días con sal.
 */
export function regresionLineal(mediciones: Medicion[]): Regresion | null {
	const n = mediciones.length;
	if (n < 3) return null;
	const base = mediciones[0]!.fecha;
	const puntos = mediciones.map((m) => ({ t: diasEntre(base, m.fecha), y: m.pesoGramos / 1000 }));

	const mediaT = puntos.reduce((s, p) => s + p.t, 0) / n;
	const mediaY = puntos.reduce((s, p) => s + p.y, 0) / n;
	const sxx = puntos.reduce((s, p) => s + (p.t - mediaT) ** 2, 0);
	if (sxx === 0) return null;

	const sxy = puntos.reduce((s, p) => s + (p.t - mediaT) * (p.y - mediaY), 0);
	const pendiente = sxy / sxx;
	const intercepto = mediaY - pendiente * mediaT;
	const sse = puntos.reduce((s, p) => s + (p.y - (intercepto + pendiente * p.t)) ** 2, 0);
	const varianzaResidual = sse / (n - 2);

	return {
		pendienteKgDia: pendiente,
		errorEstandarKgDia: Math.sqrt(varianzaResidual / sxx),
		n
	};
}

export type EstadoCalibracion =
	| { estado: 'esperando'; diasRestantes: number }
	| { estado: 'pocos-pesajes'; pesajes: number; minimo: number }
	| { estado: 'sin-senal'; kgPorSemana: number; errorKgPorSemana: number }
	| {
			estado: 'listo';
			kgPorSemana: number;
			errorKgPorSemana: number;
			cambioKg: number;
			dias: number;
			/** Mantenimiento que se deduce del peso, asumiendo que se siguió el objetivo. */
			tdeeMedido: number;
	  };

export interface ObjetivoVigente {
	creadoAt: string;
	meta: 'bajar' | 'mantener' | 'subir';
	objetivoKcal: number;
	tdeeKcal: number;
}

/**
 * Qué se puede decir hoy sobre un objetivo, mirando solo la serie de peso.
 *
 * Devolver "todavía no puedo distinguir tu tendencia del ruido" es una respuesta válida
 * y visible, no un caso de error: es el estado más frecuente en volumen, y esconderlo
 * detrás de un número inventado destruye lo único valioso de la función.
 */
export function estadoCalibracion(
	objetivo: ObjetivoVigente,
	mediciones: Medicion[],
	hoy: string
): EstadoCalibracion {
	const inicio = objetivo.creadoAt.slice(0, 10);
	const minimo = objetivo.meta === 'subir' ? DIAS_MIN_SUBIR : DIAS_MIN_BAJAR;
	const transcurridos = diasEntre(inicio, hoy);
	if (transcurridos < minimo) {
		return { estado: 'esperando', diasRestantes: minimo - transcurridos };
	}

	const desde = maximo(sumarDias(inicio, DIAS_DESCARTE), sumarDias(hoy, -DIAS_VENTANA_MAX));
	const ventana = mediciones
		.filter((m) => m.fecha >= desde && m.fecha <= hoy)
		.sort((a, b) => a.fecha.localeCompare(b.fecha));
	const diasVentana = diasEntre(desde, hoy) + 1;
	const cobertura = ventana.length / diasVentana;
	if (ventana.length < PESAJES_MIN || cobertura < COBERTURA_MIN) {
		return { estado: 'pocos-pesajes', pesajes: ventana.length, minimo: PESAJES_MIN };
	}

	const ajuste = regresionLineal(ventana);
	if (!ajuste) return { estado: 'pocos-pesajes', pesajes: ventana.length, minimo: PESAJES_MIN };

	const kgPorSemana = ajuste.pendienteKgDia * 7;
	const errorKgPorSemana = ajuste.errorEstandarKgDia * 7;
	if (Math.abs(ajuste.pendienteKgDia) < UMBRAL_SENAL * ajuste.errorEstandarKgDia) {
		return { estado: 'sin-senal', kgPorSemana, errorKgPorSemana };
	}

	const dias = diasEntre(ventana[0]!.fecha, ventana.at(-1)!.fecha);
	const cambioKg = ajuste.pendienteKgDia * dias;
	// El balance implícito: si bajó peso, el gasto era mayor que lo que comió.
	const balance = (cambioKg * KCAL_POR_KG) / dias;

	return {
		estado: 'listo',
		kgPorSemana,
		errorKgPorSemana,
		cambioKg,
		dias,
		tdeeMedido: redondearKcal(objetivo.objetivoKcal - balance)
	};
}

export interface Calibracion {
	tdeeNuevo: number;
	/** Diferencia contra la estimación anterior, con signo. */
	deltaKcal: number;
	recortado: boolean;
}

/**
 * Mezcla lo medido con la estimación previa y recorta el resultado.
 *
 * No reemplaza: mezcla. Cuatro semanas de balanza traen su propio ruido —la báscula, la
 * hora del pesaje, la sal del asado del domingo— y confiar el 100 % en una sola ventana
 * hace que el objetivo salte cada mes. El recorte del ±15 % es la última red.
 */
export function calibrar(
	tdeeActual: number,
	tdeeMedido: number,
	adherencia: Adherencia
): Calibracion | null {
	const peso = PESO_ADHERENCIA[adherencia];
	if (peso === 0) return null;

	const mezclado = peso * tdeeMedido + (1 - peso) * tdeeActual;
	const minimo = tdeeActual * (1 - RECORTE_POR_CICLO);
	const maximo = tdeeActual * (1 + RECORTE_POR_CICLO);
	const recortado = mezclado < minimo || mezclado > maximo;
	const tdeeNuevo = redondearKcal(Math.min(maximo, Math.max(minimo, mezclado)));

	return { tdeeNuevo, deltaKcal: tdeeNuevo - tdeeActual, recortado };
}
