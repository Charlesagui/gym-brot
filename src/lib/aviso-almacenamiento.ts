import type { EstadoPersistencia } from './persistencia';

/**
 * Cuándo la portada avisa que los datos corren riesgo, y con qué variante.
 *
 * La app guarda todo en el almacenamiento del navegador, y eso tiene dos formas de
 * "perder" datos que el código no puede evitar:
 *
 * - **Contenedores separados.** Cada navegador (Chrome, Samsung Internet, el que abre
 *   WhatsApp) y la app instalada tienen su propia base. Quien abre un día desde un link
 *   y otro desde el ícono ve entrenamientos distintos y cree que no se guardaron.
 * - **Borrado del navegador.** Si no concedió almacenamiento persistente puede vaciarlo
 *   solo; en iPhone sin instalar, Safari lo hace a los 7 días sin uso.
 *
 * Antes esto se avisaba sólo en Historial y Ajustes: quien entra directo a entrenar
 * nunca lo veía. La decisión es pura para poder fijarla con tests sin navegador.
 */

export type Plataforma = 'ios' | 'samsung' | 'android' | 'otra';

export type AvisoAlmacenamiento =
	{ tipo: 'navegador'; plataforma: Plataforma } | { tipo: 'efimero' } | null;

/** Cerrado con la X, vuelve a la semana: el riesgo no se fue por cerrarlo. */
export const REAPARICION_AVISO_MS = 7 * 24 * 60 * 60 * 1000;

export interface EntradaAviso {
	/** Abierta desde el ícono (display-mode standalone o equivalente). */
	instalada: boolean;
	/** Pantalla táctil: en la compu, usarla en una pestaña es lo normal. */
	tactil: boolean;
	plataforma: Plataforma;
	persistencia: EstadoPersistencia;
	/** ISO de cuándo se cerró por última vez, o null. */
	cerradoAt: string | null;
	ahora?: Date;
}

export function avisoAlmacenamiento({
	instalada,
	tactil,
	plataforma,
	persistencia,
	cerradoAt,
	ahora = new Date()
}: EntradaAviso): AvisoAlmacenamiento {
	if (cerradoAt) {
		const cerrado = new Date(cerradoAt).getTime();
		if (Number.isFinite(cerrado) && ahora.getTime() - cerrado < REAPARICION_AVISO_MS) return null;
	}
	// En el navegador se avisa aunque haya persistencia: el riesgo de los contenedores
	// separados no depende de eso.
	if (!instalada) return tactil ? { tipo: 'navegador', plataforma } : null;
	// Instalada: sólo si el navegador dijo explícitamente que puede borrar. Con
	// 'desconocido' no afirmamos nada.
	if (persistencia === 'efimero') return { tipo: 'efimero' };
	return null;
}

/** Plataforma a partir del user agent, sólo para elegir las instrucciones de instalar. */
export function plataformaDe(userAgent: string, maxTouchPoints = 0): Plataforma {
	if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios';
	// iPadOS se presenta como Mac de escritorio; lo delata el táctil.
	if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return 'ios';
	if (/SamsungBrowser/.test(userAgent)) return 'samsung';
	if (/Android/.test(userAgent)) return 'android';
	return 'otra';
}

/** Cómo instalarla a mano, cuando el navegador no ofrece el botón de instalar. */
export function instruccionesInstalar(plataforma: Plataforma): string {
	switch (plataforma) {
		case 'ios':
			return 'En Safari, tocá Compartir (el cuadrado con la flecha) y después «Agregar a inicio».';
		case 'samsung':
			return 'Tocá el menú ≡ abajo a la derecha, después «Agregar página a» y elegí «Pantalla de inicio».';
		case 'android':
			return 'Tocá el menú ⋮ arriba a la derecha y elegí «Instalar app» o «Agregar a la pantalla principal».';
		default:
			return 'En el menú del navegador, buscá «Instalar» o «Agregar a la pantalla de inicio».';
	}
}
