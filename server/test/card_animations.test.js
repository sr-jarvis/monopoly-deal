const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Card Animation System Keyframes & Contract', () => {
  const cssPath = path.join(__dirname, '../../client/src/index.css');

  it('should verify CSS animation keyframes and tokens exist in index.css', () => {
    assert.strictEqual(fs.existsSync(cssPath), true, 'index.css must exist');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    // Keyframe assertions
    assert.ok(cssContent.includes('@keyframes dealCard'), 'index.css must declare @keyframes dealCard');
    assert.ok(cssContent.includes('@keyframes playCard'), 'index.css must declare @keyframes playCard');
    assert.ok(cssContent.includes('@keyframes cardFlip'), 'index.css must declare @keyframes cardFlip');
    assert.ok(cssContent.includes('@keyframes pulseDraw'), 'index.css must declare @keyframes pulseDraw');
    assert.ok(cssContent.includes('@keyframes cardShine'), 'index.css must declare @keyframes cardShine');

    // Design Tokens assertions
    assert.ok(cssContent.includes('--md-deal-ms'), 'index.css must declare --md-deal-ms');
    assert.ok(cssContent.includes('--md-stagger-ms'), 'index.css must declare --md-stagger-ms');

    // Reduced Motion Accessibility Override
    assert.ok(cssContent.includes('prefers-reduced-motion'), 'index.css must include prefers-reduced-motion override');
  });

  it('should verify CardBackView and DeckStackView component files exist', () => {
    const cardBackPath = path.join(__dirname, '../../client/src/components/CardBackView.tsx');
    const deckStackPath = path.join(__dirname, '../../client/src/components/DeckStackView.tsx');

    assert.strictEqual(fs.existsSync(cardBackPath), true, 'CardBackView.tsx must exist');
    assert.strictEqual(fs.existsSync(deckStackPath), true, 'DeckStackView.tsx must exist');

    const cardBackCode = fs.readFileSync(cardBackPath, 'utf8');
    assert.ok(cardBackCode.includes('CardBackView'), 'CardBackView.tsx must export CardBackView');
    assert.ok(cardBackCode.includes('md-card-back-metallic'), 'CardBackView must use metallic gradient class');

    const deckStackCode = fs.readFileSync(deckStackPath, 'utf8');
    assert.ok(deckStackCode.includes('DeckStackView'), 'DeckStackView.tsx must export DeckStackView');
    assert.ok(deckStackCode.includes('md-deck--pulsing'), 'DeckStackView must support pulsing highlight');
  });
});
