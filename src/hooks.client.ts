import type { HandleClientError } from '@sveltejs/kit';

/**
 * Sin backend no hay a dónde reportar, pero el mensaje sí tiene que llegar a la
 * pantalla de error en vez de perderse en la consola de un teléfono.
 */
export const handleError: HandleClientError = ({ error }) => {
	const message = error instanceof Error ? error.message : 'Error inesperado';
	console.error('[gym-brot]', error);
	return { message };
};
