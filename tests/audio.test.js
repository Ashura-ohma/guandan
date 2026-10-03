import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AUDIO_DEFAULTS, createGameAudio } from '../audio.js';

class EventTargetStub {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name) { for (const callback of this.listeners.get(name) || []) callback(); }
  listenerCount() { return [...this.listeners.values()].reduce((count, set) => count + set.size, 0); }
}

class Param {
  value = 0;
  events = [];
  record(method, value, when) {
    assert.ok(Number.isFinite(value), 'audio values must be finite');
    assert.ok(Number.isFinite(when), 'audio times must be finite');
    if (method === 'exponentialRampToValueAtTime') assert.ok(value > 0);
    this.value = value;
    this.events.push({ method, value, when });
  }
  setValueAtTime(value, when) { this.record('setValueAtTime', value, when); }
  setTargetAtTime(value, when) { this.record('setTargetAtTime', value, when); }
  exponentialRampToValueAtTime(value, when) { this.record('exponentialRampToValueAtTime', value, when); }
  cancelScheduledValues(when) { this.events.push({ method: 'cancelScheduledValues', when }); }
}

function fixture(settings = {}, options = {}) {
  const contexts = [], timers = new Map(), window = new EventTargetStub(), document = new EventTargetStub();
  document.hidden = false;
  let nextTimer = 1;
  class Node {
    constructor(context, type) {
      this.context = context;
      this.nodeType = type;
      this.disconnected = false;
      this.gain = new Param();
      this.frequency = new Param();
      context.nodes.push(this);
    }
    connect(destination) { this.destination = destination; }
    disconnect() { this.disconnected = true; }
    start(when) { this.startTime = when; this.context.sources.push(this); }
    stop(when = this.context.currentTime) {
      this.stopTime = when;
      if (when <= this.context.currentTime) this.end();
    }
    end() { this.ended = true; this.onended?.(); }
  }
  class Context extends EventTargetStub {
    state = 'suspended';
    currentTime = 0;
    sampleRate = 48000;
    destination = {};
    nodes = [];
    sources = [];
    resumeCalls = 0;
    suspendCalls = 0;
    closeCalls = 0;
    pending = [];
    constructor() { super(); contexts.push(this); }
    createGain() { return new Node(this, 'gain'); }
    createOscillator() { return new Node(this, 'oscillator'); }
    createBiquadFilter() { return new Node(this, 'filter'); }
    createBufferSource() { return new Node(this, 'buffer-source'); }
    createBuffer(channels, size) {
      this.bufferCount = (this.bufferCount || 0) + 1;
      const data = new Float32Array(size);
      return { getChannelData: () => data };
    }
    change(state, method) {
      if (options.deferTransitions) return new Promise(resolve => this.pending.push(() => {
        this.state = state; queueMicrotask(() => this.emit('statechange')); resolve();
      }));
      if (options[method + 'Error']) return Promise.reject(new Error(method + ' unavailable'));
      this.state = state;
      queueMicrotask(() => this.emit('statechange'));
      return Promise.resolve();
    }
    resume() { this.resumeCalls++; return this.change('running', 'resume'); }
    suspend() { this.suspendCalls++; return this.change('suspended', 'suspend'); }
    close() { this.closeCalls++; this.state = 'closed'; return Promise.resolve(); }
    settle() { this.pending.shift()?.(); }
    advance(seconds) {
      this.currentTime += seconds;
      for (const source of this.sources) if (!source.ended && source.stopTime <= this.currentTime) source.end();
    }
  }
  const environment = {
    AudioContext: options.AudioContext === null ? null : options.AudioContext || Context,
    document, window,
    setTimeout(callback, milliseconds) { const id = nextTimer++; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const audio = createGameAudio(settings, environment);
  return {
    audio, contexts, timers, document, window, options,
    get context() { return contexts[0]; },
    tick(seconds = 0.04) {
      this.context?.advance(seconds);
      const entries = [...timers];
      timers.clear();
      for (const [, { callback }] of entries) callback();
    },
  };
}

async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

test('safe defaults: construction, configuration and effect calls cannot unlock audio', async () => {
  const f = fixture();
  assert.deepEqual(f.audio.settings, AUDIO_DEFAULTS);
  f.audio.configure({ musicEnabled: true, effectsEnabled: true });
  f.audio.setActive(true);
  assert.equal(f.audio.playEffect('play'), false);
  assert.equal(f.contexts.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.audio.getState().unlocked, false);
  await f.audio.destroy();
});

test('gesture unlock schedules one clock-driven music loop and independent effect bus', async () => {
  const f = fixture({ musicEnabled: true, effectsEnabled: true });
  assert.equal(await f.audio.unlock(), true);
  assert.equal(f.contexts.length, 1);
  assert.equal(f.context.resumeCalls, 1);
  assert.equal(f.audio.getState().musicPlaying, true);
  assert.equal(f.timers.size, 1);
  assert.ok(f.context.sources.length >= 7, 'harmony, bass, kick and hat are scheduled');
  assert.ok(f.context.sources.every(source => source.startTime >= 0.035));
  assert.equal(f.audio.playEffect('play'), true);
  assert.equal(f.context.nodes[0].gain.value, 0.34 * 0.58);
  assert.equal(f.context.nodes[1].gain.value, 0.6 * 0.66);
  await f.audio.unlock();
  f.audio.setActive(true);
  f.audio.configure({ musicVolume: 0.5 });
  assert.equal(f.timers.size, 1);
  await f.audio.destroy();
});

test('volume values are clamped, copied, independent and invalid inputs are ignored', async () => {
  const f = fixture({ musicEnabled: true, effectsEnabled: true, musicVolume: 2, effectsVolume: -2 });
  assert.equal(f.audio.settings.musicVolume, 1);
  assert.equal(f.audio.settings.effectsVolume, 0);
  await f.audio.unlock();
  const copy = f.audio.settings;
  copy.musicVolume = 0;
  assert.equal(f.audio.settings.musicVolume, 1);
  f.audio.configure({ musicVolume: NaN, effectsVolume: Infinity, musicEnabled: 'yes', unknown: true });
  assert.deepEqual(f.audio.settings, { musicEnabled: true, effectsEnabled: true, musicVolume: 1, effectsVolume: 0 });
  f.audio.configure({ effectsVolume: 0.4 });
  assert.equal(f.context.nodes[0].gain.value, 0.58);
  assert.equal(f.context.nodes[1].gain.value, 0.4 * 0.66);
  await f.audio.destroy();
});

test('effects-only mode never runs the music scheduler, and supports each cue', async () => {
  const f = fixture({ effectsEnabled: true });
  await f.audio.unlock();
  for (const name of ['select', 'deal', 'play', 'pass', 'bomb', 'win', 'lose', 'error']) {
    assert.equal(f.audio.playEffect(name), true, name);
    f.context.advance(2);
  }
  assert.equal(f.audio.playEffect('unknown'), false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.context.bufferCount, 1, 'noise buffer is reused across cues');
  assert.ok(f.context.sources.every(source => source.disconnected), 'all ended sources disconnect');
  await f.audio.destroy();
});

test('effects cooldown suppresses duplicate results and rapid pointer repeats', async () => {
  const f = fixture({ effectsEnabled: true });
  await f.audio.unlock();
  assert.equal(f.audio.playEffect('select'), true);
  assert.equal(f.audio.playEffect('select'), false);
  f.context.advance(0.04);
  assert.equal(f.audio.playEffect('select'), true);
  assert.equal(f.audio.playEffect('win'), true);
  assert.equal(f.audio.playEffect('win'), false);
  f.context.advance(0.81);
  assert.equal(f.audio.playEffect('win'), true);
  await f.audio.destroy();
});

test('music and effects toggles stop only their own voices', async () => {
  const f = fixture({ musicEnabled: true, effectsEnabled: true });
  await f.audio.unlock();
  const musicSources = [...f.context.sources];
  f.audio.playEffect('win');
  const effectSources = f.context.sources.slice(musicSources.length);
  f.audio.configure({ musicEnabled: false });
  assert.ok(musicSources.every(source => source.disconnected));
  assert.ok(effectSources.every(source => !source.disconnected));
  assert.equal(f.timers.size, 0);
  f.audio.configure({ musicEnabled: true, effectsEnabled: false });
  assert.ok(effectSources.every(source => source.disconnected));
  assert.equal(f.timers.size, 1);
  assert.equal(f.audio.playEffect('play'), false);
  await f.audio.destroy();
});

test('zero music volume stops scheduling while zero effects volume suppresses cues', async () => {
  const f = fixture({ musicEnabled: true, effectsEnabled: true });
  await f.audio.unlock();
  f.audio.configure({ musicVolume: 0 });
  assert.equal(f.timers.size, 0);
  assert.equal(f.audio.playEffect('play'), true);
  f.audio.configure({ effectsVolume: 0 });
  await flush();
  assert.equal(f.audio.playEffect('play'), false);
  assert.equal(f.context.state, 'suspended');
  f.audio.configure({ musicVolume: 0.2 });
  await flush();
  assert.equal(f.context.state, 'running');
  assert.equal(f.timers.size, 1);
  await f.audio.destroy();
});

test('app pause stops all scheduled sounds and resume does not duplicate the clock', async () => {
  const f = fixture({ musicEnabled: true, effectsEnabled: true });
  await f.audio.unlock();
  f.audio.playEffect('win');
  const oldPump = [...f.timers.values()][0].callback;
  f.audio.setActive(false);
  assert.equal(f.timers.size, 0);
  assert.ok(f.context.sources.every(source => source.disconnected));
  assert.equal(f.audio.playEffect('play'), false);
  oldPump();
  assert.equal(f.timers.size, 0, 'stale callbacks cannot restart a stopped scheduler');
  await flush();
  assert.equal(f.context.state, 'suspended');
  f.audio.setActive(true);
  f.audio.setActive(true);
  await flush();
  oldPump();
  assert.equal(f.timers.size, 1);
  assert.equal(f.context.resumeCalls, 2);
  await f.audio.destroy();
});

test('visibility, pagehide and Android lifecycle gates compose without unpausing each other', async () => {
  const f = fixture({ musicEnabled: true });
  await f.audio.unlock();
  f.document.hidden = true;
  f.document.emit('visibilitychange');
  await flush();
  assert.equal(f.context.state, 'suspended');
  f.window.emit('guandan-pause');
  f.document.hidden = false;
  f.document.emit('visibilitychange');
  await flush();
  assert.equal(f.context.state, 'suspended', 'visibility alone cannot undo Android pause');
  f.window.emit('guandan-resume');
  await flush();
  assert.equal(f.timers.size, 1);
  f.window.emit('pagehide');
  await flush();
  f.audio.setActive(false);
  f.window.emit('pageshow');
  await flush();
  assert.equal(f.context.state, 'suspended', 'pageshow cannot undo app pause');
  f.audio.setActive(true);
  await flush();
  assert.equal(f.timers.size, 1);
  await f.audio.destroy();
});

test('hidden initial page stays silent even after gesture unlock', async () => {
  const f = fixture({ musicEnabled: true, effectsEnabled: true });
  f.document.hidden = true;
  f.document.emit('visibilitychange');
  await f.audio.unlock();
  await flush();
  assert.equal(f.timers.size, 0);
  assert.equal(f.context.sources.length, 0);
  assert.equal(f.audio.playEffect('select'), false);
  await f.audio.destroy();
});

test('throttled timers skip backlog and keep future notes within the lookahead', async () => {
  const f = fixture({ musicEnabled: true });
  await f.audio.unlock();
  const before = f.context.sources.length;
  f.tick(120);
  const added = f.context.sources.slice(before);
  assert.ok(added.length < 15, 'no two-minute burst of notes');
  assert.ok(added.every(source => source.startTime >= 120));
  assert.equal(f.timers.size, 1);
  await f.audio.destroy();
});

test('extended music playback retains only a small bounded set of live nodes', async () => {
  const f = fixture({ musicEnabled: true });
  await f.audio.unlock();
  for (let i = 0; i < 1600; i++) {
    f.tick();
    const live = f.context.sources.filter(source => !source.disconnected);
    assert.ok(live.length < 40, `live sources must stay bounded, got ${live.length}`);
    assert.equal(f.timers.size, 1);
  }
  assert.ok(f.context.sources.length > 500, 'multiple full musical phrases were exercised');
  assert.equal(f.context.bufferCount, 1);
  await f.audio.destroy();
  assert.ok(f.context.nodes.every(node => node.disconnected));
});

test('unsupported and rejected Web Audio never throw or schedule sound', async () => {
  const unsupported = fixture({ musicEnabled: true }, { AudioContext: null });
  assert.equal(unsupported.audio.getState().supported, false);
  assert.equal(await unsupported.audio.unlock(), false);
  assert.equal(unsupported.audio.playEffect('play'), false);
  await unsupported.audio.destroy();
  const rejected = fixture({ musicEnabled: true }, { resumeError: true });
  assert.equal(await rejected.audio.unlock(), false);
  assert.match(rejected.audio.getState().error, /resume unavailable/);
  assert.equal(rejected.timers.size, 0);
  rejected.options.resumeError = false;
  assert.equal(await rejected.audio.unlock(), true, 'later gesture can recover');
  assert.equal(rejected.timers.size, 1);
  await rejected.audio.destroy();
  const failedConstructor = fixture({}, { AudioContext: class { constructor() { throw Error('not allowed'); } } });
  assert.equal(await failedConstructor.audio.unlock(), false);
  assert.match(failedConstructor.audio.getState().error, /not allowed/);
  await failedConstructor.audio.destroy();
});

test('concurrent unlocks share one context and one pending resume', async () => {
  const f = fixture({ musicEnabled: true }, { deferTransitions: true });
  const first = f.audio.unlock(), second = f.audio.unlock();
  assert.equal(first, second);
  assert.equal(f.contexts.length, 1);
  assert.equal(f.context.resumeCalls, 1);
  f.context.settle();
  assert.equal(await first, true);
  assert.equal(f.timers.size, 1);
  await f.audio.destroy();
});

test('a pause during pending unlock wins, without even briefly scheduling music', async () => {
  const f = fixture({ musicEnabled: true }, { deferTransitions: true });
  const unlocking = f.audio.unlock();
  f.audio.setActive(false);
  f.context.settle();
  assert.equal(await unlocking, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.context.sources.length, 0);
  f.context.settle();
  await flush();
  assert.equal(f.context.state, 'suspended');
  await f.audio.destroy();
});

test('rapid pause and resume serializes transitions and restores exactly one scheduler', async () => {
  const f = fixture({ musicEnabled: true }, { deferTransitions: true });
  const unlocking = f.audio.unlock();
  f.context.settle();
  await unlocking;
  f.audio.setActive(false);
  f.audio.setActive(true);
  f.audio.setActive(false);
  f.audio.setActive(true);
  assert.equal(f.context.suspendCalls, 1);
  f.context.settle();
  await flush();
  assert.equal(f.context.resumeCalls, 2);
  f.context.settle();
  await flush();
  assert.equal(f.context.state, 'running');
  assert.equal(f.timers.size, 1);
  await f.audio.destroy();
});

test('destroy removes listeners, stops sources, closes once, and defeats late callbacks', async () => {
  const f = fixture({ musicEnabled: true, effectsEnabled: true });
  await f.audio.unlock();
  f.audio.playEffect('win');
  const latePump = [...f.timers.values()][0].callback;
  await f.audio.destroy();
  await f.audio.destroy();
  latePump();
  f.window.emit('guandan-resume');
  f.document.emit('visibilitychange');
  f.audio.setActive(true);
  f.audio.configure({ musicEnabled: true });
  assert.equal(await f.audio.unlock(), false);
  assert.equal(f.audio.playEffect('win'), false);
  assert.equal(f.context.closeCalls, 1);
  assert.equal(f.window.listenerCount() + f.document.listenerCount() + f.context.listenerCount(), 0);
  assert.ok(f.context.nodes.every(node => node.disconnected));
  assert.equal(f.timers.size, 0);
  assert.equal(f.audio.getState().destroyed, true);
});

test('destroy during unlock cannot start music after the resume promise resolves', async () => {
  const f = fixture({ musicEnabled: true }, { deferTransitions: true });
  const unlocking = f.audio.unlock();
  await f.audio.destroy();
  f.context.settle();
  assert.equal(await unlocking, false);
  assert.equal(f.context.sources.length, 0);
  assert.equal(f.timers.size, 0);
});

test('source is entirely offline and records the original music license', () => {
  const source = fs.readFileSync(new URL('../audio.js', import.meta.url), 'utf8');
  assert.match(source, /Original offline score/);
  assert.match(source, /MIT licensed/);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|https?:\/\/|new Audio\(/);
});
