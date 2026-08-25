import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { borrarPesoCorporal, guardarPesoCorporal, resumirPesoCorporal } from './peso-corporal';

beforeEach(async () => {
	await db.open();
	await db.pesosCorporales.clear();
});

describe('peso corporal', () => {
	it('crea, edita y borra una única medición por día', async () => {
		await guardarPesoCorporal('2026-08-01', 80_000, '2026-08-01T10:00:00.000Z');
		await guardarPesoCorporal('2026-08-01', 79_800, '2026-08-01T18:00:00.000Z');
		expect(await db.pesosCorporales.toArray()).toEqual([
			{
				fecha: '2026-08-01',
				pesoGramos: 79_800,
				registradoAt: '2026-08-01T18:00:00.000Z'
			}
		]);
		await borrarPesoCorporal('2026-08-01');
		expect(await db.pesosCorporales.count()).toBe(0);
	});

	it('calcula cambios de 7/30 días y distancia neutral a la meta', () => {
		const resumen = resumirPesoCorporal(
			[
				{ fecha: '2026-07-01', pesoGramos: 80_000, registradoAt: '2026-07-01T12:00:00Z' },
				{ fecha: '2026-07-24', pesoGramos: 81_000, registradoAt: '2026-07-24T12:00:00Z' },
				{ fecha: '2026-08-01', pesoGramos: 82_000, registradoAt: '2026-08-01T12:00:00Z' }
			],
			81_500
		);
		expect(resumen.cambio7DiasGramos).toBe(1_000);
		expect(resumen.cambio30DiasGramos).toBe(2_000);
		expect(resumen.distanciaMetaGramos).toBe(500);
	});

	it('no rotula como cambio de 7 días una medición muy vieja', () => {
		const resumen = resumirPesoCorporal([
			{ fecha: '2026-01-01', pesoGramos: 90_000, registradoAt: '2026-01-01T12:00:00Z' },
			{ fecha: '2026-08-24', pesoGramos: 80_000, registradoAt: '2026-08-24T12:00:00Z' }
		]);
		expect(resumen.actual?.pesoGramos).toBe(80_000);
		expect(resumen.cambio7DiasGramos).toBeNull();
		expect(resumen.cambio30DiasGramos).toBeNull();
	});

	it('acepta una referencia dentro de la ventana pero no anterior a ella', () => {
		const base = [
			{ fecha: '2026-08-10', pesoGramos: 82_000, registradoAt: '2026-08-10T12:00:00Z' },
			{ fecha: '2026-08-24', pesoGramos: 80_000, registradoAt: '2026-08-24T12:00:00Z' }
		];
		// 14 días atrás entra en la ventana de 7 días (piso en 14); 15 ya no.
		expect(resumirPesoCorporal(base).cambio7DiasGramos).toBe(-2_000);
		expect(
			resumirPesoCorporal([
				{ fecha: '2026-08-09', pesoGramos: 82_000, registradoAt: '2026-08-09T12:00:00Z' },
				base[1]!
			]).cambio7DiasGramos
		).toBeNull();
	});

	it('rechaza fechas y valores fuera de límites', async () => {
		await expect(guardarPesoCorporal('2026-02-30', 80_000)).rejects.toThrow();
		await expect(guardarPesoCorporal('9999-12-31', 80_000)).rejects.toThrow('no puede ser futura');
		await expect(guardarPesoCorporal('2026-08-01', 19_999)).rejects.toThrow();
	});

	it('una fila futura heredada no reemplaza el peso actual', () => {
		const resumen = resumirPesoCorporal([
			{ fecha: '2026-08-24', pesoGramos: 80_000, registradoAt: '2026-08-24T12:00:00Z' },
			{ fecha: '9999-12-31', pesoGramos: 90_000, registradoAt: '2026-08-25T12:00:00Z' }
		]);
		expect(resumen.actual?.pesoGramos).toBe(80_000);
	});
});
