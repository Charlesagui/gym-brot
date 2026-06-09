<script lang="ts">
	import type { Ajustes } from '$lib/db';
	import {
		ajustesObs,
		setUnidad,
		setSonido,
		setMetricaPr,
		exportarJSON,
		parseBackup,
		importarBackup,
		AJUSTES_DEFAULT
	} from '$lib/extras';

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
			const data = parseBackup(await file.text());
			const nDias = data.dias?.length ?? 0;
			const ok = confirm(
				`⚠️ Esto REEMPLAZA todos tus datos actuales por los del backup ` +
					`(${nDias} ${nDias === 1 ? 'día' : 'días'}).\n\nNo se puede deshacer. ¿Continuar?`
			);
			if (!ok) {
				msg = 'Importación cancelada';
				return;
			}
			await importarBackup(data);
			msg = '✅ Datos restaurados';
		} catch {
			msg = '❌ Archivo inválido';
		} finally {
			input.value = '';
		}
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
		<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
			Métrica de PR
		</p>
		<div class="mt-3 grid grid-cols-2 gap-2">
			<button
				onclick={() => setMetricaPr('peso')}
				class="rounded-xl px-2 py-2.5 text-sm font-semibold"
				style={ajustes.metricaPr === 'peso'
					? 'background: var(--accent); color: white'
					: 'background: rgba(255,255,255,.06); color: var(--muted)'}>Peso máximo</button
			>
			<button
				onclick={() => setMetricaPr('e1rm')}
				class="rounded-xl px-2 py-2.5 text-sm font-semibold"
				style={ajustes.metricaPr === 'e1rm'
					? 'background: var(--accent); color: white'
					: 'background: rgba(255,255,255,.06); color: var(--muted)'}>1RM (1 rep. máx.)</button
			>
		</div>
		<p class="mt-2 text-xs" style="color: var(--muted)">
			{ajustes.metricaPr === 'e1rm'
				? 'El récord estima tu 1 Repetición Máxima (1RM) usando peso y reps (Epley): 95 × 12 supera a 100 × 1. Premia la sobrecarga por repeticiones.'
				: 'El récord es la serie de mayor peso, sin importar las reps. Simple y directo.'}
		</p>
	</section>

	<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
		<div class="flex items-center justify-between gap-4">
			<div>
				<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
					Sonido
				</p>
				<p class="mt-1 text-xs" style="color: var(--muted)">Sets, PR y descansos</p>
			</div>
			<button
				onclick={() => setSonido(!ajustes.sonido)}
				aria-pressed={ajustes.sonido}
				class="min-w-16 rounded-full px-4 py-2 text-sm font-bold"
				style={ajustes.sonido
					? 'background: var(--accent); color: white'
					: 'background: rgba(255,255,255,.06); color: var(--muted)'}
				>{ajustes.sonido ? 'On' : 'Off'}</button
			>
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
