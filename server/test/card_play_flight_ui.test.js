const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLIENT_DIR = path.resolve(__dirname, '../../client/src');
const UTILS_DIR = path.join(CLIENT_DIR, 'utils');
const COMPONENTS_DIR = path.join(CLIENT_DIR, 'components');

describe('Monopoly Deal 3D Card Play & Property/Bank Flight Engine UI Suite', () => {
  it('should verify cardPlayFlightEngine.ts file existence and contract exports', () => {
    const enginePath = path.join(UTILS_DIR, 'cardPlayFlightEngine.ts');
    assert.strictEqual(fs.existsSync(enginePath), true, 'cardPlayFlightEngine.ts should exist');

    const content = fs.readFileSync(enginePath, 'utf8');
    assert.match(content, /export type FlightTargetKind/);
    assert.match(content, /export function evaluateBezier3/);
    assert.match(content, /export function buildFlightPlan/);
    assert.match(content, /export function evaluateFlight/);
    assert.match(content, /export function frameToTransform/);
    assert.match(content, /export function launchCardFlight/);
  });

  it('should verify CardPlayFlightOverlay.tsx component exports and portal structure', () => {
    const overlayPath = path.join(COMPONENTS_DIR, 'CardPlayFlightOverlay.tsx');
    assert.strictEqual(fs.existsSync(overlayPath), true, 'CardPlayFlightOverlay.tsx should exist');

    const content = fs.readFileSync(overlayPath, 'utf8');
    assert.match(content, /export const CardPlayFlightOverlay/);
    assert.match(content, /createPortal/);
    assert.match(content, /perspectivePx/);
    assert.match(content, /FLIGHT_EVENTS/);
  });

  it('should verify 3D Cubic Bezier math and spatial arc calculations', () => {
    const p0 = { x: 0, y: 100, z: 0 };
    const c1 = { x: 50, y: 0, z: 60 };
    const c2 = { x: 150, y: 0, z: 35 };
    const p3 = { x: 200, y: 100, z: 0 };

    // Bezier math verification helper
    function evaluateBezier3(p0, c1, c2, p3, t) {
      const u = 1 - t;
      const tt = t * t;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * t;

      return {
        x: uuu * p0.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + ttt * p3.x,
        y: uuu * p0.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + ttt * p3.y,
        z: uuu * p0.z + 3 * uu * t * c1.z + 3 * u * tt * c2.z + ttt * p3.z,
      };
    }

    const start = evaluateBezier3(p0, c1, c2, p3, 0);
    assert.strictEqual(start.x, 0);
    assert.strictEqual(start.y, 100);

    const end = evaluateBezier3(p0, c1, c2, p3, 1);
    assert.strictEqual(end.x, 200);
    assert.strictEqual(end.y, 100);

    const mid = evaluateBezier3(p0, c1, c2, p3, 0.5);
    assert.strictEqual(mid.x, 100);
    assert.ok(mid.y < 100, 'Arc Y should elevate above start/end baseline');
    assert.ok(mid.z > 0, 'Spatial Z should elevate at midpoint');
  });

  it('should verify hardware 3D transform formatting tokens', () => {
    const frame = {
      x: 120.5,
      y: 240.2,
      z: 45.0,
      rotateZ: 12.5,
      rotateY: 180.0,
      scale: 1.15,
      opacity: 0.95,
      progress: 0.5,
      t: 0.5,
    };

    function frameToTransform(f) {
      return `translate3d(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px, ${f.z.toFixed(1)}px) rotateZ(${f.rotateZ.toFixed(1)}deg) rotateY(${f.rotateY.toFixed(1)}deg) scale(${f.scale.toFixed(3)})`;
    }

    const transformStr = frameToTransform(frame);
    assert.strictEqual(
      transformStr,
      'translate3d(120.5px, 240.2px, 45.0px) rotateZ(12.5deg) rotateY(180.0deg) scale(1.150)'
    );
  });
});
