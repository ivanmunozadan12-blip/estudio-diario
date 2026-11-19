# -*- coding: utf-8 -*-
# Prueba con una voz de referencia real (pc-voz/refs/yo.wav): ENGINE=qwen o chatterbox. Sube prueba_u_* a Supabase.
import os, io, sys, time, ast, urllib.request
import numpy as np, soundfile as sf
HERE = os.path.dirname(os.path.abspath(__file__)); ENGINE = sys.argv[1]
URL = os.environ['SUPABASE_URL'].rstrip('/'); KEY = os.environ['SUPABASE_KEY']
def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)
def subir(nombre, wav, sr):
    buf = io.BytesIO(); sf.write(buf, wav, sr, format='WAV', subtype='PCM_16')
    req = urllib.request.Request(URL + '/storage/v1/object/voz/' + nombre, data=buf.getvalue(), method='POST', headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'audio/wav', 'x-upsert': 'true'})
    urllib.request.urlopen(req, timeout=120).read()
tree = ast.parse(open(os.path.join(HERE, 'worker.py'), encoding='utf-8').read())
g = {'np': np}
for n in tree.body:
    if isinstance(n, ast.FunctionDef) and n.name == 'limpiar_audio': exec(compile(ast.Module([n], []), 'w', 'exec'), g)
limpiar = g['limpiar_audio']
def norm(a): a = np.asarray(a, dtype=np.float32); return a / (float(np.max(np.abs(a))) or 1) * 0.89
LINEAS = ['Llegas a casa y Marta ya ha puesto la norma número doce.', 'Abres el grifo. Sale agua fría. Otra vez, joder.',
          'Y tú, claro, te rindes.', 'Cuarenta euros por una tostadora que ni siquiera es tuya.', 'No pasa nada. Eso dice. Pasa todo.', 'Ahora sí, joder.']
REF = os.path.join(HERE, 'refs', 'yo.wav'); REF_TEXT = open(os.path.join(HERE, 'refs', 'yo.txt'), encoding='utf-8').read().strip()
if ENGINE == 'qwen':
    import torch
    from qwen_tts import Qwen3TTSModel
    m = Qwen3TTSModel.from_pretrained('Qwen/Qwen3-TTS-12Hz-1.7B-Base', device_map='cpu', dtype=torch.float32)
    a, sr = sf.read(REF, dtype='float32')
    if a.ndim > 1: a = a.mean(axis=1)
    p = m.create_voice_clone_prompt(ref_audio=(a, sr), ref_text=REF_TEXT)
    for i, t in enumerate(LINEAS):
        t0 = time.time(); w, s = m.generate_voice_clone(text=t, language='Spanish', voice_clone_prompt=p)
        subir('prueba_u_qwen_%02d.wav' % (i + 1), norm(limpiar(w[0], s)), s); log('qwen %d/%d en %.0f s' % (i + 1, len(LINEAS), time.time() - t0))
else:
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    m = ChatterboxMultilingualTTS.from_pretrained(device='cpu')
    for i, t in enumerate(LINEAS):
        for e in (0.5, 0.9):
            t0 = time.time(); w = m.generate(t, language_id='es', audio_prompt_path=REF, exaggeration=e, cfg_weight=0.4).squeeze().cpu().numpy()
            subir('prueba_u_cb_%02d_e%d.wav' % (i + 1, int(e * 10)), norm(limpiar(w, m.sr)), m.sr); log('cb %d/%d e=%.1f en %.0f s' % (i + 1, len(LINEAS), e, time.time() - t0))
log('Terminado')
