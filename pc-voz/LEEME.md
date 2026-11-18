# Voz del PC (Qwen3-TTS) para Piso 3ºB
1. Supabase (gratis, sin tarjeta): crea un proyecto, abre *SQL Editor*, pega `supabase.sql` y pulsa Run.
2. *Project Settings → API*: copia «Project URL» y la clave «anon / publishable».
3. En la web: Ajustes → «Voz del PC con emociones» → pega URL y clave → «Comprobar conexión».
4. En el PC: copia `worker.py` e `iniciar_voces.bat` a la carpeta `Piso3B_voces` (donde ya está `venv`), abre `iniciar_voces.bat` y pega URL y clave la primera vez. Déjalo abierto.
5. En el móvil pega el capítulo y pulsa «Crear vídeo»: las frases se hacen en el PC (≈ 7× la duración del audio) y el vídeo se monta al terminar. Si cierras la web, al volver a pulsar «Crear vídeo» con el mismo capítulo se reutilizan las frases ya hechas.
