/**
 * Original offline score and sound design for Neon Guandan. MIT licensed under
 * this project's LICENSE. The melody, arrangement and synthesized effects were
 * composed for this game; no recordings, samples, fonts or network assets.
 *
 * createGameAudio(settings?, environment?) creates no AudioContext until unlock.
 * Call await unlock() from a user gesture AFTER the user opts into audio.
 * configure({ musicEnabled, effectsEnabled, musicVolume, effectsVolume }) accepts
 * volumes in [0, 1]. The caller owns persistence; this module never uses storage.
 * setActive(false) pauses all audio; true resumes previously unlocked audio.
 * Visibility, page lifecycle and guandan-pause/resume events are also observed.
 * playEffect('select'|'deal'|'play'|'pass'|'bomb'|'win'|'lose'|'error') returns
 * whether a sound was scheduled. Unknown names and unavailable audio are no-ops.
 * settings/getState() return snapshots; destroy() releases listeners and audio.
 * environment is optional dependency injection for tests, not required in a UI.
 */

export const AUDIO_DEFAULTS = Object.freeze({
  musicEnabled: false,
  effectsEnabled: false,
  musicVolume: 0.34,
  effectsVolume: 0.6,
});

const TEMPO = 92;
const STEP_SECONDS = 60 / TEMPO / 4;
const LOOKAHEAD_SECONDS = 0.18;
const PUMP_MS = 40;
const MAX_VOICES = 96;
const MIDI = note => 440 * 2 ** ((note - 69) / 12);

// Eight bars: Dmaj9 / F#m9 / Bm9 / Aadd9, then a gentler answering phrase.
// Each row contains the bass and four warmly voiced chord tones.
const HARMONY = [
  [38, 54, 57, 61, 64], [42, 57, 61, 64, 68],
  [35, 50, 57, 61, 66], [33, 52, 57, 59, 64],
  [38, 54, 57, 61, 64], [42, 57, 61, 64, 68],
  [35, 50, 57, 61, 66], [33, 52, 57, 59, 64],
];
// Original syncopated pentatonic-led line. Missing steps deliberately breathe.
const MELODY = [
  { 2: 73, 6: 76, 10: 78, 13: 76 },
  { 1: 73, 7: 69, 11: 68 },
  { 2: 69, 5: 73, 10: 78, 14: 76 },
  { 3: 71, 8: 69, 12: 64 },
  { 2: 66, 6: 69, 10: 73, 13: 76 },
  { 1: 73, 5: 71, 10: 68, 14: 69 },
  { 2: 73, 6: 78, 11: 76 },
  { 1: 71, 6: 69, 10: 66, 13: 64 },
];

function cleanSettings(previous, patch = {}) {
  const next = { ...previous };
  if (!patch || typeof patch !== 'object') return next;
  for (const key of ['musicEnabled', 'effectsEnabled']) {
    if (typeof patch[key] === 'boolean') next[key] = patch[key];
  }
  for (const key of ['musicVolume', 'effectsVolume']) {
    if (typeof patch[key] === 'number' && Number.isFinite(patch[key])) {
      next[key] = Math.max(0, Math.min(1, patch[key]));
    }
  }
  return next;
}

export function createGameAudio(initialSettings = {}, environment = {}) {
  const injected = (key, fallback) => Object.prototype.hasOwnProperty.call(environment, key)
    ? environment[key] : fallback;
  const Context = injected('AudioContext', globalThis.AudioContext || globalThis.webkitAudioContext);
  const document = injected('document', globalThis.document);
  const window = injected('window', globalThis.window);
  const later = injected('setTimeout', globalThis.setTimeout.bind(globalThis));
  const cancel = injected('clearTimeout', globalThis.clearTimeout.bind(globalThis));
  let settings = cleanSettings(AUDIO_DEFAULTS, initialSettings);
  let context = null, musicBus = null, effectsBus = null, noiseBuffer = null;
  let unlocked = false, destroyed = false, active = true, pageVisible = true, platformActive = true;
  let visible = !document?.hidden;
  let timer = null, generation = 0, step = 0, nextTime = 0, musicPlaying = false;
  let unlockPromise = null, transition = null, resumeBlocked = false, lastError = null;
  let closePromise = null;
  const voices = new Set(), listeners = [], effectTimes = new Map();
  const musicAudible = () => settings.musicEnabled && settings.musicVolume > 0;
  const effectsAudible = () => settings.effectsEnabled && settings.effectsVolume > 0;
  const effectiveActive = () => active && visible && pageVisible && platformActive && !destroyed;
  const wantsAudio = () => unlocked && effectiveActive() && (musicAudible() || effectsAudible());
  const canPlay = () => wantsAudio() && context?.state === 'running';

  function error(reason) {
    lastError = reason?.message || String(reason || 'Audio unavailable');
  }

  function listen(target, event, callback) {
    if (!target?.addEventListener) return;
    target.addEventListener(event, callback);
    listeners.push(() => target.removeEventListener?.(event, callback));
  }

  function cleanVoice(voice, stop = false) {
    if (!voices.delete(voice)) return;
    voice.source.onended = null;
    if (stop) {
      try { voice.source.stop(); } catch { /* It may have naturally ended already. */ }
    }
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch { /* A failed context may be disconnected. */ }
    }
  }

  function stopVoices(kind) {
    for (const voice of [...voices]) if (!kind || voice.kind === kind) cleanVoice(voice, true);
  }

  function stopMusic() {
    generation++;
    if (timer !== null) cancel(timer);
    timer = null;
    musicPlaying = false;
    stopVoices('music');
  }

  function setGain(node, value) {
    if (!node || !context) return;
    const now = context.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setTargetAtTime(value, now, 0.025);
  }

  function updateGains() {
    setGain(musicBus, musicAudible() ? settings.musicVolume * 0.58 : 0);
    setGain(effectsBus, effectsAudible() ? settings.effectsVolume * 0.66 : 0);
  }

  function ensureContext() {
    if (context) return true;
    if (destroyed || typeof Context !== 'function') return false;
    let candidate;
    try {
      candidate = new Context({ latencyHint: 'interactive' });
      const music = candidate.createGain(), effects = candidate.createGain();
      music.gain.value = effects.gain.value = 0;
      music.connect(candidate.destination);
      effects.connect(candidate.destination);
      context = candidate;
      musicBus = music;
      effectsBus = effects;
      listen(context, 'statechange', () => {
        if (destroyed) return;
        if (context.state !== 'running') {
          stopMusic();
          stopVoices();
        } else if (!transition && !unlockPromise) reconcile();
      });
      updateGains();
      return true;
    } catch (reason) {
      error(reason);
      try { Promise.resolve(candidate?.close()).catch(() => {}); } catch { /* No viable context. */ }
      context = musicBus = effectsBus = null;
      return false;
    }
  }

  function track(source, nodes, kind, when, duration) {
    if (voices.size >= MAX_VOICES) cleanVoice(voices.values().next().value, true);
    const voice = { source, nodes, kind };
    voices.add(voice);
    source.onended = () => cleanVoice(voice);
    try {
      source.start(when);
      source.stop(when + duration + 0.02);
    } catch (reason) {
      cleanVoice(voice, true);
      throw reason;
    }
  }

  function envelope(gain, when, duration, volume, attack = 0.008) {
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(attack + 0.01, duration));
  }

  function tone(kind, frequency, when, duration, volume, type = 'sine', endFrequency = null, attack = 0.008) {
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, when);
    if (endFrequency !== null) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, when + duration);
    envelope(gain, when, duration, volume, attack);
    oscillator.connect(gain);
    gain.connect(kind === 'music' ? musicBus : effectsBus);
    track(oscillator, [oscillator, gain], kind, when, duration);
  }

  function noise(kind, when, duration, volume, cutoff = 4200) {
    if (!noiseBuffer) {
      noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.25), context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      let seed = 20261003;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = seed / 2147483648 - 1;
      }
    }
    const source = context.createBufferSource(), gain = context.createGain(), filter = context.createBiquadFilter();
    source.buffer = noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(cutoff, when);
    envelope(gain, when, duration, volume, 0.002);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(kind === 'music' ? musicBus : effectsBus);
    track(source, [source, filter, gain], kind, when, duration);
  }

  function bell(kind, note, when, volume = 0.075, duration = 0.6) {
    tone(kind, MIDI(note), when, duration, volume);
    tone(kind, MIDI(note + 12), when, duration * 0.36, volume * 0.16);
  }

  function scheduleStep(index, when) {
    const bar = Math.floor(index / 16) % 8, beat = index % 16;
    const chord = HARMONY[bar];
    if (beat === 0) {
      for (let i = 1; i < chord.length; i++) {
        // Rolled soft triangles leave room for the cards and the melody.
        tone('music', MIDI(chord[i]), when + (i - 1) * 0.017, STEP_SECONDS * 14, 0.026, 'triangle', null, 0.12);
      }
    }
    if (beat === 0 || beat === 7 || beat === 10) {
      const note = chord[0] + (beat === 10 ? 12 : 0);
      tone('music', MIDI(note), when, beat === 7 ? 0.32 : 0.65, 0.14, 'sine', null, 0.012);
    }
    if (beat === 0 || beat === 8) tone('music', 125, when, 0.19, 0.105, 'sine', 45);
    if (beat === 4 || beat === 12) noise('music', when, 0.085, 0.027, 1900);
    if (beat % 2 === 0) noise('music', when + (beat % 4 ? 0.013 : 0), 0.04, beat % 4 ? 0.018 : 0.012, 6500);
    if (MELODY[bar][beat] !== undefined) bell('music', MELODY[bar][beat], when, 0.085, 0.72);
  }

  function startMusic() {
    if (musicPlaying || !canPlay() || !musicAudible()) return;
    musicPlaying = true;
    nextTime = context.currentTime + 0.035;
    const token = ++generation;
    const pump = () => {
      if (token !== generation || !musicPlaying || !canPlay() || !musicAudible()) return;
      timer = null;
      try {
        // Throttled tabs never replay a backlog of missed beats.
        if (nextTime < context.currentTime) nextTime = context.currentTime + 0.025;
        while (nextTime < context.currentTime + LOOKAHEAD_SECONDS) {
          scheduleStep(step, nextTime);
          step = (step + 1) % 128;
          nextTime += STEP_SECONDS;
        }
        timer = later(pump, PUMP_MS);
      } catch (reason) {
        error(reason);
        stopMusic();
      }
    };
    pump();
  }

  function reconcile() {
    if (destroyed || !context) return;
    updateGains();
    if (!musicAudible() || !wantsAudio()) stopMusic();
    if (!effectsAudible() || !wantsAudio()) stopVoices('effects');
    if (transition || unlockPromise) return;
    if (!wantsAudio()) {
      if (context.state === 'running') changeContextState('suspend');
      return;
    }
    if (context.state === 'running') startMusic();
    else if (!resumeBlocked && context.state !== 'closed') changeContextState('resume');
  }

  function changeContextState(method) {
    // AudioContext transitions are serialized. A later pause always wins over
    // an in-flight resume, and a rapid resume cannot leave the context suspended.
    let result;
    try { result = context[method](); }
    catch (reason) { error(reason); resumeBlocked = true; return; }
    transition = Promise.resolve(result).then(() => {
      transition = null;
      if (!destroyed) reconcile();
    }, reason => {
      transition = null;
      resumeBlocked = true;
      error(reason);
      stopMusic();
      stopVoices();
    });
  }

  function unlock() {
    if (destroyed || !ensureContext()) return Promise.resolve(false);
    if (unlockPromise) return unlockPromise;
    resumeBlocked = false;
    let result;
    try {
      // Invoke directly in the gesture call stack, never after a timer/await.
      result = context.state === 'running' ? undefined : context.resume();
    } catch (reason) { error(reason); return Promise.resolve(false); }
    unlockPromise = Promise.resolve(result).then(() => {
      unlockPromise = null;
      if (destroyed || context.state !== 'running') return false;
      unlocked = true;
      lastError = null;
      reconcile();
      return true;
    }, reason => {
      unlockPromise = null;
      resumeBlocked = true;
      error(reason);
      return false;
    });
    return unlockPromise;
  }

  function playEffect(name) {
    if (!canPlay() || !effectsAudible()) return false;
    const supported = ['select', 'deal', 'play', 'pass', 'bomb', 'win', 'lose', 'error'];
    if (!supported.includes(name)) return false;
    const now = context.currentTime, previous = effectTimes.get(name);
    // Bound noisy repeated pointer events and duplicate result notifications.
    const cooldown = name === 'win' || name === 'lose' ? 0.8 : 0.035;
    if (previous !== undefined && now - previous < cooldown) return false;
    effectTimes.set(name, now);
    const when = now + 0.008;
    try {
      if (name === 'select') {
        bell('effects', 81, when, 0.075, 0.09);
      } else if (name === 'deal') {
        for (let i = 0; i < 6; i++) noise('effects', when + i * 0.046, 0.035, 0.09, 1600);
        bell('effects', 73, when + 0.27, 0.07, 0.22);
      } else if (name === 'play') {
        noise('effects', when, 0.035, 0.09, 1300);
        bell('effects', 69, when, 0.13, 0.19);
        bell('effects', 76, when + 0.055, 0.07, 0.24);
      } else if (name === 'pass') {
        tone('effects', MIDI(66), when, 0.12, 0.1, 'sine', MIDI(61));
      } else if (name === 'bomb') {
        tone('effects', 170, when, 0.42, 0.28, 'sine', 42);
        noise('effects', when, 0.2, 0.17, 650);
        for (let i = 0; i < 3; i++) bell('effects', 62 + i * 7, when + 0.055 * i, 0.11, 0.38);
      } else if (name === 'win') {
        [66, 69, 73, 78].forEach((note, i) => bell('effects', note, when + i * 0.13, 0.18, 0.7));
        [54, 61, 66].forEach(note => tone('effects', MIDI(note), when + 0.39, 1.05, 0.07, 'triangle'));
      } else if (name === 'lose') {
        [73, 69, 66].forEach((note, i) => bell('effects', note, when + i * 0.17, 0.12, 0.55));
      } else if (name === 'error') {
        tone('effects', MIDI(57), when, 0.11, 0.12, 'triangle');
        tone('effects', MIDI(56), when + 0.13, 0.13, 0.09, 'triangle');
      }
      return true;
    } catch (reason) {
      error(reason);
      stopVoices('effects');
      return false;
    }
  }

  function configure(patch = {}) {
    if (!destroyed) {
      settings = cleanSettings(settings, patch);
      reconcile();
    }
    return { ...settings };
  }

  function setActive(value) {
    active = Boolean(value);
    reconcile();
  }

  function destroy() {
    if (destroyed) return closePromise || Promise.resolve();
    destroyed = true;
    stopMusic();
    stopVoices();
    for (const remove of listeners.splice(0)) remove();
    for (const bus of [musicBus, effectsBus]) {
      try { bus?.disconnect(); } catch { /* A closed context is already silent. */ }
    }
    noiseBuffer = null;
    effectTimes.clear();
    try { closePromise = Promise.resolve(context?.close()).catch(error); }
    catch (reason) { error(reason); closePromise = Promise.resolve(); }
    return closePromise;
  }

  listen(document, 'visibilitychange', () => { visible = !document.hidden; reconcile(); });
  listen(window, 'pagehide', () => { pageVisible = false; reconcile(); });
  listen(window, 'pageshow', () => { pageVisible = true; visible = !document?.hidden; reconcile(); });
  listen(window, 'guandan-pause', () => { platformActive = false; reconcile(); });
  listen(window, 'guandan-resume', () => { platformActive = true; visible = !document?.hidden; reconcile(); });

  return {
    get settings() { return { ...settings }; },
    getState: () => ({
      supported: typeof Context === 'function', unlocked, active,
      effectiveActive: effectiveActive(), running: context?.state === 'running',
      musicPlaying, destroyed, error: lastError,
    }),
    unlock, configure, setActive, playEffect, destroy,
  };
}
