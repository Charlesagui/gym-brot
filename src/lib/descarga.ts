/**
 * Entregarle un archivo al usuario desde el navegador.
 *
 * Vive suelto porque lo necesitan dos pantallas muy distintas: el backup normal de
 * Ajustes y la copia de rescate del arranque fallido, que corre cuando la base ni
 * siquiera abrió. Duplicarlo era garantizar que una de las dos copias se olvidara de
 * alguno de los detalles de abajo, que son justo los que hacían fallar la descarga en
 * silencio en varios navegadores móviles.
 */
export function descargarJSON(json: string, nombreArchivo: string): void {
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = nombreArchivo;
	a.rel = 'noopener';
	// El anchor tiene que estar en el documento y la URL no puede revocarse en el
	// mismo tick: así fallaba la descarga, en silencio, en varios navegadores móviles.
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Nombre estable de los archivos que produce la app, fechado por día local. */
export function nombreBackup(prefijo = 'gym-brot-backup'): string {
	return `${prefijo}-${new Date().toLocaleDateString('sv')}.json`;
}
