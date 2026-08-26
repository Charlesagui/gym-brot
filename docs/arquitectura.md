# Arquitectura vigente

Gym-brot es una PWA local-first: no tiene backend y los datos de entrenamiento viven en IndexedDB.
Este documento registra los límites que deben preservarse al cambiar la app.

## Fuentes de verdad

- `src/lib/db.ts` define el esquema y las migraciones; `conIndice` y `guardarSesion` mantienen el índice derivado de cada sesión antes de persistirla.
- `src/lib/sesion-reglas.ts` contiene reglas puras de series, métricas y PR. No lee navegador ni base de datos.
- `src/lib/sesion.ts` consulta y modifica sesiones mediante Dexie; sus funciones son la frontera usada por la UI.
- `src/lib/progreso.ts` e `src/lib/historial.ts` derivan vistas desde sesiones crudas. Un PR mostrado siempre se calcula a partir de sets hechos.

Una serie solo representa trabajo real cuando está marcada y tiene una cantidad entera y positiva
de repeticiones (`serieCompleta`). Esa misma regla gobierna cierre de ejercicios, volumen, rachas,
progreso y PR. Si se vacían las reps de una serie hecha, la misma transacción la desmarca y reabre
la sesión.

Las sesiones de una fecha se ordenan por `ordenEnDia`, asignado transaccionalmente al crearlas.
Nunca usar `diaId` como aproximación temporal: puede ser un UUID y no expresa qué rutina ocurrió
primero. Las bases anteriores a v6 reciben un orden determinista durante la migración.

Los pesos aceptan decimales. Se persisten además como gramos enteros (`pesoGramos` y
`extraGramos`), que son la fuente estable entre unidades. `peso` y `extraKg` se conservan por
compatibilidad y como valor de entrada, pero cambiar kg/lb solo cambia una preferencia: nunca
reescribe el historial. Las repeticiones, cantidades de series y posiciones sí son discretas y
deben ser enteras.

El backfill de `nombreSnapshot` para bases anteriores a v9 corre fuera de la transacción de
migración —importar el catálogo durante `versionchange` puede colgar IndexedDB— y una sola vez:
detectar si falta algún snapshot obliga a recorrer `sesiones` entera, así que
`Ajustes.snapshotsCompletados` lo saca del camino del arranque.

Cada sesión congela `diaNombre` y cada ejercicio nuevo `nombreSnapshot`. El historial usa esos
snapshots antes que el catálogo o la rutina actuales, de modo que renombrar o archivar no cambia
retroactivamente lo entrenado.

Por el mismo motivo cada sesión congela `plan` (cuántos ejercicios y cuántas series tenía la
rutina): es el denominador de "4 de 12 series". Sigue a la rutina mientras el día sea hoy y no se
toca nunca en una fecha pasada. Las sesiones anteriores a ese campo se quedan sin denominador a
propósito y no se juzgan — no hay migración que lo rellene, porque estimarlo con la rutina actual
es exactamente el error que el campo evita.

Qué cuenta como día entrenado lo decide una sola función, `calidadDesde` en `sesion-reglas.ts`, y
la leen tanto el historial como el prellenado del objetivo calórico. Un día es completo si hizo
≥60 % de las series planeadas, o si se cerró a mano habiendo trabajado en ≥60 % de los ejercicios;
si no, es parcial. El cierre a mano sólo sube el veredicto, nunca es el único camino: cuando el
dato dependía de tocar un botón medía disciplina con la app en vez de entrenamiento. Una fecha con
dos rutinas toma la mejor de sus sesiones, no la suma, para que empezar una segunda no degrade el
día ya ganado. La racha semanal es la única asimetría: la sostiene cualquier día con trabajo real,
parcial incluido, porque protege la motivación mientras el contador de días informa.

## Reactividad y fallos

Las lecturas Dexie se adaptan a stores de Svelte en `src/lib/live.ts`. Las pantallas que deben distinguir carga, vacío y fallo usan `estadoLiveQuery`; las escrituras no bloqueantes informan fallos mediante `errores-datos.ts`.

La pantalla de ejercicio conserva una copia optimista de sus sets mientras hay escrituras en vuelo. Debe resincronizarse desde `setsEjercicioSesion` si una escritura falla: nunca puede dejar visible un peso que no se guardó.

Una restauración o borrado completo incrementa la revisión global antes de tocar IndexedDB. Las
mutaciones capturan la revisión al comenzar y la verifican dentro de su transacción; una escritura
que quedó en cola desde la versión anterior falla explícitamente en vez de recrear datos borrados.
Al completar el reemplazo, `BroadcastChannel` recarga las demás pestañas.

## Costo de las lecturas derivadas

`resumenHistorialObs`, `rachaSemanalActual` y `recordsGlobalesObs` leen la tabla `sesiones`
entera y la recorren en JavaScript. Es deuda conocida y medida, no un descuido: IndexedDB no sabe
agregar, así que sumar el volumen de un día obliga a traer cada sesión al hilo principal. Y como
son `liveQuery` sobre la tabla completa, cualquier escritura las invalida.

La regla, igual, es acotar por índice siempre que se pueda: esas tres no pueden porque su alcance
es "todo el historial". La distribución muscular sí puede —su período es un rango de fechas
conocido— y por eso consulta `where('fecha').between(...)` en vez de traer la tabla entera.

Medido con `scripts/bench-historial` en Chromium con IndexedDB nativo y la CPU frenada 4×
(≈ Android de gama media), sobre bases sintéticas de 3,5 sesiones por semana con 6 ejercicios de
4 series:

|                                        | 3 años (549 sesiones) | 5 años (914) | 10 años (1.828) |
| -------------------------------------- | --------------------- | ------------ | --------------- |
| abrir `/historial` (las dos consultas) | 95 ms                 | 155 ms       | 305 ms          |
| terminar el día (`rachaSemanalActual`) | 50 ms                 | 90 ms        | 180 ms          |
| toque de −/+ tal como se siente        | 16 ms                 | 24 ms        | 51 ms           |
| marcar una serie y decidir el PR       | 11 ms                 | 17 ms        | 33 ms           |

Son medianas de cinco corridas y varían alrededor de un 10% entre corridas; sirven para el orden
de magnitud, no para comparar cambios chicos.

Todo crece lineal y las constantes son chicas, así que **por ahora no se optimiza**. Dos cosas
que el número suelto no dice: el toque de −/+ no cuesta lo que cuesta escribir (1,9 ms), sino que
la pantalla de ejercicio mantiene `historialObs` suscripta y la escritura la recalcula entera; y
`rachaSemanalActual` ya sale fire-and-forget, así que no retrasa la celebración del día, pero sí
bloquea el hilo mientras esa celebración anima.

Conviene volver a medir con el banco cuando el historial real pase las ~900 sesiones (unos cinco
años entrenando), o antes si alguna vez se importan historiales largos de otra app.

Si el proyecto migra a servidor y base compartida, esto se resuelve solo: el término que domina es
deserializar la tabla, y un `GROUP BY` con índice no lo paga. Lo que sobrevive a esa migración son
las reglas puras de `sesion-reglas.ts` y los invariantes de este documento, no las consultas.

**Cachear el récord vigente por ejercicio está descartado.** Es la optimización obvia para
`recordsGlobalesObs` y la única de esta lista que puede hacer daño real: `max` no es invertible,
así que bajar o borrar la serie que tenía el récord obliga a recomputar ese ejercicio completo, y
el día que esa invalidación falle el récord no se degrada, desaparece. Un PR mostrado siempre se
calcula a partir de sets hechos. Una tabla derivada con volúmenes y contadores por sesión sí sería
aceptable —un error ahí desajusta un número, no borra un logro— y se mantendría donde ya se
mantiene `exerciseIds`: dentro de `guardarSesion`, en la misma transacción.

## Datos locales y video

`Dias`, `Sesiones`, `Notas`, `Ajustes` y `PesosCorporales` forman una única transacción durante importación o borrado. El índice derivado `exerciseIds` se recalcula antes de persistir una sesión. El peso corporal usa una fila por fecha local y gramos enteros; no se mezcla con el peso levantado en una sesión.

Los backups se validan antes de escribir: tamaño máximo de 25 MB, límites de colecciones, fechas e
ids coherentes, enteros donde el dominio es discreto y pesos decimales no negativos. La preparación
deduplica ids, repara series marcadas sin reps válidas, canoniza pesos legacy y avisa cualquier dato
descartado o truncado antes de confirmar.

El shell PWA queda precacheado. Los videos no se guardan automáticamente al reproducirse: `Ajustes → Descargar todos los videos` es la única acción que los persiste en `gb-videos`, y esa caché se puede vaciar sin tocar los datos de entrenamiento.
