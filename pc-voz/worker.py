# -*- coding: utf-8 -*-
# Piso 3ºB · trabajador de voces. Se queda abierto en el PC: coge frases de la cola de Supabase,
# las convierte en voz con Qwen3-TTS (1.7B, CPU; voz fija por personaje clonada desde un ancla) y sube el audio. Solo usa la libreria estandar + torch/qwen-tts.
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
  'abuela': 'Spanish woman about 70, the nosy grumpy neighbour: harsh raspy shrill voice, fast and bossy, shouts complaints and insults everyone.',
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
# MODO 'clon' (por defecto): cada personaje tiene UNA voz fija (un "ancla" creada una vez con VoiceDesign y guardada en Supabase);
# todas sus frases se generan clonando esa ancla con el modelo Base, asi suena igual en todas las frases, capitulos y trabajadores.
# MODO 'diseno': el sistema antiguo (voz nueva en cada frase).
import gc, threading
import numpy as np, soundfile as sf, torch
try: from qwen_tts import Qwen3TTSModel
except Exception: Qwen3TTSModel = None   # en modo 'cb' (Chatterbox) solo hace falta para crear anclas que falten
torch.set_num_threads(os.cpu_count() or 4)
MODO = (os.environ.get('VOZ_MODO') or cfg.get('MODO') or 'cb').lower()
PRUEBA = os.environ.get('PRUEBA') == '1'
REF_V = 'r1'                                   # cambia esto para crear voces nuevas (se vuelven a crear las anclas)
ALTO_ANCLA = (os.environ.get('ALTO_ANCLA') or cfg.get('ALTO_ANCLA') or '0') == '1'   # 1 = el narrador en voz alta usa un ancla propia
M_DISENO = 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign'; M_CLON = 'Qwen/Qwen3-TTS-12Hz-1.7B-Base'
REF_TEXT = {   # texto de cada ancla (unos 8-10 s de habla natural en el tono del personaje)
  'yo':     'Vale, Dani. Otra vez lo mismo. No pasa nada, de verdad, ya me acostumbraré a todo esto, como siempre.',
  'yo_alto':'Claro, por supuesto, no hay ningún problema. Me parece una idea estupenda, de verdad, muchas gracias por avisar.',
  'amigo':  'Tranquilo, tío, es lo que hay. Yo solo estoy entrenando un poquito, no te rayes, que luego te invito a algo.',
  'amiga':  'Os lo dije en el grupo, literal. Hay normas y se cumplen, así que a partir de hoy todo funciona por turnos.',
  'jefe':   'Buenas, voy a echar un vistazo. Esto lo arreglo yo en dos minutos, que lo he hecho mil veces, no se preocupe.',
  'madre':  'Pero hijo, tú comes bien, ¿verdad? Te noto muy delgado, y esa casa tiene que estar hecha un desastre.',
  'abuela': 'En mis tiempos esto no pasaba, hijo. Vengo a quejarme, que hay un ruido terrible y yo no puedo dormir.',
}
_modelos = {}; PROMPTS = {}; ANCLAS = {}
def hilo_latido():
    while True:
        try: latido()
        except Exception: pass
        time.sleep(10)
def cargar(nombre):
    if Qwen3TTSModel is None: raise RuntimeError('qwen-tts no esta instalado (hace falta para crear voces ancla nuevas)')
    if nombre not in _modelos:
        log('Cargando modelo', nombre, '(1-2 min)...'); t0 = time.time()
        _modelos[nombre] = Qwen3TTSModel.from_pretrained(nombre, device_map='cpu', dtype=torch.float32)
        log('Modelo listo en', round(time.time() - t0), 's')
    return _modelos[nombre]
def descargar(nombre):
    _modelos.pop(nombre, None); gc.collect()

def sembrar(who):
    s = sum((i + 1) * ord(c) for i, c in enumerate(who or 'yo')) % 100000
    torch.manual_seed(s); np.random.seed(s % (2**32 - 1))

def limpiar_audio(a, sr):
    # quita respiros/silencios del principio y del final y acorta las pausas largas del medio; deja el audio listo para pegarse a lo siguiente
    a = np.asarray(a, dtype=np.float32)
    if a.size < sr // 5: return a
    fr = max(1, int(sr * 0.01)); n = len(a) // fr
    e = np.sqrt((a[:n * fr].reshape(n, fr) ** 2).mean(axis=1) + 1e-12)
    act = e > e.max() * 0.05
    idx = [i for i in range(n - 2) if act[i] and act[i + 1] and act[i + 2]]
    if not idx: return a
    i0 = max(0, idx[0] - 6); i1 = min(n, idx[-1] + 9)
    keep = np.zeros(n, dtype=bool); keep[i0:i1] = True; i = i0
    while i < i1:
        if act[i]: i += 1; continue
        j = i
        while j < i1 and not act[j]: j += 1
        if j - i > 45: keep[i + 15:j - 15] = False     # pausa de mas de 0,45 s dentro de la frase -> 0,30 s
        i = j
    out = a[:n * fr].reshape(n, fr)[keep].reshape(-1).copy()
    f = min(len(out) // 4, int(sr * 0.012))
    if f > 1: out[:f] *= np.linspace(0, 1, f); out[-f:] *= np.linspace(1, 0, f)
    return out

def a_wav(a, sr):
    a = np.asarray(a, dtype=np.float32); pk = float(np.max(np.abs(a))) if a.size else 0
    if pk > 0: a = a * (0.89 / pk)
    buf = io.BytesIO(); sf.write(buf, a, sr, format='WAV', subtype='PCM_16'); return buf.getvalue(), len(a) / sr

def ancla_wav(nombre):
    """devuelve (audio, sr) del ancla; si no existe la crea con VoiceDesign y la sube a Supabase (la primera que llega gana)"""
    if nombre in ANCLAS: return ANCLAS[nombre]
    fich = 'ref_%s_%s.wav' % (REF_V, nombre); b = None
    try: b = api('GET', '/storage/v1/object/voz/' + fich, raw=True)
    except Exception as e: b = None
    if not b:
        base = 'yo' if nombre == 'yo_alto' else nombre
        ins = instruct_para(base, '', nombre == 'yo_alto')
        log('Creando la voz fija de', nombre, '...')
        sembrar(base); wavs, sr = cargar(M_DISENO).generate_voice_design(text=REF_TEXT[nombre], language='Spanish', instruct=ins)
        a = limpiar_audio(wavs[0], sr); b, _ = a_wav(a, sr)
        try: api('POST', '/storage/v1/object/voz/' + fich, b, {'Content-Type': 'audio/wav', 'x-upsert': 'false'}); log('   ancla subida:', fich)
        except Exception as e:
            log('   otra ejecucion creo antes el ancla, uso esa:', str(e)[:80])
            b = api('GET', '/storage/v1/object/voz/' + fich, raw=True)
    a, sr = sf.read(io.BytesIO(b), dtype='float32')
    if a.ndim > 1: a = a.mean(axis=1)
    ANCLAS[nombre] = (a, sr); return ANCLAS[nombre]

# ---------- motor Chatterbox multilingue (MODO 'cb'): clona la voz de referencia de cada personaje ----------
EXA = {'enfado': .8, 'panico': .85, 'asombro': .7, 'risa': .7, 'sonrisa': .55, 'nervioso': .65, 'sarcastico': .6, 'burlon': .6}   # 0.5 = normal
REFS_CB = {}
def cb_modelo():
    if 'cb' not in _modelos:
        log('Cargando Chatterbox multilingue (1-2 min)...'); t0 = time.time()
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        _modelos['cb'] = ChatterboxMultilingualTTS.from_pretrained(device='cpu'); log('Modelo listo en', round(time.time() - t0), 's')
    return _modelos['cb']
def ref_cb(nombre):
    """ruta del wav de referencia: la que subiste tu (ref_u_<nombre>.wav) o, si no hay, el ancla de Qwen"""
    if nombre in REFS_CB: return REFS_CB[nombre]
    os.makedirs('/tmp/refs_cb' if os.name != 'nt' else os.path.join(HERE, 'refs_cb'), exist_ok=True)
    ruta = os.path.join('/tmp/refs_cb' if os.name != 'nt' else os.path.join(HERE, 'refs_cb'), nombre + '.wav'); b = None
    try: b = api('GET', '/storage/v1/object/voz/ref_u_%s.wav' % nombre, raw=True)
    except Exception: b = None
    if b: log('   referencia propia para', nombre)
    else:
        a, sr = ancla_wav(nombre); b, _ = a_wav(a, sr); log('   referencia automatica (ancla) para', nombre)
    open(ruta, 'wb').write(b); REFS_CB[nombre] = ruta; return ruta

def nombre_ancla(who, alto):
    if who == 'yo': return 'yo_alto' if (alto and ALTO_ANCLA) else 'yo'
    return who if who in REF_TEXT else 'yo'

def prompt_de(nombre):
    if nombre not in PROMPTS:
        a, sr = ancla_wav(nombre)
        PROMPTS[nombre] = cargar(M_CLON).create_voice_clone_prompt(ref_audio=(a, sr), ref_text=REF_TEXT[nombre])
    return PROMPTS[nombre]

def preparar():
    if MODO == 'cb':
        for n in ['yo', 'amigo', 'amiga', 'jefe', 'madre', 'abuela']: ref_cb(n)
        cb_modelo(); return
    """crea/descarga las anclas que falten y deja cargado solo el modelo que hace falta (asi no se llena la memoria)"""
    if MODO != 'clon': cargar(M_DISENO); return
    nombres = ['yo', 'amigo', 'amiga', 'jefe', 'madre', 'abuela'] + (['yo_alto'] if (ALTO_ANCLA or PRUEBA) else [])
    for n in nombres: ancla_wav(n)
    descargar(M_DISENO)
    cargar(M_CLON)
    for n in nombres: prompt_de(n)

def generar(j, modo=None):
    who = j.get('who') or 'yo'; alto = bool(j.get('alto')); modo = modo or MODO
    txt = ' '.join(str(j.get('text') or '').split()); sembrar(who)
    if modo == 'cb':
        m = cb_modelo(); exa = 0.5 if who == 'yo' else EXA.get(j.get('mood') or '', 0.5)
        w = m.generate(txt, language_id='es', audio_prompt_path=ref_cb(nombre_ancla(who, alto)), exaggeration=exa, cfg_weight=0.4)
        return a_wav(limpiar_audio(w.squeeze().cpu().numpy(), m.sr), m.sr)
    if modo == 'clon':
        wavs, sr = cargar(M_CLON).generate_voice_clone(text=txt, language='Spanish', voice_clone_prompt=prompt_de(nombre_ancla(who, alto)))
    else:
        wavs, sr = cargar(M_DISENO).generate_voice_design(text=txt, language='Spanish', instruct=instruct_para(who, j.get('mood'), alto))
    return a_wav(limpiar_audio(wavs[0], sr), sr)

# frases de prueba para comparar voces a oido (solo con PRUEBA=1)
PRUEBAS = [
  ('yo', 'mente', 'Me ha cerrado hasta la compra. Qué ilusión.', False), ('yo', 'mente2', 'Ahora el edificio entero conoce mi puerta.', False),
  ('yo', 'alto', 'Por supuesto, pase. La puerta está encantada con las visitas.', True), ('yo', 'asombro', '¿Otra vez? Esto tiene que ser una broma.', False),
  ('amiga', 'a', 'No pasa nada. Norma once: entrada silenciosa.', False), ('amiga', 'b', 'Literal, ya lo dije en el grupo.', False),
  ('amigo', 'a', 'Tranquilo, tío, es lo que hay. Cierra sola.', False), ('amigo', 'b', 'Eso es de niños. Yo entreno con puertas más pesadas.', False),
  ('jefe', 'a', 'Voy a echar un vistazo.', False), ('jefe', 'b', 'Ahora cierra mucho mejor. Eso es calidad.', False),
  ('abuela', 'a', 'Vengo a quejarme. Me ha temblado el techo.', False), ('abuela', 'b', 'En mis tiempos esto no pasaba.', False),
  ('madre', 'a', 'Pero tú comes, ¿verdad? Te noto muy delgado.', False), ('madre', 'b', 'Ay, hijo, no me cuentes más cosas.', False),
]
def hacer_pruebas():
    log('MODO PRUEBA: anclas + frases de ejemplo (no toca la cola)')
    for n in ['yo', 'yo_alto', 'amigo', 'amiga', 'jefe', 'madre', 'abuela']:
        a, sr = ancla_wav(n); wav, _ = a_wav(a, sr)
        api('POST', '/storage/v1/object/voz/prueba_00_ancla_%s.wav' % n, wav, {'Content-Type': 'audio/wav', 'x-upsert': 'true'})
    for i, (who, tag, txt, alto) in enumerate(PRUEBAS):
        t = time.time(); wav, dur = generar({'who': who, 'text': txt, 'alto': alto})
        api('POST', '/storage/v1/object/voz/prueba_%02d_%s_%s.wav' % (i + 1, who, tag), wav, {'Content-Type': 'audio/wav', 'x-upsert': 'true'})
        log('   prueba %d/%d %s/%s: %.1f s de audio en %.0f s' % (i + 1, len(PRUEBAS), who, tag, dur, time.time() - t))
    avisar_pruebas()

def avisar_pruebas():
    if not NTFY: return
    try:
        req = urllib.request.Request('https://ntfy.sh/' + urllib.parse.quote(NTFY), data='Pruebas de voz listas. Abre la web, Ajustes y pulsa Escuchar pruebas de voz.'.encode('utf-8'), method='POST',
                                     headers={'Title': 'Piso 3B - pruebas de voz', 'Tags': 'microphone', 'Priority': 'high'})
        urllib.request.urlopen(req, timeout=20).read()
    except Exception as e: log('No pude enviar el aviso:', e)

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

threading.Thread(target=hilo_latido, daemon=True).start()
log('Preparando voces (modo %s)...' % MODO)
preparar()
log('Listo. Esperando frases de la cola. NO CIERRES ESTA VENTANA.')
if PRUEBA:
    hacer_pruebas(); log('Pruebas terminadas.'); sys.exit(0)
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
