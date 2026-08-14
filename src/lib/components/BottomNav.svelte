<script lang="ts">
	import { page } from '$app/stores';

	const ruta = $derived($page.url.pathname);
	const rutinasActivas = $derived(ruta === '/' || ruta.startsWith('/dia/'));
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
		<span class="pill" aria-hidden="true"></span>
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
		<span class="label">Rutinas</span>
		<span class="indicator" aria-hidden="true"></span>
	</a>
	<a
		href="/historial"
		class="nav-item"
		class:active={historialActivo}
		aria-current={historialActivo ? 'page' : undefined}
	>
		<span class="pill" aria-hidden="true"></span>
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
		<span class="label">Historial</span>
		<span class="indicator" aria-hidden="true"></span>
	</a>
	<a
		href="/ajustes"
		class="nav-item"
		class:active={ajustesActivo}
		aria-current={ajustesActivo ? 'page' : undefined}
	>
		<span class="pill" aria-hidden="true"></span>
		<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" />
			<path
				d="M12 3.5c.5 0 1 .04 1.47.12l.7 1.87a7.9 7.9 0 0 1 1.9 1.1l1.96-.46c.63.68 1.15 1.46 1.53 2.32l-1.2 1.63a7.9 7.9 0 0 1 0 2.2l1.2 1.63c-.38.86-.9 1.64-1.53 2.32l-1.96-.46a7.9 7.9 0 0 1-1.9 1.1l-.7 1.87A8.6 8.6 0 0 1 12 20.5c-.5 0-1-.04-1.47-.12l-.7-1.87a7.9 7.9 0 0 1-1.9-1.1l-1.96.46a8.6 8.6 0 0 1-1.53-2.32l1.2-1.63a7.9 7.9 0 0 1 0-2.2l-1.2-1.63c.38-.86.9-1.64 1.53-2.32l1.96.46a7.9 7.9 0 0 1 1.9-1.1l.7-1.87A8.6 8.6 0 0 1 12 3.5Z"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linejoin="round"
			/>
		</svg>
		<span class="label">Ajustes</span>
		<span class="indicator" aria-hidden="true"></span>
	</a>
</nav>

<style>
	.bottom-nav {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		max-width: inherit;
		margin: 0 auto;
		height: 64px;
		background: color-mix(in oklab, var(--surface) 90%, transparent);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		display: flex;
		justify-content: space-around;
		align-items: center;
		z-index: 40;
		padding-bottom: env(safe-area-inset-bottom);
	}

	.nav-item {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex: 1;
		height: 100%;
		text-decoration: none;
		color: var(--muted, #9aa0b4);
		font-size: 11px;
		font-weight: 700;
		gap: 3px;
	}

	/* Cápsula detrás del ítem activo: la distinción no depende solo del color. */
	.pill {
		position: absolute;
		inset: 8px 14%;
		border-radius: 999px;
		background: rgb(var(--accent-rgb) / 0.14);
		opacity: 0;
		transform: scale(0.85);
		transition:
			opacity var(--dur-base) var(--ease-out),
			transform var(--dur-base) var(--ease-out);
	}
	.active .pill {
		opacity: 1;
		transform: scale(1);
	}

	.icon {
		width: 21px;
		height: 21px;
		position: relative;
	}

	.label {
		position: relative;
	}

	/* Línea corta bajo el ítem activo: segunda señal además de color + cápsula. */
	.indicator {
		position: absolute;
		bottom: 2px;
		width: 3px;
		height: 3px;
		border-radius: 999px;
		background: var(--accent-text, rgb(130 104 255));
		opacity: 0;
		transform: scale(0.4);
		transition:
			opacity var(--dur-base) var(--ease-out),
			transform var(--dur-base) var(--ease-out);
	}
	.active .indicator {
		opacity: 1;
		transform: scale(1);
	}

	.active {
		color: var(--accent-text, rgb(130 104 255));
	}

	@media (prefers-reduced-motion: reduce) {
		.pill,
		.indicator {
			transition: none;
		}
	}

	@media (orientation: landscape) and (max-height: 520px) {
		.bottom-nav {
			max-width: min(100vw, 64rem);
			height: 52px;
		}

		.nav-item {
			flex-direction: row;
			gap: 6px;
			font-size: 11px;
		}

		.pill {
			inset: 6px 6%;
		}

		.icon {
			width: 18px;
			height: 18px;
		}
	}
</style>
