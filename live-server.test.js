'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes, scryptSync } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');
const { createServer } = require('./server');

const publicOrigin = 'http://192.0.2.10:8888';
const adminPassword = 'test-only-admin';
const password = 'example-student';
const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const payload = (changes = {}) => ({
  name: 'Élodie Weber', team: 'Team Grün', password, ranks, receipt: randomBytes(16).toString('hex'), ...changes,
});

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'live-seminar-'));
  const roundFile = path.join(dir, '.project-data', 'round-v2.json');
  let server;
  async function stop() {
    if (!server) return;
    await new Promise(resolve => server.close(resolve));
    server = null;
  }
  t.after(async () => {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function start() {
    ({ server } = createServer({ port: 0, roundFile, publicOrigin, adminPassword }));
    await once(server.listen(0, '127.0.0.1'), 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (route, body, cookie) => fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const login = await request('/api/login', { password: adminPassword });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const admin = (route = '/api/prof', body) => request(route, body, cookie);
    const submit = async (body = payload()) => ok(await request('/api/ballot', body));
    return { request, admin, submit, cookie };
  }
  return { dir, roundFile, start, stop, ...await start() };
}

async function ok(response) {
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

test('only an admin can delete a ballot; its assignment, edit access and proposal disappear', async t => {
  const f = await fixture(t);
  const body = payload();
  const removed = await f.submit(body);
  const kept = await f.submit(payload({ name: 'Mika Weber' }));
  await ok(await f.admin('/api/groups', { project: 5, enabled: true }));
  await ok(await f.admin('/api/size', { project: 5, group: 'B', size: 2 }));
  await ok(await f.admin('/api/lock', { id: removed.id, project: 5, group: 'B' }));
  await ok(await f.admin('/api/lock', { id: kept.id, project: 2, group: 'A' }));
  assert.ok((await ok(await f.admin('/api/propose', {}))).proposal);
  assert.equal((await f.request('/api/ballot/delete', { id: removed.id })).status, 401);
  assert.equal((await f.admin('/api/ballot/delete', { id: removed.id, other: true })).status, 400);
  assert.equal((await f.admin('/api/ballot/delete', { id: 1 })).status, 400);
  assert.equal((await f.admin('/api/ballot/delete', { id: '99' })).status, 404);
  const state = await ok(await f.admin('/api/ballot/delete', { id: removed.id }));
  assert.deepEqual(state.ballots.map(b => b.id), [kept.id]);
  assert.deepEqual(state.locked, { [kept.id]: 2 });
  assert.deepEqual(state.groups, { [kept.id]: 'A' });
  assert.deepEqual(state.expanded, [5]);
  assert.deepEqual(state.sizes, { 5: { B: 2 } });
  assert.equal(state.proposal, null);
  assert.deepEqual(state.proposalGroups, {});
  assert.deepEqual(state.warnings, []);
  const credentials = { editCode: removed.editCode, password };
  assert.equal((await f.request('/api/ballot/load', credentials)).status, 401);
  assert.equal((await f.request('/api/ballot/update', { ...credentials, ranks })).status, 401);
  assert.equal((await f.admin('/api/ballot/delete', { id: removed.id })).status, 404);
  assert.ok(!fs.readFileSync(f.roundFile, 'utf8').includes(body.receipt));
});

test('a deleted ballot ID is not reused after restart, even in an existing round without a counter', async t => {
  const f = await fixture(t);
  const [a, b, c] = await Promise.all([f.submit(), f.submit(), f.submit()]);
  const last = [a, b, c].sort((x, y) => Number(y.id) - Number(x.id))[0];
  await f.stop();
  const stored = JSON.parse(fs.readFileSync(f.roundFile, 'utf8'));
  delete stored.lastBallotNumber;
  fs.writeFileSync(f.roundFile, JSON.stringify(stored));
  const upgraded = await f.start();
  await ok(await upgraded.admin('/api/ballot/delete', { id: last.id }));
  await f.stop();
  const restarted = await f.start();
  const replacement = await restarted.submit();
  assert.ok(Number(replacement.id) > Number(last.id));
  assert.equal((await restarted.admin('/api/ballot/delete', { id: last.id })).status, 404);
  const state = await ok(await restarted.admin());
  assert.equal(state.ballots.length, 3);
  assert.equal(new Set(state.ballots.map(b => b.id)).size, 3);
});

test('ten-choice intake validates the request and exposes only ballot fields to admins', async t => {
  const f = await fixture(t);
  const body = payload();
  for (const changes of [
    { ranks: ranks.slice(0, 9) }, { ranks: [...ranks.slice(0, 9), 9] }, { ranks: [...ranks.slice(0, 9), '10'] },
    { password: undefined }, { password: 'abc' }, { password: 'x'.repeat(129) },
    { name: '<script>' }, { team: 1 }, { receipt: 'short' }, { receipt: undefined, code: 'legacy-code' },
  ]) assert.equal((await f.request('/api/ballot', { ...body, ...changes })).status, 400);
  const [saved, retry] = await Promise.all([f.submit(body), f.submit(body)]);
  assert.match(saved.editCode, /^\d{4}$/);
  assert.deepEqual(retry, saved);
  assert.equal((await f.request('/api/ballot', { ...body, password: 'wrong-password' })).status, 409);
  assert.equal((await f.request('/api/ballot', { ...body, team: 'Changed' })).status, 409);
  const second = await f.submit(payload({ team: undefined, password: 'w9Ez' }));
  assert.notEqual(second.editCode, saved.editCode);
  assert.equal((await f.request('/api/ballot/load', {editCode:second.editCode,password:'w9Ez'})).status,200);
  const state = await ok(await f.admin());
  assert.deepEqual(state.ballots, [
    { id: saved.id, name: body.name, team: body.team, ranks },
    { id: second.id, name: body.name, team: '', ranks },
  ]);
  assert.ok(state.ballots.every(ballot => !Object.hasOwn(ballot, 'editCode')));
  assert.ok(!JSON.stringify(state).includes(body.receipt));
  const persisted = fs.readFileSync(f.roundFile, 'utf8');
  assert.ok(!persisted.includes(password));
  const [firstStored, secondStored] = JSON.parse(persisted).ballots;
  assert.match(firstStored.salt, /^[a-f0-9]{32}$/);
  assert.notEqual(firstStored.salt, secondStored.salt);
  assert.equal(firstStored.passwordHash, scryptSync(password, firstStored.salt, 64).toString('hex'));
  for (const route of ['/.project-data/round-v2.json', '/server.js', '/api/ballot/load']) {
    assert.equal((await f.request(route)).status, 404);
  }
});

test('students authenticate to load and update the same ballot across a restart', async t => {
  const f = await fixture(t);
  const body = payload();
  const { id, editCode } = await f.submit(body);
  const credentials = { editCode: editCode.toUpperCase(), password };
  const view = { id, editCode, name: body.name, team: body.team, ranks };
  assert.deepEqual(await ok(await f.request('/api/ballot/load', credentials)), view);
  const bad = await f.request('/api/ballot/load', { ...credentials, password: 'bad-password' });
  const unknown = await f.request('/api/ballot/load', { ...credentials,
    editCode: (editCode.startsWith('0') ? '1' : '0') + editCode.slice(1) });
  assert.equal(bad.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await bad.json(), await unknown.json());
  assert.equal((await f.request('/api/ballot/update', { ...credentials, password: 'bad-password', ranks })).status, 401);
  assert.equal((await f.request('/api/ballot/update', { ...credentials, ranks: [1], team: '' })).status, 400);
  assert.equal((await f.request('/api/ballot/update', { ...credentials, ranks, team: null })).status, 400);
  const updated = { ...view, ranks: [...ranks].reverse(), team: 'Team Blau' };
  const { ranks: changedRanks, team } = updated;
  assert.deepEqual(await ok(await f.request('/api/ballot/update', { ...credentials, ranks: changedRanks, team,
    id: '99', name: 'Not the student' })), updated);
  await f.stop();
  const restarted = await f.start();
  assert.equal((await restarted.request('/api/prof', undefined, f.cookie)).status, 401);
  assert.deepEqual(await ok(await restarted.request('/api/ballot/load', credentials)), updated);
  assert.deepEqual((await ok(await restarted.admin())).ballots, [{ id, name: body.name, ranks: changedRanks, team }]);
});

test('an existing ballot gets a four-digit code after authenticated access without changing its choices', async t => {
  const f=await fixture(t);
  await f.submit();
  await f.stop();
  const old='a12b34c56d78';
  const disk=JSON.parse(fs.readFileSync(f.roundFile,'utf8'));
  disk.ballots[0].editCode=old;
  fs.writeFileSync(f.roundFile,JSON.stringify(disk));
  const reopened=await f.start();
  assert.equal((await reopened.request('/api/ballot/load',{editCode:old,password:'wrong'})).status,401);
  const migrated=await ok(await reopened.request('/api/ballot/load',{editCode:old,password}));
  assert.match(migrated.editCode,/^\d{4}$/);
  assert.deepEqual(migrated.ranks,ranks);
  assert.deepEqual(await ok(await reopened.request('/api/ballot/load',{editCode:migrated.editCode,password})),migrated);
});

test('student auth failures are rate limited across load and update without affecting admin auth', async t => {
  const f = await fixture(t);
  const { editCode } = await f.submit();
  const requests = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    f.request(i % 2 ? '/api/ballot/load' : '/api/ballot/update', { editCode, password: 'bad-password', ranks })));
  assert.ok(requests.every(r => r.status === 401 || r.status === 429));
  assert.ok(requests.some(r => r.status === 401));
  assert.ok(requests.some(r => r.status === 429 && Number(r.headers.get('retry-after')) > 0));
  assert.equal((await f.request('/api/ballot/load', { editCode, password })).status, 429);
  assert.equal((await f.admin()).status, 200);
});

test('admin proposals work before the round is full and student edits preserve locks', async t => {
  const f = await fixture(t);
  assert.equal((await f.admin('/api/propose', {})).status, 409);
  const { id, editCode } = await f.submit();
  assert.equal(Object.keys((await ok(await f.admin('/api/propose', {}))).proposal).length, 1);
  const second = await f.submit();
  const third = await f.submit();
  const lock = (id, project, group) => f.admin('/api/lock', { id, project, group });
  assert.equal((await lock(id, 10, 'B')).status, 409);
  assert.equal((await f.admin('/api/groups', { project: 10, enabled: true })).status, 200);
  await ok(await lock(id, 10, 'B'));
  const proposal = await ok(await f.admin('/api/propose', {}));
  assert.deepEqual(proposal.assignment, proposal.proposal);
  assert.equal(proposal.proposal[id], 10);
  assert.equal(proposal.proposalGroups[id], 'B');
  assert.ok(Object.hasOwn(proposal.proposal,second.id) && Object.hasOwn(proposal.proposal,third.id));
  assert.deepEqual(proposal.warnings, []);
  const confirmed = await ok(await lock(second.id, 9, 'A'));
  assert.equal(confirmed.proposal[second.id], 9);
  assert.equal(Object.keys(confirmed.proposal).length, 3);
  await ok(await f.request('/api/ballot/update', { editCode, password, ranks: [...ranks].reverse(), team: 'Neu' }));
  const state = await ok(await f.admin());
  assert.equal(state.proposal, null);
  assert.deepEqual(state.proposalGroups, {});
  assert.deepEqual(state.warnings, []);
  assert.deepEqual(state.locked, { [id]: 10, [second.id]: 9 });
  assert.deepEqual(state.groups, { [id]: 'B', [second.id]: 'A' });
});

test('admin group toggles and 1–4 caps respect established locks and persist', async t => {
  const f = await fixture(t);
  const size = (project, group, size) => f.admin('/api/size', { project, group, size });
  const enabled = enabled => f.admin('/api/groups', { project: 10, enabled });
  for (const [route, args] of [
    ['/api/groups', { project: 10, enabled: true }], ['/api/size', { project: 10, group: 'A', size: 4 }],
  ]) assert.equal((await f.request(route, args)).status, 401);
  for (const args of [[11, 'A', 2], [10, 'C', 2], [10, 'A', 0], [10, 'A', 5], [10, 'A', '3'],[1,'B',4]]) {
    assert.equal((await size(...args)).status, 400);
  }
  await ok(await enabled(true));
  assert.deepEqual((await ok(await size(10, 'B', 1))).sizes, { 10: { B: 1 } });
  assert.deepEqual((await ok(await size(10, 'B', 3))).sizes, { 10: { B: 3 } });
  const ballots = await Promise.all(Array.from({ length: 8 }, () => f.submit()));
  const lock = (index, group, project = 10) => f.admin('/api/lock', { id: ballots[index].id, project, group });
  for (let i = 0; i < 4; i++) await ok(await lock(i, 'A'));
  assert.equal((await lock(4, 'A')).status, 409);
  assert.equal((await size(10, 'A', 3)).status, 409);
  await ok(await lock(4, 'B'));
  await ok(await lock(5, 'B'));
  await ok(await lock(6, 'B'));
  assert.equal((await lock(7, 'B')).status, 409);
  assert.equal((await enabled(false)).status, 409);
  assert.equal((await lock(0, 'A', 9)).status, 409);
  assert.deepEqual((await ok(await size(10, 'B', null))).sizes, {});
  await ok(await lock(7, 'B'));
  assert.equal((await size(10, 'B', 3)).status,409);
  await ok(await f.admin('/api/lock', { id: ballots[7].id, project:null }));
  await ok(await size(10, 'B', 3));
  await ok(await f.admin('/api/propose', {}));
  const state = await ok(await f.admin());
  await f.stop();
  const restarted = await f.start();
  assert.deepEqual(await ok(await restarted.admin()), state);
  assert.deepEqual(state.expanded, [10]);
  assert.deepEqual(state.sizes, { 10: { B: 3 } });
  assert.equal(Object.keys(state.locked).length, 7);
  assert.equal(Object.keys(state.proposal).length, 8);
  for (const [id,project] of Object.entries(state.locked)) {
    assert.equal(state.proposal[id],project);
    assert.equal(state.proposalGroups[id],state.groups[id]);
  }
  const cleared = await ok(await restarted.admin('/api/lock', { id: ballots[6].id, project: null }));
  assert.ok(!Object.hasOwn(cleared.locked, ballots[6].id));
  assert.ok(!Object.hasOwn(cleared.groups, ballots[6].id));
});

test('batch confirmation saves only the displayed proposal and enables a PDF with a partial round', async t => {
  const f=await fixture(t);
  const {id:a}=await f.submit(), {id:b}=await f.submit();
  assert.equal((await f.request('/api/final.pdf')).status,401);
  const draft=await ok(await f.admin('/api/propose',{}));
  const entries=[a,b].map(id=>({id,project:draft.proposal[id],group:draft.proposalGroups[id]}));
  const stale=entries.map((x,i)=>i===0?{...x,project:x.project===1?2:1}:x);
  assert.equal((await f.admin('/api/confirm-all',{entries:stale})).status,409);
  const saved=await ok(await f.admin('/api/confirm-all',{entries}));
  assert.deepEqual(saved.locked,draft.proposal);
  await f.submit();
  const pdf=await f.admin('/api/final.pdf');
  assert.equal(pdf.status,200);
  assert.match(pdf.headers.get('content-disposition'),/attachment.*\.pdf/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
  assert.equal(Object.keys((await ok(await f.admin())).locked).length,2);
});

test('browser assets are served and QR still advertises the configured submission URL', async t => {
  const f = await fixture(t);
  for (const asset of ['challenges.js', 'allocation.js']) {
    const res = await f.request(`/assets/${asset}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/javascript;/);
    assert.equal(await res.text(), fs.readFileSync(path.join(__dirname, 'seminar', asset), 'utf8'));
  }
  assert.equal((await f.request('/api/qr')).status, 401);
  const state = await ok(await f.admin());
  assert.equal(state.submitUrl, `${publicOrigin}/abgabe`);
  const qr = await f.admin('/api/qr');
  assert.equal(qr.status, 200);
  assert.equal(await qr.text(), await require('qrcode').toString(state.submitUrl, { type: 'svg' }));
});

test('concurrent submissions stop at 27 and a receipt retry still works after the round fills', async t => {
  const f = await fixture(t);
  const body = payload();
  const first = await f.submit(body);
  const results = await Promise.all(Array.from({ length: 27 }, () => f.request('/api/ballot', payload())));
  assert.equal(results.filter(r => r.status === 200).length, 26);
  assert.equal(results.filter(r => r.status === 409).length, 1);
  assert.deepEqual(await f.submit(body), first);
  assert.equal((await ok(await f.admin())).ballots.length, 27);
  assert.equal((await ok(await f.admin('/api/ballot/delete', { id: first.id }))).ballots.length, 26);
  const replacement = await f.submit();
  assert.equal(replacement.id, '28');
  assert.equal((await ok(await f.admin())).ballots.length, 27);
  assert.equal((await f.request('/api/ballot', payload())).status, 409);
});

test('the default live round is isolated from the legacy round', t => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'legacy-seminar-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, '.project-data');
  fs.mkdirSync(dataDir);
  const oldFile = path.join(dataDir, 'round.json');
  const data = JSON.stringify({ ballots: [{ id: '01', ranks: ranks.slice(0, 9) }] });
  fs.writeFileSync(oldFile, data);
  assert.throws(() => createServer({ roundFile: oldFile, adminPassword }), /neue Rundendatei/);

  // The default is module-relative, so run a copy with an isolated data directory.
  fs.mkdirSync(path.join(dir, 'seminar'));
  for (const file of ['server.js', 'seminar/challenges.js', 'seminar/allocation.js']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(dir, file));
  }
  const child = spawnSync(process.execPath, ['-e', 'require("./server").createServer()'], {
    cwd: dir, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, ADMIN_PASSWORD: adminPassword, ROUND_FILE: '', PUBLIC_ORIGIN: publicOrigin,
      PORT: '0', NODE_PATH: path.join(__dirname, 'node_modules') },
  });
  assert.equal(child.status, 0, child.error?.message || child.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'round-v2.json'), 'utf8')).ballots, []);
  assert.equal(fs.readFileSync(oldFile, 'utf8'), data);
});
