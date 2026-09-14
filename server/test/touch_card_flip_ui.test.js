const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Monopoly Deal Touch Card Flip Engine UI Suite', () => {
  const flipEnginePath = path.join(__dirname, '../../client/src/utils/touchCardFlipEngine.ts');
  const soundEnginePath = path.join(__dirname, '../../client/src/utils/soundEngine.ts');
  const cardViewPath = path.join(__dirname, '../../client/src/components/CardView.tsx');
  const stylesPath = path.join(__dirname, '../../client/src/index.css');

  it('should verify touchCardFlipEngine.ts file existence and gesture flip exports', () => {
    assert.strictEqual(fs.existsSync(flipEnginePath), true, 'touchCardFlipEngine.ts should exist');
    const content = fs.readFileSync(flipEnginePath, 'utf8');

    assert.strictEqual(content.includes('export function getCardColorPair'), true);
    assert.strictEqual(content.includes('export function isFlippableCard'), true);
    assert.strictEqual(content.includes('export function getOppositeColor'), true);
    assert.strictEqual(content.includes('export function getFlippedState'), true);
    assert.strictEqual(content.includes('export function setFlippedState'), true);
    assert.strictEqual(content.includes('export function toggleCardFlip'), true);
    assert.strictEqual(content.includes('export function getActiveColor'), true);
    assert.strictEqual(content.includes('export function subscribeFlip'), true);
    assert.strictEqual(content.includes('export function attachFlipGestures'), true);
    assert.strictEqual(content.includes('WILDCARD_PAIRS'), true);
    assert.strictEqual(content.includes('RENT_PAIRS'), true);
    assert.strictEqual(content.includes('DOUBLE_TAP_WINDOW_MS'), true);
    assert.strictEqual(content.includes('LONG_PRESS_MS'), true);
  });

  it('should verify soundEngine.ts playCardFlip method definition', () => {
    assert.strictEqual(fs.existsSync(soundEnginePath), true, 'soundEngine.ts should exist');
    const content = fs.readFileSync(soundEnginePath, 'utf8');

    assert.strictEqual(content.includes('export function playCardFlip'), true);
    assert.strictEqual(content.includes("throttle('flip'"), true);
  });

  it('should verify CardView.tsx 3D flip integration and badge button', () => {
    assert.strictEqual(fs.existsSync(cardViewPath), true, 'CardView.tsx should exist');
    const content = fs.readFileSync(cardViewPath, 'utf8');

    assert.strictEqual(content.includes('isFlippableCard'), true);
    assert.strictEqual(content.includes('getFlippedState'), true);
    assert.strictEqual(content.includes('toggleCardFlip'), true);
    assert.strictEqual(content.includes('attachFlipGestures'), true);
    assert.strictEqual(content.includes('subscribeFlip'), true);
    assert.strictEqual(content.includes('md-card-flip-scene'), true);
    assert.strictEqual(content.includes('md-card-flip-inner'), true);
    assert.strictEqual(content.includes('md-card-flip-badge'), true);
    assert.strictEqual(content.includes('data-flippable-card='), true);
  });

  it('should verify index.css 3D dual-sided flip CSS tokens', () => {
    assert.strictEqual(fs.existsSync(stylesPath), true, 'index.css should exist');
    const content = fs.readFileSync(stylesPath, 'utf8');

    assert.strictEqual(content.includes('.md-card-flip-scene'), true);
    assert.strictEqual(content.includes('.md-card-flip-inner'), true);
    assert.strictEqual(content.includes('.md-card-face'), true);
    assert.strictEqual(content.includes('.is-flipped'), true);
    assert.strictEqual(content.includes('.md-card-flip-badge'), true);
    assert.strictEqual(content.includes('perspective: 1000px'), true);
    assert.strictEqual(content.includes('transform-style: preserve-3d'), true);
  });
});
