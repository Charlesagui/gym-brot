# Gym-brot — Decisiones y pendientes

App de gimnasio **personal, mobile-first**, offline y sin backend. No dependés de los nombres:
te guiás por un **video MP4 liviano** de cada ejercicio, que muestra el movimiento y marca
**el músculo en rojo**.

> **Qué es este documento.** Registra _por qué_ la app es como es y qué queda sin hacer:
> lo que no se puede deducir leyendo el código. Deliberadamente **no** describe la
> implementación — esa parte es la que se desactualiza. (Este archivo llegó a tener un
> modelo de datos y un estado de fases que terminaron mintiendo: el modelo se quedó en
> `diaSemana` singular varias migraciones atrás, y daba por pendiente la edición de series
> del historial, que ya estaba construida.)
>
> | Busco…                                                         | Está en                |
> | -------------------------------------------------------------- | ---------------------- |
> | Qué hace la app, cómo correrla, cómo desplegarla               | `README.md`            |
> | Principios de producto (operación, recompensas, accesibilidad) | `CLAUDE.md`            |
> | Modelo de datos, invariantes y límites que no se rompen        | `docs/arquitectura.md` |
> | Qué se construyó y cuándo                                      | historial de git       |

---

## 1. Decisiones tomadas ✅

| Tema                   | Decisión                                                                                                      | Por qué                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backend**            | **Ninguno**                                                                                                   | Es una app personal: sin cuentas, sin servidor que mantener ni pagar.                                                                                                |
| **Almacenamiento**     | **Dexie.js** (IndexedDB), local                                                                               | Offline real y cero latencia durante la serie. Ver riesgo de desalojo en iOS (§2).                                                                                   |
| **Distribución**       | **PWA** instalable                                                                                            | Cubre Android e iPhone con un solo build. Capacitor queda como upgrade si hace falta tienda.                                                                         |
| **Build**              | SvelteKit + Svelte 5 (runes) con `adapter-static`                                                             | App 100% estática → hosting gratis, nada que servir dinámicamente.                                                                                                   |
| **Demos de ejercicio** | **MP4 compactados** desde los GIFs de [ExerciseGymGifsDB](https://github.com/JahelCuadrado/ExerciseGymGifsDB) | Movimiento + músculo en rojo en un solo asset, mucho más liviano que el GIF original.                                                                                |
| **Mapa muscular SVG**  | ❌ **Descartado**                                                                                             | La animación ya marca el músculo: un SVG aparte sería trabajo y peso para repetir información.                                                                       |
| **Videos**             | Locales en `/videos`, descarga offline **explícita** desde Ajustes                                            | Sin CDN del que depender; el usuario decide cuándo gastar los ~22 MB.                                                                                                |
| **Catálogo**           | JSON estático empaquetado, read-only                                                                          | No es dato del usuario: no tiene por qué vivir en la base ni migrarse.                                                                                               |
| **Unidad**             | **kg** por defecto, cambiable a **lb**                                                                        | Cambiar la unidad es solo una preferencia de lectura: nunca reescribe el historial.                                                                                  |
| **Estilo visual**      | Oscuro casi negro, minimalista, con brillos radiales de color y un color propio por grupo muscular            | Legible en el gym y con personalidad sin ser infantil. Los valores exactos viven en los tokens de `src/app.css` y `src/lib/catalog.ts`, que son la fuente de verdad. |

---

## 2. Riesgos vigentes

- **iOS puede borrar los datos locales** tras semanas sin abrir la app. Mitigado con
  almacenamiento persistente y backup a archivo, pero no eliminado.
- **Licencia de las animaciones** (ExerciseDB): uso personal está bien; si la app se publica
  o se vende hay que pasar a licencia oficial o a un set propio.
- ⚠️ **El repo está público en GitHub** (verificado 2026-08-14) mientras el `LICENSE` es
  propietario y el README pide mantenerlo privado. Los 962 MP4 de `static/videos` (22 MB)
  derivan de ExerciseDB. Decidir una de dos: pasar el repo a privado, o revisar las licencias
  y ajustar `LICENSE` y README para que digan la verdad.

---

## 3. Fuentes

| Recurso                                                                               | Uso                                         | Licencia             |
| ------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------- |
| [JahelCuadrado/ExerciseGymGifsDB](https://github.com/JahelCuadrado/ExerciseGymGifsDB) | **GIFs animados fuente, convertidos a MP4** | none (de ExerciseDB) |
| [vite-pwa/sveltekit](https://github.com/vite-pwa/sveltekit)                           | PWA plugin                                  | MIT                  |
| [jessedelira/gym-tracker](https://github.com/jessedelira/gym-tracker)                 | Referencia (PWA gym)                        | —                    |

---

## 4. Diferido / mejoras futuras

- **Máquinas propias** — agregar un ejercicio custom con nombre y foto, para las máquinas del
  gym que no estén en el catálogo genérico. Pedido pero pospuesto.
- **Métrica de PR por ejercicio** — hoy `peso máximo` vs `1RM estimado` es una preferencia
  global; tendría sentido usar una en unos ejercicios y otra en otros.
- **Multiusuario con sync** — ya funciona por dispositivo (cada persona en su celu tiene sus
  datos). Cuentas y sync en la nube (Dexie Cloud / Supabase) serían un agregado, no un rehacer.
- **Personaje animado propio** para reemplazar las animaciones como "skin" y salir de la
  dependencia de licencia. Refs: `dscherm/gym-mouse` (MIT),
  `philg0ld/gemini-exercise-illustrator` (MIT). Tiene que ser original.
- **Capacitor** (tiendas), recordatorios, sync entre dispositivos.
- **Drift de redondeo kg↔lb** — decidido no arreglar: raro en uso real, y los pesos se
  persisten en gramos enteros, que son estables entre unidades (ver `docs/arquitectura.md`).
