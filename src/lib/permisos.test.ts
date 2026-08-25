import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	estadoNotificaciones,
	explicacionAlarma,
	pedirNotificaciones,
	soportaWakeLock
} from './permisos';

// El entorno de tests es `node`: `window` no existe, así que hay que crearlo además del
// global `Notification`, porque el guard real mira `'Notification' in window`.
function conNotification(permission: NotificationPermission, request?: () => Promise<string>) {
	const api = { permission, requestPermission: request ?? (() => Promise.resolve(permission)) };
	vi.stubGlobal('window', { Notification: api });
	vi.stubGlobal('Notification', api);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('permisos de la alarma', () => {
	it('traduce cada estado del navegador', () => {
		conNotification('granted');
		expect(estadoNotificaciones()).toBe('concedido');
		conNotification('denied');
		expect(estadoNotificaciones()).toBe('bloqueado');
		conNotification('default');
		expect(estadoNotificaciones()).toBe('sin-pedir');
	});

	it('un navegador sin la API no inventa un estado', () => {
		vi.stubGlobal('window', {});
		expect(estadoNotificaciones()).toBe('sin-soporte');
	});

	it('sin soporte, pedir no explota ni miente', async () => {
		vi.stubGlobal('window', {});
		expect(await pedirNotificaciones()).toBe('sin-soporte');
	});

	it('no vuelve a pedir si ya está concedido o bloqueado', async () => {
		const pedir = vi.fn(() => Promise.resolve('denied'));
		conNotification('denied', pedir);
		expect(await pedirNotificaciones()).toBe('bloqueado');
		expect(pedir).not.toHaveBeenCalled();

		conNotification('granted', pedir);
		expect(await pedirNotificaciones()).toBe('concedido');
		expect(pedir).not.toHaveBeenCalled();
	});

	it('pide una vez cuando todavía no se decidió', async () => {
		const estado = { valor: 'default' as NotificationPermission };
		const pedir = vi.fn(async () => {
			estado.valor = 'granted';
			return 'granted';
		});
		const api = {
			get permission() {
				return estado.valor;
			},
			requestPermission: pedir
		};
		vi.stubGlobal('window', { Notification: api });
		vi.stubGlobal('Notification', api);
		expect(await pedirNotificaciones()).toBe('concedido');
		expect(pedir).toHaveBeenCalledTimes(1);
	});

	it('un rechazo del diálogo no rompe nada', async () => {
		conNotification('default', () => Promise.reject(new Error('no')));
		expect(await pedirNotificaciones()).toBe('sin-pedir');
	});

	it('soportaWakeLock refleja la API disponible', () => {
		vi.stubGlobal('navigator', {});
		expect(soportaWakeLock()).toBe(false);
		vi.stubGlobal('navigator', { wakeLock: {} });
		expect(soportaWakeLock()).toBe(true);
	});

	it('explica el peor caso sin prometer lo que no puede cumplir', () => {
		expect(explicacionAlarma('bloqueado', false)).toContain('sin que te enteres');
		expect(explicacionAlarma('concedido', true)).toContain('notificación');
		expect(explicacionAlarma('concedido', false)).toContain('no puede mantener la pantalla');
		expect(explicacionAlarma('sin-pedir', true)).toContain('pantalla se mantiene encendida');
	});
});
