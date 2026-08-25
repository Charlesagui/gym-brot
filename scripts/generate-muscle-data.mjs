import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
// Reescribir el catálogo es una limpieza puntual de campos heredados, no parte de
// regenerar la metadata: sin este flag el generador no toca `exercises.json`, así que
// se puede reproducir la salida y compararla sin pisar el árbol de trabajo.
const reescribirCatalogo = args.includes('--write-catalog');
const [upstreamPath, frontPath, backPath] = args.filter((arg) => !arg.startsWith('--'));
if (!upstreamPath || !frontPath || !backPath) {
	throw new Error(
		'Uso: node scripts/generate-muscle-data.mjs <exercises.json> <FemaleFrontPaths.swift> <FemaleBackPaths.swift> [--write-catalog]'
	);
}

const root = process.cwd();
const local = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/data/exercises.json'), 'utf8'));
const upstream = JSON.parse(fs.readFileSync(upstreamPath, 'utf8'));

const normalizar = (value) =>
	value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

const alias = {
	abdominals: 'abs',
	abs: 'abs',
	'lower-abs': 'abs',
	core: 'abs',
	obliques: 'obliques',
	pectorals: 'chest',
	chest: 'chest',
	'upper-chest': 'chest',
	biceps: 'biceps',
	brachialis: 'biceps',
	triceps: 'triceps',
	delts: 'deltoids',
	deltoids: 'deltoids',
	shoulders: 'deltoids',
	'rear-deltoids': 'deltoids',
	'rotator-cuff': 'deltoids',
	forearms: 'forearms',
	'grip-muscles': 'forearms',
	'wrist-extensors': 'forearms',
	'wrist-flexors': 'forearms',
	wrists: 'forearms',
	quads: 'quadriceps',
	quadriceps: 'quadriceps',
	adductors: 'adductors',
	groin: 'adductors',
	'inner-thighs': 'adductors',
	calves: 'calves',
	soleus: 'calves',
	'ankle-stabilizers': 'calves',
	shins: 'tibialis',
	glutes: 'glutes',
	hamstrings: 'hamstrings',
	lats: 'upper-back',
	'latissimus-dorsi': 'upper-back',
	back: 'upper-back',
	'upper-back': 'upper-back',
	rhomboids: 'upper-back',
	traps: 'trapezius',
	trapezius: 'trapezius',
	'levator-scapulae': 'trapezius',
	'lower-back': 'lower-back',
	spine: 'lower-back',
	'serratus-anterior': 'serratus',
	'hip-flexors': 'hip-flexors'
};

const curated = {
	'prensa-pierna-45': ['quadriceps', ['glutes']],
	'extension-cuadriceps': ['quadriceps', []],
	'curl-femoral': ['hamstrings', []],
	abductores: ['glutes', []],
	aductores: ['adductors', []],
	'patada-gluteo': ['glutes', ['hamstrings']],
	'gemelos-sentado': ['calves', []],
	'prensa-gemelos': ['calves', []],
	'press-pecho': ['chest', ['triceps', 'deltoids']],
	'press-inclinado': ['chest', ['triceps', 'deltoids']],
	'aperturas-pec': ['chest', ['deltoids']],
	'cruce-poleas': ['chest', ['deltoids']],
	'jalon-pecho': ['upper-back', ['biceps']],
	'remo-sentado': ['upper-back', ['biceps']],
	'remo-alto-v': ['upper-back', ['biceps', 'deltoids']],
	'jalon-brazos-rectos': ['upper-back', ['triceps']],
	'press-hombro': ['deltoids', ['triceps']],
	'elevaciones-laterales': ['deltoids', []],
	'deltoide-posterior': ['deltoids', ['upper-back']],
	'face-pull': ['deltoids', ['upper-back']],
	'curl-biceps': ['biceps', ['forearms']],
	'curl-martillo': ['biceps', ['forearms']],
	'curl-concentrado': ['biceps', ['forearms']],
	'triceps-soga': ['triceps', []],
	'triceps-sobre-cabeza': ['triceps', []],
	'triceps-inverso': ['triceps', ['forearms']],
	'crunch-arrodillado': ['abs', []],
	'crunch-sentado': ['abs', []],
	'rodillas-colgado': ['abs', ['hip-flexors']],
	'crunch-inverso': ['abs', ['hip-flexors']]
};

const byName = new Map(upstream.map((exercise) => [normalizar(exercise.name), exercise]));
const metadata = {};
let emparejadosUpstream = 0;
let resueltosCurados = 0;
for (const exercise of local) {
	const source = byName.get(exercise.id) ?? byName.get(normalizar(exercise.nombre));
	let principal;
	let secundarios;
	let fuenteId;
	let noRepresentados = [];
	if (source) {
		emparejadosUpstream++;
		fuenteId = source.id;
		const primaryRaw = normalizar(source.target);
		principal = alias[primaryRaw] ?? null;
		const secondaryRaw = [...new Set(source.secondary_muscles.map(normalizar))];
		secundarios = [...new Set(secondaryRaw.map((item) => alias[item]).filter(Boolean))].filter(
			(item) => item !== principal
		);
		noRepresentados = [primaryRaw, ...secondaryRaw].filter((item) => !alias[item]);
	} else {
		const manual = curated[exercise.id];
		if (!manual) throw new Error(`Falta metadata curada para ${exercise.id}`);
		resueltosCurados++;
		[principal, secundarios] = manual;
	}
	metadata[exercise.id] = {
		principal,
		secundarios,
		aliasesNoRepresentados: [...new Set(noRepresentados)],
		...(fuenteId ? { fuenteId } : { fuente: 'curada' })
	};
}

const catalogoLimpio = local.map((exercise) => {
	const limpio = { ...exercise };
	delete limpio.musculoPrincipal;
	delete limpio.musculosSecundarios;
	delete limpio.aliasMuscularesNoRepresentados;
	return limpio;
});

if (reescribirCatalogo) {
	fs.writeFileSync(
		path.join(root, 'src/lib/data/exercises.json'),
		`${JSON.stringify(catalogoLimpio, null, '\t')}\n`
	);
}

const codigo = {
	abs: 'a',
	biceps: 'b',
	chest: 'c',
	deltoids: 'd',
	forearms: 'f',
	glutes: 'g',
	hamstrings: 'h',
	'hip-flexors': 'i',
	'lower-back': 'l',
	obliques: 'o',
	quadriceps: 'q',
	adductors: 'r',
	serratus: 's',
	triceps: 't',
	'upper-back': 'u',
	calves: 'v',
	tibialis: 'w',
	trapezius: 'z'
};
const metadataCompacta = local.map((exercise) => {
	const meta = metadata[exercise.id];
	return [
		meta.principal ? codigo[meta.principal] : '',
		meta.secundarios.map((musculo) => codigo[musculo]).join(''),
		meta.aliasesNoRepresentados.join('|')
	];
});
fs.writeFileSync(
	path.join(root, 'src/lib/data/exercise-muscles.ts'),
	`/** Metadata MIT alineada por índice con exercises.json. Generada; ver scripts/generate-muscle-data.mjs. */\nexport const MUSCULOS_COMPACTOS = ${JSON.stringify(metadataCompacta)} as const;\n`
);

const bases = {
	front: new Set([
		'chest',
		'abs',
		'biceps',
		'triceps',
		'deltoids',
		'obliques',
		'quadriceps',
		'calves',
		'adductors',
		'trapezius',
		'forearm',
		'tibialis',
		'serratus',
		'hipFlexors'
	]),
	back: new Set([
		'neck',
		'trapezius',
		'deltoids',
		'upperBack',
		'triceps',
		'lowerBack',
		'forearm',
		'gluteal',
		'adductors',
		'hamstring',
		'calves'
	])
};

function parsePaths(file, side) {
	const source = fs.readFileSync(file, 'utf8');
	const result = [];
	const block = /BodyPartPathData\(\s*slug: \.(\w+),([\s\S]*?)\n\s*\),/g;
	for (const match of source.matchAll(block)) {
		const slug = match[1];
		if (!bases[side].has(slug)) continue;
		const paths = [];
		for (const array of match[2].matchAll(/(?:common|left|right): \[([\s\S]*?)\]/g)) {
			for (const string of array[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
				const path = JSON.parse(`"${string[1]}"`).replace(/-?(?:\d+\.?\d*|\.\d+)/g, (raw) => {
					const redondeado = String(Math.round(Number(raw)));
					return redondeado.replace(/^0\./, '.').replace(/^-0\./, '-.');
				});
				paths.push(path);
			}
		}
		result.push({ slug, paths });
	}
	return result;
}

const geometry = {
	front: { viewBox: '0 0 650 1450', zones: parsePaths(frontPath, 'front') },
	back: { viewBox: '823 0 650 1450', zones: parsePaths(backPath, 'back') }
};

fs.writeFileSync(
	path.join(root, 'src/lib/body-geometry.ts'),
	`/** Geometría derivada de MuscleMap (MIT), cargada sólo al abrir el mapa. Ver THIRD_PARTY_NOTICES.md. */\nexport const GEOMETRIA_CUERPO = ${JSON.stringify(geometry)} as const;\n`
);

// Contadores medidos, no deducidos: un id curado que además empareja con upstream se
// resuelve por upstream, y restar el tamaño del mapa curado lo contaría igual.
const curadosSinUsar = Object.keys(curated).filter((id) => !local.some((e) => e.id === id));
console.log(
	JSON.stringify({
		ejercicios: local.length,
		emparejadosUpstream,
		resueltosCurados,
		curadosDefinidos: Object.keys(curated).length,
		curadosSinUsar,
		catalogoReescrito: reescribirCatalogo
	})
);
