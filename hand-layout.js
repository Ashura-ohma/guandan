import { sortHand, classify, canBeat } from './engine.js';

/** Pure layout: each row fits its available width, and every rank/suit corner stays exposed. */
export function computeHandLayout(count, width, height, large = false) {
  const landscape = width > height;
  const cardWidth = large ? 56 : 50;
  const minExposure = large ? 27 : 23;
  const available = Math.max(240, width - 24);
  const capacity = Math.max(1, 1 + Math.floor((available - cardWidth) / minExposure));
  const rows = Math.max(1, Math.min(landscape ? 1 : 2, Math.ceil(count / capacity)));
  const perRow = Math.max(1, Math.ceil(count / rows));
  const step = perRow === 1 ? cardWidth : Math.max(minExposure, Math.min(cardWidth + 4, (available - cardWidth) / (perRow - 1)));
  const rowWidth = count ? cardWidth + (Math.min(perRow,count)-1)*step : available;
  return { cardWidth, step, perRow, rows, landscape, available, rowWidth, scrollable: rowWidth > available + .5 };
}
export function arrangeHand(cards, level, order = 'rank') {
  const result = sortHand(cards, level);
  if (order === 'suit') {
    const suits = ['J', 'S', 'H', 'C', 'D'];
    result.sort((a,b) => suits.indexOf(a.suit)-suits.indexOf(b.suit) || b.rank-a.rank);
  }
  return result;
}
export function assessSelection(cards, level, target = null, declaration = null) {
  if (!cards.length) return { valid: false, combo: null, reason: 'empty' };
  const natural = classify(cards, level);
  const legal = declaration && canBeat(declaration, target) ? declaration : classify(cards, level, target);
  if (legal) return { valid: true, combo: legal, reason: 'ready' };
  return { valid: false, combo: natural, reason: natural ? 'too-small' : 'invalid' };
}
