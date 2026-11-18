import subprocess
r = subprocess.run(["nvidia-smi","-L"], capture_output=True, text=True)
if r.returncode != 0 or "GPU" not in r.stdout:
    raise SystemExit("⛔ NO HAY GPU. En el panel derecho (Settings → Session options) → Accelerator → «GPU T4 x2». Y activa «Internet» en ON.")
print("✅ GPU detectada:", r.stdout.strip())
if "P100" in r.stdout:
    print("⚠️ Es una P100: puede fallar con las librerías nuevas. Mejor elige «GPU T4 x2».")
import urllib.request
try:
    urllib.request.urlopen("https://huggingface.co", timeout=10); print("✅ Internet activado")
except Exception as e:
    raise SystemExit("⛔ SIN INTERNET. Settings → Internet → ON (necesita el teléfono verificado en tu cuenta de Kaggle).")


# 1) Librerías de Chatterbox (sin reiniciar: aún no se ha cargado nada de torch en esta sesión)
import subprocess
r = subprocess.run("pip install -q resampy librosa s3tokenizer omegaconf resemble-perth silero-vad conformer safetensors diffusers==0.29.0 transformers==4.46.3", shell=True)
print("Librerías listas." if r.returncode == 0 else "⚠️ pip devolvió %s (mira los mensajes de arriba)" % r.returncode)


# 2) Qwen en un entorno aparte (para que no choque con Chatterbox): crea las grabaciones de cada personaje y emoción
import os, json, subprocess
os.makedirs('/kaggle/working/refs', exist_ok=True)
ESP = ("Español de España, acento castellano de Madrid: distinción de 'z' y 'c' (como 'th'), 's' fuerte, jota fuerte, ritmo peninsular. "
       "Nada de acento latinoamericano ni neutro. ")
VOCES = {
 "yo":     ESP + "Hombre de unos 22 años, narrador cercano, irónico y cansado, tono medio.",
 "amigo":  ESP + "Hombre joven de unos 22 años, voz relajada y bromista, algo grave, muy coloquial.",
 "amiga":  ESP + "Mujer joven de unos 22 años, voz clara y enérgica, lista y sarcástica.",
 "jefe":   ESP + "Hombre de unos 55 años, voz ronca y autoritaria, casero gruñón.",
 "abuela": ESP + "Mujer de unos 75 años, voz temblorosa y cascada, vecina cotilla pero cariñosa.",
 "madre":  ESP + "Mujer de unos 50 años, voz claramente femenina, cálida y algo agobiada, madre española que se preocupa por todo.",
}
EMO = {
 "neutro":   "Habla con naturalidad.",
 "cansado":  "Habla muy cansado, con voz lenta y apagada, suspirando.",
 "enfadado": "Habla enfadado, con voz fuerte, tensa y rápida.",
 "alegre":   "Habla alegre y emocionado, con energía y sonriendo.",
 "panico":   "Habla en pánico, muy rápido y agudo, casi gritando.",
}
SEM = {"yo": 11, "amigo": 21, "amiga": 31, "jefe": 41, "abuela": 51, "madre": 61}
REFTXT = "Pues mira, yo creo que esto es lo que hay, y no hay mucho más que hablar, la verdad."
trabajo = [{"k": k, "e": e, "seed": SEM[k], "instruct": VOCES[k] + " " + EMO[e], "text": REFTXT, "out": f"/kaggle/working/refs/{k}__{e}.wav"} for k in VOCES for e in EMO]
json.dump(trabajo, open('/kaggle/working/trabajo.json', 'w'))
open('/kaggle/working/gen_refs.py', 'w').write('''
import json, random, numpy as np, torch, soundfile as sf
from qwen_tts import Qwen3TTSModel
m = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", device_map="cuda:0", dtype=torch.float16, attn_implementation="sdpa")
for i, t in enumerate(json.load(open("/kaggle/working/trabajo.json"))):
    random.seed(t["seed"]); np.random.seed(t["seed"]); torch.manual_seed(t["seed"]); torch.cuda.manual_seed_all(t["seed"])
    w, sr = m.generate_voice_design(text=t["text"], language="Spanish", instruct=t["instruct"])
    sf.write(t["out"], w[0], sr); print(i + 1, "/", 30, t["k"], t["e"], flush=True)
''')
if not os.path.exists('/kaggle/working/qv/bin/python'):
    # uv crea un entorno aparte con Python 3.12 (el Colab actual trae 3.13, donde Qwen puede fallar)
    r0 = subprocess.run("pip install -q uv && uv venv --python 3.12 /kaggle/working/qv && uv pip install -q --python /kaggle/working/qv/bin/python qwen-tts soundfile", shell=True)
    if r0.returncode != 0 or not os.path.exists('/kaggle/working/qv/bin/python'):
        raise SystemExit("ERROR instalando Qwen en el entorno aparte (código %s). Copia el mensaje de arriba." % r0.returncode)
# ejecutar el script de Qwen y MOSTRAR todo lo que escribe (progreso y errores)
p = subprocess.Popen(["/kaggle/working/qv/bin/python", "-u", "/kaggle/working/gen_refs.py"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
cola = []
for linea in p.stdout:
    cola.append(linea)
    if len(cola) < 400 or "/ 30" in linea or "Error" in linea or "error" in linea: print(linea, end="")
p.wait()
if p.returncode != 0:
    print("\n===== ERROR EN QWEN (código %s). ÚLTIMAS LÍNEAS: =====" % p.returncode); print("".join(cola[-40:]))
else:
    print("Grabaciones de Qwen listas.")


# 3) Cargar Chatterbox España en la GPU
import sys, os, random, numpy as np, torch, re, subprocess
if not os.path.exists('/kaggle/working/sp'):
    subprocess.run("git clone -q https://huggingface.co/spaces/ResembleAI/Chatterbox-Multilingual-TTS-es-es /kaggle/working/sp", shell=True, check=True)
sys.path.insert(0, '/kaggle/working/sp'); os.chdir('/kaggle/working/sp')
from chatterbox.src.chatterbox.tts import ChatterboxTTS
model = ChatterboxTTS.from_pretrained("cuda"); SR = model.sr; print("Chatterbox cargado.", SR)
def seed(n):
    random.seed(n); np.random.seed(n); torch.manual_seed(n); torch.cuda.manual_seed_all(n)

# 4) Chatterbox lee cada frase con acento de España, copiando la voz y la emoción de la grabación de Qwen
import soundfile as sf, shutil
os.makedirs('/kaggle/working/salida', exist_ok=True)
EXAG = {"neutro": .6, "cansado": .5, "enfadado": 1.0, "alegre": .9, "panico": 1.2}
CFG  = {"neutro": .5, "cansado": .3, "enfadado": .5, "alegre": .5, "panico": .6}
FRASE = {
 "yo":     "Son las ocho y ocho, y ya llego tarde otra vez.",
 "amigo":  "Tranquilo, tío, que sobra tiempo. ¿Quién ha dejado la sartén en el suelo?",
 "amiga":  "No pasa nada, es puntualidad. Pero la nevera ha hecho un ruido muy raro.",
 "jefe":   "Esto es un piso, no un hotel. Quiero el alquiler antes del lunes, ¿vale?",
 "abuela": "Ay, hijo, qué ruido hacéis. En mis tiempos esto no pasaba.",
 "madre":  "Cariño, ¿has comido algo? Que te veo muy delgado, de verdad.",
}
n = 0
for k in VOCES:
    for e in EMO:
        n += 1; seed(SEM[k])
        w = model.generate(FRASE[k], exaggeration=EXAG[e], temperature=0.8, cfg_weight=CFG[e], language_id="es", audio_prompt_path=f"/kaggle/working/refs/{k}__{e}.wav")
        f = f"/kaggle/working/salida/{n:02d}_{k}_{e}.wav"; sf.write(f, w.squeeze(0).cpu().numpy(), SR)
        print(f"Nº {n:02d} · {k} · {e}", flush=True)

# 5) Empaquetar todo: aparecerá en la pestaña Output como hibrido.zip
import subprocess
subprocess.run("cd /kaggle/working && zip -qr hibrido.zip salida refs", shell=True)
print("Listo: /kaggle/working/hibrido.zip")
