#!/bin/bash
# Convierte y envía por Telegram todos los vídeos generados en esta ejecución.
set -e
shopt -s nullglob
# Descubre los archivos realmente guardados, sin asumir que la extensión coincide con el MIME.
mapfile -t raws < <(find out -maxdepth 1 -type f \( -name 'raw*.webm' -o -name 'raw*.mp4' \) -size +0c | sort)
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
  node - "$VIDEO" <<'NODE'
const { execFileSync } = require('node:child_process');
const file = process.argv[2];
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', file], { encoding: 'utf8' }));
const video = (probe.streams || []).find(s => s.codec_type === 'video');
const audio = (probe.streams || []).find(s => s.codec_type === 'audio');
const duration = Number(probe.format && probe.format.duration);
if (!video || !audio) throw new Error('El MP4 debe contener imagen y audio.');
if (!(video.width > 0 && video.height > video.width)) throw new Error('El vídeo no está en formato vertical.');
if (Math.abs(video.width / video.height - 9 / 16) > 0.02) throw new Error('La relación de aspecto no es 9:16.');
if (!Number.isFinite(duration) || duration < 5 || duration > 180) throw new Error('Duración fuera del rango permitido: ' + duration);
console.log('MP4 verificado:', video.width + 'x' + video.height, Math.round(duration) + ' s, vídeo y audio presentes.');
NODE
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    caption=$(head -c 1000 "$CAPTION")
    response=$(curl -fsS -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendVideo" -F chat_id="$TELEGRAM_CHAT_ID" -F video=@"$VIDEO" -F supports_streaming=true -F caption="$caption")
    node -e 'const x=JSON.parse(process.argv[1]); if (!x.ok) { console.error("Telegram no confirmó sendVideo:", x.description || "error"); process.exit(1); }' "$response"
    response=$(curl -fsS -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" -F chat_id="$TELEGRAM_CHAT_ID" -F text="$(head -c 3900 "$CAPTION")")
    node -e 'const x=JSON.parse(process.argv[1]); if (!x.ok) { console.error("Telegram no confirmó sendMessage:", x.description || "error"); process.exit(1); }'
  else
    echo "Sin Telegram configurado: $VIDEO está en Artifacts."
  fi
done
