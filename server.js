'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const QRCode = require('qrcode');
const { challenges, validateRanks, MAX_BALLOTS } = require('./seminar/challenges');
const { solve, checkLocks, confirmAll } = require('./seminar/allocation');

const BODY_LIMIT = 16 * 1024;
const SESSION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW = 60 * 1000;
const digest = value => createHash('sha256').update(value).digest();
const deriveKey = promisify(scrypt);
const STUDENT_ATTEMPTS = 12;
const MAX_STUDENT_SCRYPT = 32;
const MAX_STUDENT_IPS = 1024;
const validPassword = password => typeof password === 'string' && password.length >= 4 && password.length <= 128;
const currentCode = /^\d{4}$/;
const legacyCode = /^[a-f0-9]{12}$/;
const validTeam = team => team === undefined || typeof team === 'string' && team.length <= 100;
const ballotView = ({ id, name, team, ranks }) => ({ id, name, team, ranks });
const ballotReceipt = ({ id, editCode }) => ({ id, editCode });
const NO_PROPOSAL = { proposal: null, proposalGroups: {}, warnings: [] };
const projectIds = new Set(challenges.map(({ id }) => id));
const byProject = new Map(challenges.map(c => [c.id,c]));
const validGroup = group => group === 'A' || group === 'B';
const ballotId = index => String(index + 1).padStart(2, '0');
// Keep the state field for clients that list slots, without issuing legacy intake codes.
const codes = Array.from({ length: MAX_BALLOTS }, (_, i) => ({ id: ballotId(i) }));
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
  ['/assets/challenges.js', ['seminar/challenges.js', 'text/javascript']],
  ['/assets/allocation.js', ['seminar/allocation.js', 'text/javascript']],
]);
const ADMIN = new Set(['GET /api/prof', 'GET /api/qr', 'GET /api/final.pdf', 'POST /api/confirm-all', 'POST /api/propose', 'POST /api/lock', 'POST /api/groups', 'POST /api/size', 'POST /api/ballot/delete']);
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
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (existing.version !== 2) throw new Error('Für die Live-Runde wird eine neue Rundendatei benötigt.');
    if (!existing.rangeLimits) {
      const sizes = Object.fromEntries(Object.entries(existing.sizes).map(([id, groups]) => {
        const {min,max}=byProject.get(Number(id));
        return [id,Object.fromEntries(Object.entries(groups).map(([group,n])=>[group,Math.max(min,Math.min(max,n))]))];
      }));
      const next={...existing,sizes,rangeLimits:true,...NO_PROPOSAL};
      persist(file,next);
      return next;
    }
    return existing;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const round = {
    version: 2, rangeLimits:true, ballots: [], locked: {}, groups: {}, expanded: [], sizes: {}, ...NO_PROPOSAL,
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
  roundFile = process.env.ROUND_FILE || path.join(__dirname, '.project-data', 'round-v2.json'),
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
  const studentAttempts = new Map();
  const dummySalt = randomBytes(16).toString('hex');
  let studentScryptInFlight = 0;
  const sessionId = req => /(?:^|;\s*)seminar_admin=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const cookie = (id, age, req) => `seminar_admin=${id}; Path=/api/; HttpOnly; SameSite=Strict; Max-Age=${age}${req.socket.encrypted || origin.protocol === 'https:' && req.headers.host === origin.host ? '; Secure' : ''}`;
  const file = path.resolve(roundFile);
  let round = loadRound(file);
  // Older rounds have no counter. Preserve it from the first write so stale admin views cannot target a reused ID.
  round.lastBallotNumber ??= Math.max(0, ...round.ballots.map(b => Number(b.id)));
  const isAdmin = req => sessions.get(sessionId(req)) > Date.now();
  function newEditCode() {
    let code;
    do { code=String(randomInt(10000)).padStart(4,'0'); }
    while(round.ballots.some(b=>b.editCode===code));
    return code;
  }
  function commit(changes) {
    const next = { ...round, ...changes };
    persist(file, next);
    round = next;
  }
  const state = () => ({
    ballots: round.ballots.map(ballotView), codes, locked: round.locked, groups: round.groups,
    expanded: round.expanded, sizes: round.sizes, proposal: round.proposal,
    proposalGroups: round.proposalGroups, warnings: round.warnings, submitUrl: submitUrl(),
  });
  function propose({ ballots, locked, groups, expanded, sizes }) {
    const { assignment, teamAssignments, warnings } = solve({ ballots: ballots.map(ballotView), locked, groups, expanded, sizes });
    return { proposal: assignment, proposalGroups: teamAssignments, warnings };
  }
  function updateAllocation(res, changes) {
    const next = { ...round, ...changes };
    const { locked, groups, expanded, sizes } = next;
    try {
      checkLocks({ locked, groups, expanded, sizes });
    } catch (err) {
      return error(res, 409, err.message);
    }
    commit({ ...changes, ...(round.proposal === null ? NO_PROPOSAL : propose(next)) });
    return json(res, 200, state());
  }

  function studentBusy(res) {
    res.setHeader('Retry-After', String(LOGIN_WINDOW / 1000));
    return error(res, 429, 'Zu viele Anfragen. Bitte warten Sie eine Minute.');
  }

  async function studentKey(password, salt) {
    studentScryptInFlight++;
    try {
      return await deriveKey(password, salt, 64);
    } finally {
      studentScryptInFlight--;
    }
  }

  // Reserve the attempt before awaiting scrypt so parallel requests share the limit.
  async function authenticateStudent(req, res, ballot, password) {
    if (studentScryptInFlight >= MAX_STUDENT_SCRYPT) return studentBusy(res);
    const ip = req.socket.remoteAddress;
    const now = Date.now();
    for (const [key, attempt] of studentAttempts) if (attempt.until <= now) studentAttempts.delete(key);
    let attempt = studentAttempts.get(ip);
    if (!attempt) {
      if (studentAttempts.size >= MAX_STUDENT_IPS) return studentBusy(res);
      attempt = { count: 0, until: now + LOGIN_WINDOW };
      studentAttempts.set(ip, attempt);
    }
    if (attempt.count >= STUDENT_ATTEMPTS) return studentBusy(res);
    attempt.count++;
    const key = await studentKey(password, ballot?.salt ?? dummySalt);
    const expectedKey = ballot ? Buffer.from(ballot.passwordHash, 'hex') : Buffer.alloc(64);
    if (timingSafeEqual(key, expectedKey) && ballot) {
      attempt.count--;
      return true;
    }
    return false;
  }

  async function retrySubmission(req, res, ballot, { name, team, ranks, password }) {
    const authenticated = await authenticateStudent(req, res, ballot, password);
    if (authenticated === undefined) return;
    // An edit or deletion may have completed during authentication.
    const current = round.ballots.find(({ id }) => id === ballot.id);
    if (!authenticated || !current || current.name !== name || current.team !== team ||
        !current.ranks.every((project, i) => project === ranks[i])) {
      return error(res, 409, 'Für diese Abgabe wurde bereits ein Wunschzettel gespeichert.');
    }
    return json(res, 200, ballotReceipt(current));
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
    if (ADMIN.has(route) && !isAdmin(req)) return error(res, 401, 'Anmeldung erforderlich.');
    if (route === 'GET /api/prof') return json(res, 200, state());
    if (route === 'GET /api/qr') {
      return send(res, 200, 'image/svg+xml', await QRCode.toString(submitUrl(), { type: 'svg' }));
    }
    if (route === 'GET /api/final.pdf') {
      if(!Object.keys(round.locked).length)return error(res,409,'Noch keine bestätigte Zusortierung.');
      const bytes=await require('./seminar/report-pdf').assignmentPdf(state());
      res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="zusortierung.pdf"'});
      return res.end(bytes);
    }
    if (route === 'POST /api/confirm-all') {
      const body=await readJson(req,res);if(!body)return;
      let changes;
      try{changes=confirmAll(round,body.entries);}catch(e){return error(res,409,e.message);}
      return updateAllocation(res,changes);
    }
    if (route === 'POST /api/propose') {
      const body = await readJson(req, res);
      if (!body) return;
      if (Object.keys(body).length) return error(res, 400, 'Leeres JSON-Objekt erwartet.');
      if (!round.ballots.length) {
        return error(res, 409, 'Es wurde noch kein Wunschzettel abgegeben.');
      }
      commit(propose(round));
      return json(res, 200, { ...state(), assignment: round.proposal });
    }
    if (route === 'POST /api/groups') {
      const body = await readJson(req, res);
      if (!body) return;
      const { project, enabled } = body;
      if (!projectIds.has(project) || typeof enabled !== 'boolean') return error(res, 400, 'Ungültige Gruppenfreigabe.');
      const expanded = round.expanded.filter(p => p !== project);
      if (enabled) expanded.push(project);
      return updateAllocation(res, { expanded: expanded.sort((a, b) => a - b) });
    }
    if (route === 'POST /api/size') {
      const body = await readJson(req, res);
      if (!body) return;
      const { project, group, size } = body;
      const range=byProject.get(project);
      if (!range || !validGroup(group) || size!==null && (!Number.isInteger(size)||size<1||size>range.max)) {
        return error(res, 400, 'Ungültige Gruppengröße.');
      }
      const sizes = { ...round.sizes };
      const limits = { ...sizes[project] };
      if (size === null) delete limits[group];
      else limits[group] = size;
      if (Object.keys(limits).length) sizes[project] = limits;
      else delete sizes[project];
      return updateAllocation(res, { sizes });
    }
    if (route === 'POST /api/lock') {
      const body = await readJson(req, res);
      if (!body) return;
      const { id, project, group = 'A' } = body;
      if (!round.ballots.some(ballot => ballot.id === id) ||
          (project !== null && (!projectIds.has(project) || !validGroup(group)))) {
        return error(res, 400, 'Ungültige Kennung oder Projektnummer.');
      }
      const previous = round.locked[id];
      if ((project === previous && (round.groups[id] ?? 'A') === group) || (project === null && previous === undefined)) {
        return json(res, 200, state());
      }
      if (project !== null && previous !== undefined) {
        return error(res, 409, 'Die bestehende Festlegung muss zuerst aufgehoben werden.');
      }
      const locked = { ...round.locked }, groups = { ...round.groups };
      if (project === null) {
        delete locked[id];
        delete groups[id];
      } else {
        locked[id] = project;
        groups[id] = group;
      }
      return updateAllocation(res, { locked, groups });
    }
    if (route === 'POST /api/ballot/delete') {
      const body = await readJson(req, res);
      if (!body) return;
      if (!isAdmin(req)) return error(res, 401, 'Anmeldung erforderlich.');
      const { id } = body;
      if (Object.keys(body).length !== 1 || typeof id !== 'string' || !/^\d{2,}$/.test(id)) {
        return error(res, 400, 'Ungültige Wunschzettel-Kennung.');
      }
      const ballots = round.ballots.filter(ballot => ballot.id !== id);
      if (ballots.length === round.ballots.length) return error(res, 404, 'Dieser Wunschzettel existiert nicht mehr.');
      const locked = { ...round.locked }, groups = { ...round.groups };
      delete locked[id];
      delete groups[id];
      commit({ ballots, locked, groups, ...NO_PROPOSAL });
      return json(res, 200, state());
    }
    if (route === 'POST /api/ballot') {
      const body = await readJson(req, res);
      if (!body) return;
      const { name, ranks, receipt, password, team = '' } = body;
      if (typeof name !== 'string' || name.length > 100 || !FIRST_NAME.test(name) ||
          name !== name.trim() || !validTeam(team) || !validPassword(password) || !validateRanks(ranks)) {
        return error(res, 400, 'Ungültiger Name, Teamname, Passwort oder Rangliste.');
      }
      if (typeof receipt !== 'string' || !/^[a-f0-9]{32}$/.test(receipt)) {
        return error(res, 400, 'Ungültige Anfrage. Bitte laden Sie die Seite neu.');
      }
      const previous = () => round.ballots.find(ballot => ballot.receipt === receipt);
      const full = () => round.ballots.length >= MAX_BALLOTS;
      const roundFull = () => error(res, 409, `Die Runde ist abgeschlossen: ${MAX_BALLOTS} Wunschzettel sind eingegangen.`);
      let existing = previous();
      if (existing) return retrySubmission(req, res, existing, { name, team, ranks, password });
      if (full()) return roundFull();
      if (studentScryptInFlight >= MAX_STUDENT_SCRYPT) return studentBusy(res);
      const salt = randomBytes(16).toString('hex');
      const passwordHash = (await studentKey(password, salt)).toString('hex');
      // Check again after asynchronous hashing; the final mutation and write are synchronous.
      existing = previous();
      if (existing) return retrySubmission(req, res, existing, { name, team, ranks, password });
      if (full()) return roundFull();
      const lastBallotNumber = round.lastBallotNumber + 1;
      const id = ballotId(lastBallotNumber - 1);
      const editCode=newEditCode();
      const ballot = { id, name, team, ranks, receipt, editCode, salt, passwordHash };
      commit({ ballots: [...round.ballots, ballot], lastBallotNumber, ...NO_PROPOSAL });
      return json(res, 200, ballotReceipt(ballot));
    }
    const updating = route === 'POST /api/ballot/update';
    if (updating || route === 'POST /api/ballot/load') {
      const body = await readJson(req, res);
      if (!body) return;
      const { editCode, password, ranks, team } = body;
      if (typeof editCode !== 'string' || (!currentCode.test(editCode)&&!legacyCode.test(editCode.toLowerCase())) || !validPassword(password)) {
        return error(res, 400, 'Ungültiger Bearbeitungscode oder ungültiges Passwort.');
      }
      if (updating && (!validTeam(team) || !validateRanks(ranks))) {
        return error(res, 400, 'Ungültiger Teamname oder ungültige Rangliste.');
      }
      const code = editCode.toLowerCase();
      const matched = round.ballots.find(ballot => ballot.editCode === code || ballot.previousEditCode === code);
      const authenticated = await authenticateStudent(req, res, matched, password);
      if (authenticated === undefined) return;
      if (!authenticated) return error(res, 401, 'Bearbeitungscode oder Passwort ist falsch.');
      // Re-read after authentication in case it was edited or deleted.
      const index = round.ballots.findIndex(ballot => ballot.id === matched.id);
      if (index === -1) return error(res, 401, 'Bearbeitungscode oder Passwort ist falsch.');
      let current = round.ballots[index];
      const upgrade = !currentCode.test(current.editCode);
      if (upgrade) current = { ...current, previousEditCode:current.editCode, editCode:newEditCode() };
      if (updating) {
        current = { ...current, ranks, team: team ?? current.team };
      }
      if (upgrade || updating) {
        const ballots = round.ballots.slice();
        ballots[index] = current;
        commit({ ballots, ...(updating?NO_PROPOSAL:{}) });
      }
      return json(res, 200, { ...ballotView(current), editCode: current.editCode });
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
