/** Valor canónico de esfuerzo: RIR 0–5 en incrementos de media repetición. */
export function rirValido(valor: unknown): valor is number {
	return (
		typeof valor === 'number' &&
		Number.isFinite(valor) &&
		valor >= 0 &&
		valor <= 5 &&
		Number.isInteger(valor * 2)
	);
}

export function rirARpe(rir: number): number {
	if (!rirValido(rir)) throw new RangeError('RIR debe estar entre 0 y 5 en pasos de 0,5.');
	return 10 - rir;
}

export function rpeARir(rpe: number): number {
	const rir = 10 - rpe;
	if (!rirValido(rir)) throw new RangeError('RPE debe estar entre 5 y 10 en pasos de 0,5.');
	return rir;
}

export function etiquetaEsfuerzo(rir: number, modo: 'rir' | 'rpe'): string {
	return modo === 'rir' ? `RIR ${rir}` : `RPE ${rirARpe(rir)}`;
}
