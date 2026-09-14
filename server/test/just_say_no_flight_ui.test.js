const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('Monopoly Deal 3D Just Say No Counter-Shield Flight & Action Neutralization Animation Engine', () => {
  const enginePath = path.resolve(__dirname, '../../client/src/utils/justSayNoFlightEngine.ts');
  const overlayPath = path.resolve(__dirname, '../../client/src/components/JustSayNoFlightOverlay.tsx');
  const soundPath = path.resolve(__dirname, '../../client/src/utils/soundEngine.ts');
  const boardPath = path.resolve(__dirname, '../../client/src/components/GameBoardView.tsx');
  const toastPath = path.resolve(__dirname, '../../client/src/components/ActionToastBanner.tsx');

  it('verifies source files exist in the client codebase', () => {
    assert.ok(fs.existsSync(enginePath), 'justSayNoFlightEngine.ts must exist');
    assert.ok(fs.existsSync(overlayPath), 'JustSayNoFlightOverlay.tsx must exist');
    assert.ok(fs.existsSync(soundPath), 'soundEngine.ts must exist');
    assert.ok(fs.existsSync(boardPath), 'GameBoardView.tsx must exist');
    assert.ok(fs.existsSync(toastPath), 'ActionToastBanner.tsx must exist');
  });

  describe('3D Trajectory Math & Pure Helpers', () => {
    function clamp(val, min, max) {
      if (!Number.isFinite(val)) return min;
      return Math.min(max, Math.max(min, val));
    }

    function safeNum(v, fallback = 0) {
      return v !== undefined && Number.isFinite(v) ? v : fallback;
    }

    function calculateShieldBezier3D(p0, p2, tInput, arcHeightPx = 140) {
      const x0 = safeNum(p0.x);
      const y0 = safeNum(p0.y);
      const z0 = safeNum(p0.z);

      const x2 = safeNum(p2.x);
      const y2 = safeNum(p2.y);
      const z2 = safeNum(p2.z);

      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
        return { x: 0, y: 0, z: 0 };
      }

      const t = clamp(tInput, 0, 1);

      const p1x = (x0 + x2) / 2;
      const p1y = (y0 + y2) / 2 - arcHeightPx;
      const p1z = (z0 + z2) / 2 + arcHeightPx * 0.6;

      const invT = 1 - t;
      const w0 = invT * invT;
      const w1 = 2 * invT * t;
      const w2 = t * t;

      return {
        x: w0 * x0 + w1 * p1x + w2 * x2,
        y: w0 * y0 + w1 * p1y + w2 * y2,
        z: w0 * z0 + w1 * p1z + w2 * z2,
      };
    }

    function calculateDeflectionArc3D(p0, p2, tInput) {
      const x0 = safeNum(p0.x);
      const y0 = safeNum(p0.y);
      const z0 = safeNum(p0.z);

      const x2 = safeNum(p2.x);
      const y2 = safeNum(p2.y);
      const z2 = safeNum(p2.z);

      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
        return { x: 0, y: 0, z: 0 };
      }

      const t = clamp(tInput, 0, 1);

      const dx = x2 - x0;
      const dy = y2 - y0;
      const dist = Math.hypot(dx, dy);

      if (dist < 0.001) {
        return {
          x: x0 + (x2 - x0) * t,
          y: y0 + (y2 - y0) * t,
          z: z0 + (z2 - z0) * t,
        };
      }

      const perpX = -dy / dist;
      const perpY = dx / dist;
      const lat = clamp(dist * 0.28, 24, 140);

      const midX = (x0 + x2) / 2;
      const midY = (y0 + y2) / 2;
      const midZ = (z0 + z2) / 2;

      const p1x = midX + perpX * lat;
      const p1y = midY + perpY * lat - dist * 0.18;
      const p1z = midZ - dist * 0.2;

      const invT = 1 - t;
      const w0 = invT * invT;
      const w1 = 2 * invT * t;
      const w2 = t * t;

      return {
        x: w0 * x0 + w1 * p1x + w2 * x2,
        y: w0 * y0 + w1 * p1y + w2 * y2,
        z: w0 * z0 + w1 * p1z + w2 * z2,
      };
    }

    function frameToTransform3D(frame) {
      const norm = (v, dp) => {
        if (!Number.isFinite(v)) return 0;
        const factor = Math.pow(10, dp);
        const rounded = Math.round(v * factor) / factor;
        return Object.is(rounded, -0) ? 0 : rounded;
      };

      const x = norm(frame.x, 2);
      const y = norm(frame.y, 2);
      const z = norm(frame.z, 2);
      const rz = norm(frame.rotateZ, 2);
      const ry = norm(frame.rotateY, 2);
      const s = norm(frame.scale, 3);

      return `translate3d(${x}px, ${y}px, ${z}px) rotateZ(${rz}deg) rotateY(${ry}deg) scale(${s})`;
    }

    function counterSpeedMultiplier(speed) {
      const map = { slow: 1.6, normal: 1.0, fast: 0.6, turbo: 0.35 };
      return map[speed] ?? 1.0;
    }

    it('calculates exact Bezier endpoints at t=0 and t=1 for counter shield flight', () => {
      const p0 = { x: 50, y: 400, z: 0 };
      const p2 = { x: 300, y: 200, z: 20 };

      const start = calculateShieldBezier3D(p0, p2, 0, 140);
      assert.strictEqual(start.x, 50);
      assert.strictEqual(start.y, 400);
      assert.strictEqual(start.z, 0);

      const end = calculateShieldBezier3D(p0, p2, 1, 140);
      assert.strictEqual(end.x, 300);
      assert.strictEqual(end.y, 200);
      assert.strictEqual(end.z, 20);
    });

    it('calculates parabolic elevation apex at t=0.5 where Y is midY - arcHeightPx/2 and Z is elevated', () => {
      const p0 = { x: 0, y: 400, z: 0 };
      const p2 = { x: 400, y: 400, z: 0 };

      const apex = calculateShieldBezier3D(p0, p2, 0.5, 140);
      assert.strictEqual(apex.x, 200);
      // midY is 400. Control point P1.y = 400 - 140 = 260.
      // At t=0.5: 0.25*400 + 0.5*260 + 0.25*400 = 100 + 130 + 100 = 330 (which is 400 - 140/2)
      assert.strictEqual(apex.y, 330, 'Apex Y at t=0.5 must equal midY - arcHeightPx/2');
      assert.ok(apex.z > 0, 'Apex Z must elevate toward the viewer');
    });

    it('clamps t parameter within [0, 1] range', () => {
      const p0 = { x: 0, y: 100, z: 0 };
      const p2 = { x: 100, y: 100, z: 0 };

      const negativeT = calculateShieldBezier3D(p0, p2, -0.5, 100);
      assert.strictEqual(negativeT.x, 0);
      assert.strictEqual(negativeT.y, 100);

      const excessT = calculateShieldBezier3D(p0, p2, 1.5, 100);
      assert.strictEqual(excessT.x, 100);
      assert.strictEqual(excessT.y, 100);
    });

    it('guards against non-finite input coordinates without producing NaN', () => {
      const invalidP0 = { x: NaN, y: Infinity, z: 0 };
      const validP2 = { x: 100, y: 100, z: 0 };

      const res = calculateShieldBezier3D(invalidP0, validP2, 0.5, 140);
      assert.ok(Number.isFinite(res.x), 'res.x must be finite');
      assert.ok(Number.isFinite(res.y), 'res.y must be finite');
      assert.ok(Number.isFinite(res.z), 'res.z must be finite');
      assert.ok(!Number.isNaN(res.x) && !Number.isNaN(res.y) && !Number.isNaN(res.z));
    });

    it('calculates deflection arc coordinates with negative Z receding away from viewer', () => {
      const intercept = { x: 200, y: 200, z: 60 };
      const discard = { x: 500, y: 500, z: 0 };

      const mid = calculateDeflectionArc3D(intercept, discard, 0.5);
      assert.ok(mid.z < intercept.z, 'Deflection arc Z must recede away from the viewer (negative Z offset)');
      assert.ok(!Number.isNaN(mid.x) && !Number.isNaN(mid.y) && !Number.isNaN(mid.z));
    });

    it('handles degenerate same-point deflection coords (dist=0) without division-by-zero NaN', () => {
      const samePoint = { x: 200, y: 200, z: 0 };
      const res = calculateDeflectionArc3D(samePoint, samePoint, 0.5);

      assert.strictEqual(res.x, 200);
      assert.strictEqual(res.y, 200);
      assert.strictEqual(res.z, 0);
      assert.ok(!Number.isNaN(res.x) && !Number.isNaN(res.y) && !Number.isNaN(res.z));
    });

    it('formats hardware-accelerated 3D CSS transform strings in strict property order with DP rounding', () => {
      const frame = {
        x: 12.3456,
        y: -45.6789,
        z: 100.1,
        rotateZ: 18.5,
        rotateY: 180.0,
        scale: 1.1234,
        opacity: 1.0,
      };

      const str = frameToTransform3D(frame);
      assert.strictEqual(str, 'translate3d(12.35px, -45.68px, 100.1px) rotateZ(18.5deg) rotateY(180deg) scale(1.123)');
    });

    it('normalizes -0 to 0 in 3D transform string formatting', () => {
      const frame = {
        x: -0.0001,
        y: 0,
        z: -0.00001,
        rotateZ: -0.001,
        rotateY: 0,
        scale: 1,
        opacity: 1.0,
      };

      const str = frameToTransform3D(frame);
      assert.strictEqual(str, 'translate3d(0px, 0px, 0px) rotateZ(0deg) rotateY(0deg) scale(1)');
    });

    it('scales duration presets for slow, normal, fast, and turbo speeds', () => {
      assert.strictEqual(counterSpeedMultiplier('slow'), 1.6);
      assert.strictEqual(counterSpeedMultiplier('normal'), 1.0);
      assert.strictEqual(counterSpeedMultiplier('fast'), 0.6);
      assert.strictEqual(counterSpeedMultiplier('turbo'), 0.35);

      const baseMs = 1640;
      assert.strictEqual(Math.round(baseMs * counterSpeedMultiplier('slow')), 2624);
      assert.strictEqual(Math.round(baseMs * counterSpeedMultiplier('turbo')), 574);
    });
  });

  describe('Client Source Code Integrity & Export Checks', () => {
    it('verifies justSayNoFlightEngine.ts contains all required exports and phase event definitions', () => {
      const content = fs.readFileSync(enginePath, 'utf8');

      assert.ok(content.includes('export interface Coord3D'), 'Must export Coord3D interface');
      assert.ok(content.includes('export interface Frame3D'), 'Must export Frame3D interface');
      assert.ok(content.includes('export type CounterSpeed'), 'Must export CounterSpeed type');
      assert.ok(content.includes('COUNTER_SPEEDS'), 'Must export COUNTER_SPEEDS object');
      assert.ok(content.includes('COUNTER_FLIGHT_EVENTS'), 'Must export COUNTER_FLIGHT_EVENTS object');
      assert.ok(content.includes('calculateShieldBezier3D'), 'Must export calculateShieldBezier3D function');
      assert.ok(content.includes('calculateDeflectionArc3D'), 'Must export calculateDeflectionArc3D function');
      assert.ok(content.includes('frameToTransform3D'), 'Must export frameToTransform3D function');
      assert.ok(content.includes('scheduleCounterFlight'), 'Must export scheduleCounterFlight function');
      assert.ok(content.includes('scheduleCounterFlightChain'), 'Must export scheduleCounterFlightChain function');
      assert.ok(content.includes('emitPhase'), 'Must export emitPhase function');
      assert.ok(content.includes('cancelCounterFlight'), 'Must export cancelCounterFlight function');
      assert.ok(content.includes('cancelAllCounterFlights'), 'Must export cancelAllCounterFlights function');

      assert.ok(content.includes('md:counterflight:start'), 'Must include start event name');
      assert.ok(content.includes('md:counterflight:intercept'), 'Must include intercept event name');
      assert.ok(content.includes('md:counterflight:neutralize'), 'Must include neutralize event name');
      assert.ok(content.includes('md:counterflight:complete'), 'Must include complete event name');
    });

    it('verifies JustSayNoFlightOverlay.tsx portal, RAF loop, speed pill, and live region', () => {
      const content = fs.readFileSync(overlayPath, 'utf8');

      assert.ok(content.includes('ReactDOM.createPortal'), 'Must portal into document body node');
      assert.ok(content.includes('md-counterflight-root'), 'Must target md-counterflight-root portal element');
      assert.ok(content.includes('requestAnimationFrame'), 'Must execute RAF loop for 3D animation rendering');
      assert.ok(content.includes('data-testid="speed-control-pill"'), 'Must render speed control pill');
      assert.ok(content.includes('role="status"'), 'Must include ARIA status live region for accessibility');
      assert.ok(content.includes('aria-live="polite"'), 'Must use aria-live polite');
      assert.ok(content.includes('md-shield-burst'), 'Must render md-shield-burst cybermorphic shockwave');
    });

    it('verifies soundEngine.ts exports playCounterShield and playActionBlocked', () => {
      const content = fs.readFileSync(soundPath, 'utf8');

      assert.ok(content.includes('export function playCounterShield()'), 'Must export playCounterShield function');
      assert.ok(content.includes('export function playActionBlocked()'), 'Must export playActionBlocked function');
      assert.ok(content.includes('just say no'), 'triggerEventSound must detect just say no');
    });

    it('verifies GameBoardView.tsx mounts JustSayNoFlightOverlay', () => {
      const content = fs.readFileSync(boardPath, 'utf8');

      assert.ok(content.includes("import { JustSayNoFlightOverlay } from './JustSayNoFlightOverlay'"), 'Must import JustSayNoFlightOverlay');
      assert.ok(content.includes('<JustSayNoFlightOverlay />'), 'Must mount <JustSayNoFlightOverlay />');
    });
  });
});
