#!/bin/bash
# Convierte y envía por Telegram todos los vídeos generados en esta ejecución.
set -e
shopt -s nullglob
# Descubre los archivos realmente guardados, sin asumir que la extensión coincide con el MIME.
mapfile -t raws < <(find out -maxdepth 1 -type f \\( -name 'raw*.webm' -o -name 'raw*.mp4' \\) -size +0c | sort)
if [ ${#raws[@]} -eq 0 ]; then
  echo "No se encontraron vídeos fuente válidos en out/. Contenido disponible:"
  ls -lah out/ || true
  exit 1
fi
for RAW in "${raws[@]}"; do
  base=$(basename "$RAW")
  if [[ "$base" =~ ^raw-([0-9]+)\. ]]; then
    idx="${BASH_REMATCH[1]}"
    VIDEO="out/video-$idx.mp4"
    CAPTION="out/caption-$idx.txt"
  else
    VIDEO="out/video.mp4"
    CAPTION="out/caption.txt"
  fi
  if [ ! -s "$RAW" ]; then echo "Archivo fuente vacío o inexistente: $RAW"; exit 1; fi
  if [ ! -f "$CAPTION" ]; then echo "Falta el texto asociado: $CAPTION"; exit 1; fi
  echo "Convirtiendo $RAW ($(stat -c%s "$RAW") bytes) -> $VIDEO"
  ffmpeg -loglevel error -y -i "$RAW" -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -r 30 -c:a aac -b:a 160k -movflags +faststart "$VIDEO"
  if [ ! -s "$VIDEO" ]; then echo "FFmpeg no creó un vídeo válido: $VIDEO"; exit 1; fi
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    caption=$(head -c 1000 "$CAPTION")
    response=$(curl -sS -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendVideo" -F chat_id="$TELEGRAM_CHAT_ID" -F video=@"$VIDEO" -F supports_streaming=true -F caption="$caption")
    echo "$response" | head -c 500
    echo
    if ! echo "$response" | grep -q '"ok":true'; then echo "Telegram no confirmó el envío de $VIDEO"; exit 1; fi
    curl -sS -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" -F chat_id="$TELEGRAM_CHAT_ID" -F text="$(cat "$CAPTION" | head -c 3900)" >/dev/null
  else
    echo "Sin Telegram configurado: $VIDEO está en Artifacts."
  fi
done
