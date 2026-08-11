# Gym-brot 🏋️

App de gimnasio **personal, mobile-first**: tus días de entrenamiento, contador de series,
peso × reps con **PR automático** y mini-gráfico, **video MP4 liviano** de cada ejercicio (con el
músculo en rojo), notas y timer de descanso. **100% offline** (PWA instalable), sin backend.

## Stack

SvelteKit + Svelte 5 (runes) · Tailwind v4 · Dexie.js (IndexedDB) · vite-pwa · `adapter-static`.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera build/ (PWA estática)
npm run preview  # previsualiza el build de producción
npm run check    # type-check (svelte-check)
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
worker precachea el shell (~1 MB). Los **videos** no se precachean —serían 22 MB de golpe en la
primera visita— sino que se guardan **la primera vez que los ves** y quedan cacheados para
siempre. Si vas a un gym sin señal y querés dejarlos listos, hay un botón
**Ajustes → Descargar todos los videos** (~22 MB, cancelable).

Cuando hay una versión nueva, la app **avisa y espera**: nunca se actualiza sola en medio de un
ejercicio o de un descanso.

## Datos y backup

Todo se guarda en tu teléfono (IndexedDB vía Dexie). Desde **Ajustes** podés
**exportar/importar** un JSON con tus rutinas y progreso. No hay nube: cada dispositivo es su
propio perfil.

## Licencia

Código **propietario — todos los derechos reservados** (ver [`LICENSE`](LICENSE)). Las animaciones
provienen de GIFs de ExerciseDB convertidos a MP4 (uso personal). No publicar como open source sin revisar estas licencias.
