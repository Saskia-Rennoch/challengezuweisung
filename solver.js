(function () {
  'use strict';

  const PROJECT_COUNT = 9;
  const BALLOT_COUNT = 27;
  const validId = /^(?:0[1-9]|1[0-9]|2[0-7])$/;
  const isProject = value => Number.isInteger(value) && value >= 1 && value <= PROJECT_COUNT;

  function validateBallot(ballot) {
    if (!ballot || typeof ballot.id !== 'string' || !validId.test(ballot.id) ||
        !Array.isArray(ballot.ranks) || ballot.ranks.length !== PROJECT_COUNT) return false;
    const seen = new Set();
    for (const project of ballot.ranks) {
      if (!isProject(project) || seen.has(project)) return false;
      seen.add(project);
    }
    return true;
  }

  const MIN_SIZE = 2;
  const BASE_SIZE = 3;
  const EXPANDED_SIZE = 6;
  const RADIX = BALLOT_COUNT + 1;
  // One base-28 digit per rank, with the units digit reserved for extra seats.
  // All 27 lower-priority costs combined are below one higher-priority unit.
  const RANK_COST = Array.from({ length: PROJECT_COUNT }, (_, i) => i === 0 ? 0 : RADIX ** i);
  const OPTIONAL_SEAT_COST = RADIX ** PROJECT_COUNT;

  function solve(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('Ungültige Eingabe für die Zuteilung.');
    }
    const { ballots, locked = {}, expanded = [], seed = 1, exactGroups } = options;
    if (!Number.isSafeInteger(seed)) throw new Error('Ungültige Losnummer: Eine ganze Zahl wird benötigt.');
    if (!Array.isArray(ballots) || ballots.length !== BALLOT_COUNT) {
      throw new Error('Es werden genau 27 Stimmzettel benötigt.');
    }
    const ids = new Set();
    const firstVotes = Array(PROJECT_COUNT + 1).fill(0);
    for (const ballot of ballots) {
      if (!validateBallot(ballot)) throw new Error('Ungültiger Stimmzettel.');
      if (ids.has(ballot.id)) throw new Error(`Doppelte Kennung: ${ballot.id}.`);
      ids.add(ballot.id);
      firstVotes[ballot.ranks[0]]++;
    }
    if (!locked || typeof locked !== 'object' || Array.isArray(locked)) {
      throw new Error('Ungültige Festlegungen.');
    }
    const fixed = new Map(Object.entries(locked));
    for (const [id, project] of fixed) {
      if (!ids.has(id) || !isProject(project)) throw new Error(`Ungültige Festlegung für Kennung ${id}.`);
    }

    if (!Array.isArray(expanded)) throw new Error('Ungültige Projektfreigaben.');
    const approved = new Set();
    for (const project of expanded) {
      if (!isProject(project)) throw new Error('Ungültige Projektfreigabe.');
      if (firstVotes[project] < EXPANDED_SIZE) {
        throw new Error(`Projekt ${project} benötigt mindestens ${EXPANDED_SIZE} Erstwünsche für eine zweite Gruppe.`);
      }
      approved.add(project);
    }
    const slots = [];
    for (let project = 1; project <= PROJECT_COUNT; project++) {
      const capacity = exactGroups ? BASE_SIZE * exactGroups[project - 1] : approved.has(project) ? EXPANDED_SIZE : BASE_SIZE;
      for (let seat = 0; seat < capacity; seat++) {
        const cost = (seat < MIN_SIZE ? 0 : OPTIONAL_SEAT_COST) + (seat < BASE_SIZE ? 0 : 1);
        slots.push({ project, seat, cost });
      }
    }
    const rows = ballots.slice().sort((a, b) => Number(a.id) - Number(b.id));
    // Only traversal order changes; all optimization costs remain exact.
    const random = seededRandom(seed);
    shuffle(rows, random);
    shuffle(slots, random);
    const costs = rows.map(({ id, ranks }) => {
      const rankCosts = [];
      ranks.forEach((project, i) => { rankCosts[project] = RANK_COST[i]; });
      return slots.map(({ project, cost }) => fixed.has(id) && fixed.get(id) !== project
        ? Infinity : rankCosts[project] + cost);
    });
    const matching = minimumMatching(costs);
    // With a fixed number of students, minimizing optional seats fills the
    // mandatory seats first. A deficit in the optimum is therefore infeasible.
    if (!exactGroups && matching.filter(index => slots[index].seat < MIN_SIZE).length !== PROJECT_COUNT * MIN_SIZE) {
      throw new Error(`Keine zulässige Zuteilung möglich: Jedes Projekt benötigt mindestens ${MIN_SIZE} Personen.`);
    }
    const assignment = {};
    const histogram = Array(PROJECT_COUNT).fill(0); // index 0 counts first choices
    rows.forEach(({ id, ranks }, i) => {
      const { project } = slots[matching[i]];
      assignment[id] = project;
      histogram[ranks.indexOf(project)]++;
    });
    return { assignment, histogram };
  }

  function groupBounds(locked = {}, groups = {}, expanded = []) {
    const a = Array(PROJECT_COUNT).fill(0), b = a.slice();
    for (const [id, project] of Object.entries(locked)) {
      if (!isProject(project)) throw new Error('Ungültiges Projekt.');
      const g = groups[id] ?? 'A';
      if (g !== 'A' && g !== 'B') throw new Error('Ungültige Gruppe.');
      (g === 'B' ? b : a)[project - 1]++;
    }
    const bounds = a.map((n,i) => [b[i] ? 2 : n ? 1 : 0, expanded.includes(i + 1) ? 2 : 1]);
    if (bounds.some(([lo,hi],i) => lo > hi || a[i] > BASE_SIZE || b[i] > BASE_SIZE)) {
      throw new Error('Diese Gruppe ist nicht freigegeben oder hat bereits drei Personen.');
    }
    if (bounds.reduce((sum,[lo])=>sum+lo,0) > BALLOT_COUNT / BASE_SIZE) {
      throw new Error('Diese Festlegung würde mehr als neun volle Dreiergruppen erfordern.');
    }
    return bounds;
  }

  function solveGrouped({ ballots, locked = {}, groups = {}, expanded = [], seed = 1 }) {
    const bounds = groupBounds(locked, groups, expanded);
    const profile = Array(PROJECT_COUNT).fill(0);
    let best, bestDoubles;
    function visit(i, left, doubles) {
      if (i === PROJECT_COUNT) {
        if (left !== 0) return;
        const next = solve({ ballots, locked, seed, exactGroups:profile });
        let k=PROJECT_COUNT-1;
        if(best)while(k>=0&&next.histogram[k]===best.histogram[k])k--;
        if(!best||(k<0?doubles<bestDoubles:next.histogram[k]<best.histogram[k])){
          best=next;bestDoubles=doubles;
        }
        return;
      }
      const [min,max]=bounds[i], remaining=bounds.slice(i+1);
      const minimum=remaining.reduce((s,[lo])=>s+lo,0), maximum=remaining.reduce((s,[,hi])=>s+hi,0);
      for(let n=Math.max(min,left-maximum);n<=Math.min(max,left-minimum);n++){
        profile[i]=n;visit(i+1,left-n,doubles+(n===2?1:0));
      }
    }
    visit(0,BALLOT_COUNT/BASE_SIZE,0);
    return best;
  }

  function seededRandom(seed) {
    // Mulberry32, with an explicit unsigned 32-bit state.
    let state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      let n = Math.imul(state ^ (state >>> 15), state | 1);
      n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
      return ((n ^ (n >>> 14)) >>> 0) / 0x100000000;
    };
  }

  function shuffle(items, random) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }

  // Rectangular Hungarian algorithm. Forbidden edges have infinite cost.
  function minimumMatching(costs) {
    const rowCount = costs.length;
    const columnCount = costs[0].length;
    const u = Array(rowCount + 1).fill(0);
    const v = Array(columnCount + 1).fill(0);
    const owner = Array(columnCount + 1).fill(0);
    const previous = Array(columnCount + 1).fill(0);

    for (let row = 1; row <= rowCount; row++) {
      owner[0] = row;
      let column = 0;
      const distance = Array(columnCount + 1).fill(Infinity);
      const seen = Array(columnCount + 1).fill(false);
      do {
        seen[column] = true;
        const activeRow = owner[column];
        let delta = Infinity;
        let next = 0;
        for (let j = 1; j <= columnCount; j++) {
          if (seen[j]) continue;
          const reduced = costs[activeRow - 1][j - 1] - u[activeRow] - v[j];
          if (reduced < distance[j]) {
            distance[j] = reduced;
            previous[j] = column;
          }
          if (distance[j] < delta) {
            delta = distance[j];
            next = j;
          }
        }
        if (delta === Infinity) throw new Error('Keine zulässige Zuteilung möglich: Projektkapazitäten überschritten.');
        for (let j = 0; j <= columnCount; j++) {
          if (seen[j]) {
            u[owner[j]] += delta;
            v[j] -= delta;
          } else {
            distance[j] -= delta;
          }
        }
        column = next;
      } while (owner[column] !== 0);

      do {
        const next = previous[column];
        owner[column] = owner[next];
        column = next;
      } while (column !== 0);
    }

    const matching = Array(rowCount);
    for (let j = 1; j <= columnCount; j++) {
      if (owner[j]) matching[owner[j] - 1] = j - 1;
    }
    return matching;
  }

  const api = { solve, validateBallot, solveGrouped, groupBounds };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ProjectSolver = api;
}());
