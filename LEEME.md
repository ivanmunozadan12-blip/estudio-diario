# Estudio Diario

Generador de vídeos verticales (voz, música, subtítulos, escenas por código) que corre entero en el navegador.

- **Web:** https://ivanmunozadan12-blip.github.io/estudio-diario/ (GitHub Pages; se actualiza sola al fusionar en `main`).
- **Uso diario:** modo simple → 🎲 tema → copiar prompt → pegar en ChatGPT → pegar la respuesta → grabar. Sin claves ni límites.
- **Voz:** Supertonic (neuronal, en el navegador) con Piper y voz sintética de respaldo.
- **Archivos publicados:** `index.html`, `sw.js`, `manifest.webmanifest`, `icon-*.png` (ver `.github/workflows/pages.yml`).
- **Automatización opcional:** `.github/workflows/videos.yml` + `ci/` generan vídeos con Gemini y los envían a Telegram/YouTube (requiere secretos del repositorio).
