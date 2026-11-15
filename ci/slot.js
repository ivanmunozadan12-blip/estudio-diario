// Decide qué hueco (0,1,2) toca ahora según la hora de Madrid. Imprime índice o "skip".
const fs = require('fs'); const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const hist = JSON.parse(fs.readFileSync('history.json', 'utf8'));
const now = new Date(); const f = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now).reduce((o, p) => (o[p.type] = p.value, o), {});
const day = `${f.year}-${f.month}-${f.day}`, cur = (+f.hour % 24) * 60 + +f.minute;
const forced = process.env.FORCE_SLOT; let slot = -1;
if (forced !== undefined && forced !== '') slot = +forced;
else cfg.horas.forEach((h, i) => { const [a, b] = h.split(':').map(Number), t = a * 60 + b; if (cur >= t - 30 && cur <= t + 120 && slot < 0) slot = i; });
if (!Number.isInteger(slot) || slot < 0 || slot > 2) {
  if (forced !== undefined && forced !== '') {
    console.error('FORCE_SLOT debe ser 0, 1 o 2; recibido: ' + String(forced));
    process.exit(2);
  }
  console.log('skip'); process.exit(0);
}
if ((forced === undefined || forced === '') && hist.some(h => h.dia === day && h.slot === slot)) { console.log('skip'); process.exit(0); }
console.log(slot + ' ' + day);
