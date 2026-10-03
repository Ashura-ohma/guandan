import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeck, createGame, sortHand, rankStrength, isWild, cardLabel, comboLabel,
  classify, classifyAll, canBeat, getLegalMoves, chooseMove, play, pass, nextRound
} from '../engine.js';

let serial = 0;
function card(rank, suit = 'S') { return { id: `test-${serial++}`, rank, suit: rank > 14 ? 'J' : suit }; }
function cards(ranks, suits = ['S', 'H', 'C', 'D']) { return ranks.map((r, i) => card(r, suits[i % suits.length])); }
function ranks(rank, n, suit = null) { return Array.from({ length: n }, (_, i) => card(rank, suit || ['S', 'C', 'D', 'H'][i % 4])); }
function fixture(hands, turn = 0, level = 2, teamLevels = [level, level]) {
  return { ...createGame({ seed: 'fixture', level, teamLevels }), hands, turn };
}
function apply(state, ids, declaration) { return play(state, state.turn, ids, declaration); }
function ids(hand) { return hand.map(c => c.id); }
function sig(combo) { return `${combo.type}:${combo.key}:${combo.size}`; }

// Independent no-wild evaluator used for exhaustive substitution cross-checks.
function plainOracle(hand, level, originalSuit) {
  const n = hand.length, out = new Set();
  const c = new Map(); for (const item of hand) c.set(item.rank, (c.get(item.rank) || 0) + 1);
  const add = (type, key) => out.add(`${type}:${key}:${n}`);
  if (n === 1) add('single', rankStrength(hand[0].rank, level));
  if (c.size === 1) {
    const rank = hand[0].rank;
    if (n === 2) add('pair', rankStrength(rank, level));
    if (n === 3 && rank < 15) add('triple', rankStrength(rank, level));
    if (n >= 4 && rank < 15) add('bomb', rankStrength(rank, level));
  }
  if (n === 4 && c.get(15) === 2 && c.get(16) === 2) add('jokerBomb', 17);
  if (n === 5 && c.size === 2) {
    for (const [rank, count] of c) if (count === 3 && rank < 15 && [...c.values()].includes(2))
      add('fullHouse', rankStrength(rank, level));
  }
  for (const [size, count, type] of [[5, 1, 'straight'], [3, 2, 'pairRun'], [2, 3, 'tripleRun']]) {
    if (n !== size * count || c.size !== size || [...c.values()].some(v => v !== count) || [...c.keys()].some(r => r > 14)) continue;
    const values = [...c.keys()].sort((a, b) => a - b);
    const normal = values.every((v, i) => !i || v === values[i - 1] + 1);
    const low = values.includes(14) && values.filter(v => v !== 14).every((v, i) => v === i + 2);
    if (normal || low) {
      const high = low ? size : values.at(-1);
      add(type, high);
      if (type === 'straight' && (originalSuit.size <= 1)) add('straightFlush', high);
    }
  }
  return out;
}
function wildcardOracle(hand, level) {
  if (hand.length === 1) return new Set([`single:${rankStrength(hand[0].rank, level)}:1`]);
  const wildIndices = hand.map((c, i) => isWild(c, level) ? i : -1).filter(i => i >= 0);
  const fixedSuits = new Set(hand.filter(c => !isWild(c, level)).map(c => c.suit));
  const work = hand.map(c => ({ ...c })), all = new Set();
  const go = i => {
    if (i === wildIndices.length) { for (const item of plainOracle(work, level, fixedSuits)) all.add(item); return; }
    for (let r = 2; r <= 14; r++) { work[wildIndices[i]].rank = r; go(i + 1); }
  };
  go(0); return all;
}
function* subsets(hand, min = 1, max = hand.length) {
  for (let mask = 1; mask < 2 ** hand.length; mask++) {
    const chosen = hand.filter((_, i) => mask & 2 ** i);
    if (chosen.length >= min && chosen.length <= max) yield chosen;
  }
}

test('108-card deck has exactly two copies, four jokers, unique ids and reproducible shuffle', () => {
  const deck = createDeck(); assert.equal(deck.length, 108); assert.equal(new Set(ids(deck)).size, 108);
  assert.equal(deck.filter(c => c.rank > 14).length, 4);
  for (let rank = 2; rank <= 14; rank++) for (const suit of ['S', 'H', 'C', 'D'])
    assert.equal(deck.filter(c => c.rank === rank && c.suit === suit).length, 2);
  const a = createGame({ seed: 99 }), b = createGame({ seed: 99 });
  assert.deepEqual(a, b); assert.notDeepEqual(a.hands, createGame({ seed: 100 }).hands);
  assert.deepEqual(a.hands.map(h => h.length), [27, 27, 27, 27]);
  assert.equal(new Set(a.hands.flat().map(c => c.id)).size, 108);
  assert.deepEqual(createGame({ level: 7 }).teamLevels, [7, 7]);
});

test('level rank and jokers compare correctly while suits have no strength', () => {
  const level = 7;
  assert.ok(rankStrength(16, level) > rankStrength(15, level));
  assert.ok(rankStrength(15, level) > rankStrength(7, level));
  assert.ok(rankStrength(7, level) > rankStrength(14, level));
  assert.ok(rankStrength(14, level) > rankStrength(13, level));
  assert.equal(canBeat(classify([card(7, 'H')], level), classify([card(7, 'S')], level)), false);
  assert.equal(classify([card(7, 'H')], level).rank, 7);
  assert.equal(cardLabel(card(14, 'H')), '♥A');
  assert.equal(comboLabel(classify(ranks(4, 4), level)), '4张炸弹');
  assert.equal(sortHand(cards([3, 14, 7, 15, 16]), level).map(c => c.rank).join(','), '16,15,7,14,3');
});

test('recognizes every ordinary pattern and rejects invalid shapes', () => {
  const examples = [
    [[8], 'single'], [[8, 8], 'pair'], [[8, 8, 8], 'triple'], [[8, 8, 8, 4, 4], 'fullHouse'],
    [[3, 4, 5, 6, 7], 'straight'], [[3, 3, 4, 4, 5, 5], 'pairRun'], [[6, 6, 6, 7, 7, 7], 'tripleRun']
  ];
  for (const [rs, type] of examples) assert.equal(classify(cards(rs), 10)?.type, type, rs.join(','));
  for (const rs of [[3, 4], [3, 3, 4], [3, 3, 3, 4], [3, 3, 4, 4], [3, 4, 5, 6, 7, 8], [3, 3, 3, 4, 5]])
    assert.equal(classify(cards(rs), 10), null, rs.join(','));
  assert.equal(classify([], 2), null);
  const same = card(8); assert.equal(classify([same, same], 2), null);
});

test('A may be low or high in runs but K-A-2 cannot wrap', () => {
  assert.equal(classify(cards([14, 2, 3, 4, 5]), 10).key, 5);
  assert.equal(classify(cards([10, 11, 12, 13, 14]), 7).key, 14);
  assert.equal(classify(cards([14, 14, 2, 2, 3, 3]), 10).key, 3);
  assert.equal(classify(cards([14, 14, 14, 2, 2, 2]), 10).key, 2);
  assert.equal(classify(cards([13, 13, 13, 14, 14, 14]), 10).key, 14);
  assert.equal(classify(cards([12, 13, 14, 2, 3]), 10), null);
  assert.equal(classify(cards([13, 13, 14, 14, 2, 2]), 10), null);
  assert.equal(classify(cards([5, 6, 7, 8, 9]), 7).key, 9, 'level remains its natural place in a run');
});

test('wildcards substitute rank and suit, cannot become jokers, and allow ten-card bombs', () => {
  const w = () => card(7, 'H');
  assert.equal(classify([card(9), w()], 7).type, 'pair');
  assert.equal(classify([card(9), card(9, 'D'), w()], 7).type, 'triple');
  assert.equal(classify([card(15), w()], 7), null);
  assert.equal(classify([card(16), card(16), w()], 7), null);
  assert.equal(classify([w(), w()], 7).rank, 7);
  const sf = classify([...cards([3, 4, 6, 7], ['S']), w()], 7);
  assert.equal(sf.type, 'straightFlush'); assert.equal(sf.wildAssignments[0].rank, 5); assert.equal(sf.suit, 'S');
  assert.equal(classify([...ranks(9, 8), w(), w()], 7).size, 10);
  const naturalLevel = [...ranks(7, 6, 'S'), w(), w()];
  assert.equal(classify(naturalLevel, 7).rank, 7);
});

test('full house compares the triple, including natural joker pairs and ambiguous wild declarations', () => {
  const a = classify(cards([8, 8, 8, 16, 16]), 7), b = classify(cards([9, 9, 9, 3, 3]), 7);
  assert.equal(a.type, 'fullHouse'); assert.equal(canBeat(b, a), true);
  const selected = [...ranks(8, 3), card(7, 'H'), card(7, 'H')];
  assert.equal(classify(selected, 7).type, 'bomb');
  assert.ok(classifyAll(selected, 7).some(c => c.type === 'fullHouse'));
  const target = classify(cards([6, 6, 6, 4, 4]), 7);
  assert.equal(classify(selected, 7, target).type, 'fullHouse', 'response conserves a bomb declaration');
  const sameTriple = classify(cards([8, 8, 8, 3, 3]), 7);
  assert.equal(canBeat(a, sameTriple), false);
});

test('bomb hierarchy: four < five < straight flush < six…ten < four jokers', () => {
  const levels = [
    classify(ranks(14, 4), 7), classify(ranks(3, 5), 7), classify(cards([14, 2, 3, 4, 5], ['S']), 7),
    classify(ranks(3, 6), 7), classify(ranks(3, 7), 7), classify(ranks(3, 8), 7),
    classify([...ranks(3, 8), card(7, 'H')], 7), classify([...ranks(3, 8), card(7, 'H'), card(7, 'H')], 7),
    classify(cards([15, 15, 16, 16]), 7)
  ];
  for (let i = 0; i < levels.length; i++) for (let j = 0; j < levels.length; j++)
    assert.equal(canBeat(levels[i], levels[j]), i > j, `${i} vs ${j}`);
  assert.equal(canBeat(classify(ranks(7, 4), 7), classify(ranks(14, 4), 7)), true);
  assert.equal(canBeat(classify(cards([4, 5, 6, 7, 8], ['D']), 10), classify(cards([3, 4, 5, 6, 7], ['S']), 10)), true);
  assert.equal(canBeat(classify(ranks(14, 2), 7), classify([card(3)], 7)), false);
});

test('all classifiers match an independent exhaustive wildcard-substitution oracle', () => {
  for (const hand of [
    [...cards([14, 2, 3, 4, 5]), card(10, 'H'), card(10, 'H')],
    [...cards([3, 3, 4, 4, 5, 5]), card(10, 'H')],
    [...cards([8, 8, 8, 15, 15]), card(10, 'H'), card(10, 'H')],
    [...cards([3, 4, 6, 7], ['S']), card(10, 'H'), card(10, 'H')]
  ]) for (const selection of subsets(hand, 1, 6)) {
    assert.deepEqual(new Set(classifyAll(selection, 10).map(sig)), wildcardOracle(selection, 10), selection.map(cardLabel).join(' '));
  }
});

test('move generation covers every legal shape/strength found in brute-force subsets', () => {
  for (const hand of [
    [...cards([3, 3, 4, 4, 5, 5, 14]), card(10, 'H'), card(10, 'H')],
    [...cards([3, 4, 6, 7, 8], ['S']), card(10, 'H'), card(10, 'H'), card(15)],
    [...ranks(8, 5), ...ranks(15, 2), card(10, 'H')]
  ]) {
    const expected = new Set(); for (const s of subsets(hand, 1, 10)) for (const combo of classifyAll(s, 10)) expected.add(sig(combo));
    const state = fixture([hand, [card(3)], [card(4)], [card(5)]], 0, 10);
    const generated = getLegalMoves(state);
    assert.deepEqual(new Set(generated.map(m => sig(m.combo))), expected);
    for (const move of generated) assert.ok(classifyAll(move.cards, 10).some(c => sig(c) === sig(move.combo)), 'all generated moves validate');
    for (const target of generated.filter((m, i) => i % 5 === 0).map(m => m.combo)) {
      state.trick = { seat: 1, cards: [], combo: target };
      const expectedBeats = new Set([...expected].filter(s => {
        const [type, key, size] = s.split(':'); return canBeat({ type, key: +key, size: +size }, target);
      }));
      assert.deepEqual(new Set(getLegalMoves(state).map(m => sig(m.combo))), expectedBeats);
    }
  }
});

test('invalid commands are atomic and cannot pass a free lead or play another seat', () => {
  const state = fixture([cards([3, 4]), cards([5, 6]), cards([7, 8]), cards([9, 10])]);
  for (const command of [() => pass(state, 0), () => play(state, 1, ids(state.hands[1])),
    () => play(state, 0, []), () => play(state, 0, ['not-owned']), () => play(state, 0, ids(state.hands[0])),
    () => play(state, 0, [state.hands[0][0].id, state.hands[0][0].id])]) {
    const before = JSON.stringify(state); assert.throws(command); assert.equal(JSON.stringify(state), before);
  }
  play(state, 0, [state.hands[0][1].id]);
  const before = JSON.stringify(state);
  assert.throws(() => play(state, 1, [state.hands[1][0].id], { type: 'jokerBomb', key: 999, size: 4 }));
  assert.equal(JSON.stringify(state), before);
});

test('three passes restore lead, and a pass does not eliminate future responses', () => {
  const state = fixture([cards([3, 11]), cards([4, 12]), cards([5, 13]), cards([6, 14])]);
  play(state, 0, [state.hands[0][0].id]); pass(state, 1);
  play(state, 2, [state.hands[2][0].id]); pass(state, 3); pass(state, 0);
  assert.equal(state.turn, 1); play(state, 1, [state.hands[1][1].id]);
  pass(state, 2); pass(state, 3); pass(state, 0);
  assert.equal(state.turn, 1); assert.equal(state.trick, null); assert.equal(state.passes, 0);
});

test('a finished trick winner passes the next free lead to the partner (接风)', () => {
  const state = fixture([[card(14)], cards([3, 4]), cards([5, 6]), cards([7, 8])], 0, 10);
  play(state, 0, ids(state.hands[0])); assert.deepEqual(state.finished, [0]);
  pass(state, 1); pass(state, 2); assert.notEqual(state.trick, null); pass(state, 3);
  assert.equal(state.turn, 2); assert.equal(state.trick, null); assert.equal(state.lastAction.partnerLead, true);
  assert.equal(state.lastTrick.seat, 0);
});

test('only active players count toward passes after a finish, and remaining player gets free lead', () => {
  const state = fixture([[card(3)], cards([4, 10]), cards([5, 11]), cards([6, 12])], 0, 7);
  play(state, 0, ids(state.hands[0])); play(state, 1, [state.hands[1][1].id]);
  pass(state, 2); pass(state, 3);
  assert.equal(state.turn, 1); assert.equal(state.trick, null);
});

test('double-down ends immediately, gives three levels and labels unresolved opponents', () => {
  const state = fixture([[card(3)], cards([4, 5]), [card(6)], cards([7, 8])], 0, 2);
  play(state, 0, ids(state.hands[0])); pass(state, 1); play(state, 2, ids(state.hands[2]));
  assert.equal(state.result.winnerTeam, 0); assert.equal(state.result.upgrade, 3); assert.equal(state.result.nextLevel, 5);
  assert.deepEqual(state.result.tiedLast, [1, 3]); assert.equal(state.turn, null);
  assert.throws(() => pass(state, 3)); assert.deepEqual(getLegalMoves(state), []);
  const next = nextRound(state, { seed: 'next' });
  assert.equal(next.level, 5); assert.deepEqual(next.teamLevels, [5, 2]); assert.equal(next.turn, 0);
});

test('first+third earns two levels; first+fourth earns one; winner uses own stored level', () => {
  for (const order of [[0, 1, 2], [0, 1, 3], [1, 0, 3]]) {
    const state = fixture([[card(3)], [card(4)], [card(5)], [card(6)]], order[0], 7, [7, 4]);
    state.finished = order.slice(0, 2); for (const seat of state.finished) state.hands[seat] = [];
    state.turn = order[2]; play(state, state.turn, ids(state.hands[state.turn]));
    const expected = order[2] % 2 === order[0] % 2 ? 2 : 1;
    assert.equal(state.result.upgrade, expected);
    assert.equal(state.result.nextLevel, [7, 4][order[0] % 2] + expected);
  }
});

test('A cannot be skipped and requires a top-three partnership finish to clear', () => {
  const s = fixture([[card(3)], [card(4)], [card(5)], [card(6)]], 2, 13, [13, 8]);
  s.finished = [0]; s.hands[0] = []; play(s, 2, ids(s.hands[2]));
  assert.equal(s.result.nextLevel, 14); assert.equal(s.result.matchWon, false);
  for (const last of [2, 3]) {
    const a = fixture([[], [], [card(5)], [card(6)]], last, 14, [14, 10]);
    a.finished = [0, 1]; play(a, last, ids(a.hands[last]));
    assert.equal(a.result.matchWon, last === 2);
    if (a.result.matchWon) assert.deepEqual(nextRound(a).teamLevels, [2, 2]);
  }
});

test('AI never uses the contents of other hands, preserves partner lead, finishes when possible', () => {
  const a = createGame({ seed: 717, difficulty: 'hard' });
  const b = structuredClone(a); for (let i = 1; i < 4; i++) b.hands[i] = b.hands[i].map(c => ({ ...c, rank: 3, suit: 'S' }));
  assert.deepEqual(chooseMove(a), chooseMove(b));
  const state = fixture([cards([8, 9]), cards([3, 4]), cards([5, 6]), cards([7, 10])]);
  state.trick = { seat: 2, cards: [card(3)], combo: classify([card(3)], 2) };
  assert.equal(chooseMove(state), null);
  state.hands[0] = [card(14)]; assert.equal(chooseMove(state).cards.length, 1);
});

test('250 seeded AI games terminate, conserve cards, obey every response and calculate results', () => {
  for (let seed = 0; seed < 250; seed++) {
    const state = createGame({ seed, level: seed % 13 + 2, difficulty: ['easy', 'normal', 'hard'][seed % 3] });
    const played = new Set(); let actions = 0;
    while (!state.result) {
      assert.ok(++actions < 1000, `deadlock seed ${seed}`);
      const turn = state.turn, move = chooseMove(state);
      if (move) {
        assert.ok(canBeat(move.combo, state.trick?.combo), `illegal response seed ${seed}`);
        for (const id of move.ids) { assert.equal(played.has(id), false); played.add(id); }
        play(state, turn, move.ids, move.combo);
      } else { assert.ok(state.trick); pass(state, turn); }
      assert.equal(played.size + state.hands.reduce((sum, h) => sum + h.length, 0), 108);
      assert.equal(new Set([...played, ...state.hands.flat().map(c => c.id)]).size, 108);
      if (!state.result) assert.ok(state.hands[state.turn].length > 0);
    }
    assert.equal(new Set(state.result.order).size, 4);
    assert.ok(state.result.upgrade >= 1 && state.result.upgrade <= 3);
    assert.equal(state.result.winnerTeam, state.result.order[0] % 2);
  }
});
