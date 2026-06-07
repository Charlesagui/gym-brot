# Gym-brot — Plan del proyecto

App de gimnasio **personal, mobile-first**. Simple y bonita, pensada para usarse
con una mano y con mala señal en el gym. Sin depender de los nombres: te guiás por un
**GIF animado** del ejercicio, que muestra el movimiento y marca **el músculo en rojo**.

> Estado: **MVP completo** (Fases 0–6 construidas — ver historial git). Este doc queda
> como referencia de decisiones y modelo de datos; los 30 ejercicios en `EJERCICIOS-INICIALES.md`.

---

## 1. Objetivo y funciones principales

1. **Rutina del día** con cantidad de series, para ir descontando lo que vas haciendo.
2. **GIF animado del ejercicio** (reconocimiento visual + cómo se hace, sin nombres).
3. **Músculo trabajado resaltado** — ya viene marcado en rojo dentro del propio GIF.
4. **PR por máquina** — peso × reps, **récord automático**, opción **🔥 MAX** y **mini-gráfico** de progreso.

Principios: botones grandes, una sola mano, dark mode, mínimos toques, animaciones suaves, **offline**.

---

## 2. Decisiones tomadas ✅

| Tema | Decisión |
|---|---|
| Framework | **SvelteKit + Svelte 5** (runes) |
| Distribución | **PWA** instalable (base). Capacitor = upgrade futuro |
| Plataformas | **Android + iPhone** |
| Imágenes | ✅ **GIFs animados** (ExerciseDB vía [JahelCuadrado/ExerciseGymGifsDB](https://github.com/JahelCuadrado/ExerciseGymGifsDB)) — movimiento + músculo en rojo. 30 en `EJERCICIOS-INICIALES.md` |
| Mapa muscular SVG | ❌ Descartado (el GIF ya marca el músculo) |
| Almacenamiento | **Dexie.js** (IndexedDB) — local, offline |
| Unidad | **kg** por defecto, cambiable a **lb** en ajustes |
| Estilo visual | **Oscuro minimalista** + brillos sutiles de color (color a definir — no atado a azul/índigo), acento vivo (§7) |
| Backend | **Ninguno** |

---

## 3. Stack técnico

- **SvelteKit** con `adapter-static` (app 100% estática).
- **vite-pwa/sveltekit** → service worker, instalable, cache offline.
- **Tailwind CSS** (touch targets grandes, dark mode, glows).
- **Dexie.js** para datos del usuario.
- **30 GIFs empaquetados** en la app (offline real) — no depender del CDN.
- Catálogo = **JSON estático** empaquetado (read-only).

---

## 4. Arquitectura

```
Catálogo (JSON estático: 30 ejercicios · nombre_es · grupo · gif)
                              │
   GIF animado (ExerciseDB)  ──►  movimiento + músculo en rojo (todo en uno)
                              │
   Dexie.js (en el teléfono)  ──►  Días · sesiones · pesos/PR · notas · ajustes
                              │
                          Todo offline · backup export/import a archivo
```

---

## 5. Modelo de datos (conceptual)

**Catálogo (estático — ver `EJERCICIOS-INICIALES.md`):**
```
Ejercicio: id · nombre_es · grupo_muscular · gif · instrucciones_es? (opcional)
```

**Datos del usuario (Dexie):**
```
Dia:      id · nombre · color? · diaSemana? · ejercicios[ { exerciseId, seriesObjetivo, orden } ]
Sesion:   id · fecha · diaId · ejercicios[ { exerciseId, sets[ { peso?, reps?, hecha, esMax? } ] } ]
          → peso POR SERIE (permite rampa/pirámide) · se resetea por sesión
Nota:     exerciseId · texto        (colapsada en la UI)
Ajustes:  darkMode · unidad(kg|lb) · timer{ activo, minutos }
```
> El **PR** se deriva del historial de sesiones = la **serie más pesada** de cada ejercicio (auto).
> **MAX** por serie = placa full; admite `extraKg` para "MAX + peso encima".
> Cada serie pre-llena el peso de la anterior / última sesión, para rampear rápido en el gym.

---

## 6. Pantallas y flujo

**Flujo:** `Días → Día → Ejercicio → (Terminar) → vuelve al Día`

1. **Días** (principal) — lista de días **editables** + **atajo HOY** (según día de semana).
   Viene con **días de ejemplo** precargados. `[+ Nuevo día]`.
2. **Día** — ejercicios del día con progreso de series (●○) y ✓ completado. `[+ Agregar ejercicio]`. Editable.
3. **Ejercicio** —
   - **GIF** en loop (movimiento + músculo en rojo).
   - **Series con peso por serie:** una fila por serie = `peso × reps` + marcar hecha ✓ (el **[+]** suma serie). Permite **rampa/pirámide** (10→15→20→25 kg); pre-llena el peso de la serie anterior / última sesión. Simple si querés: mismo peso o solo marcar hechas.
   - **🏆 PR automático** = tu **serie más pesada** del historial (+🎉 al superarlo) · **🔥 MAX** por serie (+ extra opcional).
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

**Preprocesamiento (una vez):** JSON semilla de los 30 · días de ejemplo · empaquetar los 30 GIFs.

---

## 9. Riesgos / a verificar

- **Cobertura de TU gym**: los 30 son máquinas genéricas; confirmar que coinciden. (Agregar máquinas propias = diferido, §11.)
- **Offline real**: GIFs empaquetados en la app para andar sin señal.
- **iOS**: puede borrar datos locales tras semanas sin abrir → mitigado con backup.
- **Licencia GIFs** (ExerciseDB): uso personal OK; si se publica → licencia oficial (§11).

---

## 10. Fuentes

| Recurso | Uso | Licencia |
|---|---|---|
| [JahelCuadrado/ExerciseGymGifsDB](https://github.com/JahelCuadrado/ExerciseGymGifsDB) | **GIFs animados** | none (de ExerciseDB) |
| [vite-pwa/sveltekit](https://github.com/vite-pwa/sveltekit) | PWA plugin | MIT |
| [jessedelira/gym-tracker](https://github.com/jessedelira/gym-tracker) | Referencia (PWA gym) | — |

---

## 11. Diferido / mejoras futuras

- **Multiusuario:** ya funciona local (cada persona en su celu = su propio perfil/datos). Cuentas + sync en la nube = upgrade futuro (Dexie Cloud / Supabase), sin rehacer nada.
- **Máquinas propias** (agregar ejercicio custom con nombre/foto) — pedido pero pospuesto.
- **Personaje animado custom** (reemplazar los GIFs como "skin"): DIY 3D / comprar / encargar / IA.
  Refs: `dscherm/gym-mouse` (MIT), `philg0ld/gemini-exercise-illustrator` (MIT). Debe ser original.
- **Licencia GIFs**: si se publica/vende → ExerciseDB Pro o set propio.
- **Capacitor** (tiendas), notificaciones/recordatorios, sync entre dispositivos.
