import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buscarEjercicios, catalogo, grupos } from './catalog';

describe('catalogo de ejercicios', () => {
	it('tiene ids unicos, grupos validos y videos presentes sin huerfanos', () => {
		const ids = new Set<string>();
		const videosReferenciados = new Set<string>();
		const videosDir = join(process.cwd(), 'static/videos');

		for (const ejercicio of catalogo) {
			expect(ids.has(ejercicio.id), `id duplicado: ${ejercicio.id}`).toBe(false);
			ids.add(ejercicio.id);
			expect(ejercicio.grupo in grupos, `grupo invalido: ${ejercicio.id}`).toBe(true);
			expect(
				ejercicio.demoVideo.startsWith('/videos/'),
				`demoVideo invalido: ${ejercicio.id}`
			).toBe(true);
			const video = ejercicio.demoVideo.replace('/videos/', '');
			videosReferenciados.add(video);
			expect(existsSync(join(videosDir, video)), `video faltante: ${video}`).toBe(true);
		}

		const videos = execFileSync('git', ['ls-files', 'static/videos/*.mp4'], {
			cwd: process.cwd(),
			encoding: 'utf8'
		})
			.split('\n')
			.filter(Boolean)
			.map((file) => file.replace('static/videos/', ''));
		const huerfanos = videos.filter((video) => !videosReferenciados.has(video));
		expect(huerfanos).toEqual([]);
	});
});

describe('equipamiento del catalogo', () => {
	const EQUIPOS = ['mancuerna', 'barra', 'maquina', 'peso-corporal', 'otro'];

	it('solo usa los cinco equipos del tipo, sin variantes inventadas', () => {
		for (const ejercicio of catalogo) {
			if (ejercicio.equipo === undefined) continue;
			expect(EQUIPOS, `equipo raro en ${ejercicio.id}`).toContain(ejercicio.equipo);
		}
	});

	it('una maquina de placas esta clasificada como maquina', () => {
		// Los dos campos describen lo mismo desde distinto angulo: si se contradicen, uno
		// de los dos le esta mintiendo a la pantalla que lo lea.
		for (const ejercicio of catalogo) {
			if (!ejercicio.maquinaPlacas) continue;
			expect(ejercicio.equipo, `${ejercicio.id} tiene pila de placas`).toBe('maquina');
		}
	});

	it('lo que el nombre dice mancuerna no queda clasificado como otra cosa', () => {
		// La precedencia de `scripts/clasificar-equipo.mjs` es lo que sostiene el paso de
		// peso de 1 kg: si una regla nueva se cuela adelante, esto se cae antes que el gym.
		for (const ejercicio of catalogo) {
			if (!/mancuerna/i.test(ejercicio.nombre)) continue;
			expect(ejercicio.equipo, `${ejercicio.id} se llama mancuerna`).toBe('mancuerna');
		}
	});

	it('clasifica la amplia mayoria del catalogo', () => {
		// No exige el 100%: quedan 95 ejercicios cuyo nombre no dice con que se cargan
		// ("Sentadilla, con peso", "Remo con toalla"), y adivinarles el equipo seria peor
		// que dejarlos vacios. El piso protege contra perder cobertura sin darse cuenta.
		const clasificados = catalogo.filter((ejercicio) => ejercicio.equipo).length;
		expect(clasificados / catalogo.length).toBeGreaterThan(0.85);
	});
});

describe('busqueda de ejercicios', () => {
	it('sin termino devuelve el catalogo completo', () => {
		expect(buscarEjercicios('')).toHaveLength(catalogo.length);
		expect(buscarEjercicios('   ')).toHaveLength(catalogo.length);
	});

	it('encuentra escribiendo sin tildes y sin respetar mayusculas', () => {
		const conTilde = catalogo.find((e) => /[áéíóúñ]/i.test(e.nombre));
		expect(conTilde, 'el catalogo deberia tener algun nombre con tilde').toBeDefined();
		const sinTildes = conTilde!.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

		expect(buscarEjercicios(sinTildes.toUpperCase()).map((e) => e.id)).toContain(conTilde!.id);
	});

	it('busca tambien por musculo, no solo por nombre', () => {
		const ejercicio = catalogo[0]!;
		expect(buscarEjercicios(ejercicio.musculo).map((e) => e.id)).toContain(ejercicio.id);
	});

	it('devuelve vacio cuando no hay coincidencias', () => {
		expect(buscarEjercicios('zzzz-no-existe')).toEqual([]);
	});
});
