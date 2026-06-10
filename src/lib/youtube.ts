const YOUTUBE_ID_RE = /^[\w-]{6,}$/;

export function youtubeEmbedUrl(url: string): string | null {
	try {
		const u = new URL(url);
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
		let id = '';
		if (host === 'youtu.be') id = u.pathname.split('/').filter(Boolean)[0] ?? '';
		else if (
			host === 'youtube.com' ||
			host.endsWith('.youtube.com') ||
			host === 'youtube-nocookie.com'
		) {
			if (u.pathname === '/watch') id = u.searchParams.get('v') ?? '';
			else if (u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/embed/')) {
				id = u.pathname.split('/').filter(Boolean)[1] ?? '';
			}
		}
		if (!YOUTUBE_ID_RE.test(id)) return null;
		return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1&playsinline=1`;
	} catch {
		return null;
	}
}
