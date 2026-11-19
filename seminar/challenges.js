(function (factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else window.ChallengeCatalog = factory();
})(function () {
  'use strict';

  const challenges = Object.freeze([
    [1, 'Wie wählt Wiesbaden?', 2, 3],
    [2, 'Ab aufs Rad, aber sicher!', 2, 3],
    [3, 'Wiesbaden - Stadt der kurzen Wege?', 2, 3],
    [4, 'Open Data "Health Check"', 2, 3],
    [5, 'Die Stadt von gestern', 3, 4],
    [6, 'Wie elektrisch ist Wiesbaden unterwegs?', 2, 3],
    [7, 'Zusammen verschieden', 2, 3],
    [8, 'Flächencheck im Zeitvergleich', 2, 3],
    [9, 'Ferien auf Knopfdruck', 2, 3],
    [10, 'Finanzen aufgedeckt', 3, 4],
  ].map(([id, title, min, max]) => Object.freeze({ id, title, min, max })));
  const ids = new Set(challenges.map(({ id }) => id));
  const MAX_BALLOTS = 27;

  function validateRanks(ranks) {
    if (!Array.isArray(ranks) || ranks.length !== ids.size) return false;
    const seen = new Set(ranks);
    return seen.size === ids.size && [...seen].every(id => ids.has(id));
  }

  return { challenges, validateRanks, MAX_BALLOTS };
});
