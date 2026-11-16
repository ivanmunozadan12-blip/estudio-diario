# Tener la web con https (voz natural + instalar como app)

GitHub Pages gratis exige repo **público**. Solo se publican index.html, sw.js, manifest e iconos (el workflow no copia config.json ni history.json), pero el repo público deja ver todo el código e historial. No hay claves en el código; los secrets de Actions siguen privados.

1. Repo > Settings > General > abajo "Change visibility" > Public.
2. Settings > Pages > Source: **GitHub Actions**.
3. Fusiona el PR en main (o Actions > "Publicar web" > Run workflow).
4. La dirección será https://ivanmunozadan12-blip.github.io/estudio-diario/
5. Ábrela en el móvil (Chrome: menú > Instalar aplicación / Añadir a pantalla de inicio).

Si prefieres mantenerlo privado: Cloudflare Pages (gratis) subiendo esos 5 archivos.
