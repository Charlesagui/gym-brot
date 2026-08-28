<script lang="ts">
	import Icono from '$lib/components/Icono.svelte';
	import { diasDesde, necesitaBackup, AJUSTES_DEFAULT } from '$lib/extras';
	import { formatoNumero, fechaCorta } from '$lib/formato';
	import {
		crearHistorialResumen,
		historialPantallaObs,
		type HistorialPantalla
	} from '$lib/historial';
	import { estadoLiveQuery } from '$lib/live';
	import { persistencia } from '$lib/persistencia';
	import { hoyStr } from '$lib/sesion';
	import { onMount } from 'svelte';
	import { scale } from 'svelte/transition';
	import { dur } from '$lib/motion';
	import { popOnChange } from '$lib/pop-on-change';
	import { ETIQUETAS_NIVEL, nivelActividad } from '$lib/heatmap';
	import { UMBRAL_DIA_COMPLETO } from '$lib/sesion-reglas';

	const PORCENTAJE_UMBRAL = Math.round(UMBRAL_DIA_COMPLETO * 100);
	let MapaCorporal = $state<typeof import('$lib/components/MapaCorporal.svelte').default | null>(
		null
	);

	const VACIO: HistorialPantalla = {
		resumen: crearHistorialResumen([], []),
		records: [],
		ajustes: AJUSTES_DEFAULT
	};

	// Una sola consulta para toda la pantalla: resumen, récords y ajustes salen de la
	// misma lectura de `sesiones` (ver `historialPantallaObs`).
	const pantallaStore = estadoLiveQuery(historialPantallaObs(), VACIO);
	const consulta = $derived($pantallaStore);
	const ajustes = $derived(consulta.valor.ajustes);
	const historial = $derived(consulta.valor.resumen);
	const records = $derived(consulta.valor.records);
	const cargandoDatos = $derived(consulta.estado === 'cargando');
	const errorDatos = $derived(consulta.estado === 'error');
	const metricaLabel = $derived(
		Object.keys(ajustes.metricasPrEjercicio ?? {}).length
			? 'métrica según cada ejercicio'
			: ajustes.metricaPr === 'e1rm'
				? '1RM estimado'
				: 'peso máximo'
	);

	// El día completo, no sólo la fecha: el calendario tiñe cada celda según cuántas
	// series entraron ese día. Antes esa intensidad vivía en un mapa anual aparte que
	// mostraba el mismo hecho, linkeaba al mismo lugar y no entraba en un teléfono.
	const porFecha = $derived(new Map(historial.dias.map((d) => [d.fecha, d])));
	// Fechas con trabajo cargado y sin marcar: no son días entrenados y no se tiñen,
	// pero tienen que ser alcanzables. Ver `DiaSinMarcar` en $lib/historial.
	const pendientePorFecha = $derived(new Map(historial.sinMarcar.map((d) => [d.fecha, d])));
	const semanas = $derived(historial.semanas.slice(0, 8));

	/**
	 * Fondo por intensidad con el número del día siempre en blanco. El tope es 0,55:
	 * más alfa de `--exito` sobre `--surface` deja el texto por debajo de 4,5:1, que es
	 * justo lo que la app ya respeta en el resto de las cifras.
	 */
	const ALFA_NIVEL = [0, 0.14, 0.26, 0.4, 0.55] as const;
	// Paginación: los récords viejos siempre son alcanzables.
	let recordsVisibles = $state(10);

	// Calendario mensual navegable: todo el historial es alcanzable, mes a mes.
	// `hoy` se refresca al volver a la vista: con la app abierta al cruzar la
	// medianoche, el recuadro del día quedaba marcando ayer.
	let hoy = $state(hoyStr());
	let mesOffset = $state(0);

	onMount(() => {
		const refrescarHoy = () => (hoy = hoyStr());
		document.addEventListener('visibilitychange', refrescarHoy);
		window.addEventListener('focus', refrescarHoy);
		return () => {
			document.removeEventListener('visibilitychange', refrescarHoy);
			window.removeEventListener('focus', refrescarHoy);
		};
	});

	onMount(() => {
		let activo = true;
		void import('$lib/components/MapaCorporal.svelte').then((modulo) => {
			if (activo) MapaCorporal = modulo.default;
		});
		return () => {
			activo = false;
		};
	});

	interface Mes {
		label: string;
		ym: string;
		celdas: (string | null)[];
	}

	function mesGrid(offset: number, referencia: string): Mes {
		const ahora = new Date(`${referencia}T00:00:00`);
		const base = new Date(ahora.getFullYear(), ahora.getMonth() + offset, 1);
		const label = base.toLocaleDateString('es', { month: 'long', year: 'numeric' });
		// Semana arranca lunes: celdas vacías hasta el día 1.
		const pad = (base.getDay() + 6) % 7;
		const nDias = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
		const celdas: (string | null)[] = Array.from({ length: pad }, () => null);
		for (let dia = 1; dia <= nDias; dia++) {
			celdas.push(new Date(base.getFullYear(), base.getMonth(), dia).toLocaleDateString('sv'));
		}
		return { label, ym: celdas[pad]!.slice(0, 7), celdas };
	}

	const mes = $derived(mesGrid(mesOffset, hoy));
	// La fecha más vieja alcanzable, entrenada o pendiente: un mes cuyo único registro es
	// un día sin marcar también tiene que poder navegarse, si no el enlace no sirve.
	const primeraFecha = $derived(
		[historial.dias.at(-1)?.fecha, historial.sinMarcar.at(-1)?.fecha]
			.filter((f): f is string => !!f)
			.sort()[0] ?? null
	);
	// Atrás solo hasta el mes del primer entrenamiento; adelante solo hasta hoy.
	const sinMesAnterior = $derived(!primeraFecha || mes.ym <= primeraFecha.slice(0, 7));

	/**
	 * El navegador dijo explícitamente que NO se compromete a conservar los datos.
	 * Solo cuenta con historial cargado: sin nada que perder no hay nada que avisar.
	 */
	const almacenamientoEfimero = $derived($persistencia === 'efimero' && historial.dias.length > 0);
	// Recordatorio de backup: el historial vive solo en este teléfono.
	const recordarBackup = $derived(
		necesitaBackup(
			ajustes.ultimoBackup,
			historial.dias.map((d) => d.fecha)
		)
	);
</script>

<main class="gb-page glow-bg min-h-[calc(100dvh-5rem)] px-5 pb-28 pt-8">
	<header class="mb-6">
		<p class="text-xs font-bold uppercase tracking-[0.22em]" style="color: var(--muted)">
			Progreso
		</p>
		<h1 class="mt-1 text-3xl font-extrabold tracking-tight">Historial</h1>
	</header>

	{#if errorDatos}
		<section
			class="rounded-2xl border border-red-400/25 bg-red-400/10 p-4 text-center"
			role="alert"
		>
			<p class="text-sm font-semibold" style="color: #ff9b9b">No se pudo leer el historial.</p>
			<p class="mt-1 text-xs leading-relaxed" style="color: var(--muted)">
				No cambiamos tus datos. Recargá para volver a intentarlo.
			</p>
			<button
				onclick={() => location.reload()}
				class="gb-relieve mt-3 min-h-11 rounded-xl px-4 text-sm font-bold"
				style="background: rgba(255,255,255,.1); color: white">Reintentar</button
			>
		</section>
	{:else if cargandoDatos}
		<p class="py-8 text-center text-sm" style="color: var(--muted)">Cargando historial…</p>
	{:else}
		<!--
			El mapa corporal, primero.

			Es lo que la pantalla tiene de más mirable y entraba tercero, detrás del
			recordatorio de backup y de la tarjeta de racha: entre los dos lo empujaban
			137 px, y con la letra chica de la propia tarjeta el dibujo arrancaba recién a
			los 535 px. En un teléfono de 664 px de alto no entraba ni la mitad.
		-->
		<div class="mb-4">
			{#if MapaCorporal}
				<MapaCorporal {hoy} vibracion={ajustes.vibracion ?? true} />
			{:else}
				<!-- El esqueleto reserva lo que el mapa mide de verdad (~48 rem). Con las 9 rem
				     de antes, al llegar el componente todo lo de abajo saltaba 610 px: si estabas
				     por tocar una celda del calendario, tocabas otra. -->
				<section
					class="gb-skeleton min-h-[48rem] border border-white/10 p-4"
					style="background: var(--surface)"
					aria-busy="true"
					aria-label="Cargando distribución estimada de series"
				>
					<div class="h-4 w-48 rounded bg-white/10"></div>
					<div class="mt-3 h-[44rem] rounded-xl bg-white/[0.035]"></div>
				</section>
			{/if}
		</div>

		{#if recordarBackup || almacenamientoEfimero}
			<!--
				Discreto y accionable: el dato local se puede perder sin backup (iOS purga
				IndexedDB). Sube de tono cuando el navegador AVISÓ que no se compromete a
				conservar los datos: ahí no es una buena práctica, es una cuenta regresiva.
			-->
			<a
				href="/ajustes"
				class="mb-4 flex items-center gap-3 rounded-2xl border p-3.5"
				style={almacenamientoEfimero
					? 'border-color: rgb(var(--max) / .35); background: rgb(var(--max) / .08)'
					: 'border-color: rgb(255 255 255 / .1); background: var(--surface)'}
			>
				<span style="color: {almacenamientoEfimero ? 'rgb(var(--max))' : 'var(--muted)'}"
					><Icono nombre="backup" tamano={20} /></span
				>
				<span class="min-w-0 flex-1 text-xs leading-relaxed" style="color: var(--muted)">
					{#if almacenamientoEfimero}
						<b style="color: rgb(var(--max))">Este navegador puede borrar tu historial solo.</b>
						No marcó tus datos como permanentes. Instalá la app en la pantalla de inicio y guardá una
						copia.
					{:else}
						Tu historial vive solo en este teléfono ·
						{ajustes.ultimoBackup
							? `último backup hace ${diasDesde(ajustes.ultimoBackup)} días`
							: 'todavía sin backup'}
					{/if}
				</span>
				<span class="shrink-0 text-xs font-bold" style="color: var(--accent-text)">Exportar</span>
			</a>
		{/if}

		<!-- Las tres cifras van en la tipografía de cifras, como el peso y el récord en el
		     resto de la app: son contenido, no rótulos. Se quedan del mismo tamaño a
		     propósito — quien manda en esta pantalla ahora es el dibujo de arriba, y un
		     número inflado acá le pelearía el lugar sin decir nada más. -->
		<section
			class="mb-4 rounded-2xl border border-white/10 p-4"
			style="background: radial-gradient(120% 120% at 0% 0%, rgb(var(--exito) / .18), transparent 62%), var(--surface)"
		>
			<div class="grid grid-cols-3 gap-2 text-center">
				<div>
					<p class="cifra text-2xl" use:popOnChange={historial.rachaSemanal}>
						{historial.rachaSemanal}
					</p>
					<p class="mt-1.5 text-[11px] font-semibold" style="color: var(--muted)">
						semanas en racha
					</p>
				</div>
				<div>
					<p class="cifra text-2xl" use:popOnChange={historial.diasEstaSemana}>
						{historial.diasEstaSemana}
					</p>
					<p class="mt-1.5 text-[11px] font-semibold" style="color: var(--muted)">
						días esta semana
					</p>
					{#if historial.parcialesEstaSemana > 0}
						<p class="text-[10px] font-semibold" style="color: var(--muted)">
							+{historial.parcialesEstaSemana} parcial{historial.parcialesEstaSemana === 1
								? ''
								: 'es'}
						</p>
					{/if}
				</div>
				<div>
					<p class="cifra text-2xl" use:popOnChange={historial.totalDias}>
						{historial.totalDias}
					</p>
					<p class="mt-1.5 text-[11px] font-semibold" style="color: var(--muted)">
						días entrenados
					</p>
					{#if historial.totalParciales > 0}
						<p class="text-[10px] font-semibold" style="color: var(--muted)">
							+{historial.totalParciales} parcial{historial.totalParciales === 1 ? '' : 'es'}
						</p>
					{/if}
				</div>
			</div>
			{#if historial.rachaSemanal > 0 && historial.diasEstaSemana === 0}
				<!-- Racha con gracia: la semana en curso no la corta hasta terminar sin entrenar. -->
				<p
					class="mt-3 border-t border-white/10 pt-2.5 text-center text-xs"
					style="color: var(--muted)"
				>
					Todavía no entrenaste esta semana · la racha se mantiene hasta el domingo
				</p>
			{/if}
		</section>

		<section
			class="-mx-5 mb-4 rounded-none border-y border-white/10 px-1.5 py-4 sm:mx-0 sm:rounded-2xl sm:border sm:p-4"
			style="background: var(--surface)"
		>
			<div class="mb-3 flex items-center justify-between gap-2">
				<button
					onclick={() => (mesOffset -= 1)}
					disabled={sinMesAnterior}
					class="gb-relieve grid size-11 place-items-center rounded-full border border-white/10 disabled:opacity-30"
					aria-label="Mes anterior"><Icono nombre="volver" /></button
				>
				<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
					{mes.label}
				</p>
				<button
					onclick={() => (mesOffset += 1)}
					disabled={mesOffset >= 0}
					class="gb-relieve grid size-11 place-items-center rounded-full border border-white/10 disabled:opacity-30"
					aria-label="Mes siguiente"><Icono nombre="volver" clase="rotate-180" /></button
				>
			</div>
			<div class="grid grid-cols-7 gap-0 sm:gap-1.5">
				{#each ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as letra, i (i)}
					<p class="text-center text-[10px] font-bold" style="color: var(--muted)">{letra}</p>
				{/each}
				{#each mes.celdas as fecha, i (i)}
					{#if fecha == null}
						<div></div>
					{:else if porFecha.get(fecha)}
						{@const dia = porFecha.get(fecha)!}
						{@const nivel = nivelActividad(dia.sets)}
						{@const parcial = dia.calidad === 'parcial'}
						<!-- Día entrenado: tap → detalle de ese día. El relleno dice cuántas
						     series entraron; el de hoy entra con un pop breve, porque es
						     probable que sea "el día recién completado".

						     Un día PARCIAL va HUECO y con el borde entero: entrenaste, pero por
						     debajo del umbral. Se distingue del completo (relleno), del cargado
						     sin marcar (punteado y en acento) y del vacío. Antes una serie de
						     doce llenaba la celda igual que la rutina entera. -->
						<a
							href={`/historial/dia/${fecha}`}
							in:scale={fecha === hoy ? { duration: dur(240), start: 0.7 } : { duration: 0 }}
							class="grid min-h-11 min-w-11 place-items-center rounded-lg border text-[11px] font-bold"
							style="background: {parcial
								? 'transparent'
								: `rgb(var(--exito) / ${ALFA_NIVEL[nivel]})`}; border-color: rgb(var(--exito) / {fecha ===
							hoy
								? '.9'
								: '.42'}); color: {parcial ? 'rgb(var(--exito))' : 'white'}"
							aria-label={`${fechaCorta(fecha)}: ${parcial ? 'día parcial, ' : ''}${dia.sets} ${
								dia.sets === 1 ? 'serie completada' : 'series completadas'
							}${dia.seriesPlan != null ? ` de ${dia.seriesPlan} planeadas` : ''}${
								dia.dias.length ? ` · ${dia.dias.join(', ')}` : ''
							} · ver detalle`}
						>
							{Number(fecha.slice(8, 10))}
						</a>
					{:else if pendientePorFecha.get(fecha)}
						{@const pendiente = pendientePorFecha.get(fecha)!}
						<!-- Trabajo cargado que nunca se marcó. Sin relleno y con el borde punteado
						     porque NO es un día entrenado: no cuenta en la racha ni en el total, y
						     teñirlo como los demás sería afirmar series que nadie confirmó. Lo único
						     que aporta es la puerta: el detalle de ese día sabe reabrir la rutina y
						     terminar de marcarlas, y hasta acá no había forma de llegar. -->
						<a
							href={`/historial/dia/${fecha}`}
							class="grid min-h-11 min-w-11 place-items-center rounded-lg border border-dashed text-[11px] font-bold"
							style="border-color: rgb(var(--accent-rgb) / .5); color: var(--accent-text)"
							aria-label={`${fechaCorta(fecha)}: ${pendiente.sets} ${
								pendiente.sets === 1 ? 'serie cargada' : 'series cargadas'
							} sin marcar${
								pendiente.dias.length ? ` · ${pendiente.dias.join(', ')}` : ''
							} · abrir para terminar de marcarlas`}
						>
							{Number(fecha.slice(8, 10))}
						</a>
					{:else}
						<!-- El día futuro recede sacándole el relleno, no bajándole la opacidad. Con
						     `opacity-35` el número quedaba en 1,9:1 contra el fondo —la única cosa de la
						     pantalla por debajo de 4,5:1— y atenuar no alcanzaba para arreglarlo: hasta
						     `opacity-60` da 3,2:1, y el 80 % que sí llega a 4,5:1 ya no se distingue de un
						     día pasado. Sin fondo, la celda se lee como "todavía no hay nada acá" y el
						     número conserva sus 7,1:1. -->
						<div
							class="grid min-h-11 min-w-11 place-items-center rounded-lg border text-[11px] font-semibold"
							style="background: {fecha > hoy
								? 'transparent'
								: 'rgba(255,255,255,.035)'}; border-color: {fecha === hoy
								? 'rgba(255,255,255,.4)'
								: fecha > hoy
									? 'rgba(255,255,255,.03)'
									: 'rgba(255,255,255,.06)'}; color: var(--muted)"
							aria-label={`${fechaCorta(fecha)} sin entrenamiento`}
						>
							{Number(fecha.slice(8, 10))}
						</div>
					{/if}
				{/each}
			</div>
			<div
				class="mt-2.5 flex flex-wrap items-center justify-end gap-1.5 px-1 text-[10px]"
				style="color: var(--muted)"
				aria-label={`Leyenda de series por día: ${ETIQUETAS_NIVEL.join(', ')}`}
			>
				<span
					class="size-3 rounded-[3px] border"
					style="background: transparent; border-color: rgb(var(--exito) / .5)"
					title="Día parcial: menos del {PORCENTAJE_UMBRAL} % de lo planeado"
				></span>
				<span class="mr-1">Parcial</span>
				<span>Menos series</span>
				{#each ETIQUETAS_NIVEL as etiqueta, nivel (nivel)}
					<span
						class="size-3 rounded-[3px] border"
						style={nivel === 0
							? 'background: rgba(255,255,255,.035); border-color: rgba(255,255,255,.08)'
							: `background: rgb(var(--exito) / ${ALFA_NIVEL[nivel]}); border-color: rgb(var(--exito) / .5)`}
						title={etiqueta}
					></span>
				{/each}
				<span>Más</span>
			</div>
			{#if historial.sinMarcar.length > 0}
				<p class="mt-2 px-1 text-[10px] leading-relaxed" style="color: var(--muted)">
					<span
						class="mr-1 inline-block size-3 translate-y-[2px] rounded-[3px] border border-dashed"
						style="border-color: rgb(var(--accent-rgb) / .5)"
					></span>
					Punteado: series cargadas que quedaron sin marcar. No cuentan como día entrenado.
				</p>
			{/if}
		</section>

		<!-- Mismo sangrado que el calendario: de acá para abajo la pantalla son paneles a
		     todo el ancho, no tarjetas. El calendario aprieta el padding a px-1.5 porque sus
		     celdas necesitan 44 px en un teléfono de 320; estos dos no, y respiran mejor. -->
		<section
			class="-mx-5 mb-4 rounded-none border-y border-white/10 p-4 sm:mx-0 sm:rounded-2xl sm:border"
			style="background: var(--surface)"
		>
			<div class="mb-3 flex items-center justify-between gap-3">
				<p class="text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
					Racha semanal
				</p>
				<p class="text-xs font-semibold" style="color: var(--muted)">últimas {semanas.length}</p>
			</div>
			<div class="space-y-2">
				{#each semanas as semana (semana.inicio)}
					<div class="flex items-center gap-3">
						<div class="w-20 text-xs font-semibold tabular-nums" style="color: var(--muted)">
							{fechaCorta(semana.inicio)}
						</div>
						<div class="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
							<div
								class="gb-streak-bar h-full rounded-full"
								style="width: {Math.min(
									100,
									semana.diasEntrenados * 20
								)}%; background: {semana.entrenada ? 'rgb(var(--exito))' : 'rgba(255,255,255,.12)'}"
							></div>
						</div>
						<p class="w-12 text-right text-xs font-bold tabular-nums">
							{semana.diasEntrenados} día{semana.diasEntrenados === 1 ? '' : 's'}
						</p>
					</div>
				{/each}
				{#if semanas.length === 0}
					<p class="py-3 text-center text-sm" style="color: var(--muted)">
						Todavía no hay semanas entrenadas.
					</p>
				{/if}
			</div>
		</section>

		<!-- Sin fondo propio: las filas ya son tarjetas con su borde y su superficie, y un
		     panel detrás daría superficie sobre superficie. Sólo se alinea, con el mismo
		     px-1.5 del calendario: caja contra caja, sin que el borde izquierdo salte.
		     El encabezado va a px-3 para caer sobre el texto de las filas, no sobre su borde. -->
		<section class="-mx-5 mb-4 px-1.5 sm:mx-0 sm:px-0">
			<div class="mb-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 px-3 sm:px-1">
				<p class="shrink-0 text-xs font-bold uppercase tracking-wider" style="color: var(--muted)">
					Récords vigentes
				</p>
				<p class="text-right text-xs font-semibold" style="color: var(--muted)">
					{metricaLabel} · recientes primero
				</p>
			</div>
			<div class="space-y-1.5">
				{#each records.slice(0, recordsVisibles) as record (record.exerciseId)}
					{@const nombre = record.nombre ?? 'Ejercicio archivado'}
					<!-- Fila compacta: el detalle del set vive en la pantalla del ejercicio.
					     El nombre viene congelado en la sesión, así esta pantalla no arrastra
					     el catálogo entero (193 KB) para resolver un puñado de textos. -->
					<a
						href={`/ejercicio/${record.exerciseId}`}
						class="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 px-3 py-2"
						style="background: var(--surface)"
						aria-label={`Ver progreso de ${nombre}`}
					>
						<p class="min-w-0 flex-1 truncate text-sm font-semibold">
							{nombre}
						</p>
						<span class="shrink-0 text-[11px]" style="color: var(--muted)"
							>{record.metrica === 'reps'
								? 'reps'
								: record.metrica === 'e1rm'
									? '1RM est.'
									: 'peso máx.'} · {fechaCorta(record.fecha)}</span
						>
						<!-- El récord es contenido, no rótulo: va en la tipografía de cifras con su
						     unidad chica al lado, igual que en la pantalla del ejercicio. -->
						<p class="cifra shrink-0 text-right text-base" style="color: rgb(var(--max))">
							{formatoNumero(record.valor)}<span class="cifra-u"
								>{record.modo === 'reps' ? 'reps' : ajustes.unidad}</span
							>
						</p>
					</a>
				{/each}
				{#if records.length > recordsVisibles}
					<button
						onclick={() => (recordsVisibles += 15)}
						class="gb-relieve min-h-11 w-full rounded-xl border border-white/10 py-2.5 text-sm font-semibold"
						style="background: var(--surface); color: var(--muted)"
					>
						Ver más ({records.length - recordsVisibles}
						{records.length - recordsVisibles === 1 ? 'récord' : 'récords'})
					</button>
				{/if}
				{#if records.length === 0}
					<p
						class="rounded-2xl border border-dashed border-white/15 p-5 text-center text-sm"
						style="color: var(--muted)"
					>
						Tus récords aparecen cuando marques series hechas.
					</p>
				{/if}
			</div>
		</section>
	{/if}
</main>

<style>
	.gb-streak-bar {
		transition:
			width var(--dur-slow) var(--ease-out),
			background-color var(--dur-slow) var(--ease-out);
	}
</style>
