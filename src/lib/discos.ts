/**
 * Cálculo puro de discos para una barra simétrica. La UI trabaja en la unidad
 * visible (kg o lb); escalar a centésimas evita que 1,25 y 2,5 acumulen error de
 * punto flotante mientras buscamos combinaciones.
 */

export interface DiscoContado {
	peso: number;
	cantidad: number;
}

export interface CargaBarra {
	/** Peso total armado: barra + ambos lados. */
	total: number;
	/** Suma de discos en un solo lado. */
	porLado: number;
	/** Cantidades para un solo lado, ordenadas de mayor a menor. */
	discos: DiscoContado[];
}

export type ResultadoDiscos =
	| { estado: 'invalido' }
	| { estado: 'barra-supera'; objetivo: number; barra: number }
	| {
			estado: 'calculado';
			objetivo: number;
			barra: number;
			exacta: CargaBarra | null;
			inferior: CargaBarra | null;
			superior: CargaBarra | null;
	  };

const ESCALA = 100;
const MAX_TOTAL = 2_000;

function entero(valor: number): number {
	return Math.round(valor * ESCALA);
}

function visible(valor: number): number {
	return Math.round(valor) / ESCALA;
}

function reconstruir(
	porLado: number,
	barra: number,
	discos: number[],
	anterior: Int32Array,
	ultimoDisco: Int16Array
): CargaBarra {
	const cantidades = new Map<number, number>();
	let cursor = porLado;
	while (cursor > 0) {
		const indice = ultimoDisco[cursor];
		if (indice < 0) break;
		const peso = discos[indice]!;
		cantidades.set(peso, (cantidades.get(peso) ?? 0) + 1);
		cursor = anterior[cursor];
	}

	return {
		total: visible(barra + porLado * 2),
		porLado: visible(porLado),
		discos: [...cantidades.entries()]
			.sort(([a], [b]) => b - a)
			.map(([peso, cantidad]) => ({ peso: visible(peso), cantidad }))
	};
}

/**
 * Devuelve la carga exacta o las opciones alcanzables inmediatamente inferior
 * y superior. Se minimiza la cantidad de discos por lado y, ante empate, se
 * prefieren primero los discos grandes.
 */
export function calcularDiscos(
	objetivo: number,
	barra: number,
	tamanosDisponibles: number[]
): ResultadoDiscos {
	// La barra puede pesar 0: en una máquina de discos, un landmine o un pin de carga no
	// hay barra que sumar y el total es sólo lo que cuelga de los dos lados.
	if (
		!Number.isFinite(objetivo) ||
		!Number.isFinite(barra) ||
		objetivo <= 0 ||
		barra < 0 ||
		objetivo > MAX_TOTAL ||
		barra > MAX_TOTAL
	) {
		return { estado: 'invalido' };
	}

	const objetivoInt = entero(objetivo);
	const barraInt = entero(barra);
	if (barraInt > objetivoInt) {
		return { estado: 'barra-supera', objetivo: visible(objetivoInt), barra: visible(barraInt) };
	}

	const discos = [
		...new Set(
			tamanosDisponibles
				.filter((peso) => Number.isFinite(peso) && peso > 0)
				.map(entero)
				.filter((peso) => peso > 0)
		)
	].sort((a, b) => b - a);

	const requeridoPorLado = (objetivoInt - barraInt) / 2;
	if (requeridoPorLado === 0) {
		const soloBarra: CargaBarra = { total: visible(barraInt), porLado: 0, discos: [] };
		return {
			estado: 'calculado',
			objetivo: visible(objetivoInt),
			barra: visible(barraInt),
			exacta: soloBarra,
			inferior: soloBarra,
			superior: soloBarra
		};
	}

	if (discos.length === 0) {
		const soloBarra: CargaBarra = { total: visible(barraInt), porLado: 0, discos: [] };
		return {
			estado: 'calculado',
			objetivo: visible(objetivoInt),
			barra: visible(barraInt),
			exacta: null,
			inferior: soloBarra,
			superior: null
		};
	}

	// Un disco adicional del mayor tamaño alcanza para encontrar la próxima
	// combinación superior en cualquier sistema de discos razonable.
	const limite = Math.ceil(requeridoPorLado) + discos[0]!;
	const infinito = 0x3fffffff;
	const cantidad = new Int32Array(limite + 1);
	const anterior = new Int32Array(limite + 1);
	const ultimoDisco = new Int16Array(limite + 1);
	cantidad.fill(infinito);
	anterior.fill(-1);
	ultimoDisco.fill(-1);
	cantidad[0] = 0;

	for (let suma = 1; suma <= limite; suma++) {
		for (let indice = 0; indice < discos.length; indice++) {
			const disco = discos[indice]!;
			if (disco > suma || cantidad[suma - disco] === infinito) continue;
			const candidata = cantidad[suma - disco] + 1;
			if (candidata < cantidad[suma]) {
				cantidad[suma] = candidata;
				anterior[suma] = suma - disco;
				ultimoDisco[suma] = indice;
			}
		}
	}

	const exactoInt = Number.isInteger(requeridoPorLado) ? requeridoPorLado : -1;
	const exacta =
		exactoInt >= 0 && cantidad[exactoInt] !== infinito
			? reconstruir(exactoInt, barraInt, discos, anterior, ultimoDisco)
			: null;

	let inferiorInt = Math.floor(requeridoPorLado);
	while (inferiorInt > 0 && cantidad[inferiorInt] === infinito) inferiorInt--;
	const inferior = reconstruir(inferiorInt, barraInt, discos, anterior, ultimoDisco);

	let superiorInt = Math.ceil(requeridoPorLado);
	while (superiorInt <= limite && cantidad[superiorInt] === infinito) superiorInt++;
	const superior =
		superiorInt <= limite
			? reconstruir(superiorInt, barraInt, discos, anterior, ultimoDisco)
			: null;

	return {
		estado: 'calculado',
		objetivo: visible(objetivoInt),
		barra: visible(barraInt),
		exacta,
		inferior,
		superior
	};
}
