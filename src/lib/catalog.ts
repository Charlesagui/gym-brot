import exercises from './data/exercises.json';

export type Grupo = 'piernas' | 'pecho' | 'espalda' | 'hombros' | 'brazos' | 'core';

export interface Ejercicio {
	id: string;
	nombre: string;
	grupo: Grupo;
	musculo: string;
	demoVideo: string;
	videoUrl?: string;
}

/** Catálogo estático de ejercicios, empaquetado con la app. */
export const catalogo: Ejercicio[] = exercises as Ejercicio[];

export function ejercicioPorId(id: string): Ejercicio | undefined {
	return catalogo.find((e) => e.id === id);
}

/** Color/identidad de cada grupo muscular (glow = rgb sin coma, para usar en rgb(... / a)). */
export const grupos: Record<Grupo, { label: string; glow: string; emoji: string }> = {
	piernas: { label: 'Piernas', glow: '255 111 174', emoji: '🦵' },
	pecho: { label: 'Pecho', glow: '255 122 92', emoji: '🫀' },
	espalda: { label: 'Espalda', glow: '52 211 153', emoji: '🔙' },
	hombros: { label: 'Hombros', glow: '251 191 36', emoji: '🟦' },
	brazos: { label: 'Brazos', glow: '56 189 248', emoji: '💪' },
	core: { label: 'Core', glow: '34 211 238', emoji: '🎯' }
};
