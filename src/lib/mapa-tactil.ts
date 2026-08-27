/**
 * Resolución táctil del mapa corporal: qué músculo quiso tocar el dedo.
 *
 * Existe porque el dibujo es chico y las zonas son más chicas todavía. En un teléfono
 * de 390 px el cuerpo entra en una columna de 175 px, y ahí el trapecio mide 12×8 px y
 * los flexores de cadera 15×9. La app pide 44 px para todo lo tocable: apuntarle a una
 * zona así es imposible, y el resultado era tocar y que no pasara nada.
 *
 * Así que el toque no exige puntería: si cae dentro de una zona gana esa zona, y si cae
 * cerca gana la más cercana dentro de un radio. El radio se mide en píxeles de pantalla
 * y se convierte a unidades del `viewBox`, para que valga lo mismo en cualquier tamaño.
 *
 * La geometría se aproxima con la caja de cada trazo y no con su silueta exacta: es lo
 * que el navegador ya sabe calcular (`getBBox`), y a esta escala la diferencia entre la
 * caja y el contorno es de un par de píxeles. La silueta exacta sí manda cuando el dedo
 * cae adentro, porque ahí el acierto lo resuelve el propio navegador.
 */

export interface CajaMuscular<M extends string = string> {
	musculo: M;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** Distancia del punto a la caja; 0 si cae adentro. */
export function distanciaACaja(x: number, y: number, caja: CajaMuscular): number {
	const dx = Math.max(caja.x0 - x, 0, x - caja.x1);
	const dy = Math.max(caja.y0 - y, 0, y - caja.y1);
	return Math.hypot(dx, dy);
}

/**
 * El músculo más cercano al punto, o `null` si ninguno queda dentro del radio.
 *
 * Con dos cajas a la misma distancia gana la más chica. Pasa siempre que el dedo cae
 * adentro de dos —los oblicuos envuelven al recto abdominal, el antebrazo cruza el
 * bíceps— y ahí la caja grande es la que menos dice: si el punto está en las dos, el
 * que estabas apuntando es el blanco difícil, no el fácil.
 */
export function musculoMasCercano<M extends string>(
	x: number,
	y: number,
	cajas: readonly CajaMuscular<M>[],
	radio: number
): M | null {
	let mejor: M | null = null;
	let mejorDistancia = Infinity;
	let mejorArea = Infinity;
	for (const caja of cajas) {
		const distancia = distanciaACaja(x, y, caja);
		if (distancia > radio) continue;
		const area = (caja.x1 - caja.x0) * (caja.y1 - caja.y0);
		if (distancia > mejorDistancia) continue;
		if (distancia === mejorDistancia && area >= mejorArea) continue;
		mejor = caja.musculo;
		mejorDistancia = distancia;
		mejorArea = area;
	}
	return mejor;
}
