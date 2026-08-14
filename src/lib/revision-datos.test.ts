import { describe, expect, it } from 'vitest';
import {
	capturarRevisionDatos,
	exigirRevisionDatos,
	invalidarEscriturasPendientes,
	revisionDatosVigente
} from './revision-datos';

describe('revisión global de datos', () => {
	it('invalida una escritura iniciada antes de restaurar o borrar la base', () => {
		const anterior = capturarRevisionDatos();
		invalidarEscriturasPendientes();
		expect(revisionDatosVigente(anterior)).toBe(false);
		expect(() => exigirRevisionDatos(anterior)).toThrow('Los datos cambiaron en otra pestaña');
	});
});
