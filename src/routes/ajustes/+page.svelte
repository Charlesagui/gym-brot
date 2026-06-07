<script lang="ts">
	import type { Ajustes } from '$lib/db';
	import { ajustesObs, setUnidad, exportarJSON, importarJSON, AJUSTES_DEFAULT } from '$lib/extras';

	let ajustes = $state<Ajustes>(AJUSTES_DEFAULT);
	let msg = $state('');

	$effect(() => {
		const sub = ajustesObs().subscribe((a) => (ajustes = a));
		return () => sub.unsubscribe();
	});

	async function exportar() {
		const json = await exportarJSON();
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `gym-brot-backup-${new Date().toLocaleDateString('sv')}.json`;
		a.click();
		URL.revokeObjectURL(url);
		msg = '✅ Backup descargado';
	}

	async function importar(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			await importarJSON(await file.text());
			msg = '✅ Datos restaurados';
		} catch {
			msg = '❌ Archivo inválido';
		}
		input.value = '';
	}
</script>

<main class="glow-bg min-h-dvh px-5 pb-12 pt-6">
	<header class="mb-6 flex items-center gap-3">
		<a
			href="/"
			class="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
			aria-label="Volver">←</a
		>
		<h1 class="text-xl font-bold">Ajustes</h1>
	</header>

	<section class="rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
		<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
			Unidad de peso
		</p>
		<div class="mt-3 flex gap-2">
			{#each ['kg', 'lb'] as u (u)}
				<button
					onclick={() => setUnidad(u as 'kg' | 'lb')}
					class="flex-1 rounded-xl py-2.5 font-semibold"
					style={ajustes.unidad === u
						? 'background: var(--accent); color: white'
						: 'background: rgba(255,255,255,.06); color: var(--muted)'}>{u}</button
				>
			{/each}
		</div>
	</section>

	<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
		<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">Backup</p>
		<p class="mt-1 text-xs" style="color: var(--muted)">
			Guardá una copia de tus rutinas y progreso (importante en iPhone, que puede borrar datos
			locales).
		</p>
		<button
			onclick={exportar}
			class="mt-3 w-full rounded-xl py-3 font-semibold"
			style="background: var(--accent); color: white">⬇️ Exportar datos</button
		>
		<label
			class="mt-2 block w-full cursor-pointer rounded-xl border border-white/15 py-3 text-center font-semibold"
		>
			⬆️ Importar datos
			<input type="file" accept="application/json" onchange={importar} class="hidden" />
		</label>
		{#if msg}<p class="mt-3 text-center text-sm font-medium">{msg}</p>{/if}
	</section>

	<p class="mt-8 text-center text-xs" style="color: var(--muted)">
		Gym-brot · todo se guarda en tu teléfono 📴
	</p>
</main>
