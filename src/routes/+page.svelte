<script lang="ts">
	import { catalogo, grupos, type Grupo } from '$lib/catalog';

	// Una muestra por grupo para previsualizar la tarjeta con su glow.
	const orden: Grupo[] = ['piernas', 'pecho', 'espalda', 'hombros', 'brazos', 'core'];
	const muestras = orden
		.map((g) => catalogo.find((e) => e.grupo === g))
		.filter((e): e is (typeof catalogo)[number] => Boolean(e));
</script>

<main class="glow-bg min-h-dvh px-5 py-10">
	<header class="text-center">
		<h1 class="text-4xl font-extrabold tracking-tight">
			GYM<span style="color: var(--accent)">·</span>BROT
		</h1>
		<p class="mt-2 text-sm" style="color: var(--muted)">
			{catalogo.length} ejercicios · offline ✓
		</p>
	</header>

	<section class="mx-auto mt-8 grid max-w-md grid-cols-2 gap-3">
		{#each muestras as e (e.id)}
			{@const g = grupos[e.grupo]}
			<article
				class="relative overflow-hidden rounded-2xl border border-white/10 p-3"
				style="background: radial-gradient(130% 80% at 50% 0%, rgb({g.glow} / 0.22), transparent 62%), var(--surface)"
			>
				<img
					src={e.gif}
					alt={e.nombre}
					class="aspect-square w-full rounded-xl bg-white object-contain"
					loading="lazy"
				/>
				<p class="mt-2 text-sm font-semibold leading-tight">{e.nombre}</p>
				<p class="mt-0.5 text-xs font-medium" style="color: rgb({g.glow})">
					{g.emoji} {g.label}
				</p>
			</article>
		{/each}
	</section>

	<p class="mt-8 text-center text-xs" style="color: var(--muted)">
		Vista previa de tarjetas · Fase 0
	</p>
</main>
