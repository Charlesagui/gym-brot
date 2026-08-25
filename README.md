# Gym-brot 🏋️

App de gimnasio **personal, mobile-first**: tus días de entrenamiento, contador de series,
peso × reps con **PR automático**, RIR/RPE opcional, doble progresión, peso corporal, heatmap y
distribución muscular estimada. Incluye **video MP4 liviano** por ejercicio, notas y timer de
descanso. **100% offline** (PWA instalable), sin backend.

## Stack

SvelteKit + Svelte 5 (runes) · Tailwind v4 · Dexie.js (IndexedDB) · vite-pwa · `adapter-static`.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera build/ (PWA estática)
npm run preview  # previsualiza el build de producción
npm run check    # type-check (svelte-check)
npm test         # tests unitarios + cobertura
npm run audit:media -- --skip-probe # inventario local rápido del catálogo y MP4
```

## Desplegar gratis (Netlify)

La app es 100% estática → entra en el plan gratis de **Netlify**, Vercel o Cloudflare Pages.

**Netlify (recomendado):**

1. Subí el repo a GitHub (**privado** — ver Licencia).
2. En Netlify → _Add new site → Import from Git_ → elegí el repo.
3. Build command y publish dir ya vienen en `netlify.toml` (`npm run build` → `build`).
4. Deploy. Te da una URL tipo `gym-brot.netlify.app`.

**Sin GitHub (drag & drop):** corré `npm run build` y arrastrá la carpeta `build/` a
[app.netlify.com/drop](https://app.netlify.com/drop).

> `static/_redirects` ya está incluido para que refrescar dentro de una sub-página
> (`/dia/...`, `/ejercicio/...`) no devuelva 404.

## Instalar en el celular

- **Android (Chrome):** abrí la URL → menú ⋮ → _Instalar app / Agregar a pantalla de inicio_.
- **iPhone (Safari):** abrí la URL → _Compartir_ → _Agregar a inicio_.
  En iOS hacé **backup seguido** (Ajustes → Exportar): el sistema puede borrar datos locales
  si no abrís la app por varias semanas.

## Offline y videos

La app (pantallas, lógica y datos) funciona **100% offline** desde la instalación: el service
worker precachea el shell (~1 MB). Los **videos** no se descargan ni se guardan al verlos: así
una búsqueda larga no consume el almacenamiento del teléfono. Si vas a un gym sin señal y querés
dejarlos listos, usá **Ajustes → Descargar todos los videos** (~20 MB, cancelable y reversible).

Cuando hay una versión nueva, la app **avisa y espera**: nunca se actualiza sola en medio de un
ejercicio o de un descanso.

## Datos y backup

Todo se guarda en tu teléfono (IndexedDB vía Dexie). Desde **Ajustes** podés
**exportar/importar** un JSON con tus rutinas, sesiones, ajustes y peso corporal. No hay nube:
cada dispositivo es su propio perfil.

## Licencia

Código **propietario — todos los derechos reservados** (ver [`LICENSE`](LICENSE)). Las animaciones
provienen de GIFs de ExerciseDB convertidos a MP4 y su uso está **autorizado** desde el
2026-08-25, así que no hay restricción pendiente para publicar la app. La metadata y geometría
MIT incorporadas sí exigen conservar su aviso: se detallan en
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). El inventario reproducible del catálogo y los
MP4 está en [`docs/auditoria-assets.md`](docs/auditoria-assets.md).
