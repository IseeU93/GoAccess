#!/usr/bin/env node
// Request-Simulator fuer GoAccess – ohne externe Abhaengigkeiten (Node >= 18).
//
//   node sim.mjs server   [--port 8080] [--log ../logs/access.log]
//   node sim.mjs traffic  [--target http://localhost:8080] [--profile mixed] [--rps 20] [--duration 60]
//   node sim.mjs generate [--days 14] [--lines 50000] [--out ../logs/history.log] [--seed 42]
//
// server   : kleiner Webserver mit vielen Routen (200/301/304/400/401/403/404/500 ...), schreibt ein Access-Log.
// traffic  : schickt echte Requests an den Server (Besucher, Bots, Scanner, fehlerhafte Clients).
// generate : schreibt direkt ein rueckdatiertes Log (Tage/Wochen) fuer statische Reports.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(HERE, '..', 'logs');

// ---------------------------------------------------------------- Zufall

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = Math.random;
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
function weighted(items) {
  let total = 0;
  for (const [, w] of items) total += w;
  let r = rnd() * total;
  for (const [v, w] of items) if ((r -= w) < 0) return v;
  return items[items.length - 1][0];
}

// ---------------------------------------------------------------- Server-Antworten

// Gemeinsames Modell: der Server nutzt es live, "generate" ohne Netzwerk.
function respond(method, url) {
  const p = url.split('?')[0];
  const R = (status, size, ms, extra = {}) => ({ status, size, ms, ...extra });

  if (method === 'OPTIONS') return R(204, 0, int(1, 4));
  if (/\.\.(\/|%2f)|union.{0,6}select|(<|%3c)script/i.test(url)) return R(400, 150, int(1, 5));
  if (p === '/admin' || p.startsWith('/admin/')) return R(403, 162, int(2, 10));
  if (p === '/error') return R(500, 180, int(20, 80));
  if (p === '/slow') return R(200, 2048, int(1800, 3200));
  if (p === '/old-page') return R(301, 169, int(1, 5), { location: '/about' });
  if (p === '/health') return R(200, 2, int(1, 5));

  if (p === '/api/login') {
    if (method !== 'POST') return R(405, 150, 3);
    return chance(0.7) ? R(200, 420, int(40, 120)) : R(401, 60, int(40, 100));
  }
  if (p === '/api/orders') {
    if (method === 'POST') {
      const r = rnd();
      if (r < 0.04) return R(500, 90, int(200, 900));
      if (r < 0.1) return R(400, 120, int(10, 40));
      return R(201, 310, int(60, 260));
    }
    return R(200, int(1000, 9000), int(40, 180));
  }
  if (p === '/api/search') return R(200, int(2000, 15000), int(150, 900));
  if (p === '/api/users' || p === '/api/products') return R(200, int(1500, 20000), int(25, 140));

  if (/^\/(static|images)\/[\w.-]+\.(js|css|png|jpg|svg|woff2)$/.test(p)) {
    return chance(0.25) ? R(304, 0, int(1, 5)) : R(200, int(2000, 180000), int(1, 25));
  }
  if (/^\/download\/[\w.-]+\.zip$/.test(p)) return R(200, int(2_000_000, 5_000_000), int(500, 1500));

  const productId = p.match(/^\/products\/(\d+)$/);
  const isPage =
    ['/', '/about', '/contact', '/products', '/blog', '/favicon.ico', '/robots.txt', '/sitemap.xml'].includes(p) ||
    (productId && +productId[1] >= 1 && +productId[1] <= 180) ||
    /^\/blog\/[a-z0-9-]+$/.test(p);
  if (isPage) {
    if (method !== 'GET' && method !== 'HEAD') return R(405, 150, 3);
    if (chance(0.003)) return R(503, 190, int(30, 200));
    return R(200, int(4000, 60000), int(20, 150), { html: true });
  }
  return R(404, int(150, 600), int(1, 12));
}

// ---------------------------------------------------------------- Besucher & Requests

const HUMAN_UAS = [
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', 40],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 20],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0', 10],
  ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36', 15],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0', 8],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', 7],
];
const BOT_UAS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  'python-requests/2.31.0',
  'curl/8.4.0',
  'Go-http-client/2.0',
];
const SCANNER_UAS = ['sqlmap/1.7.11#stable (https://sqlmap.org)', 'Nikto/2.5.0', 'zgrab/0.x', 'masscan/1.3'];
const REFERRERS = [
  ['-', 45], ['https://www.google.com/', 25], ['https://www.bing.com/', 5], ['https://duckduckgo.com/', 4],
  ['https://twitter.com/', 6], ['https://news.ycombinator.com/', 4], ['https://www.reddit.com/', 5], ['https://www.facebook.com/', 6],
];
const FIRST_OCTETS = [3, 5, 13, 18, 31, 37, 45, 62, 77, 81, 85, 91, 104, 128, 151, 176, 185, 194, 203, 212];
const SLUGS = ['hello-world', 'release-notes-2', 'how-to-mix', 'summer-sale', 'new-features', 'tips-and-tricks', 'behind-the-scenes', 'faq'];
const QUERIES = ['shoes', 'laptop', 'kopfhoerer', 'sale', 'dj+controller', 'preis', 'test'];
const FILES = ['manual.zip', 'setup-1.2.zip', 'dataset.zip'];

const randomIp = () => `${pick(FIRST_OCTETS)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`;

const HUMAN_ROUTES = [
  ['GET /', 20], ['GET /products', 12], ['GET /products/{n}', 22], ['GET /about', 4], ['GET /contact', 3],
  ['GET /blog', 5], ['GET /blog/{slug}', 8], ['GET /static/app.js', 10], ['GET /static/style.css', 10],
  ['GET /images/{img}', 14], ['GET /api/products', 6], ['GET /api/users', 2], ['GET /api/search?q={q}', 5],
  ['POST /api/login', 2], ['POST /api/orders', 1.5], ['GET /api/orders', 1], ['GET /download/{file}', 0.8],
  ['GET /old-page', 1], ['GET /favicon.ico', 3], ['GET /robots.txt', 0.4], ['GET /health', 0.2],
  ['GET /does-not-exist-{n}', 1], ['GET /admin', 0.2],
];
const FAULTY_ROUTES = [
  ['GET /error', 3], ['GET /slow', 2], ['POST /api/orders', 4], ['GET /api/search?q={q}', 3], ['POST /api/login', 2],
];
const BOT_ROUTES = [
  ['GET /robots.txt', 2], ['GET /sitemap.xml', 1], ['GET /products/{n}', 10], ['GET /blog/{slug}', 5], ['GET /', 2],
];
const SCAN_PATHS = [
  '/wp-login.php', '/wp-admin/', '/.env', '/.git/config', '/phpmyadmin/', '/admin', '/admin/login', '/xmlrpc.php',
  '/..%2f..%2fetc/passwd', '/api/users?id=1%20UNION%20SELECT%20password%20FROM%20users',
  '/index.php?id=<script>alert(1)</script>', '/cgi-bin/test.cgi', '/backup.zip', '/config.json',
];

function expand(tpl) {
  return tpl
    .replace('{n}', () => int(1, 200))
    .replace('{slug}', () => pick(SLUGS))
    .replace('{img}', () => `hero-${int(1, 12)}.jpg`)
    .replace('{q}', () => pick(QUERIES))
    .replace('{file}', () => pick(FILES));
}

function makeCtx() {
  const visitors = Array.from({ length: 400 }, () => ({
    ip: randomIp(),
    ua: weighted(HUMAN_UAS),
    ref: weighted(REFERRERS),
  }));
  const bots = BOT_UAS.map((ua) => ({ ip: randomIp(), ua, ref: '-' }));
  const scanners = SCANNER_UAS.slice(0, 3).map((ua) => ({ ip: randomIp(), ua, ref: '-' }));
  return { visitors, bots, scanners };
}

// Wenige Stammgaeste, viele seltene Besucher.
const zipf = (arr) => arr[Math.floor(arr.length * rnd() ** 2.2)];

function makeRequest(kind, ctx) {
  if (kind === 'scanner') {
    const s = pick(ctx.scanners);
    return { method: 'GET', path: pick(SCAN_PATHS), ...s };
  }
  const routes = kind === 'bot' ? BOT_ROUTES : kind === 'faulty' ? FAULTY_ROUTES : HUMAN_ROUTES;
  const v = kind === 'bot' ? pick(ctx.bots) : zipf(ctx.visitors);
  const [method, tpl] = weighted(routes).split(' ');
  const body = method === 'POST' ? JSON.stringify({ user: `u${int(1, 99)}`, item: int(1, 180) }) : undefined;
  return { method, path: expand(tpl), ip: v.ip, ua: v.ua, ref: v.ref, body };
}

// ---------------------------------------------------------------- Log-Format

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const ao = Math.abs(off);
  return `${pad(d.getDate())}/${MON[d.getMonth()]}/${d.getFullYear()}:${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${off >= 0 ? '+' : '-'}${pad(Math.floor(ao / 60))}${pad(ao % 60)}`;
}
// COMBINED + Antwortzeit in Sekunden (passt zu goaccess.conf)
function logLine({ ip, ts, method, path: p, status, size, ref, ua, ms }) {
  return `${ip} - - [${fmtTime(ts)}] "${method} ${p} HTTP/1.1" ${status} ${size} "${ref}" "${ua}" ${(ms / 1000).toFixed(3)}\n`;
}

// ---------------------------------------------------------------- Befehle

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Bedienfeld (/__sim): Requests per Browser-UI starten, mit Anzahl und Wiederholung.
// Der Server schickt die Requests selbst an sich (so sind IP/User-Agent frei waehlbar).
const runner = { running: false, stop: false, job: null };
function resetRunner() {
  Object.assign(runner, { round: 0, sent: 0, sentInRound: 0, inflight: 0, errors: 0, msSum: 0, done: 0, classes: { 2: 0, 3: 0, 4: 0, 5: 0 }, recent: [] });
}
resetRunner();

async function runJob(job, port) {
  resetRunner();
  runner.running = true;
  runner.stop = false;
  runner.job = job;
  const ctx = makeCtx();
  const kinds = job.mode === 'profile' ? Object.entries(PROFILES[job.profile].kinds) : null;
  const more = () => !runner.stop && (!job.count || runner.sentInRound < job.count);

  function fire() {
    const q = kinds
      ? makeRequest(weighted(kinds), ctx)
      : { method: job.method, path: job.path, ip: job.ip || randomIp(), ua: job.ua, ref: job.ref, body: job.body };
    const headers = { 'user-agent': q.ua || HUMAN_UAS[0][0], 'x-forwarded-for': q.ip };
    if (q.ref && q.ref !== '-') headers.referer = q.ref;
    if (q.body) headers['content-type'] = 'application/json';
    const t = Date.now();
    runner.inflight++;
    fetch(`http://127.0.0.1:${port}${q.path}`, { method: q.method, headers, body: q.body || undefined, redirect: 'manual' })
      .then(async (res) => {
        await res.arrayBuffer();
        const ms = Date.now() - t;
        runner.classes[Math.floor(res.status / 100)] = (runner.classes[Math.floor(res.status / 100)] || 0) + 1;
        runner.msSum += ms;
        runner.done++;
        runner.recent.push({ status: res.status, method: q.method, path: q.path, ip: q.ip, ms });
        if (runner.recent.length > 40) runner.recent.shift();
      })
      .catch(() => { runner.errors++; })
      .finally(() => { runner.inflight--; });
  }

  do {
    runner.round++;
    runner.sentInRound = 0;
    let credit = 0;
    let last = Date.now();
    while (more()) {
      const now = Date.now();
      credit += ((now - last) / 1000) * job.rps;
      last = now;
      if (runner.inflight >= 200) credit = 0;
      while (credit >= 1 && more()) {
        credit--;
        runner.sentInRound++;
        runner.sent++;
        fire();
      }
      await sleep(20);
    }
    while (runner.inflight > 0) await sleep(20);
    if (job.loop && !runner.stop) for (let i = 0; i < job.pause * 50 && !runner.stop; i++) await sleep(20);
  } while (job.loop && !runner.stop);
  runner.running = false;
}

function controlState() {
  return {
    running: runner.running, job: runner.job, round: runner.round, sent: runner.sent, inflight: runner.inflight,
    classes: runner.classes, errors: runner.errors, avgMs: runner.done ? Math.round(runner.msSum / runner.done) : 0,
    recent: runner.recent,
  };
}

function handleControl(req, res, port) {
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const route = req.url.split('?')[0];
  if (req.method === 'GET' && (route === '/__sim' || route === '/__sim/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(HERE, 'ui.html')));
  }
  if (req.method === 'GET' && route === '/__sim/report') {
    // GoAccess-Report mit eingebettetem Bedienfeld (Overlay unten rechts)
    let html;
    try { html = fs.readFileSync(path.join(LOG_DIR, 'report.html'), 'utf8'); } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('logs/report.html fehlt – erst den Live-Report starten (demo.ps1 oder report-live.ps1).');
    }
    const overlay = fs.readFileSync(path.join(HERE, 'overlay.html'), 'utf8');
    html = html.includes('</body>') ? html.replace('</body>', () => overlay + '</body>') : html + overlay;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  if (req.method === 'GET' && route === '/__sim/state') return json(200, controlState());
  if (req.method === 'POST' && route === '/__sim/stop') { runner.stop = true; return json(200, { ok: true }); }
  if (req.method === 'POST' && route === '/__sim/start') {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      if (runner.running) return json(409, { error: 'Es laeuft bereits ein Lauf – erst stoppen.' });
      let b;
      try { b = JSON.parse(raw || '{}'); } catch { return json(400, { error: 'Ungueltiges JSON' }); }
      const job = {
        mode: b.mode === 'profile' ? 'profile' : 'manual',
        profile: PROFILES[b.profile] ? b.profile : 'mixed',
        method: String(b.method || 'GET').toUpperCase(),
        path: String(b.path || '/'),
        ip: String(b.ip || '').trim(), ua: String(b.ua || ''), ref: String(b.ref || ''), body: String(b.body || ''),
        count: Math.min(Math.max(Math.floor(+b.count) || 0, 0), 1_000_000),
        rps: Math.min(Math.max(+b.rps || 10, 0.1), 500),
        loop: !!b.loop,
        pause: Math.min(Math.max(+b.pause || 0, 0), 3600),
      };
      if (!job.path.startsWith('/')) return json(400, { error: 'Pfad muss mit / beginnen' });
      if (!/^[A-Z]{3,7}$/.test(job.method)) return json(400, { error: 'Ungueltige Methode' });
      runJob(job, port);
      json(200, { ok: true });
    });
    return;
  }
  json(404, { error: 'unbekannt' });
}

// Seiten bekommen echtes HTML (aufgefuellt auf die simulierte Groesse), alles andere Fuellbytes.
function pageBody(p, r) {
  if (!r.html) return Buffer.alloc(r.size, 'x');
  const head = `<!doctype html><meta charset="utf-8"><title>Simulator – ${p}</title>` +
    `<body style="font:16px system-ui;max-width:640px;margin:40px auto"><h1>Simulierte Seite <code>${p}</code></h1>` +
    `<p>Diese Seite gibt es nur zum Testen von GoAccess.</p><ul>` +
    `<li><a href="/__sim">Bedienfeld</a></li><li><a href="/__sim/report">GoAccess-Report mit Bedienfeld</a></li>` +
    `<li><a href="/">Start</a> · <a href="/products">Produkte</a> · <a href="/blog">Blog</a> · <a href="/about">Über uns</a></li></ul><!--`;
  const buf = Buffer.alloc(Math.max(r.size, Buffer.byteLength(head) + 3), ' ');
  buf.write(head, 0);
  buf.write('-->', buf.length - 3);
  return buf;
}

function cmdServer(o) {
  const port = +o.port || 8080;
  const logFile = path.resolve(o.log || path.join(LOG_DIR, 'access.log'));
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.createWriteStream(logFile, { flags: 'a' });

  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/__sim')) return handleControl(req, res, port);
    const t0 = Date.now();
    req.resume();
    const r = respond(req.method, req.url);
    await sleep(r.ms);
    const headers = { 'content-type': r.html ? 'text/html; charset=utf-8' : 'text/plain', server: 'sim/1.0' };
    if (r.location) headers.location = r.location;
    const noBody = req.method === 'HEAD' || r.status === 204 || r.status === 304;
    const body = noBody ? null : pageBody(req.url.split('?')[0], r);
    if (body) headers['content-length'] = body.length;
    res.writeHead(r.status, headers);
    res.end(body);
    res.on('close', () => {
      const fwd = req.headers['x-forwarded-for']?.split(',')[0].trim();
      let ip = fwd || req.socket.remoteAddress || '-';
      ip = ip.replace('::ffff:', '').replace('::1', '127.0.0.1');
      out.write(logLine({
        ip, ts: t0, method: req.method, path: req.url, status: r.status, size: body ? body.length : 0,
        ref: req.headers.referer || '-', ua: req.headers['user-agent'] || '-', ms: Date.now() - t0,
      }));
    });
  });
  server.listen(port, () => console.log(`Simulator-Server auf http://localhost:${port}  ->  Log: ${logFile}\nBedienfeld: http://localhost:${port}/__sim`));
}

const PROFILES = {
  normal: { kinds: { human: 1 } },
  spike: { kinds: { human: 1 }, curve: (f) => (f > 0.2 && f < 0.5 ? 8 : 1) },
  scan: { kinds: { human: 0.3, scanner: 0.7 } },
  errors: { kinds: { human: 0.5, faulty: 0.5 } },
  bots: { kinds: { human: 0.3, bot: 0.7 } },
  mixed: {
    kinds: { human: 0.75, bot: 0.1, scanner: 0.05, faulty: 0.1 },
    curve: (f) => (f > 0.6 && f < 0.7 ? 10 : 1 + 0.6 * Math.sin(f * Math.PI * 6)),
  },
};

async function cmdTraffic(o) {
  const target = (o.target || 'http://localhost:8080').replace(/\/$/, '');
  const profName = o.profile || 'mixed';
  const prof = PROFILES[profName];
  if (!prof) return console.error(`Unbekanntes Profil "${profName}". Moeglich: ${Object.keys(PROFILES).join(', ')}`);
  const baseRps = +o.rps || 20;
  const duration = o.duration === undefined ? 60 : +o.duration; // 0 = endlos
  const ctx = makeCtx();
  const kinds = Object.entries(prof.kinds);
  const stats = { sent: 0, dropped: 0, errors: 0, classes: { 2: 0, 3: 0, 4: 0, 5: 0 }, ms: 0, inflight: 0 };

  console.log(`Traffic -> ${target}  Profil=${profName}  ${baseRps} req/s  ${duration ? duration + ' s' : 'endlos'}  (Strg+C beendet)`);

  async function fire() {
    const q = makeRequest(weighted(kinds), ctx);
    const headers = { 'user-agent': q.ua, 'x-forwarded-for': q.ip };
    if (q.ref !== '-') headers.referer = q.ref;
    if (q.body) headers['content-type'] = 'application/json';
    const t = Date.now();
    stats.inflight++;
    try {
      const res = await fetch(target + q.path, { method: q.method, headers, body: q.body, redirect: 'manual' });
      await res.arrayBuffer();
      stats.classes[Math.floor(res.status / 100)] = (stats.classes[Math.floor(res.status / 100)] || 0) + 1;
      stats.ms += Date.now() - t;
    } catch {
      stats.errors++;
    } finally {
      stats.inflight--;
    }
  }

  const start = Date.now();
  let credit = 0;
  let stop = false;
  process.on('SIGINT', () => { stop = true; });
  let nextReport = start + 5000;
  const report = (label) => {
    const done = stats.sent - stats.inflight - stats.errors;
    const c = stats.classes;
    console.log(`[${label}] gesendet ${stats.sent} | 2xx ${c[2]} 3xx ${c[3]} 4xx ${c[4]} 5xx ${c[5]} | Fehler ${stats.errors} verworfen ${stats.dropped} | Ø ${done ? Math.round(stats.ms / done) : 0} ms`);
  };

  while (!stop && (!duration || Date.now() - start < duration * 1000)) {
    const frac = duration ? (Date.now() - start) / (duration * 1000) : ((Date.now() - start) / 60000) % 1;
    const rps = baseRps * (prof.curve ? prof.curve(frac) : 1);
    credit += rps * 0.05;
    while (credit >= 1) {
      credit--;
      if (stats.inflight >= 200) { stats.dropped++; continue; }
      stats.sent++;
      fire();
    }
    if (Date.now() >= nextReport) { report(`${Math.round((Date.now() - start) / 1000)}s`); nextReport += 5000; }
    await sleep(50);
  }
  while (stats.inflight > 0) await sleep(50);
  report('fertig');
}

function cmdGenerate(o) {
  const days = +o.days || 14;
  const lines = +o.lines || 50000;
  rnd = makeRng(+o.seed || 42);
  const outFile = path.resolve(o.out || path.join(LOG_DIR, 'history.log'));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const ctx = makeCtx();
  const now = Date.now();
  const hourW = [1, 1, 1, 1, 1, 2, 3, 5, 7, 9, 10, 10, 11, 10, 10, 10, 11, 12, 13, 14, 13, 10, 6, 3].map((w, h) => [h, w]);
  const kindMix = [['human', 0.8], ['bot', 0.1], ['scanner', 0.04], ['faulty', 0.06]];
  const entries = [];

  const add = (ts, kind) => {
    const q = makeRequest(kind, ctx);
    const r = respond(q.method, q.path);
    entries.push({ ts, text: logLine({ ...q, ...r, ts }) });
  };
  const midnight = (daysAgo) => { const d = new Date(now - daysAgo * 86400000); d.setHours(0, 0, 0, 0); return d.getTime(); };

  while (entries.length < lines) {
    const day = int(0, days - 1);
    const base = midnight(day);
    const dow = new Date(base).getDay();
    if ((dow === 0 || dow === 6) && chance(0.4)) continue; // weniger Verkehr am Wochenende
    const ts = base + weighted(hourW) * 3600000 + int(0, 3599999);
    if (ts > now) continue;
    add(ts, weighted(kindMix));
  }

  // Zwischenfaelle: ein Scanner-Angriff und eine Fehlerwelle
  const burst = (kind, count, daysAgo, hour) => {
    const t0 = midnight(daysAgo) + hour * 3600000;
    for (let i = 0; i < count; i++) {
      const ts = t0 + int(0, 600000);
      if (ts < now) add(ts, kind);
    }
  };
  if (days > 3) {
    burst('scanner', Math.round(lines * 0.03), int(1, days - 1), 3);
    burst('faulty', Math.round(lines * 0.02), int(1, days - 1), 15);
  }

  entries.sort((a, b) => a.ts - b.ts);
  fs.writeFileSync(outFile, entries.map((e) => e.text).join(''));
  console.log(`${entries.length} Zeilen (${days} Tage) -> ${outFile}`);
}

// Einen einzelnen Request nach Wunsch senden. spec: { method, path, ip, ua, ref, body, count }
async function sendManual(target, spec) {
  const headers = {
    'user-agent': spec.ua || HUMAN_UAS[0][0],
    'x-forwarded-for': spec.ip || randomIp(),
  };
  if (spec.ref) headers.referer = spec.ref;
  if (spec.body) headers['content-type'] = 'application/json';
  const count = Math.max(1, +spec.count || 1);
  for (let i = 0; i < count; i++) {
    const h = spec.ip ? headers : { ...headers, 'x-forwarded-for': randomIp() }; // ohne --ip: jedes Mal neue IP
    const t = Date.now();
    try {
      const res = await fetch(target + spec.path, { method: spec.method, headers: h, body: spec.body, redirect: 'manual' });
      const buf = await res.arrayBuffer();
      console.log(`${res.status} ${spec.method} ${spec.path}  ${buf.byteLength} B  ${Date.now() - t} ms  (IP ${h['x-forwarded-for']})`);
    } catch (e) {
      console.error(`Fehler: ${e.cause?.code || e.message} – laeuft der Server (node sim.mjs server)?`);
      return;
    }
  }
}

const UA_SHORT = { chrome: HUMAN_UAS[0][0], iphone: HUMAN_UAS[1][0], firefox: HUMAN_UAS[2][0], android: HUMAN_UAS[3][0], googlebot: BOT_UAS[0], curl: BOT_UAS[4], sqlmap: SCANNER_UAS[0] };

async function cmdSend(o) {
  // node sim.mjs send GET /pfad ...  (Methode und Pfad als erste zwei Argumente)
  const [method, p] = process.argv.slice(3).filter((a, i, arr) => !a.startsWith('--') && !(arr[i - 1] || '').startsWith('--'));
  if (!method || !p) return console.error('Aufruf: send <METHODE> <PFAD> [--ip 1.2.3.4] [--ua chrome|iphone|firefox|android|googlebot|curl|sqlmap|"text"] [--ref URL] [--body JSON] [--count N] [--target URL]');
  await sendManual((o.target || 'http://localhost:8080').replace(/\/$/, ''), {
    method: method.toUpperCase(), path: p, ip: o.ip, ua: UA_SHORT[o.ua] || o.ua, ref: o.ref, body: o.body, count: o.count,
  });
}

async function cmdShell(o) {
  const target = (o.target || 'http://localhost:8080').replace(/\/$/, '');
  const rl = (await import('node:readline')).createInterface({ input: process.stdin, output: process.stdout, prompt: 'sim> ' });
  console.log(`Interaktiv -> ${target}
Format:  METHODE /pfad [ip=1.2.3.4] [ua=chrome|iphone|firefox|android|googlebot|curl|sqlmap] [ref=URL] [body=JSON] [x=N]
Beispiele:  GET /products/5     POST /api/login x=10     GET /.env ip=6.6.6.6 ua=sqlmap x=20     (nur "/pfad" = GET)   exit = beenden`);
  rl.prompt();
  let chain = Promise.resolve();
  rl.on('line', (line) => { chain = chain.then(() => handle(line)); });
  let closed = false;
  rl.on('close', () => { closed = true; chain.then(() => process.exit(0)); });
  async function handle(line) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (parts[0] === 'exit' || parts[0] === 'quit') return rl.close();
    if (parts.length) {
      const spec = { method: 'GET' };
      if (parts[0].startsWith('/')) spec.path = parts.shift();
      else { spec.method = parts.shift().toUpperCase(); spec.path = parts.shift(); }
      for (const kv of parts) {
        const [k, ...v] = kv.split('=');
        const val = v.join('=');
        if (k === 'x') spec.count = val;
        else if (k === 'ua') spec.ua = UA_SHORT[val] || val;
        else spec[k] = val;
      }
      if (!spec.path) console.log('Pfad fehlt.');
      else await sendManual(target, spec);
    }
    if (!closed) rl.prompt();
  }
}

function help() {
  console.log(`Befehle:
  send     <METHODE> <PFAD> [--ip ..] [--ua ..] [--ref ..] [--body JSON] [--count N]   (einzelner Request)
  shell    interaktiv Requests eintippen
  server   [--port 8080] [--log ../logs/access.log]
  traffic  [--target http://localhost:8080] [--profile ${Object.keys(PROFILES).join('|')}] [--rps 20] [--duration 60]
  generate [--days 14] [--lines 50000] [--out ../logs/history.log] [--seed 42]`);
}

const [cmd = 'help', ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith('--')) continue;
  const next = rest[i + 1];
  opts[rest[i].slice(2)] = next !== undefined && !next.startsWith('--') ? rest[++i] : true;
}
({ server: cmdServer, traffic: cmdTraffic, generate: cmdGenerate, send: cmdSend, shell: cmdShell }[cmd] || help)(opts);
