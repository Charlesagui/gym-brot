<script lang="ts">
	import type { Ajustes } from '$lib/db';
	import { DESCRIPCION_METRICA } from '$lib/sesion';
	import {
		ajustesObs,
		setUnidad,
		toggleSonido,
		toggleVibracion,
		toggleDescansoPantallaCompleta,
		setMetricaPr,
		setPasoPeso,
		exportarJSON,
		parseBackup,
		prepararImport,
		importarBackup,
		registrarBackup,
		borrarTodo,
		AJUSTES_DEFAULT
	} from '$lib/extras';
	import { reiniciarAyudas } from '$lib/preferencias-ui';
	import {
		borrarVideosGuardados,
		cachearVideoCompleto,
		contarVideosGuardados,
		hayEspacioParaReserva,
		RESERVA_VIDEOTECA_COMPLETA
	} from '$lib/video';
	import { estadoLiveQuery } from '$lib/live';
	import { descanso } from '$lib/descanso.svelte';
	import { onMount } from 'svelte';
	import ConfirmSheet from '$lib/components/ConfirmSheet.svelte';

	const ajustesStore = estadoLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const consultaAjustes = $derived($ajustesStore);
	const ajustes = $derived<Ajustes>(consultaAjustes.valor);
	let msg = $state('');
	let msgId: ReturnType<typeof setTimeout> | null = null;
	let guardandoUnidad = $state(false);
	let backupPendienteConfirmacion = $state(false);
	let avisosImport = $state<string[]>([]);
	let persistido = $state<boolean | null>(null);
	let confirmacion = $state<{
		titulo: string;
		mensaje: string;
		confirmarTexto: string;
		onConfirm: () => void | Promise<void>;
		onCancel?: () => void;
	} | null>(null);

	onMount(() => {
		void navigator.storage?.persisted?.().then((v) => (persistido = v));
		void refrescarVideosGuardados();
		return () => {
			if (msgId) clearTimeout(msgId);
			cancelarDescarga?.abort();
		};
	});

	function avisar(texto: string) {
		msg = texto;
		if (msgId) clearTimeout(msgId);
		msgId = setTimeout(() => (msg = ''), 6000);
	}

	function guardarAjuste(operacion: Promise<unknown>, nombre: string) {
		void operacion.catch((error: unknown) => {
			console.error(`No se pudo guardar ${nombre}`, error);
			avisar(`❌ No se pudo guardar ${nombre}. Intentá de nuevo.`);
		});
	}

	async function cambiarUnidad(unidad: 'kg' | 'lb') {
		if (guardandoUnidad || ajustes.unidad === unidad) return;
		guardandoUnidad = true;
		try {
			await setUnidad(unidad);
		} catch (e) {
			avisar(`❌ No se pudo cambiar la unidad: ${e instanceof Error ? e.message : 'error'}`);
		} finally {
			guardandoUnidad = false;
		}
	}

	async function exportar() {
		try {
			const json = await exportarJSON();
			const blob = new Blob([json], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `gym-brot-backup-${new Date().toLocaleDateString('sv')}.json`;
			a.rel = 'noopener';
			// El anchor tiene que estar en el documento y la URL no puede revocarse en el
			// mismo tick: así fallaba la descarga, en silencio, en varios navegadores móviles.
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
			// Un click sobre un anchor no confirma que el navegador haya guardado el
			// archivo (puede cancelarse o bloquearse). El usuario lo confirma después
			// de verlo en Descargas; recién ahí se apaga el recordatorio.
			backupPendienteConfirmacion = true;
			avisar('⬇️ Descarga iniciada. Confirmá que el archivo aparezca en Descargas.');
		} catch (e) {
			avisar(`❌ No se pudo generar el backup: ${e instanceof Error ? e.message : 'error'}`);
		}
	}

	async function confirmarBackupGuardado() {
		try {
			await registrarBackup();
			backupPendienteConfirmacion = false;
			avisar('✅ Backup confirmado');
		} catch (e) {
			avisar(`❌ No se pudo registrar el backup: ${e instanceof Error ? e.message : 'error'}`);
		}
	}

	async function importar(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		avisosImport = [];
		try {
			const data = parseBackup(await file.text());
			const preparado = prepararImport(data);
			const nDias = data.dias?.length ?? 0;
			const detalleAvisos = preparado.avisos.length
				? `\n\nAntes de restaurar: ${preparado.avisos.join('. ')}.`
				: '';
			confirmacion = {
				titulo: 'Restaurar backup',
				mensaje:
					`Esto reemplaza todos tus datos actuales por los del backup ` +
					`(${nDias} ${nDias === 1 ? 'día' : 'días'}). No se puede deshacer.` +
					detalleAvisos,
				confirmarTexto: 'Restaurar',
				onConfirm: async () => {
					avisosImport = await importarBackup(data);
					// El descanso persiste fuera de IndexedDB: si el backup reemplaza los datos,
					// una alarma anterior no puede seguir refiriéndose a una serie eliminada.
					descanso.saltar();
					avisar('✅ Datos restaurados');
					input.value = '';
					confirmacion = null;
				},
				onCancel: () => {
					avisar('Importación cancelada');
					input.value = '';
				}
			};
		} catch (error) {
			avisar(`❌ ${error instanceof Error ? error.message : 'Archivo inválido'}`);
			input.value = '';
		} finally {
			if (!confirmacion) input.value = '';
		}
	}

	function cancelarConfirmacion() {
		confirmacion?.onCancel?.();
		confirmacion = null;
	}

	function confirmarBorrarTodo() {
		confirmacion = {
			titulo: 'Borrar todos mis datos',
			mensaje:
				'Se borran rutinas, historial, notas y ajustes de este dispositivo. ' +
				'No se puede deshacer: si no exportaste un backup, se pierde todo.',
			confirmarTexto: 'Borrar todo',
			onConfirm: async () => {
				await borrarTodo();
				descanso.saltar();
				confirmacion = null;
				avisar('Datos borrados');
			}
		};
	}

	function confirmarReiniciarAyudas() {
		reiniciarAyudas();
		avisar('✅ Vas a volver a ver los carteles de ayuda');
	}

	// --- Descarga de videos para uso sin señal ---
	// El service worker no precachea ni guarda automáticamente los 962 videos (22 MB).
	// Esta es la única acción que los deja listos antes de ir a un gym sin datos.
	let bajando = $state(false);
	let bajados = $state(0);
	let fallidos = $state(0);
	let totalVideos = $state(0);
	let cancelarDescarga: AbortController | null = null;
	let videosGuardados = $state<number | null>(null);

	async function refrescarVideosGuardados() {
		try {
			videosGuardados = await contarVideosGuardados();
		} catch {
			videosGuardados = null;
		}
	}

	async function descargarVideos() {
		if (bajando) return;
		if (!(await hayEspacioParaReserva(RESERVA_VIDEOTECA_COMPLETA))) {
			avisar(
				'⚠️ No queda espacio suficiente para la videoteca. Liberá espacio o usá los videos online.'
			);
			return;
		}
		bajando = true;
		bajados = 0;
		fallidos = 0;
		const control = new AbortController();
		cancelarDescarga = control;
		try {
			const { catalogo } = await import('$lib/catalog');
			const urls = [...new Set(catalogo.map((e) => e.demoVideo))];
			totalVideos = urls.length;
			// De a 6: saturar la conexión del gym con 962 requests no acelera nada.
			const cola = [...urls];
			const obreros = Array.from({ length: 6 }, async () => {
				while (cola.length && !control.signal.aborted) {
					const url = cola.pop()!;
					try {
						await cachearVideoCompleto(url, control.signal);
						bajados++;
					} catch {
						if (!control.signal.aborted) fallidos++;
					}
				}
			});
			await Promise.all(obreros);
			if (control.signal.aborted) {
				avisar(`Descarga cancelada: ${bajados} listos${fallidos ? `, ${fallidos} fallidos` : ''}`);
			} else if (fallidos) {
				avisar(`⚠️ ${bajados} videos listos; ${fallidos} no se pudieron guardar.`);
			} else {
				avisar(`✅ ${bajados} videos guardados para offline`);
			}
		} catch (e) {
			avisar(`❌ No se pudieron descargar: ${e instanceof Error ? e.message : 'error'}`);
		} finally {
			bajando = false;
			cancelarDescarga = null;
			void refrescarVideosGuardados();
		}
	}

	function pararDescarga() {
		cancelarDescarga?.abort();
	}

	function confirmarBorrarVideos() {
		confirmacion = {
			titulo: 'Eliminar videos guardados',
			mensaje:
				'Vas a liberar el espacio de los videos descargados. Tus rutinas, historial y ajustes no se borran.',
			confirmarTexto: 'Eliminar videos',
			onConfirm: async () => {
				try {
					const borrados = await borrarVideosGuardados();
					videosGuardados = 0;
					avisar(`✅ ${borrados} ${borrados === 1 ? 'video eliminado' : 'videos eliminados'}`);
				} catch (error) {
					avisar(
						`❌ No se pudieron eliminar los videos: ${error instanceof Error ? error.message : 'error'}`
					);
				} finally {
					confirmacion = null;
				}
			}
		};
	}
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-5rem)] px-5 pb-12 pt-6">
	<header class="mb-6 flex items-center gap-3">
		<a
			href="/"
			class="grid size-11 shrink-0 place-items-center rounded-full border border-white/10 text-lg"
			aria-label="Volver">←</a
		>
		<h1 class="text-xl font-bold">Ajustes</h1>
	</header>

	{#if consultaAjustes.estado === 'cargando'}
		<p class="py-8 text-center text-sm" style="color: var(--muted)">Cargando ajustes…</p>
	{:else if consultaAjustes.estado === 'error'}
		<section
			class="rounded-2xl border border-red-400/25 bg-red-400/10 p-4 text-center"
			role="alert"
		>
			<p class="text-sm font-semibold" style="color: #ff9b9b">No se pudieron leer tus ajustes.</p>
			<p class="mt-1 text-xs leading-relaxed" style="color: var(--muted)">
				No cambiamos nada. Recargá para volver a intentarlo.
			</p>
			<button
				onclick={() => location.reload()}
				class="mt-3 min-h-11 rounded-xl px-4 text-sm font-bold"
				style="background: rgba(255,255,255,.1); color: white">Reintentar</button
			>
		</section>
	{:else}
		<section class="rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
			<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Unidad de peso
			</p>
			<div class="mt-3 flex gap-2">
				{#each ['kg', 'lb'] as u (u)}
					<button
						onclick={() => void cambiarUnidad(u as 'kg' | 'lb')}
						disabled={guardandoUnidad}
						class="gb-pressable min-h-11 flex-1 rounded-xl py-2.5 font-semibold"
						aria-pressed={ajustes.unidad === u}
						aria-busy={guardandoUnidad}
						aria-label={`Seleccionar unidad ${u}`}
						style={ajustes.unidad === u
							? 'background: var(--accent); color: var(--on-accent)'
							: 'background: rgba(255,255,255,.06); color: var(--muted)'}>{u}</button
					>
				{/each}
			</div>
		</section>

		<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
			<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Paso del peso
			</p>
			<div class="mt-3 flex gap-2">
				{#each [1, 2.5, 5] as paso (paso)}
					<button
						onclick={() => guardarAjuste(setPasoPeso(paso), 'el paso del peso')}
						class="gb-pressable min-h-11 flex-1 rounded-xl py-2.5 font-semibold tabular-nums"
						aria-pressed={ajustes.pasoPeso === paso}
						aria-label={`Paso de ${paso} ${ajustes.unidad}`}
						style={ajustes.pasoPeso === paso
							? 'background: var(--accent); color: var(--on-accent)'
							: 'background: rgba(255,255,255,.06); color: var(--muted)'}>{paso}</button
					>
				{/each}
			</div>
			<p class="mt-2 text-xs" style="color: var(--muted)">
				Cuánto suma o resta cada toque de − / + al cargar peso ({ajustes.unidad}). Las mancuernas
				usan
				{ajustes.unidad === 'kg' ? '1 kg' : '5 lb'} automáticamente y cada ejercicio puede personalizarse.
			</p>
		</section>

		<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
			<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Métrica de PR
			</p>
			<div class="mt-3 grid grid-cols-2 gap-2">
				<button
					onclick={() => guardarAjuste(setMetricaPr('peso'), 'la métrica de PR')}
					class="gb-pressable min-h-11 rounded-xl px-2 py-2.5 text-sm font-semibold"
					aria-pressed={ajustes.metricaPr === 'peso'}
					style={ajustes.metricaPr === 'peso'
						? 'background: var(--accent); color: var(--on-accent)'
						: 'background: rgba(255,255,255,.06); color: var(--muted)'}>Peso máximo</button
				>
				<button
					onclick={() => guardarAjuste(setMetricaPr('e1rm'), 'la métrica de PR')}
					class="gb-pressable min-h-11 rounded-xl px-2 py-2.5 text-sm font-semibold"
					aria-pressed={ajustes.metricaPr === 'e1rm'}
					style={ajustes.metricaPr === 'e1rm'
						? 'background: var(--accent); color: var(--on-accent)'
						: 'background: rgba(255,255,255,.06); color: var(--muted)'}>1RM (1 rep. máx.)</button
				>
			</div>
			<p class="mt-2 text-xs" style="color: var(--muted)">
				{DESCRIPCION_METRICA[ajustes.metricaPr]}
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
					onclick={() => guardarAjuste(toggleSonido(), 'el sonido')}
					aria-pressed={ajustes.sonido}
					class="gb-pressable min-h-11 min-w-18 rounded-full px-4 py-2 text-sm font-bold"
					style={ajustes.sonido
						? 'background: var(--accent); color: var(--on-accent)'
						: 'background: rgba(255,255,255,.06); color: var(--muted)'}
					>{ajustes.sonido ? 'On' : 'Off'}</button
				>
			</div>
			<p class="mt-2 text-xs leading-relaxed" style="color: var(--muted)">
				Mientras corre un descanso, la app mantiene tomada la salida de audio para que la alarma
				suene sí o sí al volver de la pantalla bloqueada. En iPhone eso puede pausar la música
				durante el descanso.
			</p>
		</section>

		<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
			<div class="flex items-center justify-between gap-4">
				<div>
					<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
						Descanso grande
					</p>
					<p class="mt-1 text-xs" style="color: var(--muted)">Pantalla completa al marcar serie</p>
				</div>
				<button
					onclick={() => guardarAjuste(toggleDescansoPantallaCompleta(), 'el descanso grande')}
					aria-pressed={ajustes.descansoPantallaCompleta}
					class="gb-pressable min-h-11 min-w-18 rounded-full px-4 py-2 text-sm font-bold"
					style={ajustes.descansoPantallaCompleta
						? 'background: var(--accent); color: var(--on-accent)'
						: 'background: rgba(255,255,255,.06); color: var(--muted)'}
					>{ajustes.descansoPantallaCompleta ? 'On' : 'Off'}</button
				>
			</div>
		</section>

		<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
			<div class="flex items-center justify-between gap-4">
				<div>
					<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
						Vibración
					</p>
					<p class="mt-1 text-xs" style="color: var(--muted)">Logros y fin de descanso</p>
				</div>
				<button
					onclick={() => guardarAjuste(toggleVibracion(), 'la vibración')}
					aria-pressed={ajustes.vibracion}
					class="gb-pressable min-h-11 min-w-18 rounded-full px-4 py-2 text-sm font-bold"
					style={ajustes.vibracion
						? 'background: var(--accent); color: var(--on-accent)'
						: 'background: rgba(255,255,255,.06); color: var(--muted)'}
					>{ajustes.vibracion ? 'On' : 'Off'}</button
				>
			</div>
		</section>

		<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
			<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Videos sin señal
			</p>
			<p class="mt-1 text-xs leading-relaxed" style="color: var(--muted)">
				Las miniaturas no ocupan espacio al verlas. Si vas a un gym sin datos, podés dejar la
				videoteca completa lista ahora (~22 MB), sin afectar tus datos de entrenamiento.
			</p>
			{#if videosGuardados != null}
				<p class="mt-2 text-xs" style="color: var(--muted)">
					{videosGuardados
						? `${videosGuardados} ${videosGuardados === 1 ? 'video guardado' : 'videos guardados'}`
						: 'Todavía no guardaste videos'}
				</p>
			{/if}
			{#if bajando}
				<div class="mt-3">
					<div class="h-2 overflow-hidden rounded-full bg-white/5">
						<div
							class="h-full rounded-full transition-all"
							style="width: {totalVideos
								? (bajados / totalVideos) * 100
								: 0}%; background: var(--accent)"
						></div>
					</div>
					<div class="mt-2 flex items-center justify-between gap-3">
						<p class="text-xs tabular-nums" style="color: var(--muted)">
							{bajados + fallidos}/{totalVideos} videos{fallidos ? ` · ${fallidos} fallidos` : ''}
						</p>
						<button
							onclick={pararDescarga}
							class="min-h-11 rounded-xl px-4 text-sm font-bold"
							style="background: rgba(255,255,255,.08); color: var(--muted)">Cancelar</button
						>
					</div>
				</div>
			{:else}
				<button
					onclick={descargarVideos}
					class="gb-pressable mt-3 min-h-12 w-full rounded-xl py-3 font-semibold"
					style="background: rgba(255,255,255,.08)">⬇️ Descargar todos los videos</button
				>
				{#if videosGuardados}
					<button
						onclick={confirmarBorrarVideos}
						class="gb-pressable mt-2 min-h-11 w-full rounded-xl border border-white/15 py-2 text-sm font-semibold"
						style="color: var(--muted)">Eliminar videos guardados</button
					>
				{/if}
			{/if}
		</section>

		<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
			<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Backup
			</p>
			<p class="mt-1 text-xs" style="color: var(--muted)">
				Guardá una copia de tus rutinas y progreso (importante en iPhone, que puede borrar datos
				locales).
			</p>
			{#if persistido === false}
				<p class="mt-2 text-xs leading-relaxed" style="color: rgb(var(--max))">
					⚠️ El navegador no marcó tus datos como persistentes: puede borrarlos si necesita espacio.
					Exportá seguido.
				</p>
			{/if}
			<button
				onclick={exportar}
				class="mt-3 min-h-12 w-full rounded-xl py-3 font-semibold"
				style="background: var(--accent); color: var(--on-accent)"
				>⬇️ Guardar copia de seguridad</button
			>
			{#if backupPendienteConfirmacion}
				<button
					onclick={() => void confirmarBackupGuardado()}
					class="gb-pressable mt-2 min-h-11 w-full rounded-xl border border-white/15 py-2 text-sm font-semibold"
					style="color: var(--muted)">✅ Ya guardé el archivo</button
				>
			{/if}
			<label
				class="mt-2 block min-h-12 w-full cursor-pointer rounded-xl border border-white/15 py-3 text-center font-semibold"
			>
				⬆️ Restaurar copia de seguridad
				<input type="file" accept="application/json" onchange={importar} class="hidden" />
			</label>
			{#if msg}
				<p class="mt-3 text-center text-sm font-medium" role="status" aria-live="polite">{msg}</p>
			{/if}
			{#if avisosImport.length}
				<ul
					class="mt-3 space-y-1 rounded-xl p-3 text-xs leading-relaxed"
					style="background: rgb(var(--max) / .1); color: var(--muted)"
				>
					{#each avisosImport as aviso (aviso)}
						<li>· {aviso}</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="mt-3 rounded-2xl border border-white/10 p-4" style="background: var(--surface)">
			<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
				Mantenimiento
			</p>
			<button
				onclick={confirmarReiniciarAyudas}
				class="gb-pressable mt-3 min-h-12 w-full rounded-xl border border-white/10 py-3 text-sm font-semibold"
				style="color: var(--muted)">💡 Volver a mostrar los carteles de ayuda</button
			>
			<button
				onclick={confirmarBorrarTodo}
				class="gb-pressable mt-2 min-h-12 w-full rounded-xl border border-white/10 py-3 text-sm font-semibold"
				style="color: #ff6b6b">🗑 Borrar todos mis datos</button
			>
		</section>
	{/if}

	<section
		class="mt-3 rounded-2xl border border-white/10 p-4 text-center"
		style="background: var(--surface)"
	>
		<p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--muted)">
			Acerca de
		</p>
		<p class="mt-2 text-sm font-bold">Gym-brot</p>
		<p class="mx-auto mt-1 max-w-xs text-xs leading-relaxed" style="color: var(--muted)">
			Todo se guarda en este teléfono. Sin cuentas, sin nube, sin conexión necesaria.
		</p>
		<p
			class="mt-2 font-mono text-[11px]"
			style="color: var(--muted)"
			title="Commit de esta versión"
		>
			Versión {__APP_COMMIT__}
		</p>
	</section>
</main>

{#if confirmacion}
	<ConfirmSheet
		titulo={confirmacion.titulo}
		mensaje={confirmacion.mensaje}
		confirmarTexto={confirmacion.confirmarTexto}
		tono={confirmacion.confirmarTexto === 'Restaurar' ? 'accent' : 'danger'}
		onConfirm={confirmacion.onConfirm}
		onCancel={cancelarConfirmacion}
	/>
{/if}
