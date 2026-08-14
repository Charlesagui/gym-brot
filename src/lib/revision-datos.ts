const CLAVE_REVISION = 'gym-brot:revision-datos';
const CANAL_REVISION = 'gym-brot:datos-reemplazados';

let revisionMemoria = '0';

function leerRevision(): string {
	try {
		return localStorage.getItem(CLAVE_REVISION) ?? revisionMemoria;
	} catch {
		return revisionMemoria;
	}
}

function escribirRevision(revision: string): void {
	revisionMemoria = revision;
	try {
		localStorage.setItem(CLAVE_REVISION, revision);
	} catch {
		// IndexedDB sigue funcionando aunque el navegador bloquee localStorage.
	}
}

/** Captura la generación contra la que una acción de UI comenzó a trabajar. */
export function capturarRevisionDatos(): string {
	return leerRevision();
}

export function revisionDatosVigente(revision: string): boolean {
	return leerRevision() === revision;
}

/** Invalida operaciones ya en cola antes de reemplazar toda la base. */
export function invalidarEscriturasPendientes(): void {
	escribirRevision(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

/** Avisa a las otras pestañas después de completar una restauración o borrado. */
export function anunciarReemplazoDatos(): void {
	if (typeof BroadcastChannel === 'undefined') return;
	const canal = new BroadcastChannel(CANAL_REVISION);
	canal.postMessage({ tipo: 'reemplazo-completo' });
	canal.close();
}

export function escucharReemplazosDatos(onReemplazo: () => void): () => void {
	if (typeof BroadcastChannel === 'undefined') return () => {};
	const canal = new BroadcastChannel(CANAL_REVISION);
	canal.onmessage = (event) => {
		if (event.data?.tipo === 'reemplazo-completo') onReemplazo();
	};
	return () => canal.close();
}

export class DatosReemplazadosError extends Error {
	constructor() {
		super(
			'Los datos cambiaron en otra pestaña. La acción no se aplicó; recargá e intentá de nuevo.'
		);
		this.name = 'DatosReemplazadosError';
	}
}

export function exigirRevisionDatos(revision: string): void {
	if (!revisionDatosVigente(revision)) throw new DatosReemplazadosError();
}
