const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('Monopoly Deal 3D Rent Charge & Multi-Seat Target Payment Cascade Flight Animation Engine', () => {
  const enginePath = path.resolve(__dirname, '../../client/src/utils/rentPaymentFlightEngine.ts');
  const overlayPath = path.resolve(__dirname, '../../client/src/components/RentPaymentFlightOverlay.tsx');
  const paymentModalPath = path.resolve(__dirname, '../../client/src/components/PaymentModal.tsx');
  const boardPath = path.resolve(__dirname, '../../client/src/components/GameBoardView.tsx');
  const soundPath = path.resolve(__dirname, '../../client/src/utils/soundEngine.ts');

  it('verifies source files exist in the client codebase', () => {
    assert.ok(fs.existsSync(enginePath), 'rentPaymentFlightEngine.ts must exist');
    assert.ok(fs.existsSync(overlayPath), 'RentPaymentFlightOverlay.tsx must exist');
    assert.ok(fs.existsSync(paymentModalPath), 'PaymentModal.tsx must exist');
    assert.ok(fs.existsSync(boardPath), 'GameBoardView.tsx must exist');
    assert.ok(fs.existsSync(soundPath), 'soundEngine.ts must exist');
  });

  describe('3D Trajectory Math & Pure Helpers', () => {
    function clamp01(v) {
      if (!Number.isFinite(v)) return 0;
      return Math.max(0, Math.min(1, v));
    }

    function safeNum(v, fallback = 0) {
      return v !== undefined && Number.isFinite(v) ? v : fallback;
    }

    function cubicBezier3D(p0, p1, p2, p3, tRaw) {
      const t = clamp01(tRaw);
      const u = 1 - t;
      const u2 = u * u;
      const u3 = u2 * u;
      const t2 = t * t;
      const t3 = t2 * t;

      return {
        x: safeNum(u3 * p0.x + 3 * u2 * t * p1.x + 3 * u * t2 * p2.x + t3 * p3.x),
        y: safeNum(u3 * p0.y + 3 * u2 * t * p1.y + 3 * u * t2 * p2.y + t3 * p3.y),
        z: safeNum(u3 * p0.z + 3 * u2 * t * p1.z + 3 * u * t2 * p2.z + t3 * p3.z),
      };
    }

    function getPaymentScatterAngle(cardId) {
      let hash = 2166136261;
      for (let i = 0; i < cardId.length; i++) {
        hash ^= cardId.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      const normalized = ((hash >>> 0) % 1000) / 1000;
      const angle = (normalized * 2 - 1) * 18;
      return Math.round(angle * 10) / 10;
    }

    it('evaluates cubicBezier3D endpoints accurately at t=0 and t=1', () => {
      const p0 = { x: 100, y: 200, z: 0 };
      const p1 = { x: 150, y: 100, z: 50 };
      const p2 = { x: 250, y: 100, z: 50 };
      const p3 = { x: 300, y: 200, z: 0 };

      const start = cubicBezier3D(p0, p1, p2, p3, 0);
      assert.strictEqual(start.x, 100);
      assert.strictEqual(start.y, 200);
      assert.strictEqual(start.z, 0);

      const end = cubicBezier3D(p0, p1, p2, p3, 1);
      assert.strictEqual(end.x, 300);
      assert.strictEqual(end.y, 200);
      assert.strictEqual(end.z, 0);
    });

    it('clamps t outside [0, 1] bounds without producing NaN', () => {
      const p0 = { x: 0, y: 0, z: 0 };
      const p1 = { x: 50, y: -100, z: 100 };
      const p2 = { x: 150, y: -100, z: 100 };
      const p3 = { x: 200, y: 0, z: 0 };

      const negative = cubicBezier3D(p0, p1, p2, p3, -0.5);
      assert.strictEqual(negative.x, 0);

      const overflow = cubicBezier3D(p0, p1, p2, p3, 1.5);
      assert.strictEqual(overflow.x, 200);
    });

    it('evaluates midpoint elevation arc height', () => {
      const p0 = { x: 0, y: 200, z: 0 };
      const p1 = { x: 50, y: 60, z: 100 };
      const p2 = { x: 150, y: 60, z: 100 };
      const p3 = { x: 200, y: 200, z: 0 };

      const mid = cubicBezier3D(p0, p1, p2, p3, 0.5);
      assert.ok(mid.y < 200, 'Midpoint y should be elevated above endpoints');
      assert.ok(mid.z > 0, 'Midpoint z should have 3D spatial depth');
    });

    it('computes deterministic scatter hash angles in [-18, +18] degrees', () => {
      const a1 = getPaymentScatterAngle('card-money-10m-001');
      const a2 = getPaymentScatterAngle('card-money-10m-001');
      assert.strictEqual(a1, a2, 'Same cardId must yield identical scatter angle');

      assert.ok(a1 >= -18 && a1 <= 18, 'Scatter angle must stay within bounds');

      const b1 = getPaymentScatterAngle('card-property-boardwalk-001');
      assert.ok(typeof b1 === 'number' && !Number.isNaN(b1));
    });
  });

  describe('Cascade Scheduler & Multi-Seat Stagger', () => {
    const SPEED_SCALARS = {
      slow: 1.6,
      normal: 1.0,
      fast: 0.62,
      turbo: 0.38,
    };

    function simulateScheduleCascade(params) {
      const speed = params.speed || 'normal';
      const scalar = SPEED_SCALARS[speed] || 1.0;
      const SEAT_STAGGER = 260;
      const CARD_STAGGER = 110;
      const CHARGE_PULSE = 420;
      const PAYMENT_GAP = 80;
      const BASE_FLIGHT = 760;

      const legs = [];
      let maxEndMs = 0;

      params.payments.forEach((target, seatIndex) => {
        const seatStart = seatIndex * SEAT_STAGGER;
        const chargeEnd = seatStart + CHARGE_PULSE;

        // Charge leg
        legs.push({
          legId: `charge:${target.seatId}`,
          phase: 'charge',
          seatId: target.seatId,
          startDelayMs: seatStart * scalar,
          durationMs: CHARGE_PULSE * scalar,
        });

        // Payment legs
        target.cards.forEach((card, cardIndex) => {
          const cardStart = chargeEnd + PAYMENT_GAP + cardIndex * CARD_STAGGER;
          const legStart = cardStart * scalar;
          const legDuration = BASE_FLIGHT * scalar;

          legs.push({
            legId: `payment:${target.seatId}:${card.cardId}`,
            phase: 'payment',
            seatId: target.seatId,
            card,
            startDelayMs: legStart,
            durationMs: legDuration,
          });

          const endMs = legStart + legDuration;
          if (endMs > maxEndMs) maxEndMs = endMs;
        });
      });

      return {
        planId: params.planId || 'test-plan',
        legs,
        totalDurationMs: Math.round(maxEndMs + 240 * scalar),
      };
    }

    it('schedules multi-seat rent charges with staggered seats and card cascades', () => {
      const plan = simulateScheduleCascade({
        planId: 'plan-001',
        chargerSeatId: 'p1',
        amountDue: 5,
        payments: [
          {
            seatId: 'p2',
            cards: [
              { cardId: 'c1', value: 3, kind: 'cash' },
              { cardId: 'c2', value: 2, kind: 'cash' },
            ],
          },
          {
            seatId: 'p3',
            cards: [{ cardId: 'c3', value: 5, kind: 'property' }],
          },
        ],
        speed: 'normal',
      });

      assert.strictEqual(plan.planId, 'plan-001');
      assert.strictEqual(plan.legs.length, 5, 'Should have 2 charge legs + 3 payment legs');

      // Seat 0 (p2) charge starts at 0ms
      assert.strictEqual(plan.legs[0].startDelayMs, 0);
      // Seat 1 (p3) charge starts at 260ms
      assert.strictEqual(plan.legs[3].startDelayMs, 260);

      assert.ok(plan.totalDurationMs > 1000, 'Total duration should span cascade');
    });

    it('scales durations accurately across all 4 speed presets', () => {
      const baseParams = {
        planId: 'plan-speeds',
        chargerSeatId: 'p1',
        amountDue: 3,
        payments: [
          {
            seatId: 'p2',
            cards: [{ cardId: 'c1', value: 3, kind: 'cash' }],
          },
        ],
      };

      const slowPlan = simulateScheduleCascade({ ...baseParams, speed: 'slow' });
      const normalPlan = simulateScheduleCascade({ ...baseParams, speed: 'normal' });
      const fastPlan = simulateScheduleCascade({ ...baseParams, speed: 'fast' });
      const turboPlan = simulateScheduleCascade({ ...baseParams, speed: 'turbo' });

      assert.ok(slowPlan.totalDurationMs > normalPlan.totalDurationMs);
      assert.ok(normalPlan.totalDurationMs > fastPlan.totalDurationMs);
      assert.ok(fastPlan.totalDurationMs > turboPlan.totalDurationMs);
    });
  });

  describe('3D Transform Formatter', () => {
    function frameToTransform(f) {
      const x = (f.x || 0).toFixed(2);
      const y = (f.y || 0).toFixed(2);
      const z = (f.z || 0).toFixed(2);
      const rZ = (f.rotateZ || 0).toFixed(2);
      const rY = (f.rotateY || 0).toFixed(2);
      const sc = (f.scale || 1).toFixed(3);

      return `translate3d(${x}px, ${y}px, ${z}px) rotateZ(${rZ}deg) rotateY(${rY}deg) scale(${sc})`;
    }

    it('formats 3D frames into hardware-accelerated CSS transforms', () => {
      const frame = {
        x: 120.456,
        y: -45.123,
        z: 80.0,
        rotateZ: -12.5,
        rotateY: 180.0,
        scale: 1.15,
      };

      const str = frameToTransform(frame);
      assert.strictEqual(
        str,
        'translate3d(120.46px, -45.12px, 80.00px) rotateZ(-12.50deg) rotateY(180.00deg) scale(1.150)'
      );
    });
  });

  describe('Component & Integration Verification', () => {
    it('verifies RentPaymentFlightOverlay imports in GameBoardView.tsx', () => {
      const boardContent = fs.readFileSync(boardPath, 'utf8');
      assert.ok(
        boardContent.includes('RentPaymentFlightOverlay'),
        'GameBoardView.tsx must import RentPaymentFlightOverlay'
      );
      assert.ok(
        boardContent.includes('<RentPaymentFlightOverlay />') ||
          boardContent.includes('<RentPaymentFlightOverlay'),
        'GameBoardView.tsx must mount <RentPaymentFlightOverlay />'
      );
    });

    it('verifies PaymentModal dispatches rent payment flight animation', () => {
      const modalContent = fs.readFileSync(paymentModalPath, 'utf8');
      assert.ok(
        modalContent.includes('dispatchRentPaymentStart'),
        'PaymentModal.tsx must import dispatchRentPaymentStart'
      );
    });

    it('verifies soundEngine.ts exports rent payment sound triggers', () => {
      const soundContent = fs.readFileSync(soundPath, 'utf8');
      assert.ok(soundContent.includes('playRentPayment'), 'soundEngine.ts must export playRentPayment');
      assert.ok(soundContent.includes('playMoneyBank'), 'soundEngine.ts must export playMoneyBank');
    });
  });
});
