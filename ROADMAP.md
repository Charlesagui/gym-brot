# Gym-brot — Roadmap de construcción

Orden pensado para tener **algo usable lo antes posible**: cada fase entrega algo que ya
podés tocar. Decisiones y modelo de datos en `PLAN.md`. Catálogo en `EJERCICIOS-INICIALES.md`.

> Estado: **sin código todavía.** Empezar por Fase 0 cuando se dé el OK.

---

## Fase 0 · Cimientos 🧱
- [ ] Proyecto **SvelteKit + Svelte 5** (runes) + TypeScript
- [ ] `adapter-static` (app estática)
- [ ] **Tailwind** + tema oscuro base + tokens de color (acento + glows azul/índigo)
- [ ] **PWA** (vite-pwa): manifest, íconos, service worker → instalable + offline
- [ ] **Dexie**: esquema (`Dia`, `Sesion`, `Registro`, `Nota`, `Ajustes`)
- [ ] Empaquetar los **30 GIFs** en la app (assets locales) → offline real
- [ ] Catálogo semilla (30) → JSON desde `EJERCICIOS-INICIALES.md`
- **Entrega:** app instalable que abre, offline.

## Fase 1 · Las 3 pantallas 🗂️
- [ ] Routing: `/` (Días) · `/dia/[id]` · `/ejercicio/[id]`
- [ ] Pantalla **Días** (lista + atajo HOY, placeholder)
- [ ] Pantalla **Día** (lista de ejercicios, placeholder)
- [ ] Pantalla **Ejercicio** (GIF + secciones, placeholder)
- [ ] Navegación + botón atrás
- **Entrega:** se navegan las 3 pantallas.

## Fase 2 · Días y rutinas 📋
- [ ] **Días de ejemplo** precargados al 1er arranque (Piernas / Pecho·Trícep·Hombro / Espalda·Bícep)
- [ ] Crear / renombrar / borrar día (también **desde cero**)
- [ ] Agregar/quitar ejercicios del catálogo a un día; fijar **nº de series objetivo**
- [ ] Asignar **día de semana** (atajo HOY) + color del día (opcional)
- **Entrega:** armás y editás tus días reales.

## Fase 3 · ❤️ Contador de series (el corazón)
- [ ] Círculos **●○** por serie; tocar ○ = hecha, tocar ● = deshacer
- [ ] Botón **[+]** para sumar serie extra
- [ ] Progreso (3/4) y marca **✓ Completado**; `[✓ Terminar]` → vuelve al Día
- [ ] Estado del día (progreso general)
- [ ] **Reset por sesión** (al reentrar, series a 0; historial queda)
- [ ] Atajo **HOY** funcional
- **Entrega:** se usa en el gym para entrenar y descontar series.

## Fase 4 · Peso y PR 🏆
- [ ] Cargar **peso × reps** de hoy por ejercicio
- [ ] Historial de registros (peso, reps, fecha)
- [ ] **PR automático** = mejor marca; 🎉 al superarlo
- [ ] **🔥 MAX**: marcar "tope de la máquina (placa full)"; permitir **MAX + X kg**
- [ ] **📈 Mini-gráfico** de progreso del peso
- [ ] PR inicial opcional (punto de partida)
- **Entrega:** registrás pesos y ves progreso/récords.

## Fase 5 · Notas y Timer 📝⏱️
- [ ] **Notas** por ejercicio, **colapsadas** (tocar para abrir/editar)
- [ ] **Timer de descanso** opcional (on/off), **1/2/3/4/5 min**
- [ ] Arranca al completar una serie; aviso (sonido/vibración) al terminar
- **Entrega:** los detalles que lo hacen cómodo en el gym.

## Fase 6 · Pulido y estética ✨
- [ ] Estilo final: oscuro + **glows sutiles de color** (azul/índigo), acento vivo
- [ ] Animaciones/transiciones suaves (pantallas + completar series)
- [ ] Ajustes: **kg/lb**, dark, timer, **backup export/import** (JSON)
- [ ] Íconos/splash PWA, revisión "una mano", táctil
- **Entrega:** la app "simple y bonita" lista para uso diario.

---

## Diferido (post-MVP)
- Máquinas propias (ejercicio custom con nombre/foto)
- Personaje animado custom (reemplazar GIFs)
- Capacitor (tiendas) · notificaciones · sync entre dispositivos
