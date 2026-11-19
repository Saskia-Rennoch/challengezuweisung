const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const titles = [
  'Wie wählt Wiesbaden?', 'Ab aufs Rad, aber sicher!', 'Wiesbaden - Stadt der kurzen Wege?',
  'Open Data "Health Check"', 'Die Stadt von gestern', 'Wie elektrisch ist Wiesbaden unterwegs?',
  'Zusammen verschieden', 'Flächencheck im Zeitvergleich', 'Ferien auf Knopfdruck', 'Finanzen aufgedeckt',
];
const ranks = titles.map((_, i) => i + 1);

test('catalog publishes the ten literal challenges in CommonJS and a classic browser script', () => {
  const catalog = require('./challenges');
  const expected = titles.map((title, i) => {
    const id = i + 1;
    const min = id === 5 || id === 10 ? 3 : 2;
    return { id, title, min, max: min + 1 };
  });
  assert.deepEqual(catalog.challenges, expected);
  assert.equal(catalog.MAX_BALLOTS, 27);
  const browser = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(require.resolve('./challenges'), 'utf8'), browser);
  assert.deepEqual(JSON.parse(JSON.stringify(browser.window.ChallengeCatalog.challenges)), expected);
  assert.equal(browser.window.ChallengeCatalog.validateRanks(ranks), true);
});

test('rank validation requires a complete permutation of integer challenge IDs', () => {
  const { validateRanks } = require('./challenges');
  assert.equal(validateRanks(ranks.slice().reverse()), true);
  for (const invalid of [undefined, {}, ranks.slice(1), [...ranks, 11], [...ranks.slice(1), 2],
    ['1', ...ranks.slice(1)], [11, ...ranks.slice(1)], Array(10)]) {
    assert.equal(validateRanks(invalid), false);
  }
});

function ballot(id, first = 1, team = '') {
  return { id, team, ranks: [first, ...ranks.filter(p => p !== first)] };
}

test('early proposals can contain a single person and preserve locks', () => {
  const { solve } = require('./allocation');
  assert.deepEqual(solve({ ballots: [] }), { assignment: {}, teamAssignments: {}, warnings: [] });
  const one = solve({ ballots: [ballot('one')], locked: { one: 5 } });
  assert.deepEqual(one.assignment, { one: 5 });
  assert.deepEqual(one.teamAssignments, { one: 'A' });
  assert.deepEqual(one.warnings, []);
  const two = solve({ ballots: [ballot('one'), ballot('two', 5)], locked: { one: 5 } });
  assert.deepEqual(two.assignment, { one: 5, two: 5 });
  assert.deepEqual(two.warnings, []);
});

test('lock validation enforces group ceilings and B permissions but permits an incomplete group', () => {
  const { checkLocks } = require('./allocation');
  const config = { locked: { x: 1, y: 1, z: 1 }, groups: { x: 'B', y: 'B', z: 'B' }, expanded: [1] };
  assert.doesNotThrow(() => checkLocks(config));
  assert.throws(() => checkLocks({ ...config, expanded: [] }));
  assert.throws(() => checkLocks({ ...config, sizes: { 1: { B: 2 } } }));
  assert.throws(() => checkLocks({ ...config, groups: { x: 'C' } }));
  assert.throws(() => checkLocks({ locked: { x: 11 } }));
  assert.throws(() => checkLocks({ locked: { x: 1, y: 1, z: 1, w: 1 } }));
  assert.doesNotThrow(() => checkLocks({ locked: { x: 5, y: 5, z: 5, w: 5 } }));
  assert.throws(() => checkLocks({ locked: { x: 1, y: 1, z: 1, w: 1, v: 1 } }));
  const locked = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`s${i}`, i % 10 + 1]));
  const groups = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`s${i + 10}`, 'B']));
  assert.doesNotThrow(() => checkLocks({ locked, groups, expanded: [1, 2, 3, 4] }));
});

test('a B lock is preserved independently of A, and sizes are ceilings not exact quotas', () => {
  const { solve } = require('./allocation');
  const proposal = solve({ ballots: [ballot('a'), ballot('b')], locked: { a: 1 }, groups: { a: 'B' },
    expanded: [1], sizes: { 1: { A: 2, B: 3 } } });
  assert.deepEqual(proposal.assignment, { a: 1, b: 1 });
  assert.deepEqual(proposal.teamAssignments, { a: 'B', b: 'B' });
});

function assertTogether(proposal, ids) {
  assert.ok(ids.every(id => Object.hasOwn(proposal.assignment, id)));
  assert.equal(new Set(ids.map(id => `${proposal.assignment[id]}${proposal.teamAssignments[id]}`)).size, 1);
}

function assertViable({ ballots, locked = {}, groups = {}, expanded = [], sizes = {} }, proposal) {
  const counts = new Map();
  const ids = new Set(ballots.map(b => String(b.id)));
  assert.deepEqual(Object.keys(proposal.assignment).sort(), Object.keys(proposal.teamAssignments).sort());
  for (const [id, project] of Object.entries(proposal.assignment)) {
    const group = proposal.teamAssignments[id];
    assert.ok(ids.has(id) && ranks.includes(project));
    assert.ok(group === 'A' || (group === 'B' && expanded.includes(project)));
    const key = `${project}${group}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    assert.ok(count <= (sizes[project]?.[group] ?? (project===5||project===10?4:3)));
  }

  for (const [id, project] of Object.entries(locked)) {
    assert.equal(proposal.assignment[id], project);
    assert.equal(proposal.teamAssignments[id], groups[id] ?? 'A');
  }
}

test('named teams are normalized and stay together with a locked teammate when feasible', () => {
  const { solve } = require('./allocation');
  const options = {
    ballots: [ballot('a', 1, '  Äpfel '), ballot('b', 10, 'äPFEL'), ballot('c', 10), ballot('d', 10)],
    locked: { a: 1 }, groups: { a: 'B' }, expanded: [1],
  };
  const proposal = solve(options);
  assertViable(options, proposal);
  assertTogether(proposal, ['a', 'b']);
  assert.equal(proposal.warnings.length, 0);
});

test('conflicting admin locks split a team and report its name', () => {
  const { solve } = require('./allocation');
  const options = {
    ballots: [ballot('a', 1, 'Komet'), ballot('b', 1, 'komet'), ballot('c'), ballot('d')],
    locked: { a: 1, b: 1 }, groups: { b: 'B' }, expanded: [1],
  };
  const proposal = solve(options);
  assertViable(options, proposal);
  assert.equal(Object.keys(proposal.assignment).length, 4);
  assert.match(proposal.warnings.join(' '), /komet/i);
});

test('a team of four can stay together while another voter is assigned separately', () => {
  const { solve } = require('./allocation');
  const options = { ballots: [...['a', 'b', 'c', 'd'].map(id => ballot(id, 1, 'Orbit')), ballot('e')] };
  const proposal = solve(options);
  assertViable(options, proposal);
  assert.equal(Object.keys(proposal.assignment).length, 5);
  assertTogether(proposal, ['a', 'b', 'c', 'd']);
  assert.deepEqual(proposal.warnings, []);
});

test('size ceilings can require a partial proposal with an explicit warning', () => {
  const { solve } = require('./allocation');
  const options = { ballots: Array.from({length:23},(_,i)=>ballot(`p${i}`)), sizes: Object.fromEntries(ranks.map(p => [p, { A: p===5||p===10?3:2 }])) };
  const proposal = solve(options);
  assertViable(options, proposal);
  assert.equal(Object.keys(proposal.assignment).length, 22);
  assert.ok(proposal.warnings.length);
});

test('all 27 ballots with every B enabled stay viable and preserve jointly feasible teams', { timeout: 5000 }, () => {
  const { solve } = require('./allocation');
  const teamSizes = [4, 4, 3, 3, 3, 2, 2, 2, 2, 2];
  const ballots = teamSizes.flatMap((size, index) => Array.from({ length: size }, (_, i) =>
    ballot(`${index}-${i}`, (index + i) % 10 + 1, `Team ${index}`)));
  assert.equal(ballots.length, 27);
  const options = { ballots, locked: { '0-0': 5, '2-0': 1 }, groups: { '0-0': 'B' }, expanded: ranks,
    sizes: { 1: { A: 3, B: 2 }, 5: { B: 4 }, 8: { A: 2, B: 2 } } };
  const start = performance.now();
  const proposal = solve(options);
  assert.ok(performance.now() - start < 3000, 'proposal should be interactive even with all groups enabled');
  assertViable(options, proposal);
  assert.equal(Object.keys(proposal.assignment).length, 27);
  assert.deepEqual(proposal.warnings, []);
  for (const team of new Set(ballots.map(b => b.team))) {
    assertTogether(proposal, ballots.filter(b => b.team === team).map(b => b.id));
  }
  assert.deepEqual(solve({ ...options, ballots: ballots.slice().reverse() }), proposal);
});

test('browser classic script exposes the same allocation API', () => {
  const browser = vm.createContext({ window: {} });
  for (const name of ['./challenges', './allocation']) {
    vm.runInContext(fs.readFileSync(require.resolve(name), 'utf8'), browser);
  }
  const { solve, checkLocks } = browser.window.ChallengeAllocation;
  const options = { ballots: [ballot('a', 10), ballot('b', 10), ballot('c', 10), ballot('d', 10)] };
  assert.doesNotThrow(() => checkLocks(options));
  assert.deepEqual(JSON.parse(JSON.stringify(solve(options))), require('./allocation').solve(options));
  assert.deepEqual({ ...solve(options).assignment }, { a: 10, b: 10, c: 10, d: 10 });
});

test('ranked demand is spread rather than opening an ordinary group of four by default', () => {
  const { solve } = require('./allocation');
  const options = { ballots: ['a', 'b', 'c', 'd'].map(id => ballot(id, 1)) };
  const proposal = solve(options);
  assertViable(options, proposal);
  assert.deepEqual(Object.values(proposal.assignment).sort(), [1, 1, 1, 2]);
});

test('maximum headcount agrees with exhaustive placement of two unlocked students', () => {
  const { solve } = require('./allocation');
  const expanded = [1, 5];
  const slots = ranks.flatMap(p => expanded.includes(p) ? [`${p}A`, `${p}B`] : [`${p}A`]);
  for (const onePersonGroups of [0, 1, 2, 3]) {
    const locked = {};
    const groups = {};
    const sizes = Object.fromEntries(ranks.map(p => [p, { A: p===5||p===10?3:2, B: p===5||p===10?3:2 }]));
    const loads = {};
    for (const [i, key] of slots.entries()) {
      loads[key] = i < onePersonGroups ? 1 : i < 7 ? sizes[key.slice(0,-1)].A : 0;
      for (let j = 0; j < loads[key]; j++) {
        const id = `${key}-${j}`;
        locked[id] = Number(key.slice(0, -1));
        groups[id] = key.slice(-1);
      }
    }
    const ballots = [...Object.keys(locked), 'free1', 'free2'].map((id, i) => ballot(id, i % 10 + 1));
    let best = -1;
    for (const a of [null, ...slots]) {
      for (const b of [null, ...slots]) {
        const counts = slots.map(key => loads[key] + Number(a === key) + Number(b === key));
        if (counts.every((n,i) => n <= sizes[slots[i].slice(0,-1)].A)) best = Math.max(best, Number(a !== null) + Number(b !== null));
      }
    }
    const options = { ballots, locked, groups, sizes, expanded };
    const proposal = solve(options);
    assertViable(options, proposal);
    assert.equal(Object.keys(proposal.assignment).length, Object.keys(locked).length + best);
  }
});
