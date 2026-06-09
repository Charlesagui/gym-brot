<script lang="ts">
	import { page } from '$app/stores';
</script>

<nav class="bottom-nav">
	<a href="/" class="nav-item" class:active={$page.url.pathname === '/'}>
		<span class="icon">🏠</span>
		<span class="label">Rutinas</span>
	</a>
	<a href="/ajustes" class="nav-item" class:active={$page.url.pathname === '/ajustes'}>
		<span class="icon">⚙️</span>
		<span class="label">Ajustes</span>
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
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex: 1;
		height: 100%;
		text-decoration: none;
		color: var(--muted, #9aa0b4);
		transition: color 0.2s ease, transform 0.1s ease;
		font-size: 10px;
		font-weight: 600;
		gap: 3px;
	}

	.nav-item:active {
		transform: scale(0.96);
	}

	.icon {
		font-size: 20px;
	}

	.active {
		color: var(--accent, rgb(99 102 241));
	}
</style>
