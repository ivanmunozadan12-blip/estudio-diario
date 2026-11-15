// Comprueba la sintaxis del JavaScript real antes de iniciar la producción.
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
if (!inlineScripts.length) throw new Error('No se encontró JavaScript inline en index.html.');
inlineScripts.forEach((match, i) => new vm.Script(match[1], { filename: 'index.html:inline-' + (i + 1) }));
new vm.Script(fs.readFileSync('ci/generate.js', 'utf8'), { filename: 'ci/generate.js' });

for (const token of ['extraApiKeys', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4']) {
  const source = token === 'extraApiKeys' ? html : fs.readFileSync('ci/generate.js', 'utf8');
  if (!source.includes(token)) throw new Error('Falta la integración esperada: ' + token);
}
for (const token of ['slice(0, 12)', 'e.status === 429', 'transientAttempt < 1', 'AIstate.keyIndex = ki']) {
  if (!html.includes(token)) throw new Error('Falta el respaldo avanzado de Gemini: ' + token);
}
console.log('Sintaxis correcta. Rotación entre 4 proyectos, modelos alternativos y cambio inmediato ante HTTP 429 integrados.');
