# Original Guandan engine

`engine.js` is an original, dependency-free ES module. No game code, assets, AI
models, or packages were copied from a third-party game.

## API

```js
import { createGame, chooseMove, play, pass, nextRound } from './engine.js';
const state = createGame({ level: 2, difficulty: 'normal', seed: 'optional' });
const move = chooseMove(state, state.turn);
if (move) play(state, state.turn, move.ids, move.combo);
else pass(state, state.turn);
if (state.result) {
  const next = nextRound(state);
}
```

- Cards: `{id, rank, suit, pack}`. Ranks 2–14 are 2–A; 15/16 are small/big
  jokers. Suits are S/H/C/D/J. Every physical card has a unique id.
- Teams are 0+2 and 1+3. Play advances 0→1→2→3, skipping finished hands.
- `createGame({level, difficulty, seed, dealer, teamLevels})` deals 27 cards each.
  Defaults: level 2, normal difficulty, first seat 0, both team levels equal to
  the selected level. A seed yields a repeatable deal.
- `play(state, seat, ids, optionalDeclaration)` and `pass(state, seat)` mutate
  and return state. Invalid actions throw before modifying it.
- `classify(cards, level, optionalTarget)` returns a combination or null.
  With a target it chooses the cheapest winning declaration; without one it
  chooses the strongest. `classifyAll` returns all possible declarations.
- `canBeat(combo, target)` checks a strict overcall. Passing is not a move.
- `getLegalMoves(state, seat)` returns `{ids, cards, combo}[]` for the current
  seat. It covers all playable combination types/strengths and wildcard
  allocations, with representative physical-card arrangements rather than
  exponentially enumerating equivalent copies. Players may submit any legal
  card selection, including ones outside the hint list.
- `chooseMove(state, seat)` returns a legal move or null to pass. It only uses
  its own cards and other players' public hand sizes; it does not inspect
  opponents' or its partner's cards. It is a heuristic AI, not a trained model.
- Helpers: `sortHand`, `cardLabel`, `rankLabel`, `comboLabel`, `isWild`,
  `rankStrength`, `createDeck`, `shuffle`, `seededRandom`.
- Combination fields: `type`, `rank`, `key`, `size`, `bomb`, `bombTier`, `label`,
  `wildAssignments`, `wildUsed`; some also have `sequence`, `suit`, `pairRank`.
- Core state: `hands`, `turn`, `trick`, `finished`, `result`, `level`,
  `teamLevels`, `difficulty`, `passes`, `history`, `lastAction`, `lastTrick`.
  The full state is JSON-serializable for offline resume.
- `result` reports `winnerTeam`, `order`, `upgrade`, `nextLevel`, `teamLevels`,
  `matchWon`, `doubleDown`, `tiedLast`. In a double-down, the opponents' exact
  individual order is unresolved; `tiedLast` explicitly identifies them.
- `lastAction` includes `type`, `seat`, `cards`, and where applicable `combo`,
  `finish`, `place`, `trickClosed`, `partnerLead`, and `nextSeat`.

## Casual rules profile

Two decks, 108 cards. Hearts of the current level are wild in combinations,
but cannot impersonate a joker; when played singly they remain level cards.
Ordinary plays are singles, pairs, triples, full houses, five-card straights,
three consecutive pairs, and two consecutive triples. Ace can be low or high
in a run, without wrap-around. Level cards occupy their natural rank in runs.

Bomb order is four-card bomb < five-card bomb < straight flush < six-or-more
bomb < four jokers. Larger equal-size bombs compare rank. Wildcards allow
nine- and ten-card bombs. Four jokers always win.

Other active players passing ends the trick; if its winner has finished,
their partner gets the free lead (接风). A prior pass does not prevent a later
overcall. First+second/third/fourth gives that team +3/+2/+1 levels. A must be
played; at A, first+second or first+third completes the match. There is no
tribute/return-tribute exchange or repeated-A penalty in this quick casual
edition. This profile is not advertised as a complete tournament ruleset.

Rules were cross-checked against these primary institutional publications:

- Southeast University: [two-deck rules PDF](https://xxgk.seu.edu.cn/_upload/article/files/44/c8/f455e1d04d2a998e40454931740a/4f853bb4-29b9-45dc-9c56-7627ed4c9726.pdf)
- Nanjing Sport Institute: [event and rules](https://www.nsi.edu.cn/ntzqxy/b3/a0/c3045a45984/page.htm)

## Verification

Run `node --test tests/engine.test.js` in this directory. Tests cover each
pattern, bomb ordering, edge runs, wildcard ambiguity, forbidden joker
substitution, an independent exhaustive wildcard oracle, brute-force move
coverage, invalid-command atomicity, passing/接风, upgrades, A clearing,
AI hidden-hand independence, and 250 complete reproducible games with
card-conservation and termination assertions.
