import { describe, expect, it } from 'vitest';
import { youtubeEmbedUrl } from './youtube';

const embed =
	'https://www.youtube-nocookie.com/embed/abc_DEF-123?rel=0&modestbranding=1&playsinline=1';

describe('youtubeEmbedUrl', () => {
	it('acepta hosts y formatos validos de YouTube', () => {
		expect(youtubeEmbedUrl('https://youtu.be/abc_DEF-123')).toBe(embed);
		expect(youtubeEmbedUrl('https://www.youtube.com/watch?v=abc_DEF-123')).toBe(embed);
		expect(youtubeEmbedUrl('https://m.youtube.com/shorts/abc_DEF-123')).toBe(embed);
		expect(youtubeEmbedUrl('https://youtube.com/embed/abc_DEF-123')).toBe(embed);
		expect(youtubeEmbedUrl('https://youtube-nocookie.com/embed/abc_DEF-123')).toBe(embed);
	});

	it('rechaza URLs maliciosas o no soportadas', () => {
		expect(youtubeEmbedUrl('https://youtube.com.evil.test/watch?v=abc_DEF-123')).toBeNull();
		expect(youtubeEmbedUrl('javascript:alert(1)')).toBeNull();
		expect(youtubeEmbedUrl('http://youtube.com/watch?v=abc_DEF-123')).toBeNull();
		expect(youtubeEmbedUrl('https://www.youtube.com/redirect?q=https://evil.test')).toBeNull();
		expect(youtubeEmbedUrl('https://www.youtube.com/watch?v=<script>')).toBeNull();
	});
});
