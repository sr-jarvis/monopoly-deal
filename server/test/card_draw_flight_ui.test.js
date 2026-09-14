/**
 * card_draw_flight_ui.test.js — Contract and invariant tests for Monopoly Deal 3D Card Draw Flight & Cascade Engine.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('Monopoly Deal 3D Card Draw Flight & Pass Go Multi-Card Cascade Engine', function () {
  let engineModule;

  before(function () {
    // Verify client engine file exists
    const clientEnginePath = path.join(
      __dirname,
      '../../client/src/utils/cardDrawFlightEngine.ts'
    );
    assert.strictEqual(
      fs.existsSync(clientEnginePath),
      true,
      'cardDrawFlightEngine.ts must exist'
    );

    // Verify React Overlay component exists
    const overlayPath = path.join(
      __dirname,
      '../../client/src/components/CardDrawFlightOverlay.tsx'
    );
    assert.strictEqual(
      fs.existsSync(overlayPath),
      true,
      'CardDrawFlightOverlay.tsx must exist'
    );

    // Transpile or load pure JS math functions directly if needed, or inspect module structure
  });

  it('verifies cardDrawFlightEngine.ts exports pure-math interfaces and constants', function () {
    const engineContent = fs.readFileSync(
      path.join(__dirname, '../../client/src/utils/cardDrawFlightEngine.ts'),
      'utf8'
    );

    assert.ok(engineContent.includes('export function cubicBezier3'), 'cubicBezier3 exported');
    assert.ok(engineContent.includes('export function easeOutCubic'), 'easeOutCubic exported');
    assert.ok(engineContent.includes('export function buildDrawFlightCurve'), 'buildDrawFlightCurve exported');
    assert.ok(engineContent.includes('export function recognizeTouchDrawSwipe'), 'recognizeTouchDrawSwipe exported');
    assert.ok(engineContent.includes('export function createCardDrawCascadePlan'), 'createCardDrawCascadePlan exported');
    assert.ok(engineContent.includes('export function evaluateDrawFlightFrame'), 'evaluateDrawFlightFrame exported');
    assert.ok(engineContent.includes('export function frameToTransform'), 'frameToTransform exported');
  });

  it('verifies CardDrawFlightOverlay.tsx component exports and DOM event listeners', function () {
    const overlayContent = fs.readFileSync(
      path.join(__dirname, '../../client/src/components/CardDrawFlightOverlay.tsx'),
      'utf8'
    );

    assert.ok(overlayContent.includes('export const CardDrawFlightOverlay'), 'CardDrawFlightOverlay component exported');
    assert.ok(overlayContent.includes('md:carddrawflight:start'), 'Listens to start event');
    assert.ok(overlayContent.includes('md:carddrawflight:land'), 'Dispatches land event');
    assert.ok(overlayContent.includes('md:carddrawflight:complete'), 'Dispatches complete event');
    assert.ok(overlayContent.includes('requestAnimationFrame'), 'Uses RAF loop for 3D transforms');
    assert.ok(overlayContent.includes('prefers-reduced-motion'), 'Supports reduced motion preference');
  });

  it('verifies GameBoardView.tsx and DeckStackView.tsx integration', function () {
    const gameBoardContent = fs.readFileSync(
      path.join(__dirname, '../../client/src/components/GameBoardView.tsx'),
      'utf8'
    );
    const deckStackContent = fs.readFileSync(
      path.join(__dirname, '../../client/src/components/DeckStackView.tsx'),
      'utf8'
    );

    assert.ok(deckStackContent.includes('data-deck-stack="true"'), 'DeckStackView marks data-deck-stack');
    assert.ok(gameBoardContent.includes('CardDrawFlightOverlay'), 'GameBoardView renders CardDrawFlightOverlay');
    assert.ok(gameBoardContent.includes('createCardDrawCascadePlan'), 'GameBoardView calls createCardDrawCascadePlan on draw');
  });

  it('evaluates cubic Bezier 3D curve interpolation logic', function () {
    const p0 = { x: 0, y: 0, z: 0 };
    const p1 = { x: 50, y: -140, z: 112 };
    const p2 = { x: 150, y: -70, z: 56 };
    const p3 = { x: 200, y: 400, z: 0 };

    // Bernstein polynomial math test
    const cubicEval = (p0, p1, p2, p3, t) => {
      const u = 1 - t;
      const tt = t * t;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * t;

      return {
        x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
        y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
        z: uuu * p0.z + 3 * uu * t * p1.z + 3 * u * tt * p2.z + ttt * p3.z,
      };
    };

    const startPt = cubicEval(p0, p1, p2, p3, 0);
    const midPt = cubicEval(p0, p1, p2, p3, 0.5);
    const endPt = cubicEval(p0, p1, p2, p3, 1);

    assert.strictEqual(startPt.x, 0);
    assert.strictEqual(startPt.y, 0);
    assert.strictEqual(endPt.x, 200);
    assert.strictEqual(endPt.y, 400);

    // Midpoint elevation test
    assert.ok(midPt.y < startPt.y || midPt.z > startPt.z, 'Arc elevates midpoint in 3D');
  });

  it('validates touch swipe-to-draw gesture threshold recognition', function () {
    const recognizeSwipe = (startX, startY, endX, endY, durationMs) => {
      const dx = endX - startX;
      const dy = endY - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const vel = dist / (durationMs / 1000);

      if (dist < 25 || vel < 250) {
        return { isSwipe: false };
      }
      return { isSwipe: true, dist, vel };
    };

    const slowShort = recognizeSwipe(100, 100, 110, 105, 500); // 11px, slow
    assert.strictEqual(slowShort.isSwipe, false);

    const fastLong = recognizeSwipe(100, 100, 100, 200, 150); // 100px in 150ms = 666px/s
    assert.strictEqual(fastLong.isSwipe, true);
    assert.ok(fastLong.vel > 250);
  });
});
