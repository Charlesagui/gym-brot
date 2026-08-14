import type { Ajustes } from './db';

export type UnidadPeso = Ajustes['unidad'];

export const KG_TO_LB = 2.2046226218;

/** Precisión visible y editable del producto. */
export function redondearPeso(valor: number): number {
	return Math.round(valor * 10) / 10;
}

/** Fuente canónica: gramos enteros, precisa para décimas de kg y de lb. */
export function pesoAGramos(valor: number | undefined, unidad: UnidadPeso): number | undefined {
	if (valor == null) return undefined;
	if (!Number.isFinite(valor) || valor < 0) return undefined;
	const kg = unidad === 'kg' ? valor : valor / KG_TO_LB;
	return Math.round(kg * 1000);
}

export function gramosAPeso(gramos: number | undefined, unidad: UnidadPeso): number | undefined {
	if (gramos == null) return undefined;
	const kg = gramos / 1000;
	return redondearPeso(unidad === 'kg' ? kg : kg * KG_TO_LB);
}

export interface PesoCanonico {
	peso?: number;
	pesoGramos?: number;
	esMax?: boolean;
	extraKg?: number;
	extraGramos?: number;
}

/** Devuelve una copia con valores visibles en la unidad elegida. */
export function conPesoVisible<T extends PesoCanonico>(
	valor: T,
	unidad: UnidadPeso
): T & PesoCanonico {
	const resultado = { ...valor };
	const peso = gramosAPeso(valor.pesoGramos, unidad);
	const extra = gramosAPeso(valor.extraGramos, unidad);
	if (peso != null) resultado.peso = peso;
	if (extra != null) resultado.extraKg = extra;
	// La UI recibe una vista, no la representación interna. Evita que editores o
	// snapshots vuelvan a persistir por accidente campos canónicos de otra lectura.
	delete resultado.pesoGramos;
	delete resultado.extraGramos;
	return resultado;
}

/** Completa campos canónicos de datos legacy sin cambiar el valor ingresado. */
export function conPesoCanonico<T extends PesoCanonico>(
	valor: T,
	unidadOrigen: UnidadPeso
): T & PesoCanonico {
	const resultado = { ...valor };
	const peso = valor.pesoGramos ?? pesoAGramos(valor.peso, unidadOrigen);
	const extra = valor.extraGramos ?? pesoAGramos(valor.extraKg, unidadOrigen);
	if (peso != null) resultado.pesoGramos = peso;
	if (extra != null) resultado.extraGramos = extra;
	return resultado;
}
