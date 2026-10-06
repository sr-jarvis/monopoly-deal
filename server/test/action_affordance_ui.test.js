'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Action subtype affordance and card preview UI contract', function () {
  const clientRoot = path.join(__dirname, '../../client/src');
  const readClient = (relPath) => fs.readFileSync(path.join(clientRoot, relPath), 'utf8');

  it('narrows center action drag/drop affordance by action subtype instead of every ACTION card', function () {
    const dnd = readClient('utils/dragAndDropEngine.ts');
    assert.ok(dnd.includes('getActionAffordance'), 'drag/drop engine should centralize action subtype affordance lookup');
    assert.ok(dnd.includes("direct-action"), 'standard action cards should be classified as direct action affordances');
    assert.ok(dnd.includes("attach-only"), 'Double The Rent should be classified as attach-only, not center-droppable alone');
    assert.ok(dnd.includes("response-only"), 'Just Say No should be classified as response-only, not center-droppable during normal action phase');
    assert.ok(dnd.includes("board-upgrade"), 'House/Hotel should be recognized as board-upgrade cards with prerequisites');
    assert.ok(!dnd.includes("return kind === 'ACTION' || kind === 'RENT';"), 'center action eligibility must not broadly accept every ACTION/RENT card');
  });

  it('renders an accessible responsive card preview modal for visible cards only', function () {
    const modal = readClient('components/CardPreviewModal.tsx');
    const cardView = readClient('components/CardView.tsx');
    const gameBoard = readClient('components/GameBoardView.tsx');

    assert.ok(modal.includes('role="dialog"'), 'preview modal exposes dialog role');
    assert.ok(modal.includes('aria-modal="true"'), 'preview modal is modal for assistive tech');
    assert.ok(modal.includes('Escape'), 'preview modal supports Escape dismissal');
    assert.ok(modal.includes('max-h-[90vh]'), 'preview modal constrains height responsively');
    assert.ok(cardView.includes('onPreview'), 'CardView exposes a separate inspect/preview affordance');
    assert.ok(cardView.includes('aria-label={`Preview ${cardTitle}`'), 'preview affordance is labelled');
    assert.ok(gameBoard.includes('previewCard'), 'GameBoardView keeps explicit preview state');
    assert.ok(gameBoard.includes('handlePreviewCard'), 'GameBoardView passes preview handlers to visible cards');
    assert.ok(gameBoard.includes('opponent public property cards are previewable'), 'opponent public cards should be previewable by design');
    assert.ok(!gameBoard.includes('opponent.hand.map'), 'opponent hidden hand cards must not be rendered or previewable');
  });
});
