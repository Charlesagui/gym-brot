# Auditoría de catálogo y assets

Generada el 2026-08-24 con `npm run audit:media -- --upstream <exercises.json> --write`.

## Inventario local

- Catálogo: **962 ejercicios**.
- MP4: **962 archivos**, 20.16 MiB.
- Referencias faltantes: **0**.
- MP4 huérfanos: **0**.
- IDs duplicados: **0**.
- Nombres normalizados duplicados: **0**.
- Rutas duplicadas: **0**.
- Grupos con hash SHA-256 idéntico: **0**.
- Dimensiones: `360x360`: 962.
- Códecs: `h264`: 962.

## Comparación de metadata externa

- Fuente externa: **1324 registros**.
- Ejercicios locales emparejados por nombre/ID normalizado: **932**.
- IDs locales curados sin match automático: **30**.
- Diferencia neta de catálogo: **362** ejercicios.

## Licencia de la media

**El gate está levantado.** Desde el 2026-08-25 el proyecto tiene autorización de uso sobre las
animaciones de ejercicios, así que ya no hay bloqueo para redistribuirlas dentro de la PWA ni para
ampliar el catálogo con la misma fuente. El comprobante vive fuera del repositorio; si hace falta
acreditarlo, referenciarlo desde acá y desde `PLAN.md` §3.

Lo que la autorización **no** cambia: la metadata de `hasaneyldrm/exercises-dataset` y la
geometría de `melihcolpan/MuscleMap` son MIT y siguen exigiendo conservar copyright y aviso
(`THIRD_PARTY_NOTICES.md`). Tampoco cambia que openGym sea AGPL-3.0: su código no se copia.

## Pipeline para ampliar el catálogo

1. Mantener los MP4 actuales; no convertir el catálogo a GIF ni incorporar posters sin medir primero el beneficio.
2. Descargar sólo los faltantes, validar hash y dimensiones, revisar anatomía y movimiento.
3. Convertir a MP4 H.264 360×360, coherente con los 962 que ya están.
4. Generar manifest de procedencia por asset y volver a ejecutar esta auditoría (`npm run audit:media`).
5. Verificar que el precache siga sin incluir video: la videoteca se descarga sólo desde Ajustes.

Fuentes verificadas el 2026-08-24: [Gym visual Terms](https://gymvisual.com/content/3-terms-and-conditions-of-use), [hasaneyldrm NOTICE](https://github.com/hasaneyldrm/exercises-dataset/blob/main/NOTICE.md) y [ExerciseGymGifsDB README](https://github.com/JahelCuadrado/ExerciseGymGifsDB).
