'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const order = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function ballotsFor(ranking = () => order) {
  return Array.from({ length: 27 }, (_, i) => ({
    id: String(i + 1).padStart(2, '0'),
    ranks: [...ranking(i)],
  }));
}

test('validates ballot IDs and complete permutations of projects', () => {
  const { validateBallot } = require('./solver');
  const ballots = ballotsFor();
  const first = ballots[0];
  const last = ballots[26];
  assert.equal(validateBallot(first), true);
  assert.equal(validateBallot({ ...last, ranks: [...order].reverse() }), true);
  const sparse = [...order];
  delete sparse[0];
  for (const ballot of [null, {}, { ...first, id: 1 }, ...['1', '00', '28'].map(id => ({ ...first, id })),
    ...[sparse, order.slice(1), [0, ...order.slice(1)], [2, ...order.slice(1)], ['1', ...order.slice(1)]].map(ranks => ({ ...first, ranks }))]) {
    assert.equal(validateBallot(ballot), false);
  }
});

test('fills each base project with three students and reports rank counts', () => {
  const { solve } = require('./solver');
  const ballots = ballotsFor();
  const { assignment, histogram } = solve({ ballots });
  assert.deepEqual(Object.keys(assignment).sort(), ballots.map(({ id }) => id));
  for (const project of order) {
    assert.equal(Object.values(assignment).filter(value => value === project).length, 3);
  }
  assert.deepEqual(histogram, Array(9).fill(3));
});

test('avoids a ninth choice even when it increases the sum of ranks, respecting locks', () => {
  const { solve } = require('./solver');
  const ballots = ballotsFor(i => {
    if (i === 0) return [1, 3, 4, 5, 6, 2, 7, 8, 9];
    if (i === 3) return [3, 4, 5, 6, 7, 1, 8, 9, 2];
    return order;
  });
  const locked = Object.fromEntries(ballots.flatMap(({ id }, i) =>
    i === 0 || i === 3 ? [] : [[id, Math.floor(i / 3) + 1]]));
  const { assignment, histogram } = solve({ ballots, locked });
  assert.deepEqual(assignment, { ...locked, '01': 2, '04': 1 });
  assert.deepEqual(histogram, [2, 2, 3, 3, 3, 5, 3, 3, 3]);
});

function firstChoice(project) {
  return [project, ...order.filter(value => value !== project)];
}

test('expansion at six first votes can fill six seats while retaining all minimums', () => {
  const { solve } = require('./solver');
  const ballots = ballotsFor(i => firstChoice(i < 6 ? 1 : 2));
  const { assignment } = solve({ ballots, expanded: [1] });
  const sizes = order.map(project => Object.values(assignment).filter(value => value === project).length);
  assert.equal(sizes[0], 6);
  assert.ok(sizes.slice(1).every(size => size >= 2 && size <= 3));
});

test('rejects approval below six first votes', () => {
  const { solve } = require('./solver');
  const ballots = ballotsFor(i => firstChoice(i < 5 ? 1 : 2));
  assert.throws(() => solve({ ballots, expanded: [1] }), /Projekt 1.*Erstwünsche/);
});

test('rejects an impossible minimum even when each lock is locally within capacity', () => {
  const { solve } = require('./solver');
  const ballots = ballotsFor(i => firstChoice(Math.min(3, Math.floor(i / 6) + 1)));
  const locked = Object.fromEntries(ballots.slice(0, 18).map(({ id, ranks }) => [id, ranks[0]]));
  assert.throws(() => solve({ ballots, locked, expanded: [1, 2, 3] }), /mindestens 2/);
});

test('prefers fewer seats above base capacity on an exact rank tie', () => {
  const { solve } = require('./solver');
  const top = (a, b) => [a, b, ...order.filter(p => p !== a && p !== b)];
  const ballots = ballotsFor(i => i === 0 ? top(3, 2) : i === 1 ? top(3, 1) : i === 2 ? top(3, 4) : order);
  const fixedProjects = [1, 1, 1, 2, 2, 3, ...order.slice(3).flatMap(p => [p, p, p])];
  const locked = Object.fromEntries(ballots.slice(3).map(({ id }, i) => [id, fixedProjects[i]]));
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { assignment } = solve({ ballots, locked, expanded: [1], seed });
    assert.equal(assignment['01'], 2);
    assert.equal(assignment['02'], 3);
    assert.equal(assignment['03'], 3);
  }
});

test('a seed resolves equivalent assignments independently of ballot arrival order', () => {
  const { solve } = require('./solver');
  const ballots = ballotsFor();
  const before = JSON.stringify(ballots);
  const initial = solve({ ballots, seed: 1 });
  assert.deepEqual(solve({ ballots }), initial);
  assert.deepEqual(solve({ ballots: ballots.slice().reverse(), seed: 1 }), initial);
  const alternate = solve({ ballots, seed: 2 });
  assert.notDeepEqual(alternate.assignment, initial.assignment);
  assert.deepEqual(alternate.histogram, initial.histogram);
  assert.equal(JSON.stringify(ballots), before);
});

test('publishes the API when loaded as a browser classic script', () => {
  const { readFileSync } = require('node:fs');
  const { runInNewContext } = require('node:vm');
  const window = {};
  runInNewContext(readFileSync(require.resolve('./solver'), 'utf8'), { window });
  const ballots = ballotsFor();
  assert.equal(window.ProjectSolver.validateBallot(ballots[0]), true);
  assert.equal(JSON.stringify(window.ProjectSolver.solve({ ballots })), JSON.stringify(require('./solver').solve({ ballots })));
});

test('rejects incomplete, duplicate or invalid ballots with German errors', () => {
  const { solve } = require('./solver');
  const ballots = ballotsFor();
  assert.throws(() => solve(null), /Ungültige Eingabe/);
  assert.throws(() => solve({ ballots: ballots.slice(1) }), /genau 27 Stimmzettel/);
  assert.throws(() => solve({ ballots: [ballots[1], ...ballots.slice(1)] }), /Doppelte Kennung: 02/);
  assert.throws(() => solve({ ballots: [{ id: '01', ranks: [] }, ...ballots.slice(1)] }), /Ungültiger Stimmzettel/);
});

test('rejects invalid locks, invalid expansion IDs and overfilled projects', () => {
  const { solve } = require('./solver');
  const ballots = ballotsFor();
  assert.throws(() => solve({ ballots, locked: { '28': 1 } }), /Ungültige Festlegung/);
  assert.throws(() => solve({ ballots, locked: { '01': '1' } }), /Ungültige Festlegung/);
  assert.throws(() => solve({ ballots, expanded: ['1'] }), /Ungültige Projektfreigabe/);
  assert.throws(() => solve({ ballots, seed: NaN }), /Ungültige Losnummer/);
  const lockFirst = count => Object.fromEntries(ballots.slice(0, count).map(({ id }) => [id, 1]));
  assert.throws(() => solve({ ballots, locked: lockFirst(4) }), /Projektkapazitäten/);
  assert.throws(() => solve({ ballots, locked: lockFirst(7), expanded: [1] }), /Projektkapazitäten/);
});
test('complete groups can be enabled without first votes; a B lock forces two full groups', () => {
  const { solveGrouped } = require('./solver');
  const ranks = [1,2,3,4,5,6,7,8,9];
  const ballots = Array.from({length:27},(_,i)=>({id:String(i+1).padStart(2,'0'),ranks}));
  const result=solveGrouped({ballots, expanded:[9], locked:{'01':9}, groups:{'01':'B'}});
  const counts=ranks.map(p=>Object.values(result.assignment).filter(value=>value===p).length);
  assert.equal(counts[8],6);
  assert.equal(counts.filter(n=>n===0).length,1);
  assert.ok(counts.every(n=>n%3===0));
  assert.equal(result.assignment['01'],9);
});
