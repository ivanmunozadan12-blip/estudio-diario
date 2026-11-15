#!/bin/bash
# Convierte a MP4 (H.264/AAC, válido para YouTube/Instagram/TikTok) y lo manda por Telegram.
set -e
RAW=$(ls out/raw.* | head -1)
ffmpeg -loglevel error -y -i "$RAW" -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -r 30 -c:a aac -b:a 160k -movflags +faststart out/video.mp4
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  curl -sS -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendVideo" -F chat_id="$TELEGRAM_CHAT_ID" -F video=@out/video.mp4 -F supports_streaming=true -F caption="$(head -c 1000 out/caption.txt)" | head -c 300
  curl -sS -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" -F chat_id="$TELEGRAM_CHAT_ID" -F text="$(cat out/caption.txt | head -c 3900)" >/dev/null
else echo "Sin Telegram configurado: el vídeo está en los 'Artifacts' de la ejecución."; fi
