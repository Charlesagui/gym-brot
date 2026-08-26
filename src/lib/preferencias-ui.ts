/**
 * Preferencias de interfaz que no son datos del usuario: hints ya vistos, si la demo
 * va grande, si se cerró la bienvenida. Viven en localStorage (no en la base) porque
 * son de este dispositivo y no tienen que viajar en el backup.
 *
 * Estaban repartidas en cuatro componentes con dos prefijos distintos y sin forma de
 * resetearlas; acá quedan en un solo lugar, con prefijo único y un reinicio.
 */

const P = 'gb-';
const KEY = {
	demoGrande: `${P}demo-grande`,
	demoGrandeEntrenando: `${P}demo-grande-entrenando`,
	hintMaxOk: `${P}hint-max-ok`,
	hintMaxVistas: `${P}hint-max-vistas`,
	hintTimerOk: `${P}hint-timer-ok`,
	bienvenidaCerrada: `${P}bienvenida-cerrada`
} as const;

/** Clave anterior a la unificación de prefijos; se migra al primer arranque. */
const KEY_BIENVENIDA_VIEJA = 'gym-brot-welcome-closed';

const TODAS = Object.values(KEY);

function leer(clave: string): string | null {
	try {
		return localStorage.getItem(clave);
	} catch {
		// Modo privado o storage bloqueado: la app funciona igual, sin memoria de hints.
		return null;
	}
}

function escribir(clave: string, valor: string): void {
	try {
		localStorage.setItem(clave, valor);
	} catch {
		// Sin espacio o sin permiso: no es crítico, se pierde solo la preferencia.
	}
}

/**
 * Tamaño con el que arranca la demostración, con un default por modo.
 *
 * El marco del video ocupa 402 px arriba de todo y no se va nunca: los 962 ejercicios
 * del catálogo tienen demo. Entrenando eso empuja la serie en curso abajo del pliegue
 * —con tres series hechas la tarjeta activa arrancaba en y≈708 de 844—, así que ahí
 * arranca en miniatura. Sin `?dia=` se entra justamente a mirar, y arranca grande.
 *
 * Cada modo recuerda su propia elección: agrandarla para revisar la técnica en el gym
 * no tiene por qué agrandarla también cuando entrás a consultar el progreso.
 */
export function demoGrande(entrenando = false): boolean {
	const guardado = leer(entrenando ? KEY.demoGrandeEntrenando : KEY.demoGrande);
	if (guardado != null) return guardado === '1';
	return !entrenando;
}

export function setDemoGrande(valor: boolean, entrenando = false): void {
	escribir(entrenando ? KEY.demoGrandeEntrenando : KEY.demoGrande, valor ? '1' : '0');
}

/** Hint de MAX: se muestra en máquinas de placas las primeras 3 visitas, o hasta "Entendido". */
export function debeMostrarHintMax(): boolean {
	if (leer(KEY.hintMaxOk)) return false;
	const vistas = Number(leer(KEY.hintMaxVistas) ?? '0');
	escribir(KEY.hintMaxVistas, String(vistas + 1));
	return vistas < 3;
}

export function ocultarHintMax(): void {
	escribir(KEY.hintMaxOk, '1');
}

export function debeMostrarHintTimer(): boolean {
	return !leer(KEY.hintTimerOk);
}

export function ocultarHintTimer(): void {
	escribir(KEY.hintTimerOk, '1');
}

export function bienvenidaVisible(): boolean {
	if (leer(KEY.bienvenidaCerrada)) return false;
	if (leer(KEY_BIENVENIDA_VIEJA)) {
		escribir(KEY.bienvenidaCerrada, '1');
		return false;
	}
	return true;
}

export function cerrarBienvenida(): void {
	escribir(KEY.bienvenidaCerrada, '1');
}

/** Vuelve a mostrar todos los carteles de ayuda (desde Ajustes). */
export function reiniciarAyudas(): void {
	try {
		for (const clave of TODAS) localStorage.removeItem(clave);
		localStorage.removeItem(KEY_BIENVENIDA_VIEJA);
	} catch {
		// Nada que reiniciar si el storage no está disponible.
	}
}
