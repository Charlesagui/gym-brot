import type { ObjetivoEnergia } from './db';
import type { EstadoCalibracion } from './calibracion';
import { KG_TO_LB, type UnidadPeso } from './unidades';

/**
 * Qué le dice la sección Cuerpo al usuario, además de la cifra.
 *
 * Son **predicciones, no consejos**. La diferencia importa: una predicción es
 * verificable —«esperá 0,41 kg por semana; si en tres semanas no se movió, el número
 * estaba alto»— y un consejo genérico no dice nada y en un mes es ruido que tapa la
 * cifra. Por eso ninguna frase habla de comida ni da recomendaciones de estilo de vida.
 *
 * Dos reglas que hacen que esto no se convierta en un panfleto:
 *
 *   1. **Cada frase declara qué datos necesita.** Si no están, no aparece. Nunca se
 *      rellena con una versión vaga de lo mismo.
 *   2. **Solo se muestran las primeras.** La lista sale ordenada por prioridad y la
 *      pantalla corta; con una sola cifra en pantalla, tres párrafos la entierran.
 *
 * La trampa que esto evita: las frases que comparan el peso actual contra el congelado
 * en el objetivo mienten si el último pesaje es viejo —«bajaste 3 kg» puede ser de hace
 * seis semanas—. Por eso «hace nueve días que no te pesás» tiene más prioridad y las
 * apaga: la falta de datos no es un estado de error, es lo más útil que se puede decir.
 */

export type TonoFrase = 'neutro' | 'aviso' | 'exito';

export interface Frase {
	/** Estable: sirve de `key` y para no repetir la misma frase en dos lugares. */
	id: string;
	texto: string;
	tono: TonoFrase;
}

export interface DatosFrases {
	objetivo: ObjetivoEnergia | null;
	/** Última medición conocida, en gramos. */
	pesoActualGramos: number | null;
	/** Fecha de esa medición, para saber si todavía se le puede creer. */
	fechaUltimoPeso: string | null;
	/**
	 * Estado de la calibración. Trae adentro su propia ventana —cuántos pesajes y cuántos
	 * días— y por eso ya no se pasan aparte: cuando los contaba la pantalla, contaba sobre
	 * 63 días y los rotulaba con los 56 del tope, al lado de una tarjeta que mostraba el
	 * conteo verdadero. La ventana real arranca en `creadoAt + 7`, así que los dos números
	 * eran distintos y ninguno de los dos era el de la frase.
	 */
	calibracion: EstadoCalibracion | null;
	/** Mantenimiento del objetivo que esta revisión reemplazó, si hubo una. */
	tdeeAnteriorKcal: number | null;
	unidad: UnidadPeso;
	hoy: string;
}

/** Cambio de peso, en porcentaje del congelado, que vuelve viejo al objetivo. */
export const PCT_OBJETIVO_VIEJO = 2;
/** Días sin pesarse a partir de los cuales el peso actual deja de ser un dato. */
export const DIAS_PESO_RANCIO = 7;
/** Días de vida de un objetivo a partir de los cuales conviene rehacerlo. */
export const DIAS_OBJETIVO_VENCIDO = 90;
/** Corrección que amerita explicar por qué la fórmula sola no alcanzaba. */
export const KCAL_CORRECCION_GRANDE = 150;
/** Pesajes en la ventana que ya alcanzan para corregir con confianza. */
export const PESAJES_BUENA_RACHA = 20;

function diasEntre(desde: string, hasta: string): number {
	return Math.round(
		(Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000
	);
}

/** Kilos o libras, con coma decimal y sin signo. */
function peso(kg: number, unidad: UnidadPeso): string {
	const visible = unidad === 'kg' ? Math.abs(kg) : Math.abs(kg) * KG_TO_LB;
	return `${visible.toFixed(visible < 10 ? 2 : 1).replace('.', ',')} ${unidad}`;
}

function meses(dias: number): string {
	const n = Math.floor(dias / 30);
	return n === 1 ? 'un mes' : n < 12 ? `${n} meses` : 'más de un año';
}

/**
 * La frase de la proteína va pegada a su número, no en el flujo: ahí no compite con
 * nada y convierte un dato suelto en una razón.
 */
export function fraseProteina(objetivo: ObjetivoEnergia): string {
	return objetivo.meta === 'bajar'
		? 'Es lo que hace que lo que bajes sea grasa y no músculo.'
		: 'Es el piso para que el entrenamiento se traduzca en algo.';
}

/**
 * Las frases que corresponden hoy, ya ordenadas por prioridad:
 *
 *   1. El objetivo se quedó viejo — es lo único que dice algo que no sabías.
 *   2. La calibración y los datos que le faltan.
 *   3. Qué va a costar.
 *   4. Qué esperar.
 *   5. La incertidumbre.
 */
export function frasesPara(datos: DatosFrases): Frase[] {
	const { objetivo, unidad, hoy } = datos;
	if (!objetivo) return [];

	const salida: Frase[] = [];
	const pesoCongeladoKg = objetivo.perfil.pesoGramos / 1000;
	const diasDesdeUltimoPeso =
		datos.fechaUltimoPeso == null ? null : diasEntre(datos.fechaUltimoPeso, hoy);
	// El peso actual solo cuenta como dato si es reciente. Con un pesaje de hace seis
	// semanas, "bajaste 3 kg" puede ser cierto y estar completamente desactualizado.
	const pesoFresco =
		datos.pesoActualGramos != null &&
		diasDesdeUltimoPeso != null &&
		diasDesdeUltimoPeso <= DIAS_PESO_RANCIO;

	// --- 1. El objetivo se quedó viejo ---
	if (pesoFresco) {
		const deltaKg = datos.pesoActualGramos! / 1000 - pesoCongeladoKg;
		const pct = (Math.abs(deltaKg) / pesoCongeladoKg) * 100;
		if (pct >= PCT_OBJETIVO_VIEJO) {
			salida.push(
				deltaKg < 0
					? {
							id: 'viejo-bajaste',
							tono: 'aviso',
							texto: `Bajaste ${peso(deltaKg, unidad)} desde que calculaste esto. Tu mantenimiento bajó con vos: el número ya te queda alto.`
						}
					: {
							id: 'viejo-subiste',
							tono: 'aviso',
							texto: `Subiste ${peso(deltaKg, unidad)} desde que calculaste esto. El número ya te queda corto.`
						}
			);
		}
	}

	const edadObjetivo = diasEntre(objetivo.creadoAt.slice(0, 10), hoy);
	if (edadObjetivo >= DIAS_OBJETIVO_VENCIDO) {
		salida.push({
			id: 'viejo-tiempo',
			tono: 'aviso',
			texto: `Este objetivo tiene ${meses(edadObjetivo)}. Aunque el peso no se haya movido, conviene rehacerlo.`
		});
	}

	// --- 2. Calibración y los datos que le faltan ---
	if (objetivo.calibradoDe) {
		const correccion =
			datos.tdeeAnteriorKcal == null ? 0 : objetivo.tdeeKcal - datos.tdeeAnteriorKcal;
		if (Math.abs(correccion) >= KCAL_CORRECCION_GRANDE) {
			// Cuando la corrección fue grande, decir *cuánto* vale más que decir que hubo una:
			// es la prueba concreta de por qué la fórmula sola no alcanzaba.
			salida.push({
				id: 'correccion-grande',
				tono: 'exito',
				texto: `Tu mantenimiento real estaba ${Math.abs(correccion)} kcal ${correccion < 0 ? 'por debajo' : 'por encima'} de lo estimado. Por eso la fórmula sola no alcanza.`
			});
		} else {
			salida.push({
				id: 'calibrado',
				tono: 'exito',
				texto: 'Ajustado con tu peso real. Este número ya no sale de una fórmula: sale de vos.'
			});
		}
	}

	if (datos.fechaUltimoPeso == null) {
		salida.push({
			id: 'sin-pesos',
			tono: 'aviso',
			texto: 'Todavía no registraste ningún peso. Es lo único que puede corregir este número.'
		});
	} else if (diasDesdeUltimoPeso != null && diasDesdeUltimoPeso > DIAS_PESO_RANCIO) {
		salida.push({
			id: 'peso-rancio',
			tono: 'aviso',
			texto: `Hace ${diasDesdeUltimoPeso} días que no te pesás. Sin eso, este número no se puede corregir nunca.`
		});
	}

	if (datos.calibracion?.estado === 'sin-senal') {
		salida.push({
			id: 'sin-senal',
			tono: 'neutro',
			texto:
				'Tu peso se movió menos que el ruido de la balanza. No es que no pase nada: es que todavía no se puede distinguir.'
		});
	}

	if (datos.calibracion?.estado === 'pocos-pesajes' && datos.calibracion.ventana.pesajes > 0) {
		salida.push({
			id: 'pocos-pesajes',
			tono: 'neutro',
			texto: `Te pesaste ${datos.calibracion.ventana.pesajes} veces en este período. Con ${datos.calibracion.minimo} puedo decirte si la cuenta era correcta.`
		});
	}

	// Solo cuando hay una ventana de verdad. Mientras el objetivo es joven —estado
	// `esperando`— no hay período que contar, y decir "con eso alcanza para corregir el
	// número" sería falso: todavía no alcanza, falten los pesajes que falten.
	const ventana = datos.calibracion && 'ventana' in datos.calibracion ? datos.calibracion.ventana : null;
	if (ventana && ventana.pesajes >= PESAJES_BUENA_RACHA) {
		salida.push({
			id: 'buena-racha',
			tono: 'exito',
			texto: `Te pesaste ${ventana.pesajes} de los últimos ${ventana.dias} días. Con eso alcanza para corregir el número.`
		});
	}

	// --- 3. Qué va a costar ---
	if (objetivo.meta === 'bajar') {
		salida.push(
			objetivo.nivel === 'agresivo'
				? {
						id: 'costo-deficit-agresivo',
						tono: 'aviso',
						texto:
							'Las últimas series van a costar más. Es parte del trato, no una señal de que estés entrenando mal.'
					}
				: {
						id: 'costo-deficit-moderado',
						tono: 'neutro',
						texto:
							'A este ritmo la fuerza se sostiene. Si empieza a caer, el déficit es más grande de lo que dice el número.'
					}
		);
	}

	if (objetivo.meta === 'subir') {
		if (objetivo.nivel === 'agresivo') {
			salida.push({
				id: 'costo-volumen-agresivo',
				tono: 'aviso',
				texto: 'Parte de lo que subas va a ser grasa. Cuanto más rápido subas, mayor esa parte.'
			});
		}
		salida.push({
			id: 'costo-volumen',
			tono: 'neutro',
			texto:
				'El músculo se gana más lento de lo que la balanza sube. Los dos primeros kilos nunca son todo músculo.'
		});
	}

	// --- 4. Qué esperar ---
	const kgPorSemana = (objetivo.ritmoPctSemana / 100) * pesoCongeladoKg;
	if (objetivo.meta === 'bajar') {
		salida.push({
			id: 'esperar-bajar',
			tono: 'neutro',
			texto: `Esperá bajar unos ${peso(kgPorSemana, unidad)} por semana. Si en tres semanas la balanza no se movió, el número estaba alto, no vos.`
		});
	} else if (objetivo.meta === 'subir') {
		salida.push({
			id: 'esperar-subir',
			tono: 'neutro',
			texto: `Esperá subir unos ${peso(kgPorSemana, unidad)} por semana. Si subís más rápido que eso, lo que sobra es grasa.`
		});
	} else {
		salida.push({
			id: 'esperar-mantener',
			tono: 'neutro',
			texto: `Si en un mes tu peso se movió más de ${peso(1, unidad)} para cualquier lado, esta cuenta no era la tuya.`
		});
	}

	// --- 5. La incertidumbre ---
	salida.push({
		id: 'banda',
		tono: 'neutro',
		texto:
			'La banda es ancha a propósito: la fórmula no te conoce. En cuatro semanas tu peso la va a angostar.'
	});

	return salida;
}
