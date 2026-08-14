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

Cada sesión congela `diaNombre` y cada ejercicio nuevo `nombreSnapshot`. El historial usa esos
snapshots antes que el catálogo o la rutina actuales, de modo que renombrar o archivar no cambia
retroactivamente lo entrenado.

## Reactividad y fallos

Las lecturas Dexie se adaptan a stores de Svelte en `src/lib/live.ts`. Las pantallas que deben distinguir carga, vacío y fallo usan `estadoLiveQuery`; las escrituras no bloqueantes informan fallos mediante `errores-datos.ts`.

La pantalla de ejercicio conserva una copia optimista de sus sets mientras hay escrituras en vuelo. Debe resincronizarse desde `setsEjercicioSesion` si una escritura falla: nunca puede dejar visible un peso que no se guardó.

Una restauración o borrado completo incrementa la revisión global antes de tocar IndexedDB. Las
mutaciones capturan la revisión al comenzar y la verifican dentro de su transacción; una escritura
que quedó en cola desde la versión anterior falla explícitamente en vez de recrear datos borrados.
Al completar el reemplazo, `BroadcastChannel` recarga las demás pestañas.

## Datos locales y video

`Dias`, `Sesiones`, `Notas` y `Ajustes` forman una única transacción durante importación o borrado. El índice derivado `exerciseIds` se recalcula antes de persistir una sesión.

Los backups se validan antes de escribir: tamaño máximo de 25 MB, límites de colecciones, fechas e
ids coherentes, enteros donde el dominio es discreto y pesos decimales no negativos. La preparación
deduplica ids, repara series marcadas sin reps válidas, canoniza pesos legacy y avisa cualquier dato
descartado o truncado antes de confirmar.

El shell PWA queda precacheado. Los videos no se guardan automáticamente al reproducirse: `Ajustes → Descargar todos los videos` es la única acción que los persiste en `gb-videos`, y esa caché se puede vaciar sin tocar los datos de entrenamiento.
