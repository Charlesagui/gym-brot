import type { UnidadPeso } from './unidades';

/**
 * El color de cada disco.
 *
 * Los discos de verdad vienen codificados por color —25 rojo, 20 azul, 15 amarillo,
 * 10 verde, 5 blanco es el estándar de competición— y quien entrena lo tiene
 * incorporado: reconoce la placa antes de leer el número. Reproducir esa codificación
 * no es decorar, es la misma información que ya usás cuando la agarrás del rack.
 *
 * Lo que NO se puede hacer es copiar los colores tal cual. Están pensados para verse
 * a la luz del día sobre una barra cromada, y esta app es casi negra: medido contra la
 * tarjeta en foco (#20202d), el azul real de 20 kg da 2,26:1 —ilegible— y el rojo de
 * 25 se queda en 3,19:1, que solo alcanza para texto grande.
 *
 * Así que se conserva el tono, que es lo que da el reconocimiento, y se sube la
 * luminosidad hasta la banda que la app ya usa para los grupos musculares (todos entre
 * 6,2:1 y 9,6:1, ver `grupos` en catalog.ts). El peor caso de esta paleta queda en
 * 5,76:1, contra los 4,5:1 que pide AA.
 */
const ROJO = '255 107 94';
const AZUL = '90 169 255';
const AMARILLO = '251 191 36';
const VERDE = '74 222 128';
const BLANCO = '232 232 240';
const ROSA = '255 157 176';
const CROMO = '168 173 186';

/**
 * En kg la asignación es la de competición. La excepción es el 2,5: en la vida real
 * es rojo, igual que el 25, porque la escala de colores se repite en las fracciones.
 * En el dibujo eso no molesta —el tamaño los separa, el de 25 mide el doble— pero en
 * la grilla de discos disponibles quedarían dos botones rojos iguales. El rosa es el
 * mismo tono corrido en luminosidad: se sigue leyendo como familia del rojo.
 */
const KG: Record<number, string> = {
	25: ROJO,
	20: AZUL,
	15: AMARILLO,
	10: VERDE,
	5: BLANCO,
	2.5: ROSA,
	1.25: CROMO
};

/**
 * En libras no hay un estándar tan firme como el de la IWF; los bumpers de
 * competición siguen la misma secuencia corrida un lugar (45 azul, 35 amarillo,
 * 25 verde, 10 blanco) y las fracciones suelen ser cromadas. Se respeta eso y se
 * reutilizan exactamente los mismos siete colores, para no abrir una segunda paleta.
 */
const LB: Record<number, string> = {
	45: AZUL,
	35: AMARILLO,
	25: VERDE,
	10: BLANCO,
	5: ROJO,
	2.5: ROSA
};

/** Para un peso fuera del catálogo: el acento, que es el color que la app usa por defecto. */
const FALLBACK = 'var(--accent-rgb)';

/** El color de un disco, como triplete rgb listo para `rgb(... / alfa)`. */
export function colorDisco(peso: number, unidad: UnidadPeso): string {
	return (unidad === 'kg' ? KG : LB)[peso] ?? FALLBACK;
}
