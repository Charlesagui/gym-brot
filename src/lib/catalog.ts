import exercises from './data/exercises.json';

export type Grupo = 'piernas' | 'pecho' | 'espalda' | 'hombros' | 'brazos' | 'core';

export interface Ejercicio {
	id: string;
	nombre: string;
	grupo: Grupo;
	musculo: string;
	demoVideo: string;
	videoUrl?: string;
	/** Máquina con pila de placas: habilita marcar MAX (tope de pila + kg extra encima). */
	maquinaPlacas?: boolean;
}

/** Catálogo estático de ejercicios, empaquetado con la app. */
export const catalogo: Ejercicio[] = exercises as Ejercicio[];

/** Índice id → ejercicio: lookup O(1) (se llama en loops de render sobre 629 ítems). */
const porId = new Map(catalogo.map((e) => [e.id, e]));

export function ejercicioPorId(id: string): Ejercicio | undefined {
	return porId.get(id);
}

/** Color/identidad de cada grupo muscular (glow = rgb sin coma, para usar en rgb(... / a)). */
export const grupos: Record<Grupo, { label: string; glow: string; emoji: string }> = {
	piernas: { label: 'Piernas', glow: '255 111 174', emoji: '🦵' },
	pecho: { label: 'Pecho', glow: '255 122 92', emoji: '🏋️' },
	espalda: { label: 'Espalda', glow: '52 211 153', emoji: '🛡️' },
	hombros: { label: 'Hombros', glow: '251 191 36', emoji: '🦾' },
	brazos: { label: 'Brazos', glow: '56 189 248', emoji: '💪' },
	core: { label: 'Core', glow: '34 211 238', emoji: '🔥' }
};
