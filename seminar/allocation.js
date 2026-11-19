(function (factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./challenges'));
  else window.ChallengeAllocation = factory(window.ChallengeCatalog);
})(function (catalog) {
  'use strict';

  const { challenges, validateRanks, MAX_BALLOTS } = catalog;
  const MIN_SIZE = 2;
  const MAX_SIZE = 4;
  const projectIds = new Set(challenges.map(({ id }) => id));
  const byProject = new Map(challenges.map(c => [c.id,c]));
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

  function lockLayout({ locked = {}, groups = {}, expanded = [], sizes = {} } = {}) {
    if (![locked, groups, sizes].every(record) || !Array.isArray(expanded) ||
        !expanded.every(project => projectIds.has(project))) {
      throw new Error('Ungültige Einstellungen für die Zuteilung.');
    }
    for (const [project, limits] of Object.entries(sizes)) {
      const range = byProject.get(Number(project));
      if (!projectIds.has(Number(project)) || String(Number(project)) !== project || !record(limits) ||
          Object.entries(limits).some(([group, cap]) => !['A', 'B'].includes(group) || !Number.isInteger(cap) || cap<1 || cap>range.max)) {
        throw new Error(`Ungültige Gruppengröße für Projekt ${project}.`);
      }
    }
    const enabled = new Set(expanded);
    const slots = [];
    const indexes = new Map();
    for (const { id, min, max } of challenges) {
      for (const group of enabled.has(id) ? ['A', 'B'] : ['A']) {
        indexes.set(`${id}${group}`, slots.length);
        const cap = own(sizes, id) && own(sizes[id], group) ? sizes[id][group] : max;
        slots.push({ project: id, group, min, max, cap });
      }
    }
    const fixed = new Map();
    const loads = slots.map(() => 0);
    for (const [id, project] of Object.entries(locked)) {
      const group = own(groups, id) ? groups[id] : 'A';
      if (!projectIds.has(project) || !['A', 'B'].includes(group)) {
        throw new Error(`Ungültige Festlegung für ${id}.`);
      }
      const index = indexes.get(`${project}${group}`);
      if (index === undefined) throw new Error(`Gruppe ${project}${group} ist nicht freigegeben.`);
      if (++loads[index] > slots[index].cap) throw new Error(`Gruppe ${project}${group} ist bereits voll.`);
      fixed.set(id, index);
    }
    return { slots, fixed, loads };
  }

  function checkLocks(options) {
    lockLayout(options);
  }

  function sizeCost({ group, min }, n) {
    return n === 0 ? 0 : Number(group === 'B') + Math.max(0,min-n);
  }

  // With four places at most, these are all configurations of intact teams
  // that can fit in one group: none, one of size 2/3/4, or two pairs.
  const packings = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [2, 0, 0]];

  // Exact feasibility and best size penalty, independent of rankings. Tracking
  // counts by team size, not identities, avoids enumerating assignments.
  function completionCost(slots, loads, seats, { 2: pairs = 0, 3: triples = 0, 4: quads = 0 } = {}) {
    const singles = seats - 2 * pairs - 3 * triples - 4 * quads;
    if (singles < 0) return Infinity;
    const choices = slots.map((slot, i) => {
      const options = [];
      for (let n = loads[i]; n <= slot.cap; n++) {

        const added = n - loads[i];
        for (const [p, t, q] of packings) {
          const s = added - 2 * p - 3 * t - 4 * q;
          if (s >= 0 && s <= singles && p <= pairs && t <= triples && q <= quads) {
            options.push({ s, p, t, q, cost: sizeCost(slot, n) });
          }
        }
      }
      return options;
    });
    const memo = slots.map(() => new Map());
    function visit(i, singles, pairs, triples, quads) {
      if (i === slots.length) return singles + pairs + triples + quads === 0 ? 0 : Infinity;
      // Each count is <= MAX_BALLOTS. Use disjoint digits for the memo key.
      const base = MAX_BALLOTS + 1;
      const key = ((singles * base + pairs) * base + triples) * base + quads;
      if (memo[i].has(key)) return memo[i].get(key);
      let best = Infinity;
      for (const { s, p, t, q, cost } of choices[i]) {
        if (s <= singles && p <= pairs && t <= triples && q <= quads) {
          best = Math.min(best, cost + visit(i + 1, singles - s, pairs - p, triples - t, quads - q));
          if (best === 0) break;
        }
      }
      memo[i].set(key, best);
      return best;
    }
    return visit(0, singles, pairs, triples, quads);
  }

  function namedTeams(rows) {
    const byName = new Map();
    for (const row of rows) {
      const name = typeof row.team === 'string' ? row.team.trim() : '';
      if (!name) continue;
      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, { name, members: [] });
      byName.get(key).members.push(row);
    }
    return [...byName.values()].filter(({ members }) => members.length >= MIN_SIZE);
  }

  function teamWarnings(teams, placed) {
    return teams.filter(({ members }) => {
      const index = placed.get(members[0].id);
      return index === undefined || members.some(({ id }) => placed.get(id) !== index);
    }).map(({ name }) => `Team „${name}“ konnte nicht vollständig zusammen eingeteilt werden.`);
  }

  function solve(options = {}) {
    const { ballots } = options;
    if (!Array.isArray(ballots) || ballots.length > MAX_BALLOTS) throw new Error('Ungültige Anzahl Stimmzettel.');
    const { slots, fixed, loads } = lockLayout(options);
    const ids = new Set();
    const rows = Array.from(ballots, ballot => {
      if (!ballot || (typeof ballot.id !== 'string' && !Number.isSafeInteger(ballot.id)) ||
          ballot.id === '' || !validateRanks(ballot.ranks)) throw new Error('Ungültiger Stimmzettel.');
      const id = String(ballot.id);
      if (ids.has(id)) throw new Error(`Doppelte Kennung: ${id}.`);
      ids.add(id);
      return { ...ballot, id };
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const id of fixed.keys()) {
      if (!ids.has(id)) throw new Error(`Festlegung ohne Stimmzettel für ${id}.`);
    }

    const warnings = [];
    const teams = namedTeams(rows);
    let seats = rows.length - fixed.size;
    while (seats >= 0 && completionCost(slots, loads, seats) === Infinity) seats--;
    if (seats < 0) {
      warnings.push('Für die festgelegten Gruppen sind noch nicht genügend Personen verfügbar.');
      return { assignment: {}, teamAssignments: {}, warnings: warnings.concat(teamWarnings(teams, new Map())) };
    }

    // Keep maximum headcount and admin locks first. Accept team constraints in
    // stable ballot-ID order, but only if the whole accepted set still fits.
    // If teams compete for scarce slots this is not a global cohesion optimum.
    const placed = new Map(fixed);
    const bundles = [];
    const bundled = new Set();
    const counts = { 2: 0, 3: 0, 4: 0 };
    function place(members, index) {
      loads[index] += members.length;
      seats -= members.length;
      for (const { id } of members) placed.set(id, index);
    }
    for (const { members } of teams) {
      const size = members.length;
      if (size > MAX_SIZE) continue;
      const anchors = new Set(members.filter(({ id }) => fixed.has(id)).map(({ id }) => fixed.get(id)));
      if (anchors.size > 1) continue;
      if (anchors.size === 1) {
        const [index] = anchors;
        const rest = members.filter(({ id }) => !fixed.has(id));
        if (loads[index] + rest.length > slots[index].cap) continue;
        loads[index] += rest.length;
        const feasible = completionCost(slots, loads, seats - rest.length, counts) !== Infinity;
        loads[index] -= rest.length;
        if (feasible) place(rest, index);
      } else {
        counts[size]++;
        if (completionCost(slots, loads, seats, counts) === Infinity) {
          counts[size]--;
        } else {
          bundles.push(members);
          for (const { id } of members) bundled.add(id);
        }
      }
    }

    // Place intact teams before singles. Each step trades this unit's rank
    // cost against the best attainable size penalty, without sacrificing
    // feasibility. This is deterministic, not a global rank/fairness optimum.
    const units = bundles.concat(rows.filter(({ id }) => !placed.has(id) && !bundled.has(id)).map(row => [row]));
    for (const members of units) {
      const size = members.length;
      if (seats < size) break;
      if (size > 1) counts[size]--;
      let index = -1;
      let best = Infinity;
      slots.forEach((slot, i) => {
        if (loads[i] + size > slot.cap) return;
        const rankCost = members.reduce((sum, row) => sum + row.ranks.indexOf(slot.project), 0);
        if (rankCost >= best) return;
        loads[i] += size;
        const score = rankCost + completionCost(slots, loads, seats - size, counts);
        loads[i] -= size;
        if (score < best) { index = i; best = score; }
      });
      if (index >= 0) place(members, index);
    }
    if (placed.size < rows.length) {
      warnings.push(`${rows.length - placed.size} Person(en) ohne Zuteilung: Gruppengrößen lassen keine vollständige Zuteilung zu.`);
    }
    warnings.push(...teamWarnings(teams, placed));
    return {
      assignment: Object.fromEntries([...placed].map(([id, i]) => [id, slots[i].project])),
      teamAssignments: Object.fromEntries([...placed].map(([id, i]) => [id, slots[i].group])),
      warnings,
    };
  }

  function pending(state) {
    return Object.entries(state.proposal??{}).filter(([id])=>!own(state.locked,id))
      .map(([id,project])=>({id,project,group:state.proposalGroups[id]}));
  }

  function confirmAll(state, entries) {
    const expected=pending(state);
    const wanted=new Map(expected.map(e=>[e.id,e]));
    if(!Array.isArray(entries)||!entries.length||entries.length!==expected.length||entries.some(e=>{
      if(!e||typeof e.id!=='string')return true;
      const match=wanted.get(e.id);wanted.delete(e.id);
      return !match||e.project!==match.project||e.group!==match.group;
    }))throw Error('Der Vorschlag hat sich geändert. Bitte Abgaben aktualisieren und erneut prüfen.');
    const locked={...state.locked},groups={...state.groups};
    for(const {id,project,group} of expected){locked[id]=project;groups[id]=group;}
    checkLocks({...state,locked,groups});
    return {locked,groups};
  }

  return { solve, checkLocks, pending, confirmAll };
});
