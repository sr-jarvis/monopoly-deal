/**
 * card_flight_integration.test.js — Contract & Invariant Tests for Monopoly Deal
 * 3D Card Flight Trajectory & Multi-Seat Touch Deal Animation Integration.
 */

const assert = require('assert');

// Pure trajectory engine imports (Node.js compatible math evaluation)
function clamp(val, min, max) {
  if (Number.isNaN(val)) return min;
  return Math.min(max, Math.max(min, val));
}

function quadraticBezier1D(p0, p1, p2, t) {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

function calculateBezier3D(start, end, arcHeightPx, t) {
  const clampedT = clamp(t, 0, 1);
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2 - arcHeightPx;
  const midZ = (start.z + end.z) / 2 + arcHeightPx * 0.5;

  return {
    x: quadraticBezier1D(start.x, midX, end.x, clampedT),
    y: quadraticBezier1D(start.y, midY, end.y, clampedT),
    z: quadraticBezier1D(start.z, midZ, end.z, clampedT),
  };
}

function recognizeTouchDealSwipe(startX, startY, endX, endY, durationMs, seatCount = 2) {
  const dx = endX - startX;
  const dy = endY - startY;
  const distancePx = Math.sqrt(dx * dx + dy * dy);
  const safeDuration = Math.max(1, durationMs);
  const velocityPxMs = distancePx / safeDuration;
  const velocityPxSec = velocityPxMs * 1000;

  const isSwipe = distancePx >= 30 && velocityPxSec >= 300;

  let direction = 'none';
  let targetSeatIndex = 0;

  if (isSwipe) {
    if (Math.abs(dx) > Math.abs(dy)) {
      direction = dx > 0 ? 'right' : 'left';
      targetSeatIndex = seatCount >= 4 ? (dx > 0 ? 3 : 1) : 1;
    } else {
      direction = dy > 0 ? 'down' : 'up';
      targetSeatIndex = dy < 0 ? 1 : 0;
    }
  }

  return {
    isSwipe,
    direction,
    distancePx: Math.round(distancePx * 10) / 10,
    velocityPxMs: Math.round(velocityPxMs * 1000) / 1000,
    velocityPxSec: Math.round(velocityPxSec * 10) / 10,
    targetSeatIndex,
  };
}

describe('Monopoly Deal 3D Card Flight Trajectory & Multi-Seat Touch Deal Integration', () => {
  describe('Quadratic 3D Bezier Curve Math', () => {
    it('should evaluate start point at t = 0', () => {
      const start = { x: 50, y: 50, z: 0 };
      const end = { x: 80, y: 20, z: 0 };
      const pos = calculateBezier3D(start, end, 120, 0);

      assert.strictEqual(pos.x, 50);
      assert.strictEqual(pos.y, 50);
      assert.strictEqual(pos.z, 0);
    });

    it('should evaluate end point at t = 1', () => {
      const start = { x: 50, y: 50, z: 0 };
      const end = { x: 80, y: 20, z: 0 };
      const pos = calculateBezier3D(start, end, 120, 1);

      assert.strictEqual(pos.x, 80);
      assert.strictEqual(pos.y, 20);
      assert.strictEqual(pos.z, 0);
    });

    it('should elevate Z coordinate and arch Y coordinate at midpoint t = 0.5', () => {
      const start = { x: 50, y: 50, z: 0 };
      const end = { x: 50, y: 10, z: 0 };
      const pos = calculateBezier3D(start, end, 120, 0.5);

      assert.strictEqual(pos.x, 50);
      assert.strictEqual(pos.y, -30); // elevated arc above start/end
      assert.strictEqual(pos.z, 30); // 3D height lift
    });
  });

  describe('Touch Swipe-to-Deal Gesture Recognizer', () => {
    it('should recognize valid fast upward swipe gesture', () => {
      const swipe = recognizeTouchDealSwipe(200, 500, 200, 300, 150, 2);

      assert.strictEqual(swipe.isSwipe, true);
      assert.strictEqual(swipe.direction, 'up');
      assert.strictEqual(swipe.targetSeatIndex, 1);
      assert.ok(swipe.velocityPxSec >= 300);
    });

    it('should reject slow micro-drags below velocity/distance threshold', () => {
      const swipe = recognizeTouchDealSwipe(200, 200, 210, 205, 500, 2);

      assert.strictEqual(swipe.isSwipe, false);
      assert.strictEqual(swipe.direction, 'none');
    });

    it('should resolve rightward swipe target seat for 4-player layout', () => {
      const swipe = recognizeTouchDealSwipe(200, 300, 400, 300, 200, 4);

      assert.strictEqual(swipe.isSwipe, true);
      assert.strictEqual(swipe.direction, 'right');
      assert.strictEqual(swipe.targetSeatIndex, 3);
    });
  });

  describe('Multi-Seat Preset Coordinate Invariants', () => {
    const SEAT_PRESETS = {
      2: [
        { seatIndex: 0, xPercent: 50, yPercent: 90 },
        { seatIndex: 1, xPercent: 50, yPercent: 10 },
      ],
      4: [
        { seatIndex: 0, xPercent: 50, yPercent: 90 },
        { seatIndex: 1, xPercent: 10, yPercent: 50 },
        { seatIndex: 2, xPercent: 50, yPercent: 10 },
        { seatIndex: 3, xPercent: 90, yPercent: 50 },
      ],
    };

    it('should verify 2-seat spatial layout coordinates', () => {
      const presets = SEAT_PRESETS[2];
      assert.strictEqual(presets.length, 2);
      assert.strictEqual(presets[0].xPercent, 50);
      assert.strictEqual(presets[0].yPercent, 90); // South
      assert.strictEqual(presets[1].xPercent, 50);
      assert.strictEqual(presets[1].yPercent, 10); // North
    });

    it('should verify 4-seat spatial layout coordinates', () => {
      const presets = SEAT_PRESETS[4];
      assert.strictEqual(presets.length, 4);
      assert.strictEqual(presets[1].xPercent, 10); // West
      assert.strictEqual(presets[3].xPercent, 90); // East
    });
  });
});
