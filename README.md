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
2. En Netlify → *Add new site → Import from Git* → elegí el repo.
3. Build command y publish dir ya vienen en `netlify.toml` (`npm run build` → `build`).
4. Deploy. Te da una URL tipo `gym-brot.netlify.app`.

**Sin GitHub (drag & drop):** corré `npm run build` y arrastrá la carpeta `build/` a
[app.netlify.com/drop](https://app.netlify.com/drop).

> `static/_redirects` ya está incluido para que refrescar dentro de una sub-página
> (`/dia/...`, `/ejercicio/...`) no devuelva 404.

## Instalar en el celular

- **Android (Chrome):** abrí la URL → menú ⋮ → *Instalar app / Agregar a pantalla de inicio*.
- **iPhone (Safari):** abrí la URL → *Compartir* → *Agregar a inicio*.
  En iOS hacé **backup seguido** (Ajustes → Exportar): el sistema puede borrar datos locales
  si no abrís la app por varias semanas.

## Datos y backup

Todo se guarda en tu teléfono (IndexedDB vía Dexie). Desde **Ajustes** podés
**exportar/importar** un JSON con tus rutinas y progreso. No hay nube: cada dispositivo es su
propio perfil.

## Licencia

Código **propietario — todos los derechos reservados** (ver [`LICENSE`](LICENSE)). Las animaciones
provienen de GIFs de ExerciseDB convertidos a MP4 (uso personal). No publicar como open source sin revisar estas licencias.
