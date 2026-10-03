/**
 * Original, dependency-free Guandan engine, MIT licensed.
 *
 * Cards: { id, rank: 2..16 (A=14, small joker=15, big joker=16),
 *          suit: 'S'|'H'|'C'|'D'|'J', pack: 0|1 }.
 * Seats 0/2 and 1/3 are partners. Turns advance 0→1→2→3.
 * All commands mutate and return the supplied JSON-serializable state.
 * Throws before mutation for invalid commands. Keep state in localStorage if desired.
 *
 * Casual rules: full 108-card rounds, heart-level wildcards, partnership 接风,
 * +3/+2/+1 advancement, A must be played and a top-two/top-three partnership
 * result clears A. No tribute/return-tribute or repeated-A penalty in this edition.
 * getLegalMoves covers every legal combination type/rank and wildcard allocation;
 * equivalent physical-card permutations are represented, not exhaustively expanded.
 * play accepts any legal physical-card selection, not only generated hints.
 */
export const SUITS = ['S', 'H', 'C', 'D'];
export const TYPES = Object.freeze({ SINGLE: 'single', PAIR: 'pair', TRIPLE: 'triple',
  FULL_HOUSE: 'fullHouse', STRAIGHT: 'straight', PAIR_RUN: 'pairRun',
  TRIPLE_RUN: 'tripleRun', BOMB: 'bomb', STRAIGHT_FLUSH: 'straightFlush', JOKER_BOMB: 'jokerBomb' });
const NAMES = { single: '单张', pair: '对子', triple: '三张', fullHouse: '三带二',
  straight: '顺子', pairRun: '三连对', tripleRun: '钢板', bomb: '炸弹',
  straightFlush: '同花顺', jokerBomb: '四王炸' };
const FACE = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '小王', 16: '大王' };
const ICONS = { S: '♠', H: '♥', C: '♣', D: '♦', J: '' };
export function rankLabel(rank) { return FACE[rank] || String(rank); }
export function cardLabel(card) { return `${ICONS[card.suit] || ''}${rankLabel(card.rank)}`; }
export function isWild(card, level) { return card.suit === 'H' && card.rank === level; }
export function rankStrength(rank, level = 2) { return rank > 14 ? rank + 1 : rank === level ? 15 : rank; }
export function comboLabel(combo) { return !combo ? '' : combo.type === 'bomb' ? `${combo.size}张炸弹` : NAMES[combo.type] || ''; }
export function sortHand(cards, level = 2) {
  return [...cards].sort((a, b) => rankStrength(b.rank, level) - rankStrength(a.rank, level)
    || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || String(a.id).localeCompare(String(b.id)));
}
export function createDeck() {
  const deck = [];
  for (let pack = 0; pack < 2; pack++) {
    for (let rank = 2; rank <= 14; rank++) for (const suit of SUITS)
      deck.push({ id: `${pack}-${suit}-${rank}`, rank, suit, pack });
    for (const rank of [15, 16]) deck.push({ id: `${pack}-J-${rank}`, rank, suit: 'J', pack });
  }
  return deck;
}
export function seededRandom(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffle(deck, random = Math.random) {
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function validLevel(level) { return Number.isInteger(level) && level >= 2 && level <= 14; }
function validCards(cards) {
  return Array.isArray(cards) && cards.length > 0 && cards.length <= 10
    && new Set(cards.map(c => c?.id)).size === cards.length
    && cards.every(c => c && c.id !== undefined && Number.isInteger(c.rank) && c.rank >= 2 && c.rank <= 16
      && (c.rank > 14 ? c.suit === 'J' : SUITS.includes(c.suit)));
}
function bombTier(type, size) {
  return type === 'jokerBomb' ? 100 : type === 'straightFlush' ? 3
    : type === 'bomb' ? size <= 5 ? size - 3 : size - 2 : 0;
}
function makeCombo(type, rank, size, level, extra = {}) {
  const sequence = ['straight', 'straightFlush', 'pairRun', 'tripleRun'].includes(type);
  const combo = { type, rank, key: sequence ? rank : rankStrength(rank, level), size,
    bomb: bombTier(type, size) > 0, bombTier: bombTier(type, size), ...extra };
  combo.label = comboLabel(combo);
  return combo;
}
/** Strictly greater; different ordinary patterns never beat one another. */
export function canBeat(combo, target) {
  if (!combo) return false;
  if (!target) return true;
  const a = bombTier(combo.type, combo.size), b = bombTier(target.type, target.size);
  if (a || b) return a !== b ? a > b : a === 100 ? false : combo.key > target.key;
  return combo.type === target.type && combo.size === target.size && combo.key > target.key;
}
function compareCombos(a, b) {
  return a.bombTier - b.bombTier || a.key - b.key || a.size - b.size || a.type.localeCompare(b.type);
}
function sequences(length) {
  const out = [];
  for (let start = 1; start <= 15 - length; start++) {
    const ranks = Array.from({ length }, (_, i) => start + i === 1 ? 14 : start + i);
    out.push({ ranks, high: start + length - 1 });
  }
  return out;
}
const RUNS = { 2: sequences(2), 3: sequences(3), 5: sequences(5) };
function matchPattern(cards, level, demands, suit) {
  const needs = new Map(demands.map(([rank, count]) => [rank, count]));
  const wilds = [];
  for (const card of cards) {
    if (isWild(card, level)) { wilds.push(card); continue; }
    if (suit && card.suit !== suit) return null;
    const n = needs.get(card.rank) || 0;
    if (n <= 0) return null;
    needs.set(card.rank, n - 1);
  }
  const missing = [];
  for (const [rank, count] of needs) {
    if (rank > 14 && count) return null;
    for (let i = 0; i < count; i++) missing.push(rank);
  }
  if (missing.length !== wilds.length) return null;
  return wilds.map((c, i) => ({ id: c.id, rank: missing[i], suit: suit || c.suit }));
}
/** Returns all possible declarations of a selection, strongest first. */
export function classifyAll(cards, level = 2) {
  if (!validLevel(level) || !validCards(cards)) return [];
  const size = cards.length, found = [];
  const add = (type, rank, demands, suit, extra = {}) => {
    const wildAssignments = matchPattern(cards, level, demands, suit);
    if (wildAssignments) found.push(makeCombo(type, rank, size, level, { ...extra, wildAssignments,
      wildUsed: wildAssignments.filter(a => a.rank !== level || a.suit !== 'H').length }));
  };
  if (size === 1) return [makeCombo('single', cards[0].rank, 1, level, { wildAssignments: [], wildUsed: 0 })];
  if (size === 4 && cards.every(c => c.rank > 14) && cards.filter(c => c.rank === 15).length === 2
      && cards.filter(c => c.rank === 16).length === 2)
    return [makeCombo('jokerBomb', 16, 4, level, { wildAssignments: [], wildUsed: 0 })];
  if (size === 2 || size === 3) for (let rank = 2; rank <= (size === 2 ? 16 : 14); rank++)
    add(size === 2 ? 'pair' : 'triple', rank, [[rank, size]]);
  if (size >= 4) for (let rank = 2; rank <= 14; rank++) add('bomb', rank, [[rank, size]]);
  if (size === 5) {
    for (let rank = 2; rank <= 14; rank++) for (let pair = 2; pair <= 16; pair++) if (pair !== rank)
      add('fullHouse', rank, [[rank, 3], [pair, 2]], null, { pairRank: pair });
    for (const run of RUNS[5]) {
      const demands = run.ranks.map(rank => [rank, 1]);
      add('straight', run.high, demands, null, { sequence: run.ranks });
      for (const suit of SUITS) add('straightFlush', run.high, demands, suit, { suit, sequence: run.ranks });
    }
  }
  if (size === 6) for (const [length, copies, type] of [[3, 2, 'pairRun'], [2, 3, 'tripleRun']])
    for (const run of RUNS[length]) add(type, run.high, run.ranks.map(rank => [rank, copies]), null, { sequence: run.ranks });
  return found.sort((a, b) => compareCombos(b, a) || a.wildUsed - b.wildUsed);
}
/** On a response, chooses the cheapest beating declaration; on lead, the strongest. */
export function classify(cards, level = 2, target = null) {
  const combos = classifyAll(cards, level);
  if (!target) return combos[0] || null;
  return combos.filter(combo => canBeat(combo, target)).sort((a, b) => compareCombos(a, b) || a.wildUsed - b.wildUsed)[0] || null;
}

/** Legal move candidates without the exponential expansion of identical card copies. */
export function getLegalMoves(state, seat = state.turn) {
  if (state.result || seat !== state.turn || !state.hands[seat]?.length) return [];
  const hand = state.hands[seat], level = state.level, target = state.trick?.combo || null;
  const wilds = hand.filter(c => isWild(c, level));
  const naturals = hand.filter(c => !isWild(c, level));
  const byRank = new Map();
  for (const c of naturals) { if (!byRank.has(c.rank)) byRank.set(c.rank, []); byRank.get(c.rank).push(c); }
  const moves = [], seen = new Set();
  const add = (cards, combo) => {
    if (!canBeat(combo, target)) return;
    const ids = cards.map(c => c.id), key = `${combo.type}:${combo.key}:${combo.pairRank || 0}:${[...ids].sort().join(',')}`;
    if (seen.has(key)) return;
    seen.add(key); moves.push({ ids, cards, combo });
  };
  const generate = (type, rank, demands, suit = null, extra = {}) => {
    const size = demands.reduce((s, [, count]) => s + count, 0);
    if (size > hand.length) return;
    const base = makeCombo(type, rank, size, level, extra);
    if (!canBeat(base, target)) return;
    const pools = demands.map(([r]) => (byRank.get(r) || []).filter(c => !suit || c.suit === suit));
    const walk = (index, usedWilds, chosen, assignments) => {
      if (index === demands.length) {
        add(chosen, { ...base, wildAssignments: assignments,
          wildUsed: assignments.filter(a => a.rank !== level || a.suit !== 'H').length }); return;
      }
      const [r, count] = demands[index], pool = pools[index];
      const maxNatural = Math.min(count, pool.length);
      const minNatural = r > 14 ? count : Math.max(0, count - (wilds.length - usedWilds));
      for (let take = maxNatural; take >= minNatural; take--) {
        const missing = count - take;
        if (missing > wilds.length - usedWilds || (r > 14 && missing)) continue;
        const selectedWilds = wilds.slice(usedWilds, usedWilds + missing);
        const newAssignments = selectedWilds.map(c => ({ id: c.id, rank: r, suit: suit || c.suit }));
        const options = [pool.slice(0, take)];
        if (take && take < pool.length) options.push(pool.slice(-take));
        for (const selected of options) walk(index + 1, usedWilds + missing,
          [...chosen, ...selected, ...selectedWilds], [...assignments, ...newAssignments]);
      }
    };
    walk(0, 0, [], []);
  };
  for (const c of hand) add([c], makeCombo('single', c.rank, 1, level, { wildAssignments: [], wildUsed: 0 }));
  for (let rank = 2; rank <= 16; rank++) {
    generate('pair', rank, [[rank, 2]]);
    if (rank <= 14) {
      generate('triple', rank, [[rank, 3]]);
      const max = Math.min(10, (byRank.get(rank)?.length || 0) + wilds.length);
      for (let count = 4; count <= max; count++) generate('bomb', rank, [[rank, count]]);
    }
  }
  if (!target || target.type === 'fullHouse')
    for (let rank = 2; rank <= 14; rank++) for (let pair = 2; pair <= 16; pair++) if (pair !== rank)
      generate('fullHouse', rank, [[rank, 3], [pair, 2]], null, { pairRank: pair });
  for (const run of RUNS[5]) {
    const demands = run.ranks.map(rank => [rank, 1]);
    if (!target || target.type === 'straight') generate('straight', run.high, demands, null, { sequence: run.ranks });
    for (const suit of SUITS) generate('straightFlush', run.high, demands, suit, { sequence: run.ranks, suit });
  }
  for (const [length, copies, type] of [[3, 2, 'pairRun'], [2, 3, 'tripleRun']])
    if (!target || target.type === type) for (const run of RUNS[length])
      generate(type, run.high, run.ranks.map(rank => [rank, copies]), null, { sequence: run.ranks });
  const jokers = hand.filter(c => c.rank > 14);
  if (jokers.length === 4) add(jokers, makeCombo('jokerBomb', 16, 4, level, { wildAssignments: [], wildUsed: 0 }));
  return moves.sort((a, b) => compareCombos(a.combo, b.combo) || a.combo.wildUsed - b.combo.wildUsed
    || a.ids.join().localeCompare(b.ids.join()));
}

export function createGame(options = {}) {
  const { level = 2, difficulty = 'normal', dealer = 0, teamLevels = [level, level], seed } = options;
  if (!validLevel(level)) throw new Error('级牌须为 2 到 A');
  if (!Array.isArray(teamLevels) || teamLevels.length !== 2 || !teamLevels.every(validLevel)) throw new Error('队伍等级无效');
  if (!Number.isInteger(dealer) || dealer < 0 || dealer > 3) throw new Error('先手座位无效');
  const deck = shuffle(createDeck(), seed === undefined ? Math.random : seededRandom(seed));
  const hands = [[], [], [], []];
  deck.forEach((card, index) => hands[index % 4].push(card));
  return { version: 1, level, teamLevels: [...teamLevels], difficulty, turn: dealer,
    hands: hands.map(hand => sortHand(hand, level)), trick: null, passes: 0, finished: [], result: null,
    history: [], lastAction: null, lastTrick: null, moveNumber: 0, seed: seed ?? null };
}
function assertTurn(state, seat) {
  if (state.result) throw new Error('本局已结束');
  if (seat !== state.turn) throw new Error('还没轮到你');
  if (!state.hands[seat]?.length) throw new Error('你已出完手牌');
}
function nextActive(state, seat) {
  for (let n = 1; n <= 4; n++) { const next = (seat + n) % 4; if (state.hands[next].length) return next; }
  return seat;
}
function record(state, action) {
  state.moveNumber = (state.moveNumber || 0) + 1;
  state.lastAction = { ...action, number: state.moveNumber };
  state.history.push(state.lastAction);
}
function finishRound(state) {
  const finished = state.finished;
  const doubleDown = finished.length >= 2 && finished[0] % 2 === finished[1] % 2;
  if (!doubleDown && finished.length < 3) return false;
  const order = [...finished, ...[0, 1, 2, 3].filter(seat => !finished.includes(seat))];
  const winnerTeam = order[0] % 2, partnerPlace = order.findIndex(seat => seat === (order[0] + 2) % 4) + 1;
  const upgrade = 5 - partnerPlace;
  const oldLevels = state.teamLevels || [2, 2], teamLevels = [...oldLevels];
  // The winner's own level advances; the next hand uses that team's new level.
  const oldLevel = oldLevels[winnerTeam];
  const matchWon = oldLevel === 14 && state.level === 14 && partnerPlace <= 3;
  teamLevels[winnerTeam] = Math.min(14, oldLevel + upgrade);
  state.result = { winnerTeam, order, finished: [...finished], doubleDown, partnerPlace, upgrade,
    previousLevel: oldLevel, nextLevel: teamLevels[winnerTeam], teamLevels, matchWon,
    // In a double-down, the two opponents have no individually resolved finishing order.
    tiedLast: doubleDown ? order.slice(2) : [] };
  state.turn = null;
  return true;
}
/** Validate a declaration against the actual cards, then apply atomically. */
export function play(state, seat, ids, declaration = null) {
  assertTurn(state, seat);
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('请先选牌');
  if (new Set(ids).size !== ids.length) throw new Error('不能重复选择同一张牌');
  const selected = ids.map(id => state.hands[seat].find(card => card.id === id));
  if (selected.some(card => !card)) throw new Error('只能出自己的手牌');
  const target = state.trick?.combo || null;
  let combo;
  if (declaration) combo = classifyAll(selected, state.level).find(c => c.type === declaration.type
    && c.key === declaration.key && c.size === declaration.size
    && (declaration.pairRank === undefined || c.pairRank === declaration.pairRank)
    && (declaration.suit === undefined || c.suit === declaration.suit) && canBeat(c, target));
  else combo = classify(selected, state.level, target);
  if (!combo) {
    if (classify(selected, state.level)) throw new Error('这手牌压不过桌面，请换牌或不出');
    throw new Error('这些牌不能组成有效牌型');
  }
  const set = new Set(ids);
  state.hands[seat] = state.hands[seat].filter(card => !set.has(card.id));
  state.trick = { seat, cards: selected, combo };
  state.passes = 0;
  const finish = state.hands[seat].length === 0;
  if (finish) state.finished.push(seat);
  record(state, { type: 'play', seat, cards: selected, combo, finish, place: finish ? state.finished.length : null });
  if (!finishRound(state)) state.turn = nextActive(state, seat);
  return state;
}
/** Passing does not bar a player from responding to a subsequent overcall. */
export function pass(state, seat) {
  assertTurn(state, seat);
  if (!state.trick) throw new Error('你是先手，必须出牌');
  if (state.trick.seat === seat) throw new Error('你已获得出牌权');
  state.passes++;
  record(state, { type: 'pass', seat, cards: [] });
  const active = state.hands.filter(hand => hand.length).length;
  const passesNeeded = active - (state.hands[state.trick.seat].length ? 1 : 0);
  if (state.passes >= passesNeeded) {
    const winner = state.trick.seat;
    const partner = (winner + 2) % 4;
    state.turn = state.hands[winner].length ? winner : state.hands[partner].length ? partner : nextActive(state, winner);
    state.lastTrick = { ...state.trick, nextSeat: state.turn, partnerLead: state.turn !== winner };
    state.trick = null;
    state.passes = 0;
    state.lastAction.trickClosed = true;
    state.lastAction.nextSeat = state.turn;
    state.lastAction.partnerLead = state.turn !== winner;
  } else state.turn = nextActive(state, seat);
  return state;
}

function groupCounts(cards, level) {
  const counts = new Map();
  for (const c of cards) if (!isWild(c, level)) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
  return counts;
}
function handCost(cards, level) {
  const groups = groupCounts(cards, level);
  let score = 0;
  for (const [rank, n] of groups) {
    if (n >= 4) score += 0.6;
    else if (n === 3) score += 0.8;
    else if (n === 2) score += 1;
    else score += 1.7 + (rankStrength(rank, level) < 11 ? 0.25 : -0.25);
  }
  return score + cards.filter(c => isWild(c, level)).length * 0.1;
}
/** Fair heuristic AI: reads own cards, public played cards and opponents' hand sizes only. */
export function chooseMove(state, seat = state.turn) {
  const moves = getLegalMoves(state, seat);
  if (!moves.length) return null;
  const hand = state.hands[seat], partner = (seat + 2) % 4;
  const target = state.trick?.combo || null;
  const finishing = moves.filter(m => m.cards.length === hand.length);
  if (finishing.length) return finishing.sort((a, b) => compareCombos(a.combo, b.combo))[0];
  const teammateWinning = target && state.trick.seat === partner;
  const opponents = [0, 1, 2, 3].filter(s => s % 2 !== seat % 2 && state.hands[s].length);
  const danger = Math.min(...opponents.map(s => state.hands[s].length), 27);
  // Preserve partner control, especially a finished partner's wind/lead transfer.
  if (teammateWinning) return null;
  const normal = moves.filter(m => !m.combo.bomb);
  if (target && !normal.length && danger > 5 && hand.length > 8) return null;
  const hard = state.difficulty === 'hard', easy = state.difficulty === 'easy';
  const counts = groupCounts(hand, state.level);
  const score = move => {
    const combo = move.combo;
    const ids = new Set(move.ids), remain = hand.filter(c => !ids.has(c.id));
    let result = handCost(remain, state.level) * (hard ? 12 : easy ? 4 : 9);
    result += combo.key * (target ? 0.45 : 0.3);
    result += move.cards.filter(c => isWild(c, state.level)).length * (easy ? 2 : 8);
    const used = groupCounts(move.cards, state.level);
    for (const [rank, count] of used) {
      const before = counts.get(rank) || 0;
      if (before >= 4 && count < before) result += hard ? 24 : 15;
      else if (before >= 2 && count < before) result += 3;
    }
    if (combo.bomb) result += target ? danger <= 5 ? 5 : 24 : 12;
    if (!target) {
      result -= move.cards.length * 2;
      if (danger === 1 && combo.type === 'single') result += 30;
      if (danger === 2 && combo.type === 'pair') result += 16;
      if (state.hands[partner].length === 1 && combo.type === 'single') result -= 15;
      if (state.hands[partner].length === 2 && combo.type === 'pair') result -= 10;
    } else if (danger <= 2 && !combo.bomb) result -= combo.key * 1.2;
    return result;
  };
  let best = moves[0], bestScore = Infinity;
  for (const move of moves) { const s = score(move); if (s < bestScore) { best = move; bestScore = s; } }
  return best;
}

/** Fresh casual round using the prior result's progression; no tribute exchange. */
export function nextRound(state, options = {}) {
  if (!state.result) throw new Error('请先打完本局');
  const reset = state.result.matchWon;
  return createGame({ level: reset ? 2 : state.result.nextLevel,
    teamLevels: reset ? [2, 2] : state.result.teamLevels,
    dealer: state.result.order[0], difficulty: state.difficulty, ...options });
}
