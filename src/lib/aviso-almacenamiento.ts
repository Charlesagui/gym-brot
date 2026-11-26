import type { EstadoPersistencia } from './persistencia';

/**
 * Cuándo la portada avisa que los datos corren riesgo, y con qué variante.
 *
 * La app guarda todo en el almacenamiento del navegador, y eso tiene dos formas de
 * "perder" datos que el código no puede evitar:
 *
 * - **Contenedores separados.** Cada navegador (Chrome, Samsung Internet, el que abre
 *   WhatsApp) tiene su propia base. Quien abre un día desde un link y otro desde el
 *   navegador de siempre ve entrenamientos distintos y cree que no se guardaron.
 *   La app instalada depende de la plataforma (ver `instalarSeparaDatos`).
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

/**
 * Si la app instalada arranca con una base propia, separada de la del navegador.
 *
 * En iPhone sí: la app de la pantalla de inicio no ve lo que se cargó en Safari, así
 * que instalar sin llevarse una copia deja la app vacía —el mismo "se borró todo" que
 * el aviso quiere evitar—. En Android (Chrome, Samsung Internet) no: la app instalada
 * usa los datos del navegador desde el que se instaló, y el riesgo real es mezclar
 * navegadores, por ejemplo abrir un link de WhatsApp que cae en otro.
 */
export function instalarSeparaDatos(plataforma: Plataforma): boolean {
	return plataforma === 'ios';
}

/** El cuerpo del aviso en el navegador, con el riesgo que de verdad corre esa plataforma. */
export function textoAvisoNavegador(plataforma: Plataforma): string {
	if (instalarSeparaDatos(plataforma))
		return (
			'Estás usando Gym-brot desde Safari. Safari puede borrar los datos después de unos ' +
			'días sin abrir la app, y la app instalada no ve lo que cargaste acá: arranca vacía. ' +
			'Guardá una copia, instalala y restaurá la copia adentro de la app.'
		);
	return (
		'Tus entrenamientos viven en este navegador. Si un día abrís Gym-brot desde otro ' +
		'(por ejemplo, un link de WhatsApp que se abre en Chrome), vas a ver otros datos. ' +
		'Instalala desde acá y abrila siempre desde el ícono.'
	);
}

/** Qué decir recién instalada: en iPhone falta traer la copia; en Android ya está todo. */
export function textoRecienInstalada(plataforma: Plataforma): string {
	if (instalarSeparaDatos(plataforma))
		return (
			'Abrila desde el ícono y, adentro, andá a Ajustes → Restaurar copia de seguridad con ' +
			'el archivo que guardaste. Desde ahí, usá siempre el ícono.'
		);
	return 'Tus datos ya están en la app. Abrila desde el ícono de tu pantalla de inicio y usá siempre esa.';
}

/** "Tu última copia es de hoy / de ayer / de hace N días", sin "hace 0 días". */
export function antiguedadBackup(ultimoBackup: string | undefined, ahora = new Date()): string {
	if (!ultimoBackup) return 'Todavía no guardaste ninguna copia.';
	const fecha = new Date(ultimoBackup);
	if (!Number.isFinite(fecha.getTime())) return 'Todavía no guardaste ninguna copia.';
	// Por día de calendario local, no por bloques de 24 h: una copia de anoche es "de ayer".
	const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const dias = Math.round((dia(ahora) - dia(fecha)) / (24 * 60 * 60 * 1000));
	if (dias <= 0) return 'Tu última copia es de hoy.';
	if (dias === 1) return 'Tu última copia es de ayer.';
	return `Tu última copia es de hace ${dias} días.`;
}
