import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SALIDA = 'docs/capturas';

/** Fecha local YYYY-MM-DD en el huso del usuario, corrida `dias` días hacia atrás. */
function fechaHace(dias: number): string {
	const d = new Date(Date.now() - dias * 86_400_000);
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d);
}

/** Peso inicial por ejercicio (kg) y cuánto sube por semana. */
const BASE: Record<string, [number, number]> = {
	'prensa-pierna-45': [120, 10],
	'extension-cuadriceps': [40, 2.5],
	'curl-femoral': [35, 2.5],
	abductores: [45, 2.5],
	aductores: [45, 2.5],
	'gemelos-sentado': [30, 2.5],
	'press-pecho': [55, 2.5],
	'press-inclinado': [45, 2.5],
	'aperturas-pec': [30, 2.5],
	'press-hombro': [35, 2.5],
	'elevaciones-laterales': [8, 1],
	'triceps-soga': [20, 2.5],
	'triceps-sobre-cabeza': [17.5, 2.5],
	'jalon-pecho': [50, 2.5],
	'remo-sentado': [50, 2.5],
	'remo-alto-v': [40, 2.5],
	'jalon-brazos-rectos': [20, 2.5],
	'curl-biceps': [25, 2.5],
	'curl-martillo': [12, 1],
	'curl-concentrado': [10, 1]
};

interface DiaSeed {
	id: string;
	nombre: string;
	ejercicios: { exerciseId: string; seriesObjetivo: number }[];
}

function serie(peso: number, reps: number) {
	return { peso, pesoGramos: Math.round(peso * 1000), reps, hecha: true };
}

/** Seis semanas: lunes piernas, miércoles empuje, viernes tirón, con doble progresión. */
function sesiones(dias: DiaSeed[]) {
	const hoy = new Date();
	// 0 = domingo. Días hacia atrás hasta el lunes de esta semana.
	const aLunes = (hoy.getDay() + 6) % 7;
	const salida: unknown[] = [];
	for (let semana = 6; semana >= 1; semana--) {
		dias.forEach((dia, i) => {
			const atras = aLunes + semana * 7 - i * 2;
			if (atras <= 0) return;
			const fecha = fechaHace(atras);
			const n = 6 - semana; // 0..5
			const ejercicios = dia.ejercicios.map(({ exerciseId, seriesObjetivo }) => {
				const [base, paso] = BASE[exerciseId] ?? [20, 2.5];
				const peso = base + Math.floor(n / 2) * paso;
				const repsTope = 8 + (n % 2) * 2;
				return {
					exerciseId,
					sets: Array.from({ length: seriesObjetivo }, (_, s) =>
						serie(peso, Math.max(6, repsTope + 2 - s))
					)
				};
			});
			salida.push({
				id: `${fecha}__${dia.id}`,
				fecha,
				diaId: dia.id,
				diaNombre: dia.nombre,
				ordenEnDia: 0,
				ejercicios,
				plan: {
					ejercicios: ejercicios.length,
					series: ejercicios.reduce((t, e) => t + e.sets.length, 0)
				},
				diaTerminado: true,
				diaTerminadoAt: `${fecha}T20:00:00.000Z`,
				tocadaAt: `${fecha}T20:00:00.000Z`
			});
		});
	}
	// Hoy: empuje a mitad de camino, para que el día y la consola muestren progreso real.
	const empuje = dias.find((d) => d.id === 'dia-pecho-triceps-hombro');
	if (empuje) {
		const fecha = fechaHace(0);
		const hechas: Record<string, number> = { 'press-pecho': 4, 'press-inclinado': 2 };
		const ejercicios = empuje.ejercicios.map(({ exerciseId, seriesObjetivo }) => {
			const [base, paso] = BASE[exerciseId] ?? [20, 2.5];
			const peso = base + 3 * paso;
			return {
				exerciseId,
				sets: Array.from({ length: seriesObjetivo }, (_, s) =>
					// Las pendientes llevan la carga sugerida, como las deja la app al abrir la serie.
					s < (hechas[exerciseId] ?? 0) ? serie(peso, 10 - s) : { ...serie(peso, 8), hecha: false }
				)
			};
		});
		salida.push({
			id: `${fecha}__${empuje.id}`,
			fecha,
			diaId: empuje.id,
			diaNombre: empuje.nombre,
			ordenEnDia: 0,
			ejercicios,
			plan: {
				ejercicios: ejercicios.length,
				series: ejercicios.reduce((t, e) => t + e.sets.length, 0)
			},
			tocadaAt: new Date().toISOString()
		});
	}
	return salida;
}

function pesos() {
	return Array.from({ length: 10 }, (_, i) => {
		const fecha = fechaHace(42 - i * 4);
		return {
			fecha,
			pesoGramos: Math.round((82.4 - i * 0.35 + (i % 3 === 0 ? 0.2 : 0)) * 1000),
			registradoAt: `${fecha}T11:00:00.000Z`
		};
	});
}

async function leerTabla(page: Page, tabla: string): Promise<unknown[]> {
	return page.evaluate(
		(t) =>
			new Promise<unknown[]>((ok, mal) => {
				const pedido = indexedDB.open('gym-brot');
				pedido.onerror = () => mal(pedido.error);
				pedido.onsuccess = () => {
					const db = pedido.result;
					const lectura = db.transaction(t, 'readonly').objectStore(t).getAll();
					lectura.onsuccess = () => {
						db.close();
						ok(lectura.result);
					};
					lectura.onerror = () => mal(lectura.error);
				};
			}),
		tabla
	);
}

async function foto(page: Page, nombre: string) {
	await page.waitForTimeout(700);
	// A 600 px de ancho y con paleta: nítidas en el README sin sumar megas al repo.
	const crudo = await page.screenshot();
	await sharp(crudo)
		.resize({ width: 600 })
		.png({ palette: true, quality: 90, effort: 10 })
		.toFile(`${SALIDA}/${nombre}.png`);
}

test('capturas del README', async ({ page }) => {
	test.setTimeout(120_000);
	await page.goto('/');
	await expect(page.getByText('Piernas').first()).toBeVisible();

	const dias = (await leerTabla(page, 'dias')) as DiaSeed[];
	const ajustes = (await leerTabla(page, 'ajustes')) as Record<string, unknown>[];
	expect(dias.length).toBeGreaterThan(0);
	const backup = {
		app: 'gym-brot',
		version: 3,
		exportado: new Date().toISOString(),
		// El empuje se agenda para hoy: la portada muestra qué toca en vez de "descanso".
		dias: dias.map((d) =>
			d.id === 'dia-pecho-triceps-hombro' ? { ...d, diasSemana: [new Date().getDay()] } : d
		),
		sesiones: sesiones(dias),
		notas: [],
		ajustes: ajustes.map((a) => ({ ...a, sonido: false, sonidoLogros: false })),
		pesosCorporales: pesos(),
		objetivosEnergia: []
	};
	const archivo = join(tmpdir(), 'gym-brot-demo.json');
	writeFileSync(archivo, JSON.stringify(backup));

	await page.goto('/ajustes');
	await page.locator('input[type="file"]').setInputFiles(archivo);
	await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
	// El aviso dura poco: lo que se espera es que las sesiones hayan entrado.
	await expect
		.poll(
			// Restaurar puede recargar la página a mitad de una lectura: eso cuenta como "todavía no".
			async () => (await leerTabla(page, 'sesiones').catch(() => [])).length,
			{ timeout: 10_000 }
		)
		.toBe(backup.sesiones.length);

	await page.goto('/');
	const cerrar = page.getByRole('button', { name: 'Cerrar bienvenida' });
	if (await cerrar.isVisible()) await cerrar.click();
	await foto(page, 'inicio');

	await page.goto('/historial');
	await foto(page, 'historial');

	await page.goto('/ejercicio/press-pecho');
	await page.waitForTimeout(1500);
	// El gráfico y los récords quedan debajo de la demo y del selector de métrica.
	await page.evaluate(() => window.scrollTo(0, 620));
	await foto(page, 'progreso');

	const empuje = 'dia-pecho-triceps-hombro';
	await page.goto(`/dia/${empuje}`);
	await foto(page, 'dia');

	await page.goto(`/ejercicio/press-inclinado?dia=${empuje}&fecha=${fechaHace(0)}`);
	await foto(page, 'ejercicio');

	await page.getByRole('button', { name: 'Marcar serie 3', exact: true }).click();
	await page.waitForTimeout(2500);
	await foto(page, 'descanso');
});
