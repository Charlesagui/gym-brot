# Gym-brot — Plan del proyecto

App de gimnasio **personal, mobile-first**. Simple y bonita, pensada para usarse
con una mano y con mala señal en el gym. Sin depender de los nombres: te guiás por un
**video MP4 liviano** del ejercicio, que muestra el movimiento y marca **el músculo en rojo**.

> Estado: **MVP completo** (Fases 0–6 construidas — ver historial git). Este doc queda
> como referencia de decisiones y modelo de datos; el catálogo arrancó con los 30 ejercicios
> documentados en `EJERCICIOS-INICIALES.md` y luego se amplió con más ejercicios de cable/polea.

---

## 1. Objetivo y funciones principales

1. **Rutina del día** con cantidad de series, para ir descontando lo que vas haciendo.
2. **Video MP4 del ejercicio** (reconocimiento visual + cómo se hace, sin nombres).
3. **Músculo trabajado resaltado** — ya viene marcado en rojo dentro de la animación.
4. **PR por máquina** — **récord automático** por **peso máximo** (o **1RM estimado** opcional, configurable),
   contado **solo de las series marcadas hechas ✓**, con **🔥 MAX** (+ kg encima de la placa) y **mini-gráfico**.

Principios: botones grandes, una sola mano, dark mode, mínimos toques, animaciones suaves, **offline**.

---

## 2. Decisiones tomadas ✅

| Tema              | Decisión                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Framework         | **SvelteKit + Svelte 5** (runes)                                                                                                                                         |
| Distribución      | **PWA** instalable (base). Capacitor = upgrade futuro                                                                                                                    |
| Plataformas       | **Android + iPhone**                                                                                                                                                     |
| Imágenes          | ✅ **MP4 compactados** desde GIFs de ExerciseDB vía [JahelCuadrado/ExerciseGymGifsDB](https://github.com/JahelCuadrado/ExerciseGymGifsDB) — movimiento + músculo en rojo |
| Mapa muscular SVG | ❌ Descartado (la animación ya marca el músculo)                                                                                                                         |
| Almacenamiento    | **Dexie.js** (IndexedDB) — local, offline                                                                                                                                |
| Unidad            | **kg** por defecto, cambiable a **lb** en ajustes                                                                                                                        |
| Estilo visual     | **Oscuro minimalista** + brillos sutiles de color (color a definir — no atado a azul/índigo), acento vivo (§7)                                                           |
| Backend           | **Ninguno**                                                                                                                                                              |

---

## 3. Stack técnico

- **SvelteKit** con `adapter-static` (app 100% estática).
- **vite-pwa/sveltekit** → service worker, instalable, cache offline.
- **Tailwind CSS** (touch targets grandes, dark mode, glows).
- **Dexie.js** para datos del usuario.
- **MP4 empaquetados** en la app (offline real) — no depender del CDN.
- Catálogo = **JSON estático** empaquetado (read-only).

---

## 4. Arquitectura

```
Catálogo (JSON estático: ejercicios · nombre_es · grupo · demoVideo)
                              │
   MP4 animado (ExerciseDB)  ──►  movimiento + músculo en rojo (todo en uno)
                              │
   Dexie.js (en el teléfono)  ──►  Días · sesiones · pesos/PR · notas · ajustes
                              │
                          Todo offline · backup export/import a archivo
```

---

## 5. Modelo de datos (conceptual)

**Catálogo (estático — ver `EJERCICIOS-INICIALES.md`):**

```
Ejercicio: id · nombre_es · grupo_muscular · demoVideo · instrucciones_es? (opcional)
```

**Datos del usuario (Dexie):**

```
Dia:      id · nombre · color? · diaSemana? · ejercicios[ { exerciseId, seriesObjetivo, orden } ]
Sesion:   id · fecha · diaId · ejercicios[ { exerciseId, sets[ { peso?, reps?, hecha, esMax? } ] } ]
          → peso POR SERIE (permite rampa/pirámide) · se resetea por sesión
Nota:     exerciseId · texto        (colapsada en la UI)
Ajustes:  darkMode · unidad(kg|lb) · timer{ activo, minutos }
```

> El **PR** se deriva del historial de sesiones, **solo de las series marcadas hechas ✓** (no se fabrica nada).
> Métrica **configurable** (Ajustes): `peso` = serie más pesada · `e1rm` = 1RM estimado (Epley `peso·(1+reps/30)`),
> que sí tiene en cuenta las reps. El número y el mini-gráfico siempre rotulan qué métrica usan.
> **MAX** por serie = placa full; `extraKg` suma los kg encima de la placa al valor del PR.
> El umbral de "PR ya celebrado" guarda el **set** (no un escalar), así se recalcula bien al cambiar métrica o unidad.
> Cada serie pre-llena el peso de la anterior / última sesión, para rampear rápido en el gym.

---

## 6. Pantallas y flujo

**Flujo:** `Días → Día → Ejercicio → (Terminar) → vuelve al Día`

1. **Días** (principal) — lista de días **editables** + **atajo HOY** (según día de semana).
   Viene con **días de ejemplo** precargados. `[+ Nuevo día]`.
2. **Día** — ejercicios del día con progreso de series (●○) y ✓ completado. `[+ Agregar ejercicio]`. Editable.
3. **Ejercicio** —
   - **Video** en loop (movimiento + músculo en rojo).
   - **Series con peso por serie:** una fila por serie = `peso × reps` + marcar hecha ✓ (el **[+]** suma serie). Permite **rampa/pirámide** (10→15→20→25 kg); pre-llena el peso de la serie anterior / última sesión. Simple si querés: mismo peso o solo marcar hechas.
   - **🏆 PR automático** (de tus series hechas ✓) por **peso máximo** o **1RM estimado** (elegís en Ajustes; el número dice qué métrica usa) · **🔥 MAX** por serie (+ kg encima de la placa).
   - **📈 Mini-gráfico** de progreso del peso.
   - **📝 Notas** colapsadas (tocar para abrir/editar: "asiento en 4", "agarre cerrado").
   - **⏱️ Timer** de descanso opcional (arranca al completar serie).
   - `[✓ Terminar ejercicio]` → marca ✓ y vuelve.

**Reset por sesión:** al reentrar a un día, las series vuelven a 0; el historial de PR queda.

---

## 7. Estilo visual

- Base **oscura casi negra**, minimalista, mucho espacio en negro.
- **Brillos sutiles de color** (radial glows): el fondo general usa el acento; cada tarjeta de ejercicio usa el color de su grupo. Ref de vibra: captura estilo Gemini.
- **Sombras tintadas** con color, no gris plano.
- **Acento global: violeta** (`#7c5cff`, elegido) para lo interactivo (círculos, botones, PR, 🔥 MAX).
- **Color por grupo** (glow de cada tarjeta): Piernas rosa · Pecho coral · Espalda verde · Hombros ámbar · Brazos celeste · Core cian.
- Tipografía limpia, botones grandes (una mano), transiciones suaves. (Tono exacto se afina al construir.)

---

## 8. Fases del MVP (construidas — historial en git)

`0` Cimientos · `1` Las 3 pantallas · `2` Días y rutinas · `3` ❤️ Contador de series ·
`4` Peso y PR · `5` Notas y Timer · `6` Pulido y estética.

**Preprocesamiento:** JSON semilla · días de ejemplo · empaquetar MP4 compactados.

---

## 9. Riesgos / a verificar

- **Cobertura de TU gym**: los 30 son máquinas genéricas; confirmar que coinciden. (Agregar máquinas propias = diferido, §11.)
- **Offline real**: MP4 empaquetados en la app para andar sin señal.
- **iOS**: puede borrar datos locales tras semanas sin abrir → mitigado con backup.
- **Licencia animaciones** (ExerciseDB): uso personal OK; si se publica → licencia oficial (§11).

---

## 10. Fuentes

| Recurso                                                                               | Uso                                         | Licencia             |
| ------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------- |
| [JahelCuadrado/ExerciseGymGifsDB](https://github.com/JahelCuadrado/ExerciseGymGifsDB) | **GIFs animados fuente, convertidos a MP4** | none (de ExerciseDB) |
| [vite-pwa/sveltekit](https://github.com/vite-pwa/sveltekit)                           | PWA plugin                                  | MIT                  |
| [jessedelira/gym-tracker](https://github.com/jessedelira/gym-tracker)                 | Referencia (PWA gym)                        | —                    |

---

## 11. Diferido / mejoras futuras

- **Multiusuario:** ya funciona local (cada persona en su celu = su propio perfil/datos). Cuentas + sync en la nube = upgrade futuro (Dexie Cloud / Supabase), sin rehacer nada.
- **Máquinas propias** (agregar ejercicio custom con nombre/foto) — pedido pero pospuesto.
- **Personaje animado custom** (reemplazar las animaciones como "skin"): DIY 3D / comprar / encargar / IA.
  Refs: `dscherm/gym-mouse` (MIT), `philg0ld/gemini-exercise-illustrator` (MIT). Debe ser original.
- **Licencia animaciones**: si se publica/vende → ExerciseDB Pro o set propio.
- **Capacitor** (tiendas), notificaciones/recordatorios, sync entre dispositivos.

---

## 12. Roadmap verdad-de-datos + PR

Refinamiento del PR para cumplir el manifiesto ("Datos y verdad").

**✅ Hecho (fases A–C + pulido UI):**

- **A1 · PR honesto** — el PR sale **solo de series marcadas hechas ✓**. "Terminar ejercicio" ya **no auto-completa**
  series no tocadas (no fabrica récords ni progreso). El badge en vivo y la celebración al terminar usan el mismo criterio.
- **A2 · Umbral robusto** — "PR ya celebrado" guarda el **set** (`{peso, reps, esMax, extraKg}`), no un escalar →
  se recalcula bien al cambiar de métrica o de unidad.
- **A3 · kg↔lb** — la conversión de unidad ahora también convierte `extraKg` y el umbral celebrado.
- **A4 · Medianoche** — la sesión activa fija su fecha al entrar al ejercicio; no se pierden toques al cruzar las 00:00.
- **B · Métrica configurable** — Ajustes → `peso máximo` | `1RM estimado (Epley)`. Todo (PR, gráfico, badge, celebración)
  pasa por una función de valor única; rótulos dinámicos + línea con la métrica secundaria.
- **C · MAX coherente** — `extraKg` ("encima de la placa") implementado y suma al PR; toggle MAX más descubrible.
- **UI** — estado vacío "Todavía sin PR"; mini-gráfico con 1 sola sesión.

**⏳ Pendiente (mayor esfuerzo / riesgo — pedir antes de hacer):**

- **D3 · Corrección de dato** — long-press en un punto del gráfico para quitar/editar una serie del historial
  (salida de emergencia ante un dato malo). Menos urgente ahora que A1–A3 cierran las fuentes de datos falsos.
- **D4 · Vista global de récords** — pantalla que liste todos los PRs (pantalla nueva).
- **Métrica por ejercicio** — hoy es global; permitir `peso` en unos y `1RM` en otros.
