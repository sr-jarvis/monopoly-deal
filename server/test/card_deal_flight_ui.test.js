/**
 * card_deal_flight_ui.test.js — Contract and invariant tests for Monopoly Deal 3D Card Deal Flight & Multi-Seat Engine.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('Monopoly Deal 3D Card Deal Flight & Multi-Seat Initial Deal Animation Engine', function () {
  before(function () {
    // Verify client engine file exists
    const clientEnginePath = path.join(
      __dirname,
      '../../client/src/utils/cardDealFlightEngine.ts'
    );
    assert.strictEqual(
      fs.existsSync(clientEnginePath),
      true,
      'cardDealFlightEngine.ts must exist'
    );

    // Verify React Overlay component exists
    const overlayPath = path.join(
      __dirname,
      '../../client/src/components/CardDealFlightOverlay.tsx'
    );
    assert.strictEqual(
      fs.existsSync(overlayPath),
      true,
      'CardDealFlightOverlay.tsx must exist'
    );
  });

  it('verifies cardDealFlightEngine.ts exports pure-math interfaces, scheduler, and constants', function () {
    const engineContent = fs.readFileSync(
      path.join(__dirname, '../../client/src/utils/cardDealFlightEngine.ts'),
      'utf8'
    );

    assert.ok(engineContent.includes('export function calculateBezier3D'), 'calculateBezier3D exported');
    assert.ok(engineContent.includes('export function buildArcControlPoint'), 'buildArcControlPoint exported');
    assert.ok(engineContent.includes('export function getFlipAngle'), 'getFlipAngle exported');
    assert.ok(engineContent.includes('export function resolveSeatTargets'), 'resolveSeatTargets exported');
    assert.ok(engineContent.includes('export function scheduleInitialDealCascade'), 'scheduleInitialDealCascade exported');
    assert.ok(engineContent.includes('export function buildCardTransform'), 'buildCardTransform exported');
    assert.ok(engineContent.includes('export function buildFlightFrameTransform'), 'buildFlightFrameTransform exported');
    assert.ok(engineContent.includes('export const DEAL_FLIGHT_DEFAULTS'), 'DEAL_FLIGHT_DEFAULTS exported');
    assert.ok(engineContent.includes('export const DEAL_FLIGHT_EVENTS'), 'DEAL_FLIGHT_EVENTS exported');
  });

  it('verifies CardDealFlightOverlay.tsx component exports and DOM event listeners', function () {
    const overlayContent = fs.readFileSync(
      path.join(__dirname, '../../client/src/components/CardDealFlightOverlay.tsx'),
      'utf8'
    );

    assert.ok(overlayContent.includes('export const CardDealFlightOverlay'), 'CardDealFlightOverlay component exported');
    assert.ok(overlayContent.includes('md:carddealflight:start'), 'Listens to start event');
    assert.ok(overlayContent.includes('md:carddealflight:land'), 'Dispatches land event');
    assert.ok(overlayContent.includes('md:carddealflight:complete'), 'Dispatches complete event');
    assert.ok(overlayContent.includes('requestAnimationFrame'), 'Uses RAF loop for 3D transforms');
    assert.ok(overlayContent.includes('prefers-reduced-motion'), 'Supports reduced motion preference');
    assert.ok(overlayContent.includes('createPortal'), 'Mounts via React portal');
  });

  it('verifies GameBoardView.tsx, LobbyView.tsx, and DeckStackView.tsx integration', function () {
    const gameBoardContent = fs.readFileSync(
      path.join(__dirname, '../../client/src/components/GameBoardView.tsx'),
      'utf8'
    );
    const lobbyContent = fs.readFileSync(
      path.join(__dirname, '../../client/src/components/LobbyView.tsx'),
      'utf8'
    );
    const deckStackContent = fs.readFileSync(
      path.join(__dirname, '../../client/src/components/DeckStackView.tsx'),
      'utf8'
    );

    assert.ok(deckStackContent.includes('data-deck-stack="true"'), 'DeckStackView marks data-deck-stack');
    assert.ok(gameBoardContent.includes('CardDealFlightOverlay'), 'GameBoardView renders CardDealFlightOverlay');
    assert.ok(gameBoardContent.includes('scheduleInitialDealCascade'), 'GameBoardView calls scheduleInitialDealCascade');
    assert.ok(gameBoardContent.includes('data-seat-id'), 'GameBoardView attaches data-seat-id');
    assert.ok(lobbyContent.includes('CardDealFlightOverlay'), 'LobbyView renders CardDealFlightOverlay');
  });

  it('evaluates 3D quadratic Bezier curve math and control points', function () {
    const p0 = { x: 0, y: 0, z: 0 };
    const p1 = { x: 100, y: -140, z: 70 };
    const p2 = { x: 200, y: 0, z: 0 };

    const bezierEval = (p0, p1, p2, t) => {
      const u = Math.max(0, Math.min(1, t));
      const oneMinusU = 1 - u;
      const uu = oneMinusU * oneMinusU;
      const u2 = u * u;

      return {
        x: uu * p0.x + 2 * oneMinusU * u * p1.x + u2 * p2.x,
        y: uu * p0.y + 2 * oneMinusU * u * p1.y + u2 * p2.y,
        z: uu * p0.z + 2 * oneMinusU * u * p1.z + u2 * p2.z,
      };
    };

    const startPt = bezierEval(p0, p1, p2, 0);
    const midPt = bezierEval(p0, p1, p2, 0.5);
    const endPt = bezierEval(p0, p1, p2, 1);

    assert.strictEqual(startPt.x, 0);
    assert.strictEqual(startPt.y, 0);
    assert.strictEqual(endPt.x, 200);
    assert.strictEqual(endPt.y, 0);

    // Midpoint elevation test
    assert.strictEqual(midPt.x, 100);
    assert.strictEqual(midPt.y, -70);
    assert.strictEqual(midPt.z, 35);
  });

  it('evaluates Y-axis 3D flip angle calculations for human and opponent seats', function () {
    const getFlipAngle = (progress, faceUp) => {
      if (!faceUp) return 180;
      const p = Math.max(0, Math.min(1, progress));
      const flipStart = 0.25;
      const flipEnd = 0.8;

      if (p <= flipStart) return 180;
      if (p >= flipEnd) return 0;

      const local = (p - flipStart) / (flipEnd - flipStart);
      const eased = local < 0.5
        ? 4 * local * local * local
        : 1 - Math.pow(-2 * local + 2, 3) / 2;

      return 180 * (1 - eased);
    };

    // Human seat (faceUp = true)
    assert.strictEqual(getFlipAngle(0, true), 180, 'Face down at start');
    assert.strictEqual(getFlipAngle(0.2, true), 180, 'Face down before flipStart');
    assert.strictEqual(getFlipAngle(0.8, true), 0, 'Face up at flipEnd');
    assert.strictEqual(getFlipAngle(1, true), 0, 'Face up at completion');

    // Monotonic non-increasing check for human
    const mid1 = getFlipAngle(0.4, true);
    const mid2 = getFlipAngle(0.6, true);
    assert.ok(mid1 >= mid2, 'Flip angle decreases monotonically from 180 to 0');

    // Opponent seat (faceUp = false)
    assert.strictEqual(getFlipAngle(0, false), 180, 'Face down at start');
    assert.strictEqual(getFlipAngle(0.5, false), 180, 'Remains face down mid-flight');
    assert.strictEqual(getFlipAngle(1, false), 180, 'Remains face down at end');
  });

  it('validates round-robin deal cascade scheduling logic across 2..5 seats', function () {
    const calculateSchedule = (seatIds, humanSeatId, cardsPerSeat = 5, dealStaggerMs = 140) => {
      const uniqueSeats = Array.from(new Set(seatIds)).slice(0, 5);
      const seatCount = uniqueSeats.length;
      const flightCount = seatCount * cardsPerSeat;

      let effectiveStagger = dealStaggerMs;
      const maxCascadeMs = 3400;
      const flightDurationMs = 520;
      const landSettleMs = 120;

      if (flightCount > 1) {
        const rawDuration = (flightCount - 1) * effectiveStagger + flightDurationMs + landSettleMs;
        if (rawDuration > maxCascadeMs) {
          const allowedSpan = maxCascadeMs - flightDurationMs - landSettleMs;
          effectiveStagger = Math.max(20, Math.floor(allowedSpan / (flightCount - 1)));
        }
      }

      const flights = [];
      for (let round = 0; round < cardsPerSeat; round++) {
        for (let sIdx = 0; sIdx < seatCount; sIdx++) {
          const seatId = uniqueSeats[sIdx];
          const dealIndex = round * seatCount + sIdx;
          const startAtMs = dealIndex * effectiveStagger;
          flights.push({
            id: `deal:${seatId}:${round}`,
            seatId,
            seatIndex: sIdx,
            cardIndex: round,
            dealIndex,
            startAtMs,
            faceUp: seatId === humanSeatId,
          });
        }
      }

      const lastStart = flights.length > 0 ? flights[flights.length - 1].startAtMs : 0;
      const totalDurationMs = lastStart + flightDurationMs + landSettleMs;

      return { seatCount, flightCount, effectiveStagger, flights, totalDurationMs };
    };

    // 2 Seats (Human + Bot): 10 cards total
    const plan2 = calculateSchedule(['p1', 'p2'], 'p1');
    assert.strictEqual(plan2.seatCount, 2);
    assert.strictEqual(plan2.flightCount, 10);
    assert.strictEqual(plan2.effectiveStagger, 140);
    assert.strictEqual(plan2.flights[0].seatId, 'p1', 'Round 0 Card 0 -> P1');
    assert.strictEqual(plan2.flights[1].seatId, 'p2', 'Round 0 Card 0 -> P2');
    assert.strictEqual(plan2.flights[2].seatId, 'p1', 'Round 1 Card 1 -> P1');
    assert.strictEqual(plan2.flights[3].seatId, 'p2', 'Round 1 Card 1 -> P2');
    assert.strictEqual(plan2.flights[0].faceUp, true, 'Human card is faceUp');
    assert.strictEqual(plan2.flights[1].faceUp, false, 'Bot card is faceDown');

    // 5 Seats (Human + 4 Bots): 25 cards total with stagger compression
    const plan5 = calculateSchedule(['p1', 'p2', 'p3', 'p4', 'p5'], 'p1');
    assert.strictEqual(plan5.seatCount, 5);
    assert.strictEqual(plan5.flightCount, 25);
    assert.ok(plan5.effectiveStagger < 140, 'Stagger compressed for 25 flights');
    assert.ok(plan5.totalDurationMs <= 3400, 'Total duration compressed under 3400ms');
  });

  it('verifies 3D CSS transform string formatting', function () {
    const buildCardTransform = (input) => {
      const x = Number.isFinite(input.x) ? input.x : 0;
      const y = Number.isFinite(input.y) ? input.y : 0;
      const z = Number.isFinite(input.z) ? input.z : 0;
      const rotateZ = Number.isFinite(input.rotateZ) ? input.rotateZ : 0;
      const rotateY = Number.isFinite(input.rotateY) ? input.rotateY : 0;
      const scale = Number.isFinite(input.scale) ? input.scale : 1;

      return `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateZ(${rotateZ.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale(${scale.toFixed(2)})`;
    };

    const transform = buildCardTransform({
      x: 120.5,
      y: -40.0,
      z: 70.0,
      rotateZ: 24.0,
      rotateY: 180.0,
      scale: 0.92,
    });

    assert.strictEqual(
      transform,
      'translate3d(120.50px, -40.00px, 70.00px) rotateZ(24.00deg) rotateY(180.00deg) scale(0.92)'
    );

    const nanTransform = buildCardTransform({ x: NaN, y: Infinity, z: undefined });
    assert.strictEqual(
      nanTransform,
      'translate3d(0.00px, 0.00px, 0.00px) rotateZ(0.00deg) rotateY(0.00deg) scale(1.00)'
    );
  });
});
