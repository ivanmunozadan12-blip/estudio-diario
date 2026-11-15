// Validación estática y pruebas de entradas. No consume APIs externas.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(label + ': ' + (result.stderr || result.stdout || 'fallo sin salida'));
}

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[0].slice(0, match[0].indexOf('>') + 1)));
if (!scripts.length) throw new Error('No se encontró JavaScript inline en index.html.');
scripts.forEach((match, i) => new vm.Script(match[1], { filename: 'index.html:inline-' + (i + 1) }));

const sourceFiles = ['ci', 'netlify/functions'].flatMap(walk).concat(['sw.js'])
  .filter(file => ['.js', '.mjs', '.cjs'].some(ext => file.endsWith(ext)));
for (const file of sourceFiles) run(process.execPath, ['--check', file], 'Sintaxis incorrecta en ' + file);

for (const file of ['config.json', 'history.json', 'package.json', 'manifest.webmanifest']) {
  JSON.parse(fs.readFileSync(file, 'utf8'));
}
run('bash', ['-n', 'ci/send.sh'], 'Sintaxis incorrecta en ci/send.sh');
for (const file of ['.github/workflows/videos.yml', '.github/workflows/validate.yml']) {
  const parsed = spawnSync('ruby', ['-e', 'require \'yaml\'; YAML.load_file(ARGV[0])', file], { encoding: 'utf8' });
  if (parsed.error && parsed.error.code !== 'ENOENT') throw parsed.error;
  if (!parsed.error && parsed.status !== 0) throw new Error('YAML inválido en ' + file + ': ' + (parsed.stderr || parsed.stdout));
}

for (const value of ['invalid', '3', '-1', '1.5']) {
  const result = spawnSync(process.execPath, ['ci/slot.js'], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_SLOT: value }
  });
  if (result.status !== 2) throw new Error('FORCE_SLOT=' + value + ' debería terminar con código 2; obtuvo ' + result.status);
}
for (const value of ['0', '1', '2']) {
  const result = spawnSync(process.execPath, ['ci/slot.js'], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_SLOT: value }
  });
  const output = result.stdout.trim();
  const date = output.slice(2);
  const validDate = date.length === 10 && date[4] === '-' && date[7] === '-' &&
    date.slice(0, 4).split('').every(c => c >= '0' && c <= '9') &&
    date.slice(5, 7).split('').every(c => c >= '0' && c <= '9') &&
    date.slice(8, 10).split('').every(c => c >= '0' && c <= '9');
  if (result.status !== 0 || !output.startsWith(value + ' ') || !validDate) {
    throw new Error('FORCE_SLOT=' + value + ' no ha producido un resultado válido: ' + result.stdout + result.stderr);
  }
}

const generate = fs.readFileSync('ci/generate.js', 'utf8');
const app = html;
if (!app.includes("'network'].includes(e.code)") || !app.includes("code: 'research_failed'") || !app.includes("code: 'verification_failed'") || !app.includes('return TTS.speak(text.replace')) {
  throw new Error('Falta una protección de respaldo Gemini, investigación, verificación o voz sintética.');
}
const mock = fs.readFileSync('ci/mock.js', 'utf8');
if (!mock.includes('api.genScript = async') || mock.includes('generativelanguage.googleapis.com') || mock.includes('Voice.speak')) {
  throw new Error('El mock de CI debe sustituir generación y voz sin llamar a Gemini ni Piper.');
}
const sender = fs.readFileSync('ci/send.sh', 'utf8');
if (!sender.includes('ffprobe') || !sender.includes('codec_type') || !sender.includes('9 / 16') || !sender.includes('sendVideo') || !sender.includes('sendMessage')) {
  throw new Error('Faltan las validaciones del MP4 o la confirmación de los envíos Telegram.');
}
const preflight = fs.readFileSync('ci/preflight.js', 'utf8');
if (!preflight.includes('/getMe') || !preflight.includes('/getChat') || !preflight.includes('oauth2.googleapis.com/token') || preflight.includes('sendVideo')) {
  throw new Error('El preflight debe validar Telegram y OAuth sin enviar contenido.');
}
if (generate.includes('2026-11-15') || generate.includes('forceTopics:')) {
  throw new Error('Queda una selección de temas de prueba fechada y forzada en producción.');
}
const sw = fs.readFileSync('sw.js', 'utf8');
if (!sw.includes("u.pathname.startsWith('/.netlify/functions/')") || !sw.includes('r.ok')) {
  throw new Error('El service worker debe excluir funciones Netlify y cachear solo respuestas correctas.');
}
for (const file of ['netlify/functions/youtube-auth.js', 'netlify/functions/youtube-callback.js']) {
  if (!fs.existsSync(file)) throw new Error('Falta el endpoint Netlify activo: ' + file);
}
if (fs.existsSync('netlify/functions/youtube-auth.mjs') || fs.existsSync('netlify/functions/youtube-callback.mjs')) {
  throw new Error('Persisten entrypoints Netlify duplicados.');
}
console.log('OK: ' + scripts.length + ' scripts inline, ' + sourceFiles.length + ' archivos JS, JSON, YAML, shell, slots válidos e inválidos y service worker.');
