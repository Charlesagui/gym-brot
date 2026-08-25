import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const catalogPath = path.join(root, 'src/lib/data/exercises.json');
const videosDir = path.join(root, 'static/videos');
const args = process.argv.slice(2);
const valorArg = (name) => {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
};
const upstreamPath = valorArg('--upstream');
const escribir = args.includes('--write');
const omitirProbe = args.includes('--skip-probe');

const normalizar = (value) =>
	value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

async function archivosRecursivos(dir) {
	const result = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const absoluto = path.join(dir, entry.name);
		if (entry.isDirectory()) result.push(...(await archivosRecursivos(absoluto)));
		else result.push(absoluto);
	}
	return result;
}

function duplicados(items, key) {
	const porClave = new Map();
	for (const item of items) {
		const value = key(item);
		const lista = porClave.get(value) ?? [];
		lista.push(item);
		porClave.set(value, lista);
	}
	return [...porClave.entries()]
		.filter(([, lista]) => lista.length > 1)
		.map(([clave, lista]) => ({ clave, cantidad: lista.length, items: lista }));
}

async function sha256(file) {
	const contenido = await readFile(file);
	return createHash('sha256').update(contenido).digest('hex');
}

async function probe(file) {
	if (omitirProbe) return null;
	try {
		const { stdout } = await execFileAsync('ffprobe', [
			'-v',
			'error',
			'-select_streams',
			'v:0',
			'-show_entries',
			'stream=codec_name,width,height,pix_fmt',
			'-of',
			'json',
			file
		]);
		return JSON.parse(stdout).streams?.[0] ?? null;
	} catch {
		return null;
	}
}

async function mapConcurrente(items, limite, fn) {
	const resultados = new Array(items.length);
	let siguiente = 0;
	await Promise.all(
		Array.from({ length: Math.min(limite, items.length) }, async () => {
			while (siguiente < items.length) {
				const index = siguiente++;
				resultados[index] = await fn(items[index], index);
			}
		})
	);
	return resultados;
}

const catalogo = JSON.parse(await readFile(catalogPath, 'utf8'));
const archivos = (await archivosRecursivos(videosDir))
	.filter((file) => file.endsWith('.mp4'))
	.sort();
const relativos = archivos.map((file) => `/${path.relative(path.join(root, 'static'), file)}`);
const referenciados = new Set(catalogo.map((exercise) => exercise.demoVideo));
const existentes = new Set(relativos);
const faltantes = [...referenciados].filter((file) => !existentes.has(file)).sort();
const huerfanos = [...existentes].filter((file) => !referenciados.has(file)).sort();

const detalles = await mapConcurrente(archivos, 8, async (file) => {
	const [info, hash, metadata] = await Promise.all([stat(file), sha256(file), probe(file)]);
	return {
		file: `/${path.relative(path.join(root, 'static'), file)}`,
		bytes: info.size,
		sha256: hash,
		...(metadata ?? {})
	};
});

const dimensiones = {};
const codecs = {};
for (const detalle of detalles) {
	const dimension =
		detalle.width && detalle.height ? `${detalle.width}x${detalle.height}` : 'sin-probe';
	dimensiones[dimension] = (dimensiones[dimension] ?? 0) + 1;
	const codec = detalle.codec_name ?? 'sin-probe';
	codecs[codec] = (codecs[codec] ?? 0) + 1;
}

let upstream = null;
if (upstreamPath) {
	const externo = JSON.parse(await readFile(upstreamPath, 'utf8'));
	const idsLocales = new Set(catalogo.map((exercise) => exercise.id));
	const nombresExternos = new Map(externo.map((exercise) => [normalizar(exercise.name), exercise]));
	const localesEmparejados = catalogo.filter(
		(exercise) =>
			nombresExternos.has(exercise.id) || nombresExternos.has(normalizar(exercise.nombre))
	);
	const idsEmparejados = new Set(
		localesEmparejados.map(
			(exercise) =>
				nombresExternos.get(exercise.id)?.id ?? nombresExternos.get(normalizar(exercise.nombre))?.id
		)
	);
	const registrosExternosEmparejados = externo.filter(
		(exercise) => idsLocales.has(normalizar(exercise.name)) || idsEmparejados.has(exercise.id)
	);
	upstream = {
		total: externo.length,
		localesEmparejados: localesEmparejados.length,
		localesCuradosSinMatch: catalogo.length - localesEmparejados.length,
		registrosExternosEmparejados: registrosExternosEmparejados.length,
		faltantesNetos: externo.length - catalogo.length
	};
}

const resumen = {
	fecha: new Date().toLocaleDateString('sv-SE'),
	catalogo: catalogo.length,
	mp4: archivos.length,
	bytes: detalles.reduce((total, item) => total + item.bytes, 0),
	faltantes,
	huerfanos,
	duplicados: {
		ids: duplicados(catalogo, (exercise) => exercise.id).map((item) => item.clave),
		nombresNormalizados: duplicados(catalogo, (exercise) => normalizar(exercise.nombre)).map(
			(item) => item.clave
		),
		rutas: duplicados(catalogo, (exercise) => exercise.demoVideo).map((item) => item.clave),
		hashExacto: duplicados(detalles, (item) => item.sha256).map((item) => ({
			hash: item.clave,
			files: item.items.map((detalle) => detalle.file)
		}))
	},
	dimensiones,
	codecs,
	upstream
};

if (escribir) {
	const mb = (resumen.bytes / 1024 / 1024).toFixed(2);
	const markdown = `# Auditoría de catálogo y assets\n\nGenerada el ${resumen.fecha} con \`npm run audit:media -- --upstream <exercises.json> --write\`.\n\n## Inventario local\n\n- Catálogo: **${resumen.catalogo} ejercicios**.\n- MP4: **${resumen.mp4} archivos**, ${mb} MiB.\n- Referencias faltantes: **${resumen.faltantes.length}**.\n- MP4 huérfanos: **${resumen.huerfanos.length}**.\n- IDs duplicados: **${resumen.duplicados.ids.length}**.\n- Nombres normalizados duplicados: **${resumen.duplicados.nombresNormalizados.length}**.\n- Rutas duplicadas: **${resumen.duplicados.rutas.length}**.\n- Grupos con hash SHA-256 idéntico: **${resumen.duplicados.hashExacto.length}**.\n- Dimensiones: ${Object.entries(
		resumen.dimensiones
	)
		.map(([clave, cantidad]) => `\`${clave}\`: ${cantidad}`)
		.join(', ')}.\n- Códecs: ${Object.entries(resumen.codecs)
		.map(([clave, cantidad]) => `\`${clave}\`: ${cantidad}`)
		.join(
			', '
		)}.\n${upstream ? `\n## Comparación de metadata externa\n\n- Fuente externa: **${upstream.total} registros**.\n- Ejercicios locales emparejados por nombre/ID normalizado: **${upstream.localesEmparejados}**.\n- IDs locales curados sin match automático: **${upstream.localesCuradosSinMatch}**.\n- Diferencia neta de catálogo: **${upstream.faltantesNetos}** ejercicios.\n` : ''}\n## Gate de licencia y pipeline\n\n1. Mantener los MP4 actuales; no convertir el catálogo a GIF ni incorporar posters sin medir primero el beneficio.\n2. No descargar media desde repositorios de terceros: su disponibilidad pública no concede derechos de reutilización.\n3. Para ampliar el catálogo, exigir una licencia documentada por asset y permiso compatible con distribución dentro de la PWA.\n4. Con licencia aprobada: descargar sólo faltantes, validar hash/dimensiones, revisar anatomía y movimiento, convertir a MP4 H.264 360×360, generar manifest de procedencia y ejecutar esta auditoría.\n5. Sin licencia: producir una biblioteca visual original con revisión humana; no usar imágenes generadas por IA como demostración técnica sin esa revisión.\n\nFuentes verificadas el ${resumen.fecha}: [Gym visual Terms](https://gymvisual.com/content/3-terms-and-conditions-of-use), [hasaneyldrm NOTICE](https://github.com/hasaneyldrm/exercises-dataset/blob/main/NOTICE.md) y [ExerciseGymGifsDB README](https://github.com/JahelCuadrado/ExerciseGymGifsDB).\n`;
	await writeFile(path.join(root, 'docs/auditoria-assets.md'), markdown);
}

console.log(JSON.stringify(resumen, null, 2));
