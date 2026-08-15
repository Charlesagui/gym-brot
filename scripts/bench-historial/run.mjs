/**
 * Mide el costo de las lecturas derivadas del historial (ver docs/arquitectura.md).
 *
 * Siembra bases sintéticas de 3, 5 y 10 años y cronometra las consultas que recorren la
 * tabla `sesiones` entera, más el camino de entrenamiento. Corre el código real de
 * `src/lib` dentro de Chromium para medir contra IndexedDB nativo: `fake-indexeddb` no
 * reproduce el costo de deserializar, que es justo el término que domina.
 *
 *   node scripts/bench-historial/run.mjs          # CPU sin frenar (la de esta máquina)
 *   CPU=4 node scripts/bench-historial/run.mjs    # ≈ Android de gama media
 *   SALIDA=medicion.json CPU=4 node scripts/bench-historial/run.mjs
 *
 * No toca la base del navegador: cada corrida usa un perfil temporal que Playwright
 * descarta al cerrar.
 */
import { build } from 'vite';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(aqui, '../..');
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-historial-'));
const PUERTO = 4319;
const ANIOS = [3, 5, 10];

// `tsconfig.json` extiende el que genera SvelteKit. Sin él, la transformación de TS
// falla con un error que no se parece en nada a la causa.
if (!fs.existsSync(path.join(repo, '.svelte-kit/tsconfig.json'))) {
	execFileSync('npx', ['svelte-kit', 'sync'], { cwd: repo, stdio: 'inherit' });
}

await build({
	root: aqui,
	configFile: false,
	logLevel: 'error',
	resolve: { alias: { $lib: path.join(repo, 'src/lib') } },
	define: { 'import.meta.env.DEV': 'false' },
	build: { outDir: dist, emptyOutDir: true, target: 'es2022', minify: false }
});

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const servidor = http.createServer((peticion, respuesta) => {
	const rel = peticion.url === '/' ? '/index.html' : peticion.url.split('?')[0];
	const archivo = path.join(dist, rel);
	if (!archivo.startsWith(dist) || !fs.existsSync(archivo)) {
		respuesta.writeHead(404).end('no');
		return;
	}
	respuesta.writeHead(200, {
		'content-type': tipos[path.extname(archivo)] ?? 'application/octet-stream'
	});
	fs.createReadStream(archivo).pipe(respuesta);
});
await new Promise((listo) => servidor.listen(PUERTO, '127.0.0.1', listo));

const freno = Number(process.env.CPU ?? 1);
const navegador = await chromium.launch();
const resultados = [];
for (const anios of ANIOS) {
	const pagina = await (await navegador.newContext()).newPage();
	pagina.on('console', (mensaje) => console.log(`  [${anios}a] ${mensaje.text()}`));
	pagina.on('pageerror', (error) => console.error('[pageerror]', error.message));
	if (freno > 1) {
		const cdp = await pagina.context().newCDPSession(pagina);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: freno });
	}
	await pagina.goto(`http://127.0.0.1:${PUERTO}/`);
	await pagina.waitForFunction(() => globalThis.bench != null, null, { timeout: 30_000 });

	console.log(`\n=== ${anios} años ===`);
	const semilla = await pagina.evaluate((a) => globalThis.bench.sembrar(a), anios);
	console.log(`  ${semilla.sesiones} sesiones, ${semilla.sets} series, ${semilla.prs} PRs`);
	const pantallaHistorial = await pagina.evaluate(() => globalThis.bench.medirHistorial(5));
	const entrenamiento = await pagina.evaluate(() => globalThis.bench.medirEntrenamiento(5));
	resultados.push({ anios, ...semilla, ...pantallaHistorial, ...entrenamiento });
	await pagina.context().close();
}
await navegador.close();
servidor.close();
fs.rmSync(dist, { recursive: true, force: true });

if (process.env.SALIDA) {
	fs.writeFileSync(path.resolve(process.env.SALIDA), JSON.stringify(resultados, null, 2));
	console.log(`\nEscrito en ${path.resolve(process.env.SALIDA)}`);
}

const ms = (n) => (n == null ? '—' : `${n.toFixed(1)} ms`);
const fila = (titulo, leer) =>
	console.log(`| ${titulo} | ${resultados.map((r) => ms(leer(r))).join(' | ')} |`);
const cabecera = resultados.map((r) => `${r.anios} años (${r.sesiones} sesiones)`).join(' | ');

console.log(`\nCPU frenada ${freno}×\n`);
console.log(`| | ${cabecera} |`);
console.log(`| --- | ${resultados.map(() => '---').join(' | ')} |`);
fila('abrir /historial (resumen + récords)', (r) => r.resumenHistorialObs + r.recordsGlobalesObs);
fila('  · resumenHistorialObs', (r) => r.resumenHistorialObs);
fila('  · recordsGlobalesObs', (r) => r.recordsGlobalesObs);
fila('  · solo deserializar la tabla', (r) => r.lecturaTabla);
fila('terminar el día (rachaSemanalActual)', (r) => r.rachaSemanalActual);
fila('toque de −/+ tal como se siente', (r) => r.toqueConPantallaEjercicio);
fila('  · solo la escritura', (r) => r.setPeso);
fila('marcar una serie y decidir el PR', (r) => r.registrarPrSiSupera);
fila('abrir un ejercicio', (r) => r.prepararEjercicioSesion);
fila('escritura con /historial montada', (r) => r.escrituraConHistorialMontada);
