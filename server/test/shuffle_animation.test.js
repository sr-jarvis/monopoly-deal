'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'client');
const SRC_DIR = path.join(CLIENT_DIR, 'src');

function readSource(relativePath) {
  const full = path.join(SRC_DIR, relativePath);
  assert.ok(fs.existsSync(full), `expected ${relativePath} to exist at ${full}`);
  return fs.readFileSync(full, 'utf8');
}

function runClientScript(script) {
  return spawnSync('npm', ['run', script, '--silent'], {
    cwd: CLIENT_DIR,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
  });
}

describe('shuffleEngine module contract', () => {
  let source;
  before(() => {
    source = readSource('utils/shuffleEngine.ts');
  });

  it('models every animation state', () => {
    for (const state of ['idle', 'riffle', 'fan', 'cut', 'dealing']) {
      assert.match(source, new RegExp(`'${state}'`), `missing state ${state}`);
    }
  });

  it('exports the engine, its class and the shared singleton', () => {
    assert.match(source, /export class ShuffleEngine\b/);
    assert.match(source, /export const shuffleEngine\b/);
    assert.match(source, /export type ShuffleState\b/);
    assert.match(source, /export type ShufflePhase\b/);
    assert.match(source, /export type ShuffleSpeed\b/);
  });

  it('exports pure timing helpers', () => {
    for (const fn of [
      'resolvePhaseDuration',
      'buildTimeline',
      'sequenceDuration',
      'cardTransform',
      'dealFlightPlan',
      'dealPlanDuration',
      'nextSpeed',
      'easeInOut',
    ]) {
      assert.match(source, new RegExp(`export function ${fn}\\b`), `missing helper ${fn}`);
    }
  });

  it('defines the four speed presets with distinct multipliers', () => {
    for (const speed of ['slow', 'normal', 'fast', 'turbo']) {
      assert.match(source, new RegExp(`\\b${speed}:`), `missing speed ${speed}`);
    }
  });

  it('dispatches namespaced custom events', () => {
    assert.match(source, /new CustomEvent</);
    for (const name of [
      'md:shuffle:start',
      'md:shuffle:phase',
      'md:shuffle:end',
      'md:shuffle:deal',
    ]) {
      assert.ok(source.includes(name), `missing event name ${name}`);
    }
  });

  it('is SSR-safe — no bare window/document access at module scope', () => {
    assert.match(source, /typeof window === 'undefined'/);
  });
});

describe('soundEngine WebAudio integration', () => {
  let source;
  before(() => {
    source = readSource('utils/shuffleEngine.ts');
  });

  it('exports a SoundEngine class and a shared soundEngine instance', () => {
    assert.match(source, /export class SoundEngine\b/);
    assert.match(source, /export const soundEngine\b/);
  });

  it('uses WebAudio primitives rather than shipping audio assets', () => {
    assert.match(source, /AudioContext/);
    assert.match(source, /createBufferSource\(\)/);
    assert.match(source, /createBiquadFilter\(\)/);
    assert.match(source, /createGain\(\)/);
  });

  it('exposes a hook per shuffle phase plus mute and resume controls', () => {
    for (const method of ['riffle(', 'fan(', 'cut(', 'deal(', 'setMuted(', 'resume(']) {
      assert.ok(source.includes(method), `missing SoundEngine method ${method}`);
    }
  });

  it('gates playback behind the muted flag', () => {
    assert.match(source, /if \(this\.muted\) return;/);
  });
});

describe('ShuffleAnimationOverlay component contract', () => {
  let source;
  before(() => {
    source = readSource('components/ShuffleAnimationOverlay.tsx');
  });

  it('exports the component both named and default', () => {
    assert.match(source, /export function ShuffleAnimationOverlay\b/);
    assert.match(source, /export default ShuffleAnimationOverlay/);
  });

  it('subscribes to the engine and drives geometry from cardTransform', () => {
    assert.match(source, /shuffleEngine\.subscribe\(/);
    assert.match(source, /cardTransform\(/);
    assert.match(source, /STACK_SIZE/);
  });

  it('renders a labelled modal that keyboard users can escape', () => {
    assert.match(source, /role="dialog"/);
    assert.match(source, /aria-modal="true"/);
    assert.ok(source.includes("event.key === 'Escape'"));
  });

  it('offers speed, mute and manual trigger affordances', () => {
    assert.match(source, /nextSpeed\(/);
    assert.match(source, /soundEngine\.toggleMuted\(\)/);
    assert.match(source, /shuffleEngine\.start\(/);
  });

  it('honours prefers-reduced-motion', () => {
    assert.ok(source.includes('prefers-reduced-motion'));
  });

  it('tags the stage with the active phase so CSS can select a keyframe set', () => {
    assert.match(source, /data-phase=/);
  });
});

describe('index.css keyframe tokens', () => {
  let css;
  before(() => {
    css = readSource('index.css');
  });

  it('declares every required keyframe', () => {
    for (const name of [
      'md-shuffle-riffle',
      'md-shuffle-fan',
      'md-shuffle-cut',
      'md-card-deal-fly',
    ]) {
      assert.match(css, new RegExp(`@keyframes\\s+${name}\\b`), `missing @keyframes ${name}`);
    }
  });

  it('binds each phase to its keyframe via the data-phase selector', () => {
    for (const phase of ['riffle', 'fan', 'cut', 'dealing']) {
      assert.match(
        css,
        new RegExp(`data-phase='${phase}'`),
        `missing data-phase binding for ${phase}`,
      );
    }
  });

  it('animates in 3D with GPU-friendly properties', () => {
    assert.match(css, /perspective:/);
    assert.match(css, /transform-style:\s*preserve-3d/);
    assert.match(css, /will-change:\s*transform/);
    assert.match(css, /translate3d\(/);
  });

  it('reads per-card custom properties supplied by the overlay', () => {
    for (const token of [
      '--md-shuffle-x',
      '--md-shuffle-y',
      '--md-shuffle-z',
      '--md-shuffle-rot',
      '--md-shuffle-tilt',
      '--md-shuffle-duration',
      '--md-shuffle-delay',
    ]) {
      assert.ok(css.includes(token), `missing custom property ${token}`);
    }
  });

  it('degrades under prefers-reduced-motion', () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  });

  it('sits below the existing gameplay modals', () => {
    const overlay = css.slice(css.indexOf('.md-shuffle-overlay'));
    const zIndex = /z-index:\s*(\d+)/.exec(overlay);
    assert.ok(zIndex, 'overlay must declare a z-index');
    assert.ok(Number(zIndex[1]) < 1000, 'overlay must not cover gameplay modals');
  });
});

describe('view integration', () => {
  it('GameBoardView mounts the overlay and exposes a Shuffle Deck button', () => {
    const source = readSource('components/GameBoardView.tsx');
    assert.match(source, /ShuffleAnimationOverlay/);
    assert.match(source, /triggerShuffle\(/);
    assert.ok(source.includes('Shuffle'), 'action bar must offer a Shuffle Deck button');
  });

  it('LobbyView shuffles on game setup and on rematch', () => {
    const source = readSource('components/LobbyView.tsx');
    assert.match(source, /triggerShuffle\(/);
    assert.ok(source.includes("'game-setup'"), 'missing game-setup shuffle');
  });

  it('DeckStackView animates dealt cards from the deal event', () => {
    const source = readSource('components/DeckStackView.tsx');
    assert.match(source, /onShuffleEvent</);
    assert.match(source, /SHUFFLE_EVENTS\.deal/);
    assert.ok(source.includes('md-deck-card--dealing'));
  });
});

describe('client toolchain', function () {
  this.timeout(5 * 60 * 1000);

  before(function () {
    if (!fs.existsSync(path.join(CLIENT_DIR, 'node_modules'))) {
      this.skip(); // dependencies not installed — nothing to verify
    }
  });

  it('passes ESLint', () => {
    const result = runClientScript('lint');
    assert.equal(result.status, 0, `lint failed:\n${result.stdout}\n${result.stderr}`);
  });

  it('type-checks and builds with Vite', () => {
    const result = runClientScript('build');
    assert.equal(result.status, 0, `build failed:\n${result.stdout}\n${result.stderr}`);
  });
});
