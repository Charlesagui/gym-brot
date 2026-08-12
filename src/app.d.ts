/// <reference types="vite-plugin-pwa/svelte" />

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	/** Hash corto del commit incorporado durante el build. */
	const __APP_COMMIT__: string;

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
