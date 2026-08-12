import exercises from './data/exercises.json';

export type Grupo = 'piernas' | 'pecho' | 'espalda' | 'hombros' | 'brazos' | 'core';
export type Equipo = 'mancuerna' | 'barra' | 'maquina' | 'peso-corporal' | 'otro';

export interface Ejercicio {
	id: string;
	nombre: string;
	grupo: Grupo;
	musculo: string;
	demoVideo: string;
	videoUrl?: string;
	/** Equipamiento principal: permite adaptar controles sin inferirlo del nombre traducido. */
	equipo?: Equipo;
	/** Máquina con pila de placas: habilita marcar MAX (tope de pila + kg extra encima). */
	maquinaPlacas?: boolean;
}

/** Catálogo estático de ejercicios, empaquetado con la app. */
export const catalogo: Ejercicio[] = exercises as Ejercicio[];

/** Índice id → ejercicio: lookup O(1) (se llama en loops de render sobre ~960 ítems). */
const porId = new Map(catalogo.map((e) => [e.id, e]));

export function ejercicioPorId(id: string): Ejercicio | undefined {
	return porId.get(id);
}

/** Quita acentos y pasa a minúsculas: en el teclado del gym se escribe sin tildes. */
function normalizar(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}

/**
 * Índice de búsqueda normalizado, armado una sola vez y recién cuando se busca.
 * Antes cada tecla normalizaba nombre y músculo de los 962 ejercicios (dos `normalize`
 * + dos regex por fila, ~2.000 por pulsación); armarlo al importar el módulo tampoco
 * servía, porque el catálogo lo importa toda la app y esa pantalla casi no se abre.
 */
let indiceBusqueda: { ejercicio: Ejercicio; texto: string }[] | null = null;

/** Ejercicios cuyo nombre o músculo contiene `termino` (sin distinguir tildes). */
export function buscarEjercicios(termino: string): Ejercicio[] {
	const t = normalizar(termino.trim());
	if (!t) return catalogo;
	indiceBusqueda ??= catalogo.map((ejercicio) => ({
		ejercicio,
		// Se busca también por músculo: la premisa es guiarse sin depender del nombre.
		texto: `${normalizar(ejercicio.nombre)} ${normalizar(ejercicio.musculo)}`
	}));
	return indiceBusqueda.filter((e) => e.texto.includes(t)).map((e) => e.ejercicio);
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
