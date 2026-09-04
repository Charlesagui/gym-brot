import fs from 'node:fs';
import path from 'node:path';

/**
 * Rellena `Ejercicio.equipo` en el catálogo, y usa wger como segunda opinión.
 *
 * Por qué las reglas y no la base ajena. La idea original era importar el equipamiento
 * desde wger (871 ejercicios, CC-BY-SA, API pública). Medido, el cruce no da: los dos
 * catálogos comparten 30 nombres exactos de 962, un 3%. Los nombres de acá son propios
 * ("Jalón al pecho (polea)", "Press de pecho en máquina") y dicen el equipamiento en
 * castellano, así que la fuente más precisa para ESTE catálogo es su propio vocabulario.
 *
 * Entonces wger queda donde sí sirve: como control. Sobre los 30 que sí cruzan, la regla
 * y wger opinan lo mismo en 20 de 22 —los dos desacuerdos son criterio, no error— y wger
 * resuelve 8 que la regla no puede. Eso es lo que hace que las reglas se puedan defender:
 * no son una corazonada, están contrastadas contra una base independiente.
 *
 * Uso:
 *   node scripts/clasificar-equipo.mjs --fetch-wger .tmp/wger.json   # baja el snapshot
 *   node scripts/clasificar-equipo.mjs --wger .tmp/wger.json         # mide, no escribe
 *   node scripts/clasificar-equipo.mjs --wger .tmp/wger.json --write # aplica
 *
 * Los datos de ejercicios de wger son CC-BY-SA: lo que entra de ahí se atribuye en
 * Ajustes → Acerca de. Ver https://wger.de y su API en /api/v2/exerciseinfo/.
 */

const args = process.argv.slice(2);
const valorArg = (nombre) => {
	const i = args.indexOf(nombre);
	return i >= 0 ? args[i + 1] : undefined;
};
const escribir = args.includes('--write');
const destinoFetch = valorArg('--fetch-wger');
const wgerPath = valorArg('--wger');

const root = process.cwd();
const catalogoPath = path.join(root, 'src/lib/data/exercises.json');

const normalizar = (valor) =>
	valor
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

// --- Descarga del snapshot -------------------------------------------------------

if (destinoFetch) {
	const todos = [];
	let url = 'https://wger.de/api/v2/exerciseinfo/?format=json&limit=100';
	while (url) {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`wger respondió ${res.status}`);
		const pagina = await res.json();
		todos.push(...pagina.results);
		url = pagina.next;
	}
	fs.mkdirSync(path.dirname(destinoFetch), { recursive: true });
	fs.writeFileSync(destinoFetch, JSON.stringify(todos));
	console.log(JSON.stringify({ descargados: todos.length, destino: destinoFetch }));
	process.exit(0);
}

// --- Reglas ----------------------------------------------------------------------

/**
 * El orden es la precedencia, y sigue una sola idea: manda lo que cargás, no el gesto.
 * Una plancha "con disco" no es peso corporal y un curl "en polea" no es de barra
 * aunque el nombre diga barra, así que el equipamiento nombrado se lee antes que el
 * movimiento y el peso corporal queda último, de última opción.
 *
 * `ez` está separado de `barra` sólo porque aparece sin ella ("Curl EZ"); Smith cuenta
 * como barra y no como máquina porque lo que se carga son discos en una barra, que es
 * lo que decide los controles — la pila de placas ya tiene su propio flag.
 */
const REGLAS = [
	['mancuerna', ['mancuerna', 'mancuernas']],
	[
		'otro',
		[
			'banda',
			'bandas',
			'goma',
			'gomas',
			'kettlebell',
			'kettlebells',
			'trx',
			'fitball',
			'balon',
			'pelota',
			'rueda',
			'disco',
			'discos',
			'landmine',
			'saco',
			'mazo',
			'trineo',
			'anillas',
			'bosu',
			'medicinal',
			'battle',
			'soga'
		]
	],
	[
		'maquina',
		[
			'polea',
			'poleas',
			'maquina',
			'maquinas',
			'prensa',
			'pec deck',
			'multipower',
			'cable',
			'hack',
			'silla romana'
		]
	],
	['barra', ['barra', 'barras', 'smith', 'ez', 'high bar', 'low bar']],
	[
		'peso-corporal',
		[
			'peso corporal',
			'dominada',
			'dominadas',
			'fondo',
			'fondos',
			'flexion',
			'flexiones',
			'plancha',
			'burpee',
			'crunch',
			'sit up',
			'situp',
			'curl up',
			'abdominal',
			'abdominales',
			'colgado',
			'colgada',
			'puente',
			'escalador',
			'dead bug',
			'lever',
			'muscle up',
			'pike',
			'estocada',
			'estocadas',
			'zancada',
			'zancadas',
			'sissy squat',
			'split squat',
			'glute ham raise',
			'nordico',
			'remo invertido',
			'toques de talon',
			'codo a rodilla',
			'bicicleta abdominal'
		]
	]
];

/**
 * "Con peso", "lastrado" y compañía apagan el peso corporal: un crunch con mancuerna
 * en la mano no se registra como un crunch a secas. Lo delató el cruce con wger, que
 * marcaba "Crunch con peso" como mancuerna cuando la regla lo daba por peso corporal;
 * como acá el nombre no dice CON QUÉ, se deja sin clasificar en vez de adivinar.
 */
const LASTRE = ['con peso', 'lastrado', 'lastrada', 'con carga'];

/**
 * Los que el nombre no alcanza a resolver, decididos a mano por id.
 *
 * Salieron del control con wger: donde las dos fuentes discrepaban, ninguna tenía razón
 * sola. "Dominada asistida" es la máquina de contrapeso, no peso corporal, y la regla no
 * podía saberlo; "Rueda abdominal" sí es un implemento y ahí la regla le gana a wger, que
 * la cuenta como peso corporal. Un mapa corto y explícito es más honesto que estirar las
 * reglas hasta que estos entren de casualidad y arrastren a otros diez con ellos.
 */
const CURADOS = {
	'assisted-pull-up': 'maquina'
};

function porReglas(ejercicio) {
	const curado = CURADOS[ejercicio.id];
	if (curado) return { equipo: curado, motivo: 'curado' };
	// Lo curado a mano manda: una máquina de placas es una máquina, sin inferir nada.
	if (ejercicio.maquinaPlacas) return { equipo: 'maquina', motivo: 'maquinaPlacas' };
	const nombre = normalizar(ejercicio.nombre);
	const palabras = new Set(nombre.split(' '));
	const lastrado = LASTRE.some((frase) => nombre.includes(frase));
	for (const [equipo, claves] of REGLAS) {
		if (equipo === 'peso-corporal' && lastrado) return { equipo: null, motivo: 'lastre' };
		for (const clave of claves) {
			const pega = clave.includes(' ') ? nombre.includes(clave) : palabras.has(clave);
			if (pega) return { equipo, motivo: `nombre:${clave}` };
		}
	}
	return { equipo: null, motivo: null };
}

// --- wger como control -----------------------------------------------------------

/**
 * El vocabulario de wger traducido al de acá. `Bench`, `Incline bench` y `Gym mat` no
 * son la carga sino el mueble donde te apoyás: no definen el equipo y se ignoran, o
 * cada press en banco plano quedaría clasificado como "banco".
 */
const MAPA_WGER = {
	Barbell: 'barra',
	'SZ-Bar': 'barra',
	Dumbbell: 'mancuerna',
	Kettlebell: 'otro',
	'Resistance band': 'otro',
	'Swiss Ball': 'otro',
	'Cable machine': 'maquina',
	'Pull-up bar': 'peso-corporal',
	'none (bodyweight exercise)': 'peso-corporal'
};
const MUEBLES_WGER = new Set(['Bench', 'Incline bench', 'Gym mat']);

function indiceWger(datos) {
	const porNombre = new Map();
	for (const ejercicio of datos) {
		const equipos = new Set(
			(ejercicio.equipment ?? [])
				.filter((eq) => !MUEBLES_WGER.has(eq.name))
				.map((eq) => MAPA_WGER[eq.name])
				.filter(Boolean)
		);
		// Con dos equipamientos distintos wger no está diciendo cuál manda: no opina.
		if (equipos.size !== 1) continue;
		const [equipo] = equipos;
		for (const t of ejercicio.translations ?? []) {
			if (t.language === 2 || t.language === 4) {
				const clave = normalizar(t.name);
				if (!porNombre.has(clave)) porNombre.set(clave, equipo);
			}
		}
	}
	return porNombre;
}

// --- Ejecución -------------------------------------------------------------------

const catalogo = JSON.parse(fs.readFileSync(catalogoPath, 'utf8'));
const wger = wgerPath ? indiceWger(JSON.parse(fs.readFileSync(wgerPath, 'utf8'))) : new Map();

const cuenta = { yaTenia: 0, porReglas: 0, porWger: 0, sinClasificar: 0 };
const control = { coincide: 0, difiere: 0 };
const desacuerdos = [];
const sinResolver = [];

for (const ejercicio of catalogo) {
	const opinionWger = wger.get(normalizar(ejercicio.nombre)) ?? null;
	const { equipo: regla } = porReglas(ejercicio);

	if (regla && opinionWger) {
		if (regla === opinionWger) control.coincide++;
		else {
			control.difiere++;
			desacuerdos.push({ nombre: ejercicio.nombre, regla, wger: opinionWger });
		}
	}

	// Un valor ya cargado no se pisa: fue curado a mano y sabe cosas que el nombre no
	// dice (una apertura en fitball se hace con mancuerna, y el nombre sólo dice fitball).
	if (ejercicio.equipo) {
		cuenta.yaTenia++;
		continue;
	}
	const equipo = regla ?? opinionWger;
	if (!equipo) {
		cuenta.sinClasificar++;
		sinResolver.push(ejercicio.nombre);
		continue;
	}
	if (regla) cuenta.porReglas++;
	else cuenta.porWger++;
	if (escribir) ejercicio.equipo = equipo;
}

if (escribir) {
	fs.writeFileSync(catalogoPath, `${JSON.stringify(catalogo, null, '\t')}\n`);
}

console.log(
	JSON.stringify(
		{
			ejercicios: catalogo.length,
			...cuenta,
			control: { ...control, desacuerdos },
			// Se listan enteros a propósito: un ejercicio sin equipo no es un bug, pero sí
			// algo que hay que poder mirar de un vistazo antes de aceptar la corrida.
			sinResolver: args.includes('--listar') ? sinResolver : sinResolver.length,
			catalogoEscrito: escribir
		},
		null,
		2
	)
);
