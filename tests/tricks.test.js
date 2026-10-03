import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, classify, play, pass, chooseMove, getTrickTimeline, getCurrentTrick
} from '../engine.js';

let serial = 0;
const card = rank => ({ id: `trick-${serial++}`, rank, suit: rank > 14 ? 'J' : 'S' });
function fixture(ranks, level = 2) {
  return { ...createGame({ seed: 'trick-history', level }), hands: ranks.map(hand => hand.map(card)) };
}
function playRank(state, rank) {
  const selected = state.hands[state.turn].find(item => item.rank === rank);
  assert.ok(selected, `seat ${state.turn} must own rank ${rank}`);
  play(state, state.turn, [selected.id]);
}
function passTimes(state, count) { for (let i = 0; i < count; i++) pass(state, state.turn); }
function freezeTree(object) {
  if (object && typeof object === 'object' && !Object.isFrozen(object)) {
    for (const value of Object.values(object)) freezeTree(value);
    Object.freeze(object);
  }
  return object;
}
function ranksBySeat(display) { return display.plays.map(action => action?.cards.map(c => c.rank) ?? null); }

test('new games have four empty seats and a first-trick display, but no history groups', () => {
  const state = createGame({ seed: 'empty' });
  assert.deepEqual(getTrickTimeline(state), []);
  assert.deepEqual(getCurrentTrick(state), { number: 1, actions: [], plays: [null, null, null, null],
    lastActions: [null, null, null, null], winnerSeat: null, closed: false });
  assert.deepEqual(getCurrentTrick(null), getCurrentTrick(state));
});

test('all four plays remain visible while later passes add badges without erasing cards', () => {
  const state = fixture([[3, 7, 11, 14], [4, 8, 12, 14], [5, 9, 13, 14], [6, 10, 13, 14]]);
  for (const rank of [3, 4, 5, 6, 7]) playRank(state, rank);
  passTimes(state, 2);
  const display = getCurrentTrick(state);
  assert.deepEqual(ranksBySeat(display), [[7], [4], [5], [6]]);
  assert.deepEqual(display.lastActions.map(action => action?.type), ['play', 'pass', 'pass', 'play']);
  assert.equal(display.winnerSeat, 0);
  assert.equal(display.plays[0].number, 5, 'replaces a seat’s earlier play only when it plays again');
  assert.equal(display.actions.length, 7);
  assert.equal(display.closed, false);
  assert.equal(getTrickTimeline(state).length, 1);
  playRank(state, 10);
  pass(state, 0);
  assert.equal(getCurrentTrick(state).winnerSeat, 3, 'highlight follows the actual current winning play');
  assert.deepEqual(getCurrentTrick(state).plays[0].cards.map(c => c.rank), [7]);
  assert.equal(getCurrentTrick(state).lastActions[0].type, 'pass');
});

test('a player can pass, later overcall, and replace its pass badge within the same trick', () => {
  const state = fixture([[3, 11], [4, 12], [5, 13], [6, 14]]);
  playRank(state, 3); pass(state, 1); playRank(state, 5); pass(state, 3); pass(state, 0);
  assert.equal(getCurrentTrick(state).lastActions[1].type, 'pass');
  assert.equal(getCurrentTrick(state).plays[1], null);
  playRank(state, 12);
  assert.equal(getCurrentTrick(state).lastActions[1].type, 'play');
  assert.deepEqual(ranksBySeat(getCurrentTrick(state)), [[3], [12], [5], null]);
  assert.equal(getCurrentTrick(state).number, 1);
});

test('three complete tricks are independently grouped, and closing immediately clears the table', () => {
  const state = fixture([[3, 4, 5, 6], [7, 11], [8, 12], [9, 13]]);
  const snapshots = [];
  for (const rank of [3, 4, 5]) {
    playRank(state, rank); passTimes(state, 3);
    snapshots.push(JSON.parse(JSON.stringify(state)));
    const current = getCurrentTrick(state);
    assert.equal(current.number, snapshots.length + 1);
    assert.deepEqual(current.plays, [null, null, null, null]);
    assert.deepEqual(current.lastActions, [null, null, null, null]);
    assert.equal(current.winnerSeat, null);
    assert.deepEqual(current.actions, []);
    assert.equal(current.closed, false);
  }
  const timeline = getTrickTimeline(state);
  assert.deepEqual(timeline.map(trick => trick.number), [1, 2, 3]);
  assert.deepEqual(timeline.map(trick => trick.closed), [true, true, true]);
  assert.deepEqual(timeline.map(trick => trick.winnerSeat), [0, 0, 0]);
  assert.deepEqual(timeline.map(trick => trick.actions.length), [4, 4, 4]);
  assert.deepEqual(timeline.map(trick => trick.plays[0].cards[0].rank), [3, 4, 5]);
  for (let i = 0; i < snapshots.length; i++) {
    assert.deepEqual(getTrickTimeline(snapshots[i]), timeline.slice(0, i + 1));
    assert.equal(getCurrentTrick(snapshots[i]).number, i + 2);
  }
});

test('a finished winner closes after all remaining players pass and partner lead starts empty', () => {
  const state = fixture([[14], [3, 4], [5, 6], [7, 8]], 10);
  playRank(state, 14); passTimes(state, 2);
  assert.equal(getCurrentTrick(state).winnerSeat, 0);
  assert.equal(getTrickTimeline(state)[0].closed, false);
  passTimes(state, 1);
  assert.equal(state.turn, 2);
  assert.equal(getCurrentTrick(state).number, 2);
  assert.deepEqual(getCurrentTrick(state).plays, [null, null, null, null]);
  const first = getTrickTimeline(state)[0];
  assert.equal(first.closed, true);
  assert.equal(first.winnerSeat, 0);
  assert.equal(first.actions.at(-1).nextSeat, 2);
  assert.equal(first.actions.at(-1).partnerLead, true);
  playRank(state, 5);
  const current = getCurrentTrick(state);
  assert.equal(current.number, 2);
  assert.deepEqual(ranksBySeat(current), [null, null, [5], null]);
});

test('finished seats reduce pass count only after their historical finishing action', () => {
  const state = fixture([[3, 4], [7, 10, 11], [8, 12, 13], [9, 14, 16]], 6);
  playRank(state, 3); passTimes(state, 3);
  playRank(state, 4); playRank(state, 10); passTimes(state, 2);
  assert.deepEqual(state.finished, [0]);
  const timeline = getTrickTimeline(state);
  assert.equal(timeline.length, 2);
  assert.deepEqual(timeline.map(trick => trick.actions.length), [4, 4]);
  assert.deepEqual(timeline.map(trick => trick.winnerSeat), [0, 1]);
  assert.deepEqual(timeline.map(trick => trick.closed), [true, true]);
  assert.equal(getCurrentTrick(state).number, 3);
});

test('round-ending plays stay visible even though no final pass or trickClosed marker exists', () => {
  const state = fixture([[3], [4, 5], [6], [7, 8]]);
  playRank(state, 3); pass(state, 1); playRank(state, 6);
  assert.ok(state.result);
  const display = getCurrentTrick(state);
  assert.equal(display.winnerSeat, 2);
  assert.deepEqual(ranksBySeat(display), [[3], null, [6], null]);
  assert.equal(display.lastActions[1].type, 'pass');
  assert.equal(display.closed, false);
  assert.equal(getTrickTimeline(state).length, 1);
  assert.equal(getTrickTimeline(state)[0].actions.length, 3);
});

test('JSON-reloaded version-1 saves and legacy histories without closure/finish tags reconstruct identically', () => {
  const state = fixture([[3, 4], [7, 10, 11], [8, 12, 13], [9, 14, 16]], 6);
  playRank(state, 3); passTimes(state, 3);
  playRank(state, 4); playRank(state, 10); passTimes(state, 2);
  playRank(state, 7); passTimes(state, 1);
  const reloaded = JSON.parse(JSON.stringify(state));
  assert.equal(reloaded.version, 1);
  assert.deepEqual(getTrickTimeline(reloaded), getTrickTimeline(state));
  assert.deepEqual(getCurrentTrick(reloaded), getCurrentTrick(state));
  delete reloaded.lastTrick;
  for (const action of reloaded.history) {
    delete action.trickClosed; delete action.finish; delete action.nextSeat; delete action.partnerLead;
  }
  const summarize = value => value.map(trick => ({ number: trick.number, closed: trick.closed,
    winnerSeat: trick.winnerSeat, ranks: ranksBySeat(trick), actionNumbers: trick.actions.map(a => a.number) }));
  assert.deepEqual(summarize(getTrickTimeline(reloaded)), summarize(getTrickTimeline(state)));
  assert.deepEqual(ranksBySeat(getCurrentTrick(reloaded)), ranksBySeat(getCurrentTrick(state)));
});

test('minimal old snapshots preserve available table cards and pass status without invented history', () => {
  const cards = [card(8)], combo = classify(cards, 2);
  const state = { version: 1, trick: { seat: 1, cards, combo },
    lastAction: { type: 'pass', seat: 2, cards: [], number: 9 } };
  assert.deepEqual(getTrickTimeline(state), []);
  const current = getCurrentTrick(state);
  assert.deepEqual(ranksBySeat(current), [null, [8], null, null]);
  assert.equal(current.winnerSeat, 1);
  assert.equal(current.lastActions[1].type, 'play');
  assert.equal(current.lastActions[2].type, 'pass');
  assert.deepEqual(current.actions, [], 'does not fabricate an action sequence');
});

test('helpers are read-only and prior timeline results do not gain later actions', () => {
  const state = fixture([[3, 11], [4, 12], [5, 13], [6, 14]]);
  playRank(state, 3);
  const previous = getTrickTimeline(state);
  playRank(state, 4);
  assert.equal(previous[0].actions.length, 1);
  assert.equal(previous[0].plays[1], null);
  const frozen = freezeTree(JSON.parse(JSON.stringify(state))), before = JSON.stringify(frozen);
  assert.doesNotThrow(() => getTrickTimeline(frozen));
  assert.doesNotThrow(() => getCurrentTrick(frozen));
  assert.equal(JSON.stringify(frozen), before);
  assert.notEqual(getCurrentTrick(frozen).plays, getCurrentTrick(frozen).plays);
});

test('every snapshot in seeded full games agrees with an incremental four-seat oracle', () => {
  for (let seed = 0; seed < 8; seed++) {
    const state = createGame({ seed: `timeline-${seed}`, level: seed + 2 });
    let number = 1, plays = [null, null, null, null], lastActions = [null, null, null, null];
    const closed = [];
    let actions = [];
    while (!state.result) {
      const move = chooseMove(state);
      if (move) play(state, state.turn, move.ids, move.combo);
      else pass(state, state.turn);
      const action = state.lastAction;
      actions.push(action); lastActions[action.seat] = action;
      if (action.type === 'play') plays[action.seat] = action;
      if (action.trickClosed) {
        closed.push({ number, actions, plays, lastActions,
          winnerSeat: state.lastTrick.seat, closed: true });
        number++; actions = []; plays = [null, null, null, null]; lastActions = [null, null, null, null];
      }
      const expected = { number, actions, plays, lastActions, winnerSeat: state.trick?.seat ?? null, closed: false };
      const snapshot = JSON.parse(JSON.stringify(state));
      assert.deepEqual(getCurrentTrick(snapshot), expected, `seed ${seed}, move ${state.moveNumber}`);
      assert.deepEqual(getTrickTimeline(snapshot), actions.length ? [...closed, expected] : closed);
      assert.ok(state.moveNumber < 1000);
    }
  }
});
