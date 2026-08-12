# Arquitectura vigente

Gym-brot es una PWA local-first: no tiene backend y los datos de entrenamiento viven en IndexedDB.
Este documento registra los límites que deben preservarse al cambiar la app.

## Fuentes de verdad

- `src/lib/db.ts` define el esquema y las migraciones; `conIndice` y `guardarSesion` mantienen el índice derivado de cada sesión antes de persistirla.
- `src/lib/sesion-reglas.ts` contiene reglas puras de series, métricas y PR. No lee navegador ni base de datos.
- `src/lib/sesion.ts` consulta y modifica sesiones mediante Dexie; sus funciones son la frontera usada por la UI.
- `src/lib/progreso.ts` e `src/lib/historial.ts` derivan vistas desde sesiones crudas. Un PR mostrado siempre se calcula a partir de sets hechos.

## Reactividad y fallos

Las lecturas Dexie se adaptan a stores de Svelte en `src/lib/live.ts`. Las pantallas que deben distinguir carga, vacío y fallo usan `estadoLiveQuery`; las escrituras no bloqueantes informan fallos mediante `errores-datos.ts`.

La pantalla de ejercicio conserva una copia optimista de sus sets mientras hay escrituras en vuelo. Debe resincronizarse desde `setsEjercicioSesion` si una escritura falla: nunca puede dejar visible un peso que no se guardó.

## Datos locales y video

`Dias`, `Sesiones`, `Notas` y `Ajustes` forman una única transacción durante importación o borrado. El índice derivado `exerciseIds` se recalcula antes de persistir una sesión.

El shell PWA queda precacheado. Los videos no se guardan automáticamente al reproducirse: `Ajustes → Descargar todos los videos` es la única acción que los persiste en `gb-videos`, y esa caché se puede vaciar sin tocar los datos de entrenamiento.
