# -*- coding: utf-8 -*-
# Prueba de motor alternativo: Chatterbox multilingue (MIT) clonando las voces ancla de Qwen.
# Sube audios prueba_cb_* a Supabase para compararlos a oido con los de Qwen. No toca la cola.
import os, sys, io, time, json, urllib.request, urllib.error, ast, wave
import numpy as np
URL = os.environ['SUPABASE_URL'].rstrip('/'); KEY = os.environ['SUPABASE_KEY']
def api(method, path, body=None, headers=None):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY}; h.update(headers or {})
    req = urllib.request.Request(URL + path, data=body, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=120) as r: return r.read()
def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'worker.py'), encoding='utf-8').read()
i = src.index('PRUEBAS = ['); j = src.index('\ndef hacer_pruebas')
PRUEBAS = eval(src[i + len('PRUEBAS = '):j])
import torch, soundfile as sf
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
log('Cargando Chatterbox multilingue...')
m = ChatterboxMultilingualTTS.from_pretrained(device='cpu'); log('listo, sr', m.sr)
os.makedirs('/tmp/anclas', exist_ok=True)
def ancla(n):
    p = '/tmp/anclas/%s.wav' % n
    if not os.path.exists(p): open(p, 'wb').write(api('GET', '/storage/v1/object/voz/ref_r1_%s.wav' % n))
    return p
def subir(nombre, wav):
    buf = io.BytesIO(); sf.write(buf, wav, m.sr, format='WAV', subtype='PCM_16')
    api('POST', '/storage/v1/object/voz/' + nombre, buf.getvalue(), {'Content-Type': 'audio/wav', 'x-upsert': 'true'})
def gen(txt, ref, exa):
    w = m.generate(txt, language_id='es', audio_prompt_path=ref, exaggeration=exa, cfg_weight=0.4)
    w = w.squeeze().cpu().numpy().astype(np.float32); pk = float(np.max(np.abs(w)) or 1); return w / pk * 0.89
for k, (who, tag, txt, alto) in enumerate(PRUEBAS):
    n = 'yo_alto' if alto else who
    for exa in (0.5, 0.9):
        t = time.time()
        try: subir('prueba_cb_%02d_%s_%s_e%d.wav' % (k + 1, who, tag, int(exa * 10)), gen(txt, ancla(n), exa))
        except Exception as e: log('ERROR', who, tag, exa, repr(e)[:300]); continue
        log('cb %d/%d %s/%s exa=%.1f en %.0f s' % (k + 1, len(PRUEBAS), who, tag, exa, time.time() - t))
log('Terminado')
