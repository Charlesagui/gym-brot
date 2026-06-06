import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// SPA: la app es client-side (datos en Dexie), con shell de respaldo.
		adapter: adapter({ fallback: 'index.html' })
	}
};

export default config;
