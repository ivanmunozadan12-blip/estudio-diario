// Validación local de sintaxis, configuración y reglas de seguridad. No llama a APIs externas.
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
  if (result.status !== 0) throw new Error(label + '\n' + (result.stderr || result.stdout || 'fallo sin salida'));
}
const html = fs.readFileSync('index.html', 'utf8');
const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
if (!inlineScripts.length) throw new Error('No se encontró JavaScript inline en index.html.');
inlineScripts.forEach((match, i) => new vm.Script(match[1], { filename: 'index.html:inline-' + (i + 1) }));

const sourceFiles = ['ci', 'netlify/functions'].flatMap(dir => walk(dir))
  .filter(file => /\.(?:js|mjs|cjs)$/.test(file));
for (const file of sourceFiles) run(process.execPath, ['--check', file], 'Sintaxis incorrecta en ' + file);
for (const file of ['config.json', 'history.json', 'package.json', 'manifest.webmanifest']) {
  JSON.parse(fs.readFileSync(file, 'utf8'));
}
run('bash', ['-n', 'ci/send.sh'], 'Sintaxis incorrecta en ci/send.sh');
for (const file of ['.github/workflows/videos.yml', '.github/workflows/validate.yml']) {
  const yamlCheck = spawnSync('ruby', ['-e', 'require \'yaml\'; YAML.load_file(ARGV[0])', file], { encoding: 'utf8' });
  if (yamlCheck.error && yamlCheck.error.code !== 'ENOENT') throw yamlCheck.error;
  if (!yamlCheck.error && yamlCheck.status !== 0) throw new Error('YAML inválido en ' + file + ': ' + (yamlCheck.stderr || yamlCheck.stdout));
}

const invalidSlots = ['invalid', '3', '-1', '1.5'];
for (const value of invalidSlots) {
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
  if (result.status !== 0 || !new RegExp('^' + value + ' \\d{4}-\\d{2}-\\d{2}\\s*.test(result.stdout.trim())) {
    throw new Error('FORCE_SLOT=' + value + ' no ha producido un resultado válido: ' + result.stdout + result.stderr);
  }
}
const generate = fs.readFileSync('ci/generate.js', 'utf8');
if (generate.includes('2026-11-15') || generate.includes('forceTopics:')) throw new Error('Queda una selección de temas de prueba fechada y forzada en producción.');
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
console.log('OK: JavaScript inline, ' + sourceFiles.length + ' archivos JS/MJS/CJS, JSON, YAML, shell, slots 0-2, rechazo de slots inválidos, selección automática de temas y reglas del service worker.');
).test(result.stdout.trim())) {
    throw new Error('FORCE_SLOT=' + value + ' no ha producido un resultado válido: ' + result.stdout + result.stderr);
  }
}
const generate = fs.readFileSync('ci/generate.js', 'utf8');
if (generate.includes('2026-11-15') || generate.includes('forceTopics:')) throw new Error('Queda una selección de temas de prueba fechada y forzada en producción.');
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
console.log('OK: JavaScript inline, ' + sourceFiles.length + ' archivos JS/MJS/CJS, JSON, YAML, shell, slots 0-2, rechazo de slots inválidos, selección automática de temas y reglas del service worker.');
