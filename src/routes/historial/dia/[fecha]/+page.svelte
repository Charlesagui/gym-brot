<script lang="ts">
	import Icono from '$lib/components/Icono.svelte';
	import { page } from '$app/stores';
	import { liveQuery } from 'dexie';
	import { db, type Dia, type Sesion, type SetSesion } from '$lib/db';
	import { ejercicioPorId, grupos } from '$lib/catalog';
	import { resumenDiaSesion, compararConAnterior } from '$lib/historial';
	import { indexSetPr } from '$lib/progreso';
	import { ajustesObs, AJUSTES_DEFAULT } from '$lib/extras';
	import { estadoLiveQuery, fromLiveQuery } from '$lib/live';
	import { fechaCorta, formatoSet, formatoVolumen } from '$lib/formato';
	import { pasoPesoEfectivo } from '$lib/paso-peso';
	import { estadoSesion, serieCompleta, UMBRAL_DIA_COMPLETO } from '$lib/sesion-reglas';
	import { fechaCalendarioValida, hoyCalendarioLocal } from '$lib/fechas';
	import { popOnChange } from '$lib/pop-on-change';
	import EditarSerieSheet, { type SerieEditable } from '$lib/components/EditarSerieSheet.svelte';
	import { conPesoVisible } from '$lib/unidades';
	import { etiquetaEsfuerzo } from '$lib/esfuerzo';

	// La fecha viene de la URL: si no tiene forma de YYYY-MM-DD no se consulta nada y
	// el título no muestra "Invalid Date".
	const fecha = $derived($page.params.fecha!);
	const fechaValida = $derived(fechaCalendarioValida(fecha));

	const ajustesStore = fromLiveQuery(ajustesObs(), AJUSTES_DEFAULT);
	const ajustes = $derived($ajustesStore);
	// Aislada del resto de los ajustes: es lo único de acá que cambia la consulta, y
	// derivar el primitivo hace que guardar cualquier otra preferencia no la rearme.
	const unidad = $derived(ajustes.unidad);

	// Serie en edición → bottom sheet; guarda también el glow del grupo del ejercicio.
	let serieEditando = $state<SerieEditable | null>(null);
	let glowEditando = $state('124 92 255');
	const ejercicioEditando = $derived(
		serieEditando ? ejercicioPorId(serieEditando.exerciseId) : undefined
	);
	const pasoPesoEditando = $derived(
		ejercicioEditando ? pasoPesoEfectivo(ejercicioEditando, ajustes) : ajustes.pasoPeso
	);

	/**
	 * Puede haber más de una sesión (día de rutina) en la misma fecha: se muestran agrupadas.
	 *
	 * La fecha y la unidad se leen ACÁ, sincrónicamente, y recién después entran al
	 * `liveQuery`. Antes vivían dentro del callback `async`, que corre más tarde: el
	 * `$derived` quedaba sin ninguna dependencia rastreada, así que se calculaba una sola
	 * vez y nunca más. La consulta seguía respondiendo a escrituras en `sesiones` —de eso
	 * se ocupa Dexie— pero era sorda a la fecha y a la unidad.
	 *
	 * Con navegación del router entre dos fechas eso se veía entero: el título cambiaba al
	 * día nuevo y abajo seguían las series del día viejo, con su volumen y su botón de
	 * "seguir editando" apuntando a la sesión equivocada. Hoy no hay ningún enlace de un
	 * día a otro, así que no se podía disparar; el primero que se agregue lo dispara.
	 */
	const sesionesStore = $derived.by(() => {
		const consultada = fechaValida ? fecha : null;
		const unidadConsulta = unidad;
		return estadoLiveQuery(
			liveQuery(async () => {
				if (!consultada) return { sesiones: [] as Sesion[], dias: [] as Dia[] };
				const [sesiones, dias] = await Promise.all([
					db.sesiones.where('fecha').equals(consultada).toArray(),
					db.dias.toArray()
				]);
				return {
					sesiones: sesiones.map((sesion) => ({
						...sesion,
						ejercicios: sesion.ejercicios.map((ejercicio) => ({
							...ejercicio,
							sets: ejercicio.sets.map((set) => conPesoVisible(set, unidadConsulta)),
							prCelebrado: ejercicio.prCelebrado
								? conPesoVisible(ejercicio.prCelebrado, unidadConsulta)
								: undefined
						}))
					})),
					dias
				};
			}),
			{ sesiones: [] as Sesion[], dias: [] as Dia[] }
		);
	});
	const consultaSesiones = $derived($sesionesStore);
	const datosSesiones = $derived(consultaSesiones.valor);
	const conEntrenamiento = $derived(
		datosSesiones.sesiones.filter((s) => s.ejercicios.some((e) => e.sets.some(serieCompleta)))
	);
	const nombreDia = $derived(new Map(datosSesiones.dias.map((d) => [d.id, d.nombre])));

	// Historial de los mismos días de rutina (para comparar contra "la vez anterior").
	// Solo se compara cuando existe de verdad esa sesión anterior; si no, no se muestra nada.
	// La fecha se lee sincrónicamente por el mismo motivo que arriba.
	const candidatasStore = $derived.by(() => {
		const consultada = fechaValida ? fecha : null;
		return fromLiveQuery(
			liveQuery(async () => {
				if (!consultada) return [] as Sesion[];
				const deHoy = await db.sesiones.where('fecha').equals(consultada).toArray();
				const diaIds = [...new Set(deHoy.map((s) => s.diaId))];
				if (diaIds.length === 0) return [] as Sesion[];
				const listas = await Promise.all(
					diaIds.map((id) => db.sesiones.where('diaId').equals(id).toArray())
				);
				return listas.flat();
			}),
			[] as Sesion[]
		);
	});
	const comparaciones = $derived(
		new Map(conEntrenamiento.map((s) => [s.id, compararConAnterior(s, $candidatasStore, unidad)]))
	);

	const resumenes = $derived(conEntrenamiento.map((s) => resumenDiaSesion(s, unidad)));
	const totalSets = $derived(resumenes.reduce((n, r) => n + r.setsHechos, 0));
	const totalVolumen = $derived(resumenes.reduce((n, r) => n + r.volumen, 0));
	const totalSinVolumen = $derived(resumenes.reduce((n, r) => n + r.setsSinVolumen, 0));
	const totalPrs = $derived(resumenes.reduce((n, r) => n + r.prs.length, 0));

	/**
	 * Cuál de las tres cifras manda.
	 *
	 * El volumen es el titular de un día de gimnasio, pero un día entero de dominadas y
	 * abdominales tiene volumen cero: presentar un "0" gigante como resumen de un
	 * entrenamiento real sería mentir con tipografía. Cuando no hay peso que multiplicar,
	 * manda la cifra que sí dice algo — las series hechas.
	 */
	const mandaVolumen = $derived(totalVolumen > 0);

	const fechaLarga = $derived(
		fechaValida
			? new Date(`${fecha}T00:00:00`).toLocaleDateString('es', {
					weekday: 'long',
					day: 'numeric',
					month: 'long',
					year: 'numeric'
				})
			: 'fecha desconocida'
	);
	const fechaTitulo = $derived(
		(fechaLarga[0]?.toLocaleUpperCase('es') ?? '') + fechaLarga.slice(1)
	);

	function labelPr(metrica: 'peso' | 'e1rm' | 'reps' | undefined, tienePeso: boolean): string {
		if (!tienePeso || metrica === 'reps') return 'reps máximas';
		if (metrica === 'peso') return 'peso máximo';
		if (metrica === 'e1rm') return '1RM estimado';
		return 'registrado';
	}

	/**
	 * Cuánto de lo planeado entró ese día y si el día se cerró.
	 *
	 * Es el dato que el historial tenía guardado y nunca mostraba: `diaTerminado` vivía en
	 * la sesión desde siempre y ninguna pantalla de historial lo leía, así que un día de
	 * una serie se veía idéntico a uno entero.
	 */
	function estadoTexto(sesion: Sesion): string {
		const estado = estadoSesion(sesion);
		const partes: string[] = [];
		partes.push(
			estado.seriesPlan != null
				? `${estado.seriesHechas} de ${estado.seriesPlan} series`
				: `${estado.seriesHechas} ${estado.seriesHechas === 1 ? 'serie' : 'series'}`
		);
		if (sesion.diaTerminado) {
			const hora = sesion.diaTerminadoAt
				? new Date(sesion.diaTerminadoAt).toLocaleTimeString('es', {
						hour: '2-digit',
						minute: '2-digit'
					})
				: null;
			partes.push(
				sesion.diaTerminadoConPendientes
					? `cerrado con pendientes${hora ? ` ${hora}` : ''}`
					: `día cerrado${hora ? ` ${hora}` : ''}`
			);
		} else partes.push('día no cerrado');
		return partes.join(' · ');
	}

	const PORCENTAJE_UMBRAL = Math.round(UMBRAL_DIA_COMPLETO * 100);

	function sinVolumen(s: SetSesion): boolean {
		return s.peso == null || s.reps == null;
	}

	// El historial era la única puerta al pasado y sólo dejaba editar series YA marcadas:
	// una serie que quedó sin marcar (se murió el teléfono, te olvidaste) no se podía
	// arreglar desde ningún lado. La sesión de un día pasado se abre con la misma pantalla
	// de entrenamiento, que sí sabe marcar, agregar y quitar.
	const rutinasVigentes = $derived(new Set(datosSesiones.dias.map((d) => d.id)));
	const esFutura = $derived(fechaValida && fecha > hoyCalendarioLocal());
	/**
	 * Sesiones de esa fecha SIN ninguna serie marcada. No tienen nada que mostrar, pero son
	 * exactamente el caso que había que poder arreglar: cargaste el peso de todas las series
	 * y te olvidaste de marcarlas. El calendario del historial ahora sí ofrece la entrada
	 * (celda punteada); hasta entonces esta salida existía y era inalcanzable.
	 */
	const sinMarcar = $derived(
		datosSesiones.sesiones.filter(
			(s) =>
				!s.ejercicios.some((e) => e.sets.some(serieCompleta)) &&
				rutinasVigentes.has(s.diaId) &&
				!esFutura
		)
	);
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-5rem)] px-5 pb-28 pt-6">
	<header class="mb-5 flex items-center gap-3">
		<a
			href="/historial"
			class="grid size-11 shrink-0 place-items-center rounded-full border border-white/10"
			aria-label="Volver al historial"><Icono nombre="volver" /></a
		>
		<div class="min-w-0">
			<p class="text-xs font-bold uppercase tracking-[0.22em]" style="color: var(--muted)">
				Entrenamiento
			</p>
			<h1 class="mt-0.5 text-xl font-extrabold leading-tight">{fechaTitulo}</h1>
		</div>
	</header>

	{#if !fechaValida}
		<section class="rounded-2xl border border-dashed border-white/15 p-6 text-center" role="alert">
			<p class="text-sm font-bold">La fecha del historial no es válida</p>
			<p class="mt-1 text-xs" style="color: var(--muted)">
				No se consultó ni modificó ningún entrenamiento.
			</p>
			<a
				href="/historial"
				class="gb-relieve mt-4 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold"
				style="background: var(--accent); color: var(--on-accent)"
			>
				Volver al historial
			</a>
		</section>
	{:else if consultaSesiones.estado === 'error'}
		<section
			class="rounded-2xl border border-red-400/25 bg-red-400/10 p-5 text-center"
			role="alert"
		>
			<p class="text-sm font-bold" style="color: #ff9b9b">No se pudo leer este entrenamiento.</p>
			<p class="mt-1 text-xs" style="color: var(--muted)">No se modificó ningún dato.</p>
			<button
				onclick={() => location.reload()}
				class="gb-relieve mt-3 min-h-11 rounded-xl px-4 text-sm font-bold"
				style="background: rgba(255,255,255,.1)">Reintentar</button
			>
		</section>
	{:else if consultaSesiones.estado === 'cargando'}
		<p class="py-8 text-center text-sm" style="color: var(--muted)">Cargando entrenamiento…</p>
	{:else if conEntrenamiento.length === 0}
		<p
			class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm"
			style="color: var(--muted)"
		>
			No hay series registradas en esta fecha.
		</p>
		{#each sinMarcar as sesion (sesion.id)}
			<a
				href={`/dia/${sesion.diaId}?fecha=${fecha}`}
				class="gb-relieve mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-bold"
				style="color: var(--accent-text)"
			>
				<Icono nombre="editar" tamano={15} />
				Abrir {sesion.diaNombre ?? nombreDia.get(sesion.diaId) ?? 'la rutina'} de ese día
			</a>
		{/each}
	{:else}
		<!-- Una cifra manda y las otras dos la acompañan: el volumen es el titular de un día
		     de gimnasio, salvo cuando no hay peso que multiplicar (ver `mandaVolumen`). -->
		<section
			class="mb-4 rounded-2xl border border-white/10 p-4"
			style="background: radial-gradient(120% 120% at 0% 0%, rgb(var(--exito) / .14), transparent 62%), var(--surface)"
		>
			{#if mandaVolumen}
				<div class="text-center">
					<p class="cifra text-[2.6rem]" use:popOnChange={totalVolumen}>
						{formatoVolumen(totalVolumen)}<span class="cifra-u">{ajustes.unidad}</span>
					</p>
					<p class="mt-2 text-[11px] font-semibold" style="color: var(--muted)">
						volumen del día · peso × reps de las series ✓
					</p>
				</div>
				<div class="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-center">
					<div>
						<p class="cifra text-xl" use:popOnChange={totalSets}>{totalSets}</p>
						<p class="mt-1.5 text-[11px] font-semibold" style="color: var(--muted)">sets hechos</p>
					</div>
					<div>
						<p class="cifra text-xl" use:popOnChange={totalPrs}>{totalPrs}</p>
						<p class="mt-1.5 text-[11px] font-semibold" style="color: var(--muted)">
							PRs registrados
						</p>
					</div>
				</div>
			{:else}
				<div class="text-center">
					<p class="cifra text-[2.6rem]" use:popOnChange={totalSets}>{totalSets}</p>
					<p class="mt-2 text-[11px] font-semibold" style="color: var(--muted)">
						sets hechos · sin peso que multiplicar, no hay volumen
					</p>
				</div>
				<div class="mt-3 border-t border-white/10 pt-3 text-center">
					<p class="cifra text-xl" use:popOnChange={totalPrs}>{totalPrs}</p>
					<p class="mt-1.5 text-[11px] font-semibold" style="color: var(--muted)">
						PRs registrados
					</p>
				</div>
			{/if}
			{#if mandaVolumen && totalSinVolumen > 0}
				<p
					class="mt-3 border-t border-white/10 pt-2.5 text-center text-xs"
					style="color: var(--muted)"
				>
					{totalSinVolumen}
					{totalSinVolumen === 1
						? 'serie hecha sin peso no cuenta'
						: 'series hechas sin peso no cuentan'}
					para el volumen
				</p>
			{/if}
		</section>

		{#each conEntrenamiento as sesion (sesion.id)}
			{@const cmp = comparaciones.get(sesion.id) ?? null}
			{@const parcial = estadoSesion(sesion).calidad === 'parcial'}
			<section class="mb-4">
				<div class="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
					<div class="min-w-0">
						<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
							{sesion.diaNombre ?? nombreDia.get(sesion.diaId) ?? 'Rutina archivada'}
							{#if parcial}
								<span
									class="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal"
									style="background: rgba(255,255,255,.08)"
									title="Menos del {PORCENTAJE_UMBRAL} % de lo planeado">parcial</span
								>
							{/if}
						</p>
						<p class="mt-0.5 text-[11px] font-medium" style="color: var(--muted)">
							{estadoTexto(sesion)}
						</p>
					</div>
					{#if cmp}
						<p class="text-[11px] font-semibold" style="color: var(--muted)">
							vs. {fechaCorta(cmp.fechaAnterior)}:
							<span style="color: {cmp.deltaVolumen >= 0 ? 'rgb(var(--exito))' : 'var(--text)'}">
								{cmp.deltaVolumen >= 0 ? '+' : ''}{formatoVolumen(cmp.deltaVolumen)}
								{ajustes.unidad}
							</span>
						</p>
					{/if}
				</div>
				{#if rutinasVigentes.has(sesion.diaId) && !esFutura}
					<a
						href={`/dia/${sesion.diaId}?fecha=${fecha}`}
						class="gb-relieve mb-2 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 text-sm font-bold"
						style="color: var(--accent-text)"
					>
						<Icono nombre="editar" tamano={15} /> Seguir editando este entrenamiento
					</a>
				{/if}
				<div class="space-y-2">
					{#each sesion.ejercicios.filter( (e) => e.sets.some(serieCompleta) ) as ejercicio (ejercicio.exerciseId)}
						{@const ej = ejercicioPorId(ejercicio.exerciseId)}
						{@const nombreEjercicio =
							ejercicio.nombreSnapshot ?? ej?.nombre ?? 'Ejercicio archivado'}
						{@const g = ej ? grupos[ej.grupo] : undefined}
						{@const setPr = indexSetPr(ejercicio.sets, ejercicio.prCelebrado)}
						<article
							class="rounded-2xl border border-white/10 p-4"
							style="background: var(--surface)"
						>
							<div class="flex items-center justify-between gap-3">
								<a
									href={`/ejercicio/${ejercicio.exerciseId}`}
									class="min-w-0 flex-1 truncate text-sm font-bold"
								>
									{#if g}<span style="color: rgb({g.glow})">{g.emoji}</span>{/if}
									{nombreEjercicio}
								</a>
								{#if ejercicio.prCelebrado}
									<span
										class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold"
										style="background: rgb(var(--max) / .14); color: rgb(var(--max))"
										><span class="inline-flex items-center gap-1"
											><Icono nombre="record" tamano={13} /> PR</span
										>
										{labelPr(
											ejercicio.prCelebrado.metrica,
											ejercicio.prCelebrado.peso != null
										)}</span
									>
								{/if}
							</div>
							<div class="mt-2.5 space-y-1.5">
								{#each ejercicio.sets as set, i (i)}
									{#if serieCompleta(set)}
										<button
											onclick={() => {
												glowEditando = g?.glow ?? '124 92 255';
												serieEditando = {
													sesionId: sesion.id,
													exerciseId: ejercicio.exerciseId,
													setIndex: i,
													set,
													fecha: sesion.fecha,
													maquinaPlacas: !!ej?.maquinaPlacas
												};
											}}
											class="flex min-h-11 w-full items-center gap-2 rounded-xl bg-white/[0.025] px-3 py-2 text-left text-sm"
											aria-label={`Editar serie ${i + 1}: ${formatoSet(set, ajustes.unidad)}`}
										>
											<span
												class="grid size-6 shrink-0 place-items-center rounded-full border border-white/10 text-[11px] font-bold"
												style="color: var(--muted)">{i + 1}</span
											>
											<span class="cifra min-w-0 flex-1 truncate text-sm">
												{formatoSet(set, ajustes.unidad)}
											</span>
											{#if set.rir != null}<span
													class="shrink-0 text-[10px] font-bold"
													style="color: var(--accent-text)"
													>{etiquetaEsfuerzo(
														set.rir,
														ajustes.modoEsfuerzo === 'rpe' ? 'rpe' : 'rir'
													)}</span
												>{/if}
											{#if i === setPr}
												<span
													class="shrink-0"
													aria-label="Set del PR"
													style="color: rgb(var(--max))"
												>
													<Icono nombre="record" tamano={14} />
												</span>
											{/if}
											{#if sinVolumen(set)}
												<span class="shrink-0 text-[10px] font-medium" style="color: var(--muted)"
													>sin volumen</span
												>
											{/if}
											<span class="shrink-0" style="color: var(--muted)"
												><Icono nombre="editar" tamano={13} /></span
											>
										</button>
									{/if}
								{/each}
							</div>
						</article>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</main>

{#if serieEditando}
	<EditarSerieSheet
		serie={serieEditando}
		glow={glowEditando}
		unidad={ajustes.unidad}
		pasoPeso={pasoPesoEditando}
		modoEsfuerzo={ajustes.modoEsfuerzo ?? 'off'}
		onClose={() => (serieEditando = null)}
	/>
{/if}
