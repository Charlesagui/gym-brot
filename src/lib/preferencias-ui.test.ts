import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	hayBackupPendiente,
	marcarBackupPendiente,
	olvidarBackupPendiente,
	reiniciarAyudas,
	ocultarHintMax,
	debeMostrarHintMax
} from './preferencias-ui';

/**
 * El entorno de vitest es `node`: no hay `localStorage`. Se monta el mínimo, con el
 * mismo desmontaje que usa `descanso.test.ts` — con `isolate: false` estos dobles
 * sobreviven al archivo y el siguiente cree estar en un navegador.
 */
const previo = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let almacen: Map<string, string>;

beforeEach(() => {
	almacen = new Map();
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: (k: string) => almacen.get(k) ?? null,
			setItem: (k: string, v: string) => void almacen.set(k, v),
			removeItem: (k: string) => void almacen.delete(k)
		}
	});
});

afterEach(() => {
	if (previo) Object.defineProperty(globalThis, 'localStorage', previo);
	else delete (globalThis as Record<string, unknown>).localStorage;
});

describe('backup bajado y sin confirmar', () => {
	it('sobrevive a salir de la pantalla: se marca una vez y se sigue leyendo después', () => {
		expect(hayBackupPendiente()).toBe(false);
		marcarBackupPendiente();
		// Cada lectura es una visita nueva a Ajustes. El pendiente no vive en el
		// componente: ahí es donde se perdía, y con él la fecha del último backup.
		expect(hayBackupPendiente()).toBe(true);
		expect(hayBackupPendiente()).toBe(true);
	});

	it('lo olvida cuando se confirma', () => {
		marcarBackupPendiente();
		olvidarBackupPendiente();
		expect(hayBackupPendiente()).toBe(false);
	});

	it('caduca al día: confirmar hoy un archivo de la semana pasada fecharía mal el backup', () => {
		const bajado = new Date('2026-09-01T10:00:00.000Z');
		marcarBackupPendiente(bajado);

		const dentro = new Date(bajado.getTime() + 23 * 3_600_000);
		expect(hayBackupPendiente(dentro)).toBe(true);

		const pasado = new Date(bajado.getTime() + 25 * 3_600_000);
		expect(hayBackupPendiente(pasado)).toBe(false);
		// Y no queda a medio caducar: la siguiente visita tampoco lo ve.
		expect(hayBackupPendiente(dentro)).toBe(false);
	});

	it('descarta una marca ilegible en vez de creerle', () => {
		localStorage.setItem('gb-backup-pendiente', 'cuando quieras');
		expect(hayBackupPendiente()).toBe(false);
	});

	it('"volver a mostrar los carteles de ayuda" NO se lo lleva puesto', () => {
		marcarBackupPendiente();
		ocultarHintMax();

		reiniciarAyudas();

		// El hint vuelve, que es lo que se pidió...
		expect(debeMostrarHintMax()).toBe(true);
		// ...pero el backup pendiente no es un cartel: perderlo cuesta la fecha del
		// último backup, y con ella el historial vuelve a reclamar una copia ya hecha.
		expect(hayBackupPendiente()).toBe(true);
	});

	it('sin storage disponible no rompe: se pierde el pendiente, no la descarga', () => {
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			get() {
				throw new Error('storage bloqueado');
			}
		});
		expect(() => marcarBackupPendiente()).not.toThrow();
		expect(hayBackupPendiente()).toBe(false);
		expect(() => olvidarBackupPendiente()).not.toThrow();
	});
});
