import { restaurarInstantanea, type InstantaneaSesion } from './sesion';
import { guardarSinBloquear } from './errores-datos';

/**
 * La vuelta atrás de la última acción que borró trabajo.
 *
 * Vive fuera de las pantallas por una razón concreta: "Terminar con N series" navega
 * apenas termina, así que un deshacer guardado en el componente se iba con él. Acá el
 * ofrecimiento sobrevive el viaje y la barra aparece en la pantalla a la que llegaste.
 *
 * Guarda una sola acción: la última. Encadenar deshaceres pediría una pila, y con una
 * ventana de segundos eso es más máquina de la que el caso necesita.
 *
 * Es memoria de la sesión de la app, no de la base: si recargás, se perdió. Es un
 * arrepentimiento de segundos, no un historial de versiones.
 */
class Deshacer {
	mensaje = $state('');
	activo = $state(false);
	#datos: { diaId: string; fecha: string; instantanea: InstantaneaSesion } | null = null;
	#id: ReturnType<typeof setTimeout> | null = null;

	ofrecer(
		mensaje: string,
		diaId: string,
		fecha: string,
		instantanea: InstantaneaSesion,
		segundos = 9
	) {
		this.#limpiarTimer();
		this.#datos = { diaId, fecha, instantanea };
		this.mensaje = mensaje;
		this.activo = true;
		this.#id = setTimeout(() => this.descartar(), segundos * 1000);
	}

	deshacer() {
		const datos = this.#datos;
		this.descartar();
		if (!datos) return;
		guardarSinBloquear(
			restaurarInstantanea(datos.diaId, datos.instantanea, datos.fecha),
			'No se pudo deshacer. Intentá de nuevo.'
		);
	}

	descartar() {
		this.#limpiarTimer();
		this.#datos = null;
		this.activo = false;
		this.mensaje = '';
	}

	#limpiarTimer() {
		if (this.#id) clearTimeout(this.#id);
		this.#id = null;
	}
}

export const deshacer = new Deshacer();
