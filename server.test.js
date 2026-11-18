const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const publicOrigin = 'http://192.0.2.10:8888';
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'seminar-'));
  const roundFile = path.join(dir, '.project-data', 'round.json');
  const servers = new Set();
  t.after(async () => {
    for (const server of servers) await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function start() {
    const { createServer } = require('./server');
    const { server } = createServer({ roundFile, publicOrigin, assetRoot: dir, adminPassword: 'test-only-login-2467' });
    servers.add(server);
    await once(server.listen(0, '127.0.0.1'), 'listening');
    const request = (route, { method = 'GET', auth = false, body, raw, headers } = {}) =>
      fetch(`http://127.0.0.1:${server.address().port}${route}`, {
        method, headers: {
          ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(auth ? { cookie } : {}), ...headers,
        }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
    const logged = await request('/api/login', { method: 'POST', body: { password: 'test-only-login-2467' } });
    const cookie = logged.headers.get('set-cookie').split(';')[0];
    const token = cookie.split('=')[1];
    const admin = (route = '/api/prof', body) => request(route, {
      auth: true, ...(body === undefined ? {} : { method: 'POST', body }),
    });
    const stop = async () => {
      await new Promise(resolve => server.close(resolve));
      servers.delete(server);
    };
    return { token, cookie, request, admin, stop };
  }
  return { dir, roundFile, start, ...await start() };
}

test('admin routes require a session cookie; state starts with 27 unique codes', async t => {
  const { request, admin, token } = await fixture(t);
  for (const [method, route] of [
    ['GET', '/api/prof'], ['GET', '/api/qr'], ['POST', '/api/propose'], ['POST', '/api/lock'],
  ]) {
    for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
      const res = await request(`${route}?token=${token}`, { method, headers });
      assert.equal(res.status, 401);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.ok(!(await res.text()).includes(token));
    }
  }
  assert.equal((await request('/api/ballot')).status, 404);
  assert.equal((await request('/.project-data/round.json')).status, 404);
  assert.equal((await request('/server.js')).status, 404);
  const res = await admin();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const text = await res.text();
  assert.ok(!text.includes(token));
  const { codes, ...state } = JSON.parse(text);
  assert.deepEqual(state, { ballots: [], locked: {}, groups:{}, expanded:[], proposal: null, submitUrl: `${publicOrigin}/abgabe` });
  assert.deepEqual(codes.map(({ id }) => id), Array.from({ length: 27 }, (_, i) => String(i + 1).padStart(2, '0')));
  assert.equal(new Set(codes.map(({ code }) => code)).size, 27);
  assert.ok(codes.every(({ code }) => /^[A-Z0-9]{6,12}$/.test(code)));
});

test('password opens professor session without exposing it; logout invalidates the cookie', async t => {
  const { request } = await fixture(t);
  const login = password => request('/api/login', { method: 'POST', body: { password } });
  assert.equal((await login('incorrect')).status, 401);
  assert.equal((await request('/api/prof')).status, 401);
  const res = await login('test-only-login-2467');
  assert.equal(res.status, 200);
  const set = res.headers.get('set-cookie');
  assert.match(set, /HttpOnly; SameSite=Strict/);
  const headers = { cookie: set.split(';')[0] };
  assert.equal((await request('/api/prof', { headers })).status, 200);
  assert.equal((await request('/api/qr', { headers })).status, 200);
  assert.equal((await request('/api/logout', { method: 'POST', headers, body: {} })).status, 200);
  assert.equal((await request('/api/prof', { headers })).status, 401);
});

test('maps only the contracted static files, including demo and solver assets', async t => {
  const { dir, token, request } = await fixture(t);
  const assets = [
    ['/', 'seminar/student.html', 'text/html'],
    ['/abgabe', 'seminar/student.html', 'text/html'],
    ['/prof', 'seminar/prof.html', 'text/html'],
    ['/assets/style.css', 'style.css', 'text/css'],
    ['/assets/seminar.css', 'seminar/seminar.css', 'text/css'],
    ['/assets/student.js', 'seminar/student.js', 'text/javascript'],
    ['/assets/prof.js', 'seminar/prof.js', 'text/javascript'],
    ['/assets/solver.js', 'solver.js', 'text/javascript'],
    ['/assets/demo.js', 'seminar/demo.js', 'text/javascript'],
  ];
  fs.mkdirSync(path.join(dir, 'seminar'));
  for (const [, file] of assets) fs.writeFileSync(path.join(dir, file), `fixture: ${file}`);
  for (const [route, file, mime] of assets) {
    const res = await request(route);
    assert.equal(res.status, 200, route);
    assert.equal(res.headers.get('content-type').split(';')[0], mime);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await res.text(), `fixture: ${file}`);
    if (mime === 'text/html') assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  }
  assert.equal((await request(`/seminar/prof.html?token=${token}`)).status, 404);
});

const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9];
test('professor can enable two groups for any project and reserve group B before ballots are complete', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/groups',{method:'POST',body:{project:9,enabled:true}})).status,401);
  const codes=await fillRound(f,7);
  const lock=(id,group)=>f.admin('/api/lock',{id,project:9,group});
  assert.equal((await lock(codes[0].id,'B')).status,409);
  const settings=await f.admin('/api/groups',{project:9,enabled:true});
  assert.equal(settings.status,200);
  assert.deepEqual((await settings.json()).expanded,[9]);
  for(const [i,{id}] of codes.slice(0,6).entries())assert.equal((await lock(id,i<3?'A':'B')).status,200);
  assert.equal((await lock(codes[6].id,'B')).status,409);
  assert.equal((await f.admin('/api/groups',{project:9,enabled:false})).status,409);
  const state=await(await f.admin()).json();
  assert.equal(Object.values(state.groups).filter(g=>g==='B').length,3);
});
const ballot = (request, body) => request('/api/ballot', { method: 'POST', body });

test('QR intake needs no personal code, retries safely and stops at 27 ballots', async t => {
  const { request, admin } = await fixture(t);
  const named = { name: 'Lea Weber', ranks, receipt: 'a'.repeat(32) };
  const first = await ballot(request, named);
  assert.equal(first.status, 200);
  const saved = await first.json();
  assert.deepEqual(await (await ballot(request, named)).json(), saved);
  assert.equal((await ballot(request, { ...named, name: 'Mika' })).status, 409);
  for (let n = 0; n < 26; n++) {
    const reply = await ballot(request, { name: 'Mika', ranks, receipt: String(n).padStart(32, '0') });
    assert.equal(reply.status, 200);
  }
  assert.equal((await ballot(request, { ...named, receipt: 'b'.repeat(32) })).status, 409);
  const state = await (await admin()).json();
  assert.equal(state.ballots.length, 27);
  assert.deepEqual(state.ballots[0], { id: saved.id, name: named.name, ranks });
});

test('validates JSON, Unicode first names, codes, and strict project permutations', async t => {
  const { request, admin } = await fixture(t);
  const { codes } = await (await admin()).json();
  const valid = { code: codes[0].code, name: 'Élodie', ranks };
  for (const changes of [
    { name: '' }, { name: 'Léa3' }, { name: '<script>' }, { name: '́' }, { name: null },
    { ranks: ranks.slice(1) }, { ranks: [...ranks, 10] }, { ranks: [...ranks.slice(0, -1), 1] },
    { ranks: [...ranks.slice(0, -1), '9'] }, { ranks: [...ranks.slice(0, -1), 10] },
    { ranks: [...ranks.slice(0, -1), 0] }, { ranks: {} }, { code: 'NOT-A-CODE' },
  ]) assert.equal((await ballot(request, { ...valid, ...changes })).status, 400);
  for (const raw of ['{oops', '[]', 'null']) {
    assert.equal((await request('/api/ballot', { method: 'POST', raw })).status, 400);
  }
  assert.equal((await request('/api/ballot', { method: 'POST', body: valid,
    headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request('/api/ballot', { method: 'POST', raw: ' '.repeat(16385) })).status, 413);
  assert.deepEqual((await (await admin()).json()).ballots, []);
  for (const [i, name] of ['Élodie', '李', 'Ame\u0301lie', 'Anne-Marie', 'D’Arcy', 'María José', 'Élodie'].entries()) {
    const res = await ballot(request, { ...valid, code: codes[i].code, name });
    assert.equal(res.status, 200, name);
    assert.deepEqual(await res.json(), { id: codes[i].id });
  }
  assert.deepEqual((await (await admin()).json()).ballots.map(({ name }) => name),
    ['Élodie', '李', 'Ame\u0301lie', 'Anne-Marie', 'D’Arcy', 'María José', 'Élodie']);
});

test('a used code accepts identical retries, not changed ballots', async t => {
  const { request, admin } = await fixture(t);
  const { codes: [{ id, code }] } = await (await admin()).json();
  const body = { code, name: 'Noah', ranks };
  const replies = await Promise.all([ballot(request, body), ballot(request, body)]);
  for (const res of replies) {
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id });
  }
  for (const changes of [{ name: 'Mila' }, { ranks: [...ranks].reverse() }]) {
    assert.equal((await ballot(request, { ...body, ...changes })).status, 409);
  }
  assert.deepEqual((await (await admin()).json()).ballots, [{ id, name: body.name, ranks }]);
});

async function fillRound({ request, admin }, count = 27) {
  const { codes } = await (await admin()).json();
  for (const { id, code } of codes.slice(0, count)) {
    const res = await ballot(request, { code, name: 'Mila', ranks });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id });
  }
  return codes;
}

function assertThreeSeats(state) {
  assert.deepEqual(Object.keys(state.proposal).sort(), state.codes.map(({ id }) => id));
  for (const project of ranks) assert.equal(Object.values(state.proposal).filter(p => p === project).length, 3);
  for (const [id, project] of Object.entries(state.locked)) assert.equal(state.proposal[id], project);
}

test('propose waits for all 27 ballots and assigns exactly three per project', async t => {
  const f = await fixture(t);
  const codes = await fillRound(f, 26);
  assert.equal((await f.admin('/api/propose', { expanded: [1] })).status, 400);
  assert.equal((await f.admin('/api/propose', {})).status, 409);
  assert.equal((await (await f.admin()).json()).proposal, null);
  assert.equal((await ballot(f.request, { code: codes[26].code, name: 'Eli', ranks })).status, 200);
  const res = await f.admin('/api/propose', {});
  assert.equal(res.status, 200);
  const state = await res.json();
  assertThreeSeats(state);
  assert.deepEqual(await (await f.admin()).json(), state);
});

test('locks require a submitted ID, cannot move directly or exceed three seats, and refresh the proposal', async t => {
  const f = await fixture(t);
  const lock = (id, project) => f.admin('/api/lock', { id, project });
  assert.equal((await lock('01', 1)).status, 400);
  await fillRound(f);
  for (const [id, project] of [[1, 1], ['99', 1], ['01', 0], ['01', 10], ['01', '1'], ['01', 1.5], ['01', undefined]]) {
    assert.equal((await lock(id, project)).status, 400);
  }
  const early = await lock('01', 1);
  assert.equal(early.status, 200);
  assert.equal((await early.json()).proposal, null);
  const before = await (await f.admin('/api/propose', {})).json();
  const forced = Object.keys(before.proposal).filter(id => before.proposal[id] !== 1);
  for (const id of forced.slice(0, 2)) {
    const res = await lock(id, 1);
    assert.equal(res.status, 200);
    const state = await res.json();
    assertThreeSeats(state);
    assert.equal(state.proposal[id], 1);
  }
  assert.equal((await lock('01', 2)).status, 409);
  assert.equal((await lock(forced[2], 1)).status, 409);
  assert.equal((await lock('01', 1)).status, 200);
  const released = await (await lock('01', null)).json();
  assert.ok(!Object.hasOwn(released.locked, '01'));
  assertThreeSeats(released);
  const moved = await (await lock('01', 2)).json();
  assert.equal(moved.locked['01'], 2);
  assertThreeSeats(moved);
});

test('restart retains the round, including seed, assignments, locks, and used codes, but rotates the token', async t => {
  const f = await fixture(t);
  const [{ id, code }] = await fillRound(f);
  assert.equal((await f.admin('/api/lock', { id, project: 4 })).status, 200);
  const state = await (await f.admin('/api/propose', {})).json();
  assertThreeSeats(state);
  const disk = JSON.parse(fs.readFileSync(f.roundFile, 'utf8'));
  assert.ok(Number.isSafeInteger(disk.seed));
  assert.deepEqual(fs.readdirSync(path.dirname(f.roundFile)), ['round.json']);
  await f.stop();
  const restarted = await f.start();
  assert.notEqual(f.token, restarted.token);
  assert.equal((await restarted.request('/api/prof', { headers: { cookie: f.cookie } })).status, 401);
  assert.deepEqual(await (await restarted.admin()).json(), state);
  assert.equal((await ballot(restarted.request, { code, name: 'Noah', ranks })).status, 409);
  assert.equal((await ballot(restarted.request, { code, name: 'Mila', ranks })).status, 200);
  assert.deepEqual(await (await restarted.admin('/api/propose', {})).json(), state);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.roundFile, 'utf8')), disk);
});

test('authenticated QR SVG encodes the exact advertised submit URL', async t => {
  const { admin } = await fixture(t);
  const { submitUrl } = await (await admin()).json();
  const res = await admin('/api/qr');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type').split(';')[0], 'image/svg+xml');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const svg = await res.text();
  assert.match(svg, /^<svg\b/);
  assert.equal(svg, await require('qrcode').toString(submitUrl, { type: 'svg' }));
});

test('CLI honors PORT and ROUND_FILE and prints localhost admin and autodetected LAN submission URLs',
  { timeout: 5000 }, async t => {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'seminar-cli-'));
    const file = path.join(dir, 'round.json');
    const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      env: { ...process.env, PORT: '0', PUBLIC_ORIGIN: '', ROUND_FILE: file, ADMIN_PASSWORD: 'test-only-login-2467' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const closed = once(child, 'close');
    t.after(async () => {
      child.kill();
      await closed;
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const output = await new Promise((resolve, reject) => {
      let text = '';
      child.stdout.on('data', chunk => {
        text += chunk;
        if (text.split('\n').length >= 3) resolve(text);
      });
      child.on('close', code => reject(new Error(`CLI exited before announcing both URLs (code ${code})`)));
      t.signal.addEventListener('abort', () => reject(t.signal.reason), { once: true });
    });
    const [, port] = output.match(/http:\/\/localhost:(\d+)\/prof\s/) || [];
    assert.ok(Number(port) > 0, 'expected a localhost admin URL without credentials');
    const login = await fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-only-login-2467' }) });
    const res = await fetch(`http://127.0.0.1:${port}/api/prof`, { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } });
    assert.equal(res.status, 200);
    const { submitUrl } = await res.json();
    const candidateHosts = Object.values(os.networkInterfaces()).flat()
      .filter(net => net.family === 'IPv4' && !net.internal).map(net => net.address);
    assert.ok((candidateHosts.length ? candidateHosts : ['localhost']).includes(new URL(submitUrl).hostname));
    assert.equal(new URL(submitUrl).port, port);
    assert.ok(output.includes(submitUrl));
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).codes.length, 27);
  });
