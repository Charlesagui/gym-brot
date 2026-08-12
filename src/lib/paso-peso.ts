import type { Ejercicio } from './catalog';
import type { Ajustes } from './db';

/** Paso recomendado cuando el usuario no eligió uno para este ejercicio. */
export function pasoPesoAutomatico(ejercicio: Ejercicio, ajustes: Ajustes): number {
	if (ejercicio.equipo === 'mancuerna') return ajustes.unidad === 'kg' ? 1 : 5;
	return ajustes.pasoPeso;
}

/** Personalización del ejercicio > recomendación por equipo > ajuste global. */
export function pasoPesoEfectivo(ejercicio: Ejercicio, ajustes: Ajustes): number {
	return (
		ajustes.pasosPesoEjercicio?.[ejercicio.id]?.[ajustes.unidad] ??
		pasoPesoAutomatico(ejercicio, ajustes)
	);
}

export function pasoPesoPersonalizado(ejercicio: Ejercicio, ajustes: Ajustes): number | undefined {
	return ajustes.pasosPesoEjercicio?.[ejercicio.id]?.[ajustes.unidad];
}
