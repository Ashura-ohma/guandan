# Offline music and sound

`audio.js` is an ES module with no dependencies, downloads, recordings or remote
requests. It synthesizes the original **Neon Table** score: a quiet 92 BPM,
eight-bar lounge/electronic arrangement with warm rolled chords, a syncopated
bell melody, soft bass, kick, brush and hat. All music and sound design are
original to this project and released under its MIT `LICENSE`.

## Integration

```js
import { createGameAudio, AUDIO_DEFAULTS } from './audio.js';

// The UI owns saved preferences. Never treat an absent preference as opt-in.
const audio = createGameAudio(savedAudioSettings || AUDIO_DEFAULTS);

// Call only from an explicit user audio control, or a later user gesture after
// the player previously chose to enable sound. There is no startup autoplay.
async function enableMusicFromClick() {
  audio.configure({ musicEnabled: true });
  const available = await audio.unlock();
  // Persist audio.settings and update controls. If !available, leave play usable.
}

audio.configure({ musicVolume: 0.34, effectsVolume: 0.6 });
audio.setActive(false); // Stop audio when the game/UI chooses to pause.
audio.setActive(true);  // Resume only audio that has already been unlocked.
audio.playEffect('play');
await audio.destroy();  // Call when permanently disposing of this controller.
```

Settings are `musicEnabled`, `effectsEnabled` (both default `false`), and separate
`musicVolume`, `effectsVolume` values from 0 to 1. Values are clamped; invalid
values are ignored. `.settings` and `configure(patch)` return copies. The module
never accesses local storage, changes game state, or shows a UI.

`unlock()` returns `Promise<boolean>`. It calls Web Audio directly in the user
gesture's call stack. Repeated or concurrent unlocks reuse the one context. Await
it before a cue that should play on the same first gesture. `playEffect(name)`
returns `false` when muted, paused, blocked, unsupported, unknown, or duplicated
within its short cooldown. Cues are `select`, `deal`, `play`, `pass`, `bomb`,
`win`, `lose`, and `error`.

`getState()` reports `supported`, `unlocked`, `active`, `effectiveActive`,
`running`, `musicPlaying`, `destroyed`, and the latest `error` string or null.
Unlock failures can be retried on a later gesture. Missing Web Audio is a safe
silent mode; the UI should never depend on audio succeeding.

The controller independently observes document visibility, `pagehide/pageshow`,
and the window's `guandan-pause/guandan-resume` Android events. These gates compose
with `setActive`, so a visibility or Android resume cannot undo a UI pause.
Paused sources, including already scheduled future notes, are stopped and
disconnected. A single short lookahead timer schedules against AudioContext time;
background throttling never replays missed music. Natural sound endings release
their nodes; repeated lifecycle events cannot create extra schedulers. Destroy
also unregisters all listeners and closes the context.

## Tests

`node --test tests/audio.test.js` exercises gesture gating, every cue, independent
volumes, muting, visibility and Android lifecycle composition, stale callbacks,
async pause/resume races, unavailable audio, disposal, and bounded playback with
Web Audio stubs. `npm test` includes these alongside the game tests. Auditory
quality and device-specific Web Audio policies still benefit from a real-device
listening pass.
