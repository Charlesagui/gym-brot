/**
 * Estado de los permisos del navegador de los que depende la alarma del descanso.
 *
 * La app pide notificaciones una sola vez, al arrancar el primer descanso. Si esa vez se
 * rechazó o se ignoró, no había forma de enterarse ni de reintentar: el descanso vencía
 * sin sonido y sin aviso, y parecía un bug de la app. Ajustes usa esto para mostrar el
 * estado real y ofrecer el reintento.
 */
export type EstadoPermiso = 'sin-soporte' | 'sin-pedir' | 'concedido' | 'bloqueado';

export function estadoNotificaciones(): EstadoPermiso {
	if (typeof window === 'undefined' || !('Notification' in window)) return 'sin-soporte';
	if (Notification.permission === 'granted') return 'concedido';
	if (Notification.permission === 'denied') return 'bloqueado';
	return 'sin-pedir';
}

/**
 * Pide el permiso y devuelve el estado resultante. Sólo el navegador puede mostrar el
 * diálogo, y sólo mientras no esté bloqueado: desde 'bloqueado' hay que ir a los ajustes
 * del sitio en el navegador, no hay API para revertirlo.
 */
export async function pedirNotificaciones(): Promise<EstadoPermiso> {
	if (estadoNotificaciones() !== 'sin-pedir') return estadoNotificaciones();
	try {
		await Notification.requestPermission();
	} catch {
		// Navegador que no resuelve la promesa o usuario que cerró el diálogo.
	}
	return estadoNotificaciones();
}

export function soportaWakeLock(): boolean {
	return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export type EstadoWakeLock = 'sin-soporte' | 'concedido' | 'rechazado';

/**
 * Prueba el wake lock de verdad: pide la pantalla y la suelta apenas se confirma.
 * `soportaWakeLock` solo dice que la API existe; el pedido real puede ser rechazado en
 * silencio (típicamente por el ahorro de batería) y ese rechazo era invisible: la
 * pantalla se apagaba "sola" en pleno descanso sin ninguna pista de por qué. Hay que
 * llamarla con la página a la vista: oculta, el pedido falla siempre.
 */
export async function probarWakeLock(): Promise<EstadoWakeLock> {
	if (!soportaWakeLock()) return 'sin-soporte';
	try {
		const sentinel = await navigator.wakeLock.request('screen');
		void sentinel.release().catch(() => {});
		return 'concedido';
	} catch {
		return 'rechazado';
	}
}

/** Qué señales puede dar el descanso al vencer, para explicarlo sin tecnicismos. */
export function explicacionAlarma(notificaciones: EstadoPermiso, wakeLock: EstadoWakeLock): string {
	const notifica = notificaciones === 'concedido';
	if (wakeLock === 'rechazado') {
		// Distinto de 'sin-soporte': la API está, pero el sistema dijo que no. Nombrar el
		// ahorro de batería —lejos la causa más común— le ahorra el diagnóstico al usuario.
		const pista =
			'El teléfono rechazó mantener la pantalla encendida: el ahorro de batería suele ser la causa';
		return notifica
			? `${pista}. Si la pantalla se apaga, al terminar el descanso llega una notificación.`
			: `${pista}, y sin notificaciones el descanso puede terminar sin que te enteres.`;
	}
	if (notifica && wakeLock === 'concedido')
		return 'La pantalla se mantiene encendida durante el descanso y, si igual se apaga, llega una notificación.';
	if (notifica)
		return 'Este navegador no puede mantener la pantalla encendida, pero al terminar el descanso llega una notificación.';
	if (wakeLock === 'concedido')
		return 'La pantalla se mantiene encendida durante el descanso. Sin notificaciones, si la pantalla igual se apaga podés no escuchar el final.';
	return 'Sin notificaciones ni pantalla activa, el descanso puede terminar sin que te enteres.';
}
