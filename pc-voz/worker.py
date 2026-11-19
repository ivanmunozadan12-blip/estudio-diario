# -*- coding: utf-8 -*-
# Piso 3ºB · trabajador de voces. Se queda abierto en el PC: coge frases de la cola de Supabase,
# las convierte en voz con Chatterbox multilingue (CPU; voz fija de cada personaje clonada desde voz-ref/) y sube el audio.
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


# ---------- motor de voz: Chatterbox multilingue (MIT, CPU). Clona la voz de referencia de cada personaje (carpeta voz-ref/) ----------
import gc, threading, numpy as np, soundfile as sf, torch
torch.set_num_threads(os.cpu_count() or 4)
PRUEBA = os.environ.get('PRUEBA') == '1'
RAW = 'https://raw.githubusercontent.com/ivanmunozadan12-blip/estudio-diario/main/voz-ref/'
EXA = {'enfado': .8, 'panico': .85, 'asombro': .75, 'risa': .7, 'sonrisa': .55, 'nervioso': .65, 'sarcastico': .6, 'burlon': .6, 'triste': .7, 'falso_dulce': .6}   # 0.5 = emocion normal (el narrador siempre 0.5)
_modelo = None; REFS = {}

def hilo_latido():
    while True:
        try: latido()
        except Exception: pass
        time.sleep(10)

def modelo():
    global _modelo
    if _modelo is None:
        log('Cargando Chatterbox multilingue (1-2 min)...'); t0 = time.time()
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        _modelo = ChatterboxMultilingualTTS.from_pretrained(device='cpu'); log('Modelo listo en', round(time.time() - t0), 's')
    return _modelo

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

def ref(nombre):
    """ruta de la voz de referencia del personaje: voz-ref/<nombre>.wav del repositorio (o descargada de GitHub si no esta)"""
    if nombre in REFS: return REFS[nombre]
    for d in (os.path.join(HERE, '..', 'voz-ref'), os.path.join(HERE, 'voz-ref')):
        p = os.path.join(d, nombre + '.wav')
        if os.path.exists(p): REFS[nombre] = p; return p
    d = os.path.join(HERE, 'voz-ref'); os.makedirs(d, exist_ok=True); p = os.path.join(d, nombre + '.wav')
    with urllib.request.urlopen(RAW + nombre + '.wav', timeout=60) as r: open(p, 'wb').write(r.read())
    REFS[nombre] = p; return p

def nombre_ref(who):
    return who if who in ('yo', 'amigo', 'amiga', 'jefe', 'madre', 'abuela') else 'yo'   # el narrador en voz alta usa la misma voz que su mente

def preparar():
    for n in ('yo', 'amigo', 'amiga', 'jefe', 'madre', 'abuela'): ref(n)
    modelo()

def generar(j):
    who = j.get('who') or 'yo'; txt = ' '.join(str(j.get('text') or '').split()); sembrar(who)
    m = modelo(); exa = 0.5 if who == 'yo' else EXA.get(j.get('mood') or '', 0.65 if who == 'amiga' else 0.5)   # Marta, la dramatica, nunca por debajo de 0.65 si no hay emocion indicada
    w = m.generate(txt, language_id='es', audio_prompt_path=ref(nombre_ref(who)), exaggeration=exa, cfg_weight=0.4)
    return a_wav(limpiar_audio(w.squeeze().cpu().numpy(), m.sr), m.sr)

# frases de prueba de la serie, con el nombre de cada personaje (solo con PRUEBA=1)
PRUEBAS = [
  ('yo', 'narrador', 'harto', 'Abres la nevera y tu yogur de fresa ya no está.', False),
  ('yo', 'narrador', 'seco', 'Llevas diez minutos esperando el baño. Y tú, claro, te rindes.', False),
  ('yo', 'narrador', '', 'Por supuesto, Marta. Ningún problema.', True),
  ('amigo', 'dani', 'tranquilo', 'Tranquilo, tío, es lo que hay. Yo solo como proteína.', False),
  ('amigo', 'dani', 'burlon', 'No te rayes, que luego te invito a algo.', False),
  ('amiga', 'marta', 'asombro', 'Estoy en shock. Literal, esto es una traición.', False),
  ('amiga', 'marta', 'falso_dulce', 'Chicos, esto va a mis stories. Con hashtag.', False),
  ('jefe', 'casero', 'falso_dulce', 'Eso es humedad. Voy a echar un vistazo, no se preocupe.', False),
  ('jefe', 'casero', 'nervioso', 'Esto lo arreglo yo en dos minutos, que lo he hecho mil veces.', False),
  ('abuela', 'vecina', 'enfado', '¡Sinvergüenzas! ¡Otra vez la música a estas horas, desgraciados!', False),
  ('abuela', 'vecina', 'enfado', 'Menuda gentuza, hijo, menuda gentuza. Voy a llamar a la comunidad.', False),
  ('madre', 'madre', 'nervioso', 'Pero hijo, ¿tú comes bien? Te noto muy delgado.', False),
  ('madre', 'madre', 'falso_dulce', 'Esa casa tiene que estar hecha un desastre, seguro.', False),
]
def hacer_pruebas():
    log('MODO PRUEBA: frases de la serie con la voz de cada personaje (no toca la cola)')
    for i, (who, nombre, mood, txt, alto) in enumerate(PRUEBAS):
        t = time.time(); wav, dur = generar({'who': who, 'mood': mood, 'text': txt, 'alto': alto})
        api('POST', '/storage/v1/object/voz/prueba_%02d_%s.wav' % (i + 1, nombre), wav, {'Content-Type': 'audio/wav', 'x-upsert': 'true'})
        log('   prueba %d/%d %s: %.1f s de audio en %.0f s' % (i + 1, len(PRUEBAS), nombre, dur, time.time() - t))
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
log('Preparando voces...')
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
