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

/** Qué señales puede dar el descanso al vencer, para explicarlo sin tecnicismos. */
export function explicacionAlarma(notificaciones: EstadoPermiso, wakeLock: boolean): string {
	if (notificaciones === 'concedido' && wakeLock)
		return 'La pantalla se mantiene encendida durante el descanso y, si igual se apaga, llega una notificación.';
	if (notificaciones === 'concedido')
		return 'Este navegador no puede mantener la pantalla encendida, pero al terminar el descanso llega una notificación.';
	if (wakeLock)
		return 'La pantalla se mantiene encendida durante el descanso. Sin notificaciones, si la pantalla igual se apaga podés no escuchar el final.';
	return 'Sin notificaciones ni pantalla activa, el descanso puede terminar sin que te enteres.';
}
