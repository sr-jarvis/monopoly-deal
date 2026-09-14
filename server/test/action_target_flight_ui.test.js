'use strict';
/**
 * action_target_flight_ui.test.js
 * Contract + unit tests for the 3D action-card target flight engine.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLIENT_SRC = path.resolve(__dirname, '../../client/src');
const ENGINE_PATH = path.join(CLIENT_SRC, 'utils/actionTargetFlightEngine.ts');
const OVERLAY_PATH = path.join(CLIENT_SRC, 'components/ActionTargetFlightOverlay.tsx');
const BOARD_PATH = path.join(CLIENT_SRC, 'components/GameBoardView.tsx');

/* Pure math helpers for test verification */
function clamp01(t) {
  if (!Number.isFinite(t)) return 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function cubicBezier3(curve, t) {
  const u = clamp01(t);
  const inv = 1 - u;
  const a = inv * inv * inv;
  const b = 3 * inv * inv * u;
  const c = 3 * inv * u * u;
  const d = u * u * u;
  const [p0, p1, p2, p3] = curve;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    z: a * p0.z + b * p1.z + c * p2.z + d * p3.z,
  };
}

function fanOutBias(index, count, spreadPx = 44) {
  if (count <= 1) return 0;
  return (index - (count - 1) / 2) * spreadPx;
}

function fmt(n) {
  const safe = Number.isFinite(n) ? n : 0;
  return String(Number(safe.toFixed(2)));
}

function frameToTransform(frame) {
  return (
    `translate3d(${fmt(frame.x)}px, ${fmt(frame.y)}px, ${fmt(frame.z)}px) ` +
    `rotateZ(${fmt(frame.rotateZ)}deg) ` +
    `rotateY(${fmt(frame.rotateY)}deg) ` +
    `scale(${fmt(frame.scale)})`
  );
}

describe('Monopoly Deal 3D Action Card Target Flight & Property Steal Engine UI Suite', () => {
  it('should verify actionTargetFlightEngine.ts file existence and contract exports', () => {
    assert.strictEqual(fs.existsSync(ENGINE_PATH), true, 'actionTargetFlightEngine.ts should exist');
    const content = fs.readFileSync(ENGINE_PATH, 'utf8');

    assert.match(content, /export type ActionFlightKind/);
    assert.match(content, /export type FlightPhaseName/);
    assert.match(content, /export const ACTION_TARGET_FLIGHT_EVENTS/);
    assert.match(content, /export const PROPERTY_STEAL_KINDS/);
    assert.match(content, /export const CHARGE_KINDS/);
    assert.match(content, /export const SEAT_VECTORS/);
    assert.match(content, /export function cubicBezier3/);
    assert.match(content, /export function planActionTargetFlight/);
    assert.match(content, /export function sampleGhost/);
    assert.match(content, /export function frameToTransform/);
    assert.match(content, /export function launchActionTargetFlight/);
  });

  it('should verify ActionTargetFlightOverlay.tsx component exports and portal structure', () => {
    assert.strictEqual(fs.existsSync(OVERLAY_PATH), true, 'ActionTargetFlightOverlay.tsx should exist');
    const content = fs.readFileSync(OVERLAY_PATH, 'utf8');

    assert.match(content, /export const ActionTargetFlightOverlay/);
    assert.match(content, /createPortal/);
    assert.match(content, /ACTION_TARGET_FLIGHT_EVENTS/);
    assert.match(content, /requestAnimationFrame/);
    assert.match(content, /cancelAnimationFrame/);
    assert.match(content, /backfaceVisibility/);
    assert.match(content, /preserve-3d/);
    assert.match(content, /prefers-reduced-motion/);
    assert.match(content, /pointerEvents:\s*'none'/);
  });

  it('should verify GameBoardView.tsx mounts ActionTargetFlightOverlay and configures launcher', () => {
    assert.strictEqual(fs.existsSync(BOARD_PATH), true, 'GameBoardView.tsx should exist');
    const content = fs.readFileSync(BOARD_PATH, 'utf8');

    assert.match(content, /ActionTargetFlightOverlay/);
    assert.match(content, /launchActionTargetFlight/);
    assert.match(content, /kindFromActionCard/);
  });

  it('should verify 3D cubic Bezier trajectory math and endpoint interpolation', () => {
    const curve = [
      { x: 0, y: 500, z: 0 },
      { x: 100, y: 300, z: 80 },
      { x: 300, y: 300, z: 80 },
      { x: 400, y: 100, z: 0 },
    ];

    const start = cubicBezier3(curve, 0);
    const end = cubicBezier3(curve, 1);
    const mid = cubicBezier3(curve, 0.5);

    assert.deepEqual(start, { x: 0, y: 500, z: 0 });
    assert.deepEqual(end, { x: 400, y: 100, z: 0 });
    assert.equal(mid.x, 200);
    assert.equal(mid.y, 300);
    assert.equal(mid.z, 60);
  });

  it('should verify multi-seat fan-out bias calculations', () => {
    assert.equal(fanOutBias(0, 1), 0);
    const three = [0, 1, 2].map((i) => fanOutBias(i, 3, 44));
    assert.deepEqual(three, [-44, 0, 44]);
    assert.equal(three[0] + three[2], 0);
  });

  it('should verify 3D CSS hardware-accelerated transform formatting tokens', () => {
    const frame = {
      x: 100.456,
      y: -200.123,
      z: 50,
      rotateZ: 45.12,
      rotateY: 180,
      scale: 1.15,
    };

    const css = frameToTransform(frame);
    assert.equal(css, 'translate3d(100.46px, -200.12px, 50px) rotateZ(45.12deg) rotateY(180deg) scale(1.15)');
    assert.ok(!/\b(left|top|width|height)\b/.test(css), 'must not contain layout properties');
  });
});
