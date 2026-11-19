# -*- coding: utf-8 -*-
# Prueba de acento: misma frase en las 6 voces de voz-ref/ con varios ajustes. ENGINE=cb o qwen. Sube prueba_a_* a Supabase.
import os, io, sys, time, urllib.request
import numpy as np, soundfile as sf
HERE = os.path.dirname(os.path.abspath(__file__)); ENGINE = sys.argv[1]
URL = os.environ['SUPABASE_URL'].rstrip('/'); KEY = os.environ['SUPABASE_KEY']
def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)
def subir(nombre, wav, sr):
    buf = io.BytesIO(); sf.write(buf, wav, sr, format='WAV', subtype='PCM_16')
    req = urllib.request.Request(URL + '/storage/v1/object/voz/' + nombre, data=buf.getvalue(), method='POST', headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'audio/wav', 'x-upsert': 'true'})
    urllib.request.urlopen(req, timeout=120).read()
def norm(a): a = np.asarray(a, dtype=np.float32); return a / (float(np.max(np.abs(a))) or 1) * 0.89
FRASE = 'Vale, gracias. Hazme un favor: coge la cerveza de la nevera y cierra la puerta, que hace mucho frío.'
VOCES = [('yo', 'narrador'), ('amigo', 'dani'), ('amiga', 'marta'), ('jefe', 'casero'), ('abuela', 'vecina'), ('madre', 'madre')]
SOLO = [x for x in os.environ.get('SOLO', '').split(',') if x]
if SOLO: VOCES = [v for v in VOCES if v[1] in SOLO]
REF = lambda n: os.path.join(HERE, '..', 'voz-ref', n + '.wav')
if ENGINE == 'cb':
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    m = ChatterboxMultilingualTTS.from_pretrained(device='cpu')
    for w, nombre in VOCES:
        for cfg in (0.4, 0.7, 1.0):
            t0 = time.time(); a = m.generate(FRASE, language_id='es', audio_prompt_path=REF(w), exaggeration=0.5, cfg_weight=cfg).squeeze().cpu().numpy()
            subir('prueba_a_%s_cb%d.wav' % (nombre, int(cfg * 10)), norm(a), m.sr); log('cb', nombre, cfg, 'en %.0f s' % (time.time() - t0))
elif ENGINE == 'qwen2':
    from faster_whisper import WhisperModel
    asr = WhisperModel('small', device='cpu', compute_type='int8'); TXT = {}
    for w, nombre in VOCES:
        seg, _ = asr.transcribe(REF(w), language='es', beam_size=5); TXT[w] = ' '.join(x.text.strip() for x in seg).strip(); log('TRANSCRIPCION', nombre, '=>', TXT[w])
    del asr
    import torch
    from qwen_tts import Qwen3TTSModel
    m = Qwen3TTSModel.from_pretrained('Qwen/Qwen3-TTS-12Hz-1.7B-Base', device_map='cpu', dtype=torch.float32)
    for w, nombre in VOCES:
        try:
            a, sr = sf.read(REF(w), dtype='float32')
            if a.ndim > 1: a = a.mean(axis=1)
            p = m.create_voice_clone_prompt(ref_audio=(a, sr), ref_text=TXT[w])
            t0 = time.time(); wv, s = m.generate_voice_clone(text=FRASE, language='Spanish', voice_clone_prompt=p)
            subir('prueba_a_%s_qwenicl.wav' % nombre, norm(wv[0]), s); log('qwenicl', nombre, 'en %.0f s' % (time.time() - t0))
        except Exception as e: log('ERROR qwenicl', nombre, repr(e)[:300])
else:
    import torch
    from qwen_tts import Qwen3TTSModel
    m = Qwen3TTSModel.from_pretrained('Qwen/Qwen3-TTS-12Hz-1.7B-Base', device_map='cpu', dtype=torch.float32)
    for w, nombre in VOCES:
        try:
            a, sr = sf.read(REF(w), dtype='float32')
            if a.ndim > 1: a = a.mean(axis=1)
            p = m.create_voice_clone_prompt(ref_audio=(a, sr), ref_text=None, x_vector_only_mode=True)
            t0 = time.time(); wv, s = m.generate_voice_clone(text=FRASE, language='Spanish', voice_clone_prompt=p)
            subir('prueba_a_%s_qwen.wav' % nombre, norm(wv[0]), s); log('qwen', nombre, 'en %.0f s' % (time.time() - t0))
        except Exception as e: log('ERROR qwen', nombre, repr(e)[:300])
log('Terminado')
