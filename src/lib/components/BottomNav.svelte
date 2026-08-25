<script lang="ts">
	import { page } from '$app/stores';

	const ruta = $derived($page.url.pathname);
	const rutinasActivas = $derived(ruta === '/' || ruta.startsWith('/dia/'));
	const discosActivo = $derived(ruta.startsWith('/herramientas/discos'));
	const historialActivo = $derived(ruta === '/historial' || ruta.startsWith('/historial/'));
	const ajustesActivo = $derived(ruta === '/ajustes');
</script>

<nav class="bottom-nav">
	<a
		href="/"
		class="nav-item"
		class:active={rutinasActivas}
		aria-current={rutinasActivas ? 'page' : undefined}
	>
		<span class="icono">
			<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path
					d="M4 11.5 12 4l8 7.5"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<path
					d="M6 10v8.5a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1V10"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</span>
		<span class="label">Rutinas</span>
	</a>
	<a
		href="/herramientas/discos"
		class="nav-item"
		class:active={discosActivo}
		aria-current={discosActivo ? 'page' : undefined}
	>
		<span class="icono">
			<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path d="M7 12h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
				<path
					d="M4 9v6M7 8v8M17 8v8M20 9v6"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				/>
			</svg>
		</span>
		<span class="label">Discos</span>
	</a>
	<a
		href="/historial"
		class="nav-item"
		class:active={historialActivo}
		aria-current={historialActivo ? 'page' : undefined}
	>
		<span class="icono">
			<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path
					d="M4 15.5 9.5 10l3.5 3.5L20 6"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<path
					d="M14.5 6H20v5.5"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<path
					d="M4 19h16"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					opacity="0.5"
				/>
			</svg>
		</span>
		<span class="label">Historial</span>
	</a>
	<a
		href="/ajustes"
		class="nav-item"
		class:active={ajustesActivo}
		aria-current={ajustesActivo ? 'page' : undefined}
	>
		<span class="icono">
			<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" />
				<path
					d="M12 3.5c.5 0 1 .04 1.47.12l.7 1.87a7.9 7.9 0 0 1 1.9 1.1l1.96-.46c.63.68 1.15 1.46 1.53 2.32l-1.2 1.63a7.9 7.9 0 0 1 0 2.2l1.2 1.63c-.38.86-.9 1.64-1.53 2.32l-1.96-.46a7.9 7.9 0 0 1-1.9 1.1l-.7 1.87A8.6 8.6 0 0 1 12 20.5c-.5 0-1-.04-1.47-.12l-.7-1.87a7.9 7.9 0 0 1-1.9-1.1l-1.96.46a8.6 8.6 0 0 1-1.53-2.32l1.2-1.63a7.9 7.9 0 0 1 0-2.2l-1.2-1.63c.38-.86.9-1.64 1.53-2.32l1.96.46a7.9 7.9 0 0 1 1.9-1.1l.7-1.87A8.6 8.6 0 0 1 12 3.5Z"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linejoin="round"
				/>
			</svg>
		</span>
		<span class="label">Ajustes</span>
	</a>
</nav>

<style>
	.bottom-nav {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		/* Se acopla al ancho del shell (`max-w-md`) sin repetir el número. */
		max-width: inherit;
		margin: 0 auto;
		/* El área segura se suma a la altura además de ir al padding. Con `box-sizing:
		   border-box` un `height` fijo la descontaba del contenido: en un iPhone con
		   indicador de home, los 34 px salían de los ítems y la barra quedaba aplastada. */
		height: calc(64px + env(safe-area-inset-bottom, 0px));
		padding-bottom: env(safe-area-inset-bottom, 0px);
		background: color-mix(in oklab, var(--surface) 92%, transparent);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		border-top: 1px solid rgba(255, 255, 255, 0.07);
		display: flex;
		z-index: 40;
	}

	.nav-item {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex: 1;
		gap: 4px;
		text-decoration: none;
		color: var(--muted, #9aa0b4);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.01em;
		-webkit-tap-highlight-color: transparent;
		transition: color var(--dur-base) var(--ease-out);
	}

	/* Cápsula de ancho fijo detrás del icono. Antes el fondo del activo se dimensionaba
	   con un inset porcentual sobre el ítem entero, así que encuadraba distinto en cada
	   pestaña y abrazaba la palabra: "Historial" recibía una cápsula más ancha que
	   "Ajustes". El icono mide siempre lo mismo, la etiqueta no. */
	.icono {
		display: grid;
		place-items: center;
		width: 56px;
		height: 30px;
		border-radius: 999px;
		background: rgb(var(--accent-rgb) / 0);
		transition: background-color var(--dur-base) var(--ease-out);
	}

	.active .icono {
		background: rgb(var(--accent-rgb) / 0.18);
	}

	.icon {
		display: block;
		width: 21px;
		height: 21px;
	}

	.label {
		line-height: 1;
	}

	/* Segunda señal además del color, para no distinguir sólo por tono. La etiqueta
	   está centrada dentro de un ítem de ancho fijo: engordarla no corre nada. */
	.active .label {
		font-weight: 800;
	}

	.active {
		color: var(--accent-text, rgb(130 104 255));
	}

	.nav-item:focus-visible {
		outline: none;
	}
	.nav-item:focus-visible .icono {
		outline: 3px solid var(--accent-text);
		outline-offset: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-item,
		.icono {
			transition: none;
		}
	}

	@media (orientation: landscape) and (max-height: 520px) {
		.bottom-nav {
			max-width: min(100vw, 64rem);
			height: calc(52px + env(safe-area-inset-bottom, 0px));
		}

		.nav-item {
			flex-direction: row;
			gap: 8px;
		}

		.icono {
			width: 34px;
			height: 26px;
		}

		.icon {
			width: 18px;
			height: 18px;
		}
	}
</style>
