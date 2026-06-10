import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { catalogo, grupos } from './catalog';

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
