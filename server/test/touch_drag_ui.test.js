const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Monopoly Deal Touch Drag Gesture Engine UI Suite', () => {
  const touchEnginePath = path.join(__dirname, '../../client/src/utils/touchDragEngine.ts');
  const cardViewPath = path.join(__dirname, '../../client/src/components/CardView.tsx');
  const propGroupPath = path.join(__dirname, '../../client/src/components/PropertyGroupView.tsx');
  const gameBoardPath = path.join(__dirname, '../../client/src/components/GameBoardView.tsx');
  const stylesPath = path.join(__dirname, '../../client/src/index.css');

  it('should verify touchDragEngine.ts file existence and gesture exports', () => {
    assert.strictEqual(fs.existsSync(touchEnginePath), true, 'touchDragEngine.ts should exist');
    const content = fs.readFileSync(touchEnginePath, 'utf8');

    assert.strictEqual(content.includes('export function getTouchDragState'), true);
    assert.strictEqual(content.includes('export function resolveDropTarget'), true);
    assert.strictEqual(content.includes('export function handleTouchStart'), true);
    assert.strictEqual(content.includes('export function handleTouchMove'), true);
    assert.strictEqual(content.includes('export function handleTouchEnd'), true);
    assert.strictEqual(content.includes('TOUCH_DRAG_THRESHOLD_PX'), true);
    assert.strictEqual(content.includes('md-touch-drag-ghost'), true);
  });

  it('should verify CardView.tsx touch gesture props and event bindings', () => {
    assert.strictEqual(fs.existsSync(cardViewPath), true, 'CardView.tsx should exist');
    const content = fs.readFileSync(cardViewPath, 'utf8');

    assert.strictEqual(content.includes('onTouchStartCard?:'), true);
    assert.strictEqual(content.includes('onTouchMoveCard?:'), true);
    assert.strictEqual(content.includes('onTouchEndCard?:'), true);
    assert.strictEqual(content.includes('onTouchStart={isDraggable ? handleTouchStart : undefined}'), true);
    assert.strictEqual(content.includes('data-draggable-card='), true);
  });

  it('should verify PropertyGroupView.tsx touch drop zone data attributes', () => {
    assert.strictEqual(fs.existsSync(propGroupPath), true, 'PropertyGroupView.tsx should exist');
    const content = fs.readFileSync(propGroupPath, 'utf8');

    assert.strictEqual(content.includes('data-drop-zone="PROPERTY"'), true);
    assert.strictEqual(content.includes('data-drop-color={color}'), true);
  });

  it('should verify GameBoardView.tsx Action and Bank drop zone touch attributes and touch handlers', () => {
    assert.strictEqual(fs.existsSync(gameBoardPath), true, 'GameBoardView.tsx should exist');
    const content = fs.readFileSync(gameBoardPath, 'utf8');

    assert.strictEqual(content.includes('data-drop-zone="ACTION"'), true);
    assert.strictEqual(content.includes('data-drop-zone="BANK"'), true);
    assert.strictEqual(content.includes('handleTouchStart'), true);
    assert.strictEqual(content.includes('handleTouchMove'), true);
    assert.strictEqual(content.includes('handleTouchEnd'), true);
    assert.strictEqual(content.includes('DRAG_EVENTS.DROP'), true);
  });

  it('should verify index.css touch gesture ghost and drop hover styles', () => {
    assert.strictEqual(fs.existsSync(stylesPath), true, 'index.css should exist');
    const content = fs.readFileSync(stylesPath, 'utf8');

    assert.strictEqual(content.includes('.md-touch-drop-hover'), true);
    assert.strictEqual(content.includes('#md-touch-drag-ghost'), true);
  });
});
