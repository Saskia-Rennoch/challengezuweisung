'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const QRCode = require('qrcode');
const { solveGrouped, groupBounds, validateBallot } = require('./solver');

const BALLOT_COUNT = 27;
const BODY_LIMIT = 16 * 1024;
const SESSION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW = 60 * 1000;
const digest = value => createHash('sha256').update(value).digest();
const FIRST_NAME = /^(?:\p{L}\p{M}*)+(?:[ '\u2019\p{Pd}](?:\p{L}\p{M}*)+)*$/u;
const STATIC = new Map([
  ['/', ['seminar/student.html', 'text/html']],
  ['/abgabe', ['seminar/student.html', 'text/html']],
  ['/prof', ['seminar/prof.html', 'text/html']],
  ['/assets/style.css', ['style.css', 'text/css']],
  ['/assets/seminar.css', ['seminar/seminar.css', 'text/css']],
  ['/assets/student.js', ['seminar/student.js', 'text/javascript']],
  ['/assets/prof.js', ['seminar/prof.js', 'text/javascript']],
  ['/assets/solver.js', ['solver.js', 'text/javascript']],
  ['/assets/demo.js', ['seminar/demo.js', 'text/javascript']],
]);
const ADMIN = new Set(['GET /api/prof', 'GET /api/qr', 'POST /api/propose', 'POST /api/lock', 'POST /api/groups']);
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; " +
  "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

function persist(file, round) {
  // Write beside the target, then replace it in one rename. No request can
  // interleave a mutation with its write (all mutations are synchronous).
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(round) + '\n', { flag: 'wx', mode: 0o600, flush: true });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function loadRound(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const codes = new Set();
  while (codes.size < BALLOT_COUNT) codes.add(randomBytes(5).toString('hex').toUpperCase());
  const round = {
    codes: [...codes].map((code, i) => ({ id: String(i + 1).padStart(2, '0'), code })),
    ballots: [], locked: {}, seed: randomBytes(4).readUInt32LE(), proposal: null,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  persist(file, round);
  return round;
}

function lanAddress(networks = os.networkInterfaces()) {
  return Object.values(networks).flat().find(net => net.family === 'IPv4' && !net.internal)?.address;
}

function createServer({
  port = Number(process.env.PORT ?? 8787),
  publicOrigin = process.env.PUBLIC_ORIGIN,
  roundFile = process.env.ROUND_FILE || path.join(__dirname, '.project-data', 'round.json'),
  assetRoot = __dirname,
  adminPassword = process.env.ADMIN_PASSWORD,
} = {}) {
  if (typeof adminPassword !== 'string' || !adminPassword.trim()) {
    throw new Error('ADMIN_PASSWORD muss vor dem Start gesetzt werden.');
  }
  const lan = lanAddress();
  const origin = new URL(publicOrigin || `http://${lan || 'localhost'}:${port}`);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('PUBLIC_ORIGIN muss ein HTTP(S)-Origin ohne Pfad oder Anmeldedaten sein.');
  }
  const submitUrl = () => {
    const url = new URL('/abgabe', origin);
    if (!publicOrigin && port === 0 && server.listening) url.port = server.address().port;
    return url.href;
  };
  const expected = digest(adminPassword);
  const sessions = new Map();
  const failures = new Map();
  const sessionId = req => /(?:^|;\s*)seminar_admin=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const cookie = (id, age, req) => `seminar_admin=${id}; Path=/api/; HttpOnly; SameSite=Strict; Max-Age=${age}${req.socket.encrypted || origin.protocol === 'https:' && req.headers.host === origin.host ? '; Secure' : ''}`;
  const file = path.resolve(roundFile);
  let round = loadRound(file);
  function commit(changes) {
    const next = { ...round, ...changes };
    persist(file, next);
    round = next;
  }
  const state = () => ({ ballots: round.ballots, codes: round.codes, locked: round.locked, groups:round.groups??{},
    expanded:round.expanded??[], proposal: round.proposal, submitUrl: submitUrl() });
  const propose = (changes = {}) => solveGrouped({ ...round, ...changes }).assignment;
  function updateAllocation(res, changes) {
    const next={...round,...changes};
    try{groupBounds(next.locked,next.groups,next.expanded);}catch(e){return error(res,409,e.message);}
    commit({ ...changes, proposal:round.proposal===null?null:propose(changes) });
    return json(res,200,state());
  }

  async function handle(req, res) {
    const pathname = req.url.split('?')[0];
    const route = `${req.method} ${pathname}`;
    const now = Date.now();
    if (route === 'POST /api/login') {
      const body = await readJson(req, res);
      if (!body) return;
      for (const [ip, attempt] of failures) if (attempt.until <= now) failures.delete(ip);
      const ip = req.socket.remoteAddress;
      const attempt = failures.get(ip) || { count: 0, until: now + LOGIN_WINDOW };
      if (attempt.count >= 8) return error(res, 429, 'Zu viele Anmeldeversuche. Bitte warten Sie eine Minute.');
      if (typeof body.password !== 'string' || !timingSafeEqual(digest(body.password), expected)) {
        if (!failures.has(ip) && failures.size >= 1024) failures.delete(failures.keys().next().value);
        failures.set(ip, { ...attempt, count: attempt.count + 1 });
        return error(res, 401, 'Das Passwort ist falsch.');
      }
      failures.delete(ip);
      for (const [id, until] of sessions) if (until <= now) sessions.delete(id);
      sessions.delete(sessionId(req));
      if (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
      const id = randomBytes(32).toString('hex');
      sessions.set(id, now + SESSION_MS);
      res.setHeader('Set-Cookie', cookie(id, SESSION_MS / 1000, req));
      return json(res, 200, { ok: true });
    }
    if (route === 'POST /api/logout') {
      if (!await readJson(req, res)) return;
      sessions.delete(sessionId(req));
      res.setHeader('Set-Cookie', cookie('', 0, req));
      return json(res, 200, { ok: true });
    }
    if (ADMIN.has(route) && !(sessions.get(sessionId(req)) > now)) return error(res, 401, 'Anmeldung erforderlich.');
    if (route === 'GET /api/prof') return json(res, 200, state());
    if (route === 'GET /api/qr') {
      return send(res, 200, 'image/svg+xml', await QRCode.toString(submitUrl(), { type: 'svg' }));
    }
    if (route === 'POST /api/propose') {
      const body = await readJson(req, res);
      if (!body) return;
      if (Object.keys(body).length) return error(res, 400, 'Leeres JSON-Objekt erwartet.');
      if (round.ballots.length !== BALLOT_COUNT) {
        return error(res, 409, 'Es werden genau 27 Stimmzettel benötigt.');
      }
      commit({ proposal: propose() });
      return json(res, 200, state());
    }
    if (route === 'POST /api/groups') {
      const body=await readJson(req,res);if(!body)return;
      const {project,enabled}=body;
      if(!Number.isInteger(project)||project<1||project>9||typeof enabled!=='boolean')return error(res,400,'Ungültige Gruppenfreigabe.');
      const expanded=(round.expanded??[]).filter(p=>p!==project);
      if(enabled)expanded.push(project);
      return updateAllocation(res,{expanded:expanded.sort((a,b)=>a-b)});
    }
    if (route === 'POST /api/lock') {
      const body = await readJson(req, res);
      if (!body) return;
      const { id, project, group='A' } = body;
      if (!round.ballots.some(ballot => ballot.id === id) ||
          (project !== null && (!Number.isInteger(project) || project < 1 || project > 9 || !['A','B'].includes(group)))) {
        return error(res, 400, 'Ungültige Kennung oder Projektnummer.');
      }
      const previous = round.locked[id];
      if ((project===previous&&(round.groups?.[id]??'A')===group)||(project===null&&previous===undefined)) return json(res,200,state());
      if (project !== null && previous !== undefined) {
        return error(res, 409, 'Die bestehende Festlegung muss zuerst aufgehoben werden.');
      }
      const locked = { ...round.locked }, groups={ ...round.groups };
      if (project === null) { delete locked[id];delete groups[id]; }
      else {locked[id] = project;groups[id]=group;}
      return updateAllocation(res,{locked,groups});
    }
    if (route === 'POST /api/ballot') {
      const body = await readJson(req, res);
      if (!body) return;
      const { code, name, ranks, receipt } = body;
      const open = receipt !== undefined;
      if (typeof name !== 'string' || name.length > 100 || !FIRST_NAME.test(name) ||
          name !== name.trim() || !validateBallot({ id: '01', ranks })) {
        return error(res, 400, 'Ungültiger Name oder ungültige Rangliste.');
      }
      if (open && (typeof receipt !== 'string' || !/^[a-f0-9]{32}$/.test(receipt))) {
        return error(res, 400, 'Ungültige Anfrage. Bitte laden Sie die Seite neu.');
      }
      const id = open ? round.receipts?.[receipt] || round.codes.find(entry =>
        !round.ballots.some(ballot => ballot.id === entry.id))?.id : round.codes.find(entry => entry.code === code)?.id;
      if (!id) return open ? error(res, 409, 'Die Runde ist abgeschlossen: 27 Wunschzettel sind eingegangen.') :
        error(res, 400, 'Ungültiger Abgabecode.');
      const previous = round.ballots.find(ballot => ballot.id === id);
      if (previous) {
        if (previous.name !== name || !previous.ranks.every((project, i) => project === ranks[i])) {
          return error(res, 409, 'Für diese Abgabe wurde bereits ein Wunschzettel gespeichert.');
        }
      } else {
        commit({ ballots: [...round.ballots, { id, name, ranks }],
          ...(open ? { receipts: { ...round.receipts, [receipt]: id } } : {}) });
      }
      return json(res, 200, { id });
    }
    const asset = req.method === 'GET' && STATIC.get(pathname);
    if (asset) {
      const [file, type] = asset;
      let body;
      try {
        body = await fs.promises.readFile(path.join(assetRoot, file));
      } catch (err) {
        if (err.code === 'ENOENT') return error(res, 404, 'Nicht gefunden.');
        throw err;
      }
      return send(res, 200, type, body);
    }
    return error(res, 404, 'Nicht gefunden.');
  }

  const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CSP);
    handle(req, res).catch(err => {
      console.error(err);
      if (!res.destroyed && !res.headersSent) error(res, 500, 'Interner Serverfehler.');
    });
  });
  return { server, get submitUrl() { return submitUrl(); } };
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(body);
}

function json(res, status, value) {
  send(res, status, 'application/json', JSON.stringify(value));
}

function error(res, status, message) {
  json(res, status, { error: message });
}

function readJson(req, res) {
  const reject = (status, message) => {
    req.resume();
    error(res, status, message);
    return null;
  };
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return reject(415, 'JSON erwartet.');
  }
  if (Number(req.headers['content-length']) > BODY_LIMIT) {
    return reject(413, 'Anfrage zu groß.');
  }
  return new Promise(resolve => {
    const chunks = [];
    let size = 0;
    req.on('error', () => resolve(null));
    req.on('data', function onData(chunk) {
      size += chunk.length;
      if (size <= BODY_LIMIT) chunks.push(chunk);
      else {
        req.off('data', onData);
        resolve(reject(413, 'Anfrage zu groß.'));
      }
    });
    req.on('end', () => {
      if (size > BODY_LIMIT) return;
      try {
        const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (body && typeof body === 'object' && !Array.isArray(body)) return resolve(body);
      } catch {
        // Invalid UTF-8 or JSON.
      }
      error(res, 400, 'Ungültiges JSON-Objekt.');
      resolve(null);
    });
  });
}

module.exports = { createServer };

if (require.main === module) {
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Ungültiger PORT.');
  const app = createServer({ port });
  app.server.listen(port, '0.0.0.0', () => {
    console.log(`Leitung: http://localhost:${app.server.address().port}/prof`);
    console.log(`Abgabe (LAN): ${app.submitUrl}`);
  });
}
