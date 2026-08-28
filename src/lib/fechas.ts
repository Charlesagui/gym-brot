const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha local de hoy en el mismo formato estable que usan las claves calendario. */
export function hoyCalendarioLocal(): string {
	return new Date().toLocaleDateString('sv');
}

/** Valida una fecha calendario real en formato local estable YYYY-MM-DD. */
export function fechaCalendarioValida(fecha: string): boolean {
	if (!FECHA_RE.test(fecha)) return false;
	const valor = new Date(`${fecha}T00:00:00Z`);
	return !Number.isNaN(valor.getTime()) && valor.toISOString().slice(0, 10) === fecha;
}

/**
 * Conserva una fecha explícita válida; una URL antigua sin fecha usa la de apertura.
 *
 * `apertura` es el fallback —se congela al abrir la pantalla, para no cambiar de sesión a
 * mitad de un entrenamiento— y `hoy` es el tope, que conviene pasar vivo: una sesión en el
 * futuro no existe, nadie entrenó todavía mañana. Sin este tope, `?fecha=2030-01-01`
 * creaba una sesión de verdad en la base que después ninguna pantalla mostraba.
 *
 * El tope solo puede invalidar hacia adelante, así que cruzar la medianoche con la
 * pantalla abierta no vuelve inválida una fecha que era buena: pasa a ser pasado.
 */
export function fechaSesionDesdeUrl(
	valor: string | null,
	apertura: string,
	hoy = apertura
): string | null {
	if (valor == null) return apertura;
	if (!fechaCalendarioValida(valor)) return null;
	return valor > hoy ? null : valor;
}

/**
 * Corre una fecha calendario N días. Va por `Date` local y no por aritmética de texto
 * para que los meses, los años bisiestos y los cambios de hora salgan solos.
 */
export function fechaMasDias(fecha: string, dias: number): string {
	const d = new Date(`${fecha}T00:00:00`);
	d.setDate(d.getDate() + dias);
	return d.toLocaleDateString('sv');
}

/** Comparación por día sin horas, zona horaria ni DST. */
export function fechaDentroDeRango(fecha: string, desde: string | null, hasta: string): boolean {
	return fechaCalendarioValida(fecha) && fecha <= hasta && (desde == null || fecha >= desde);
}
