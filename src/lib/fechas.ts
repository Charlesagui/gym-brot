const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valida una fecha calendario real en formato local estable YYYY-MM-DD. */
export function fechaCalendarioValida(fecha: string): boolean {
	if (!FECHA_RE.test(fecha)) return false;
	const valor = new Date(`${fecha}T00:00:00Z`);
	return !Number.isNaN(valor.getTime()) && valor.toISOString().slice(0, 10) === fecha;
}

/** Conserva una fecha explícita válida; una URL antigua sin fecha usa hoy. */
export function fechaSesionDesdeUrl(valor: string | null, hoy: string): string | null {
	if (valor == null) return hoy;
	return fechaCalendarioValida(valor) ? valor : null;
}

/** Comparación por día sin horas, zona horaria ni DST. */
export function fechaDentroDeRango(fecha: string, desde: string | null, hasta: string): boolean {
	return fechaCalendarioValida(fecha) && fecha <= hasta && (desde == null || fecha >= desde);
}
