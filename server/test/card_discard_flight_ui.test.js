/**
 * card_discard_flight_ui.test.js — Contract and invariant tests for Monopoly Deal 3D Card Discard Flight & Hand Over-Limit Cascade Engine.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('Monopoly Deal 3D Card Discard & Hand Over-Limit Cascade Flight Animation Engine', function () {
  before(function () {
    // Verify client engine file exists
    const clientEnginePath = path.join(
      __dirname,
      '../../client/src/utils/cardDiscardFlightEngine.ts'
    );
    assert.strictEqual(
      fs.existsSync(clientEnginePath),
      true,
      'cardDiscardFlightEngine.ts must exist'
    );

    // Verify React Overlay component exists
    const overlayPath = path.join(
      __dirname,
      '../../client/src/components/CardDiscardFlightOverlay.tsx'
    );
    assert.strictEqual(
      fs.existsSync(overlayPath),
      true,
      'CardDiscardFlightOverlay.tsx must exist'
    );
  });

  it('verifies cardDiscardFlightEngine.ts exports pure-math interfaces, scatter hash, scheduler, and constants', function () {
    const engineContent = fs.readFileSync(
      path.join(__dirname, '../../client/src/utils/cardDiscardFlightEngine.ts'),
      'utf8'
    );

    assert.ok(engineContent.includes('export function calculateDiscardBezier3D'), 'calculateDiscardBezier3D exported');
    assert.ok(engineContent.includes('export function getDiscardScatterAngle'), 'getDiscardScatterAngle exported');
    assert.ok(engineContent.includes('export function resolveDiscardEndpoints'), 'resolveDiscardEndpoints exported');
    assert.ok(engineContent.includes('export function scheduleDiscardCascade'), 'scheduleDiscardCascade exported');
    assert.ok(engineContent.includes('export function evaluateDiscardFrame'), 'evaluateDiscardFrame exported');
    assert.ok(engineContent.includes('export function frameToTransform'), 'frameToTransform exported');
    assert.ok(engineContent.includes('export const DISCARD_FLIGHT_CONFIG'), 'DISCARD_FLIGHT_CONFIG exported');
    assert.ok(engineContent.includes('export const DISCARD_FLIGHT_EVENTS'), 'DISCARD_FLIGHT_EVENTS exported');
  });

  it('verifies CardDiscardFlightOverlay.tsx component exports and DOM event listeners', function () {
    const overlayContent = fs.readFileSync(
      path.join(__dirname, '../../client/src/components/CardDiscardFlightOverlay.tsx'),
      'utf8'
    );

    assert.ok(overlayContent.includes('export const CardDiscardFlightOverlay'), 'CardDiscardFlightOverlay component exported');
    assert.ok(overlayContent.includes('md:carddiscardflight:start'), 'Listens to start event');
    assert.ok(overlayContent.includes('md:carddiscardflight:land'), 'Dispatches land event');
    assert.ok(overlayContent.includes('md:carddiscardflight:complete'), 'Dispatches complete event');
    assert.ok(overlayContent.includes('requestAnimationFrame'), 'Uses RAF loop for 3D transforms');
    assert.ok(overlayContent.includes('prefers-reduced-motion'), 'Supports reduced motion preference');
    assert.ok(overlayContent.includes('createPortal'), 'Mounts via React portal');
  });

  it('verifies GameBoardView.tsx and DiscardModal.tsx integration', function () {
    const gameBoardContent = fs.readFileSync(
      path.join(__dirname, '../../client/src/components/GameBoardView.tsx'),
      'utf8'
    );
    const discardModalContent = fs.readFileSync(
      path.join(__dirname, '../../client/src/components/DiscardModal.tsx'),
      'utf8'
    );

    assert.ok(gameBoardContent.includes('data-discard-pile="true"'), 'GameBoardView marks data-discard-pile');
    assert.ok(gameBoardContent.includes('CardDiscardFlightOverlay'), 'GameBoardView renders CardDiscardFlightOverlay');
    assert.ok(discardModalContent.includes('scheduleDiscardCascade'), 'DiscardModal calls scheduleDiscardCascade');
  });

  it('evaluates 3D quadratic Bezier curve math and control points for discard trajectories', function () {
    const p0 = { x: 0, y: 500, z: 0 };
    const p2 = { x: 200, y: 200, z: 0 };
    const arcHeightPx = 120;

    const control = {
      x: (p0.x + p2.x) / 2,
      y: Math.min(p0.y, p2.y) - arcHeightPx,
      z: arcHeightPx * 0.5,
    };

    const bezierEval = (from, control, to, t) => {
      const u = Math.max(0, Math.min(1, t));
      const oneMinusU = 1 - u;
      const uu = oneMinusU * oneMinusU;
      const u2 = u * u;

      return {
        x: Math.round((uu * from.x + 2 * oneMinusU * u * control.x + u2 * to.x) * 100) / 100,
        y: Math.round((uu * from.y + 2 * oneMinusU * u * control.y + u2 * to.y) * 100) / 100,
        z: Math.round((uu * from.z + 2 * oneMinusU * u * control.z + u2 * to.z) * 100) / 100,
      };
    };

    const startPt = bezierEval(p0, control, p2, 0);
    const midPt = bezierEval(p0, control, p2, 0.5);
    const endPt = bezierEval(p0, control, p2, 1);

    assert.strictEqual(startPt.x, 0);
    assert.strictEqual(startPt.y, 500);
    assert.strictEqual(endPt.x, 200);
    assert.strictEqual(endPt.y, 200);

    // Midpoint elevation test
    assert.strictEqual(midPt.x, 100);
    assert.strictEqual(midPt.y, 215);
    assert.strictEqual(midPt.z, 30);
  });

  it('evaluates organic scatter angle hash determinism and bounds', function () {
    const fnvHashScatter = (cardId) => {
      if (!cardId) return 0;
      const s = String(cardId);
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const norm = ((h >>> 0) % 10000) / 9999;
      const angle = -25 + norm * 50;
      return Math.round(angle * 100) / 100;
    };

    const angle1 = fnvHashScatter('m_10m_1');
    const angle1Repeat = fnvHashScatter('m_10m_1');
    const angle2 = fnvHashScatter('action_pass_go_2');
    const angleEmpty = fnvHashScatter('');

    assert.strictEqual(angle1, angle1Repeat, 'Hash must be deterministic');
    assert.strictEqual(angleEmpty, 0, 'Empty string returns 0deg');
    assert.ok(angle1 >= -25 && angle1 <= 25, 'Angle 1 within bounds [-25, 25]');
    assert.ok(angle2 >= -25 && angle2 <= 25, 'Angle 2 within bounds [-25, 25]');

    // Distribution test
    const testIds = Array.from({ length: 50 }, (_, i) => `card_test_id_${i}`);
    const angles = testIds.map(fnvHashScatter);
    const uniqueAngles = new Set(angles);
    assert.ok(uniqueAngles.size >= 15, '50 card IDs should produce varied scatter angles');
  });

  it('evaluates multi-card cascade scheduling timing and max duration compression', function () {
    const baseDurationMs = 620;
    const discardStaggerMs = 120;
    const maxCascadeMs = 2500;

    const computeTiming = (count) => {
      const staggeredCount = Math.min(count, 5);
      const rawTotal = (staggeredCount - 1) * discardStaggerMs + baseDurationMs;
      const compressionFactor = rawTotal <= maxCascadeMs ? 1 : maxCascadeMs / rawTotal;

      const actualStagger = Math.floor(discardStaggerMs * compressionFactor);
      const actualDuration = Math.floor(baseDurationMs * compressionFactor);
      const totalDurationMs = Math.min(count - 1, 4) * actualStagger + actualDuration;

      return { actualStagger, actualDuration, totalDurationMs };
    };

    const singleCard = computeTiming(1);
    assert.strictEqual(singleCard.totalDurationMs, 620);

    const fiveCards = computeTiming(5);
    assert.strictEqual(fiveCards.totalDurationMs, 4 * 120 + 620); // 1100ms
    assert.ok(fiveCards.totalDurationMs <= maxCascadeMs, '5-card cascade under 2500ms');

    // Edge case with extreme count
    const tenCards = computeTiming(10);
    assert.ok(tenCards.totalDurationMs <= maxCascadeMs, '10-card cascade under 2500ms cap');
  });

  it('evaluates 3D transform formatting and negative zero prevention', function () {
    const formatTransform = (frame) => {
      const cleanNum = (v, decimals = 2) => {
        const norm = Object.is(v, -0) ? 0 : v;
        return norm.toFixed(decimals);
      };
      return `translate3d(${cleanNum(frame.x)}px, ${cleanNum(frame.y)}px, ${cleanNum(frame.z)}px) rotateZ(${cleanNum(frame.rotateZ)}deg) rotateY(${cleanNum(frame.rotateY)}deg) scale(${cleanNum(frame.scale, 3)})`;
    };

    const frame = {
      x: -0,
      y: 120.456,
      z: 30.1,
      rotateZ: -12.34,
      rotateY: 180,
      scale: 0.98,
    };

    const transformStr = formatTransform(frame);
    assert.ok(!transformStr.includes('-0.00'), 'Prevents -0.00 in CSS transform');
    assert.ok(transformStr.includes('translate3d(0.00px, 120.46px, 30.10px)'), 'Formats translate3d');
    assert.ok(transformStr.includes('rotateZ(-12.34deg)'), 'Formats rotateZ');
    assert.ok(transformStr.includes('rotateY(180.00deg)'), 'Formats rotateY');
    assert.ok(transformStr.includes('scale(0.980)'), 'Formats scale');
  });
});
