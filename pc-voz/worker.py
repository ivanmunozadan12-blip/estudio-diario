# -*- coding: utf-8 -*-
# Piso 3ºB · trabajador de voces. Se queda abierto en el PC: coge frases de la cola de Supabase,
# las convierte en voz con Qwen3-TTS (VoiceDesign 1.7B, CPU) y sube el audio. Solo usa la libreria estandar + torch/qwen-tts.
import os, sys, time, json, io, socket, traceback, datetime, urllib.request, urllib.error, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__))
LOGF = os.path.join(HERE, 'worker_log.txt')
try:
    if os.path.exists(LOGF) and os.path.getsize(LOGF) > 1000000: os.remove(LOGF)
except Exception: pass
def log(*a):
    l = ' '.join(str(x) for x in (time.strftime('%H:%M:%S'),) + a); print(l, flush=True)
    try:
        with open(LOGF, 'a', encoding='utf-8') as f: f.write(l + '\n')
    except Exception: pass

# ---------- configuracion ----------
cfg = {}
try:
    for l in open(os.path.join(HERE, 'config.txt'), encoding='utf-8'):
        if '=' in l: k, v = l.split('=', 1); cfg[k.strip().upper()] = v.strip()
except Exception: pass
URL = (cfg.get('URL') or os.environ.get('SUPABASE_URL') or '').rstrip('/'); KEY = cfg.get('KEY') or os.environ.get('SUPABASE_KEY') or ''
NTFY = (cfg.get('NTFY') or os.environ.get('NTFY_TOPIC') or '').strip()
ONCE = os.environ.get('ONCE') == '1'   # modo GitHub: trabaja hasta vaciar la cola y termina
T_INI = time.time()
if not URL or not KEY: log('Falta config.txt con URL= y KEY='); sys.exit(2)
HOST = os.environ.get('WORKER_NAME') or socket.gethostname()

def api(method, path, body=None, headers=None, raw=False, retries=3):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY}
    if headers: h.update(headers)
    data = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)): data = bytes(body)
        else: data = json.dumps(body).encode('utf-8'); h.setdefault('Content-Type', 'application/json')
    for k in range(retries):
        try:
            req = urllib.request.Request(URL + path, data=data, method=method, headers=h)
            with urllib.request.urlopen(req, timeout=60) as r:
                b = r.read()
                if raw: return b
                return json.loads(b) if b else None
        except urllib.error.HTTPError as e:
            msg = e.read().decode('utf-8', 'replace')[:300]
            if e.code >= 500 and k < retries - 1: time.sleep(2 + k * 3); continue
            raise RuntimeError('HTTP %s %s %s' % (e.code, path[:60], msg))
        except (urllib.error.URLError, socket.timeout, ConnectionError) as e:
            if k < retries - 1: time.sleep(2 + k * 3); continue
            raise RuntimeError('red: %s' % e)

def avisar(texto):
    # Aviso al movil con ntfy.sh (gratis, sin cuenta): hay que tener la app ntfy suscrita al mismo tema.
    if not NTFY: return
    try:
        req = urllib.request.Request('https://ntfy.sh/' + urllib.parse.quote(NTFY), data=texto.encode('utf-8'), method='POST',
                                     headers={'Title': 'Piso 3B - voces listas', 'Tags': 'microphone', 'Priority': 'high'})
        urllib.request.urlopen(req, timeout=20).read(); log('Aviso enviado al movil')
    except Exception as e: log('No pude enviar el aviso:', e)

def now_iso(): return datetime.datetime.now(datetime.timezone.utc).isoformat()

# ---------- voces: ficha fija por personaje + emocion por escena (en ingles, es lo que mejor entiende el modelo) ----------
ESP = 'Native Castilian Spanish accent from Madrid, Spain (not Latin American, not Mexican, not Portuguese, not English-accented). '
PERSONAJES = {
  'yo':     'Young man about 22, lazy dry low-to-mid voice, slightly hoarse, speaks slowly with very little pitch variation, always tired and fed up with everything, sarcastic but never shouting.',
  'amigo':  'Young man about 23 (Dani), relaxed friendly mid-pitch voice, casual and a bit goofy, quick and easygoing, speaks like a flatmate and best friend.',
  'amiga':  'Young woman about 22 (Marta), clear mid-high voice, fast and precise, sharp and sarcastic, confident, falsely sweet when she is bossy.',
  'jefe':   'Spanish man about 55, the grumpy landlord: gruff gravelly low voice with a smoker rasp, impatient, stubborn, speaks in a short blunt way.',
  'madre':  'Spanish woman about 52, a worried and nagging mother: warm mid voice, talks fast, slightly dramatic and reproachful, loving but overbearing.',
  'abuela': 'Elderly Spanish woman about 78, the nosy neighbour: thin cracked slightly trembling high voice, slow and grumpy, mutters and complains.',
}
EMO = {
  'harto': 'exhausted and fed up, flat deadpan monotone, resigned, a small sigh before the line',
  'cansado': 'very tired, low energy, drained, slow',
  'resignado': 'resigned and defeated, flat, giving up',
  'triste': 'sad and subdued, quiet, a little broken',
  'dormido': 'half asleep, mumbling, extremely low energy',
  'enfado': 'angry and irritated, sharp, raised voice, clipped words',
  'panico': 'panicked and frantic, fast, breathless, voice rising',
  'asombro': 'astonished and incredulous, rising intonation, eyes wide',
  'sonrisa': 'amused, light, smiling while speaking',
  'risa': 'laughing while speaking, amused, breaking into giggles',
  'asco': 'disgusted, grimacing, drawn-out words',
  'serio': 'serious, firm and controlled',
  'educado': 'polite and calm on the surface but with zero enthusiasm, flat and indifferent, like he does not care about anything at all',
  'seco': 'dry, blunt, deadpan, matter-of-fact, no emotion at all',
  'sarcastico': 'sarcastic, dripping with irony, exaggerated sweetness with a bite, slow on the key word',
  'falso_dulce': 'falsely sweet and polite, a smile in the voice, passive-aggressive, calm but cutting',
  'tranquilo': 'completely relaxed and unbothered, slow and confident, calm low energy, in no hurry',
  'burlon': 'teasing and mocking, playful smirk in the voice, casual',
  'nervioso': 'nervous and fussing, a bit fast and high, over-explaining, anxious',
}
# emocion por defecto de cada personaje cuando la escena no indica "voz" (el mood de animacion como 'hablar' no es una emocion)
DEFECTO = {
  'amiga': 'sarcastic and falsely sweet, quick and precise, passive-aggressive',
  'amigo': 'relaxed and unbothered, calm and confident, slow and low',
  'jefe': 'falsely friendly like a salesman in a hurry, smooth and evasive',
  'madre': 'warm and worried, nagging with love, a bit dramatic',
  'abuela': 'grumpy and complaining, reproachful, slow and cracked',
}
def instruct_para(who, mood, alto):
    base = PERSONAJES.get(who) or PERSONAJES['yo']
    if who == 'yo':
        if alto: emo = EMO['educado']
        elif mood and mood != 'harto' and mood in EMO: emo = 'mostly tired and fed up, but with a touch of this: ' + EMO[mood]
        else: emo = EMO['harto']
    else:
        emo = EMO.get(mood or '') or DEFECTO.get(who) or 'natural and expressive, matching the personality'
    return ESP + base + ' Emotion and delivery: ' + emo + '. Natural pace, realistic human speech.'

# ---------- modelo ----------
import numpy as np, soundfile as sf, torch
from qwen_tts import Qwen3TTSModel
torch.set_num_threads(os.cpu_count() or 4)
log('Cargando modelo Qwen3-TTS (1-2 min)...'); t0 = time.time()
model = Qwen3TTSModel.from_pretrained('Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', device_map='cpu', dtype=torch.float32)
log('Modelo listo en', round(time.time() - t0), 's. Esperando frases de la cola. NO CIERRES ESTA VENTANA.')

def sembrar(who):
    s = sum((i + 1) * ord(c) for i, c in enumerate(who or 'yo')) % 100000
    torch.manual_seed(s); np.random.seed(s % (2**32 - 1))

def generar(j):
    sembrar(j.get('who'))
    ins = instruct_para(j.get('who'), j.get('mood'), bool(j.get('alto')))
    txt = ' '.join(str(j.get('text') or '').split())
    wavs, sr = model.generate_voice_design(text=txt, language='Spanish', instruct=ins)
    a = np.asarray(wavs[0], dtype=np.float32)
    pk = float(np.max(np.abs(a))) if a.size else 0
    if pk > 0: a = a * (0.89 / pk)
    buf = io.BytesIO(); sf.write(buf, a, sr, format='WAV', subtype='PCM_16')
    return buf.getvalue(), len(a) / sr

def latido():
    api('POST', '/rest/v1/voz_jobs?on_conflict=key', {'key': '__latido__', 'status': 'hb', 'worker': HOST, 'updated_at': now_iso()},
        {'Prefer': 'resolution=merge-duplicates,return=minimal'})

def limpiar():
    lim = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=3)).isoformat()
    q = '/rest/v1/voz_jobs?select=key&key=neq.__latido__&created_at=lt.' + urllib.parse.quote(lim)
    viejos = [r['key'] for r in (api('GET', q) or [])]
    if viejos:
        try: api('DELETE', '/storage/v1/object/voz', {'prefixes': [k + '.wav' for k in viejos]})
        except Exception as e: log('limpieza audio:', e)
        api('DELETE', '/rest/v1/voz_jobs?key=in.(' + ','.join(urllib.parse.quote(k) for k in viejos) + ')')
        log('Limpiadas', len(viejos), 'frases de hace mas de 3 dias')

# frases que se quedaron a medias si el trabajador se cerro
try: api('PATCH', '/rest/v1/voz_jobs?status=eq.working&worker=eq.' + urllib.parse.quote(HOST), {'status': 'pending'}, {'Prefer': 'return=minimal'})
except Exception as e: log('aviso:', e)

nuevas = 0; ult_latido = 0; ult_limp = 0; ult_atasco = 0; ult_trabajo = time.time(); hechas = 0; seg_audio = 0.0; seg_cpu = 0.0
while True:
    try:
        if time.time() - ult_latido > 10: latido(); ult_latido = time.time()
        if time.time() - ult_limp > 1800: limpiar(); ult_limp = time.time()
        if time.time() - ult_atasco > 120:
            ult_atasco = time.time()
            lim = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=25)).isoformat()
            api('PATCH', '/rest/v1/voz_jobs?status=eq.working&updated_at=lt.' + urllib.parse.quote(lim), {'status': 'pending'}, {'Prefer': 'return=minimal'})
        if ONCE and (time.time() - T_INI > 5.4 * 3600): log('Tiempo maximo del turno alcanzado; sigo en el proximo.'); break
        r = api('GET', '/rest/v1/voz_jobs?select=*&status=eq.pending&key=neq.__latido__&order=created_at.asc&limit=1')
        if not r:
            if nuevas and time.time() - ult_trabajo > 15:
                avisar('Las voces estan listas (%d frases). Abre la web y pulsa Crear video.' % nuevas); nuevas = 0
            if ONCE and time.time() - ult_trabajo > 90: log('Cola vacia. Termino.'); break
            time.sleep(3); continue
        ult_trabajo = time.time()
        j = r[0]
        c = api('PATCH', '/rest/v1/voz_jobs?key=eq.%s&status=eq.pending' % urllib.parse.quote(j['key']),
                {'status': 'working', 'worker': HOST, 'updated_at': now_iso()}, {'Prefer': 'return=representation'})
        if not c: continue   # otro trabajador la cogio
        log('[%s%s] %s' % (j.get('who'), '/alto' if j.get('alto') else '', (j.get('text') or '')[:60]))
        t = time.time()
        try:
            wav, dur = generar(j)
            api('POST', '/storage/v1/object/voz/%s.wav' % urllib.parse.quote(j['key']), wav, {'Content-Type': 'audio/wav', 'x-upsert': 'true'})
            api('PATCH', '/rest/v1/voz_jobs?key=eq.' + urllib.parse.quote(j['key']),
                {'status': 'done', 'audio_path': j['key'] + '.wav', 'dur': dur, 'updated_at': now_iso()}, {'Prefer': 'return=minimal'})
            ult_trabajo = time.time(); dt = time.time() - t; hechas += 1; nuevas += 1; seg_audio += dur; seg_cpu += dt
            log('   listo: %.1f s de audio en %.0f s (media x%.1f) · frases hechas: %d' % (dur, dt, seg_cpu / max(seg_audio, .1), hechas))
        except Exception as e:
            traceback.print_exc(); log('   ERROR en la frase:', e)
            try: api('PATCH', '/rest/v1/voz_jobs?key=eq.' + urllib.parse.quote(j['key']), {'status': 'error', 'error': str(e)[:300], 'updated_at': now_iso()}, {'Prefer': 'return=minimal'})
            except Exception as e2: log('   no pude anotar el error:', e2)
    except KeyboardInterrupt: log('Parado.'); break
    except Exception as e:
        log('Aviso (reintento en 10 s):', e); time.sleep(10)
