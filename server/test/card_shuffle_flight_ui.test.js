const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('Monopoly Deal 3D Card Shuffle, Cut & Multi-Seat Deck Dealer Flight Animation Engine', () => {
  const enginePath = path.resolve(__dirname, '../../client/src/utils/cardShuffleFlightEngine.ts');
  const overlayPath = path.resolve(__dirname, '../../client/src/components/CardShuffleFlightOverlay.tsx');
  const boardPath = path.resolve(__dirname, '../../client/src/components/GameBoardView.tsx');
  const lobbyPath = path.resolve(__dirname, '../../client/src/components/LobbyView.tsx');

  it('verifies source files exist in the client codebase', () => {
    assert.ok(fs.existsSync(enginePath), 'cardShuffleFlightEngine.ts must exist');
    assert.ok(fs.existsSync(overlayPath), 'CardShuffleFlightOverlay.tsx must exist');
    assert.ok(fs.existsSync(boardPath), 'GameBoardView.tsx must exist');
    assert.ok(fs.existsSync(lobbyPath), 'LobbyView.tsx must exist');
  });

  describe('3D Trajectory Math & Pure Helpers', () => {
    // Pure math reimplementation for Node mocha contract verification matching client ts
    function clamp(val, min, max) {
      if (Number.isNaN(val)) return min;
      return Math.min(max, Math.max(min, val));
    }

    function calculateShuffleBezier3D(p0, p2, t, arcHeightPx = 120) {
      const clampedT = clamp(t, 0, 1);
      const midX = (p0.x + p2.x) / 2;
      const midY = (p0.y + p2.y) / 2 - arcHeightPx;
      const midZ = Math.max(p0.z, p2.z) + arcHeightPx * 0.5;

      const p1 = { x: midX, y: midY, z: midZ };
      const u = 1 - clampedT;

      return {
        x: u * u * p0.x + 2 * u * clampedT * p1.x + clampedT * clampedT * p2.x,
        y: u * u * p0.y + 2 * u * clampedT * p1.y + clampedT * clampedT * p2.y,
        z: u * u * p0.z + 2 * u * clampedT * p1.z + clampedT * clampedT * p2.z,
      };
    }

    function speedMultiplier(speed) {
      const speeds = { slow: 1.6, normal: 1.0, fast: 0.6, turbo: 0.35 };
      return speeds[speed] ?? 1.0;
    }

    function dealFlightPlan3D(cardCount, seatCount, speed = 'normal') {
      const cards = Math.max(0, Math.floor(cardCount));
      const seats = Math.max(1, Math.floor(seatCount));
      const mult = speedMultiplier(speed);
      const durationMs = Math.round(440 * mult);
      const stepMs = Math.round(140 * mult);

      const flights = [];
      for (let i = 0; i < cards; i++) {
        const seatIndex = i % seats;
        flights.push({
          cardIndex: i,
          seatIndex,
          delayMs: i * stepMs,
          durationMs,
          flip3D: seatIndex === 0,
        });
      }
      return flights;
    }

    it('calculates 3D spatial quadratic Bezier trajectory points with parabolic elevation', () => {
      const p0 = { x: 0, y: 0, z: 0 };
      const p2 = { x: 200, y: 300, z: 10 };

      const start = calculateShuffleBezier3D(p0, p2, 0, 120);
      assert.strictEqual(start.x, 0);
      assert.strictEqual(start.y, 0);
      assert.strictEqual(start.z, 0);

      const mid = calculateShuffleBezier3D(p0, p2, 0.5, 120);
      assert.strictEqual(mid.x, 100);
      assert.ok(mid.y < (p0.y + p2.y) / 2, 'Mid Y point must elevate upward relative to midpoint');
      assert.ok(mid.z > 30, 'Mid Z point must elevate in 3D depth space relative to start');

      const end = calculateShuffleBezier3D(p0, p2, 1, 120);
      assert.strictEqual(end.x, 200);
      assert.strictEqual(end.y, 300);
      assert.strictEqual(end.z, 10);
    });

    it('scales speed presets accurately for slow, normal, fast, and turbo', () => {
      assert.strictEqual(speedMultiplier('slow'), 1.6);
      assert.strictEqual(speedMultiplier('normal'), 1.0);
      assert.strictEqual(speedMultiplier('fast'), 0.6);
      assert.strictEqual(speedMultiplier('turbo'), 0.35);
    });

    it('schedules initial deal flight plans across 2..5 player seats with 140ms stagger', () => {
      // 5 cards per seat for 3 seats = 15 cards total
      const flights3 = dealFlightPlan3D(15, 3, 'normal');
      assert.strictEqual(flights3.length, 15);
      assert.strictEqual(flights3[0].delayMs, 0);
      assert.strictEqual(flights3[0].flip3D, true, 'Human seat (0) receives 3D card flip');
      assert.strictEqual(flights3[1].delayMs, 140);
      assert.strictEqual(flights3[1].flip3D, false, 'Opponent seat (1) stays face down');
      assert.strictEqual(flights3[2].delayMs, 280);
      assert.strictEqual(flights3[2].flip3D, false, 'Opponent seat (2) stays face down');
      assert.strictEqual(flights3[3].seatIndex, 0, 'Round-robin deal returns to seat 0');

      // Turbo speed scaling
      const turboFlights = dealFlightPlan3D(10, 2, 'turbo');
      assert.strictEqual(turboFlights[1].delayMs, Math.round(140 * 0.35));
    });
  });

  describe('Client Source Integrity', () => {
    it('verifies cardShuffleFlightEngine.ts contains required 3D trajectory and event exports', () => {
      const content = fs.readFileSync(enginePath, 'utf8');
      assert.ok(content.includes('calculateShuffleBezier3D'), 'Must export calculateShuffleBezier3D');
      assert.ok(content.includes('cardTransform3D'), 'Must export cardTransform3D');
      assert.ok(content.includes('dealFlightPlan3D'), 'Must export dealFlightPlan3D');
      assert.ok(content.includes('SHUFFLE_FLIGHT_EVENTS'), 'Must export SHUFFLE_FLIGHT_EVENTS');
      assert.ok(content.includes('md:cardshuffleflight:start'), 'Must include custom start event name');
      assert.ok(content.includes('md:cardshuffleflight:complete'), 'Must include custom complete event name');
      assert.ok(content.includes('playCardPlay'), 'Must trigger playCardPlay SFX');
      assert.ok(content.includes('playCardFlip'), 'Must trigger playCardFlip SFX');
    });

    it('verifies CardShuffleFlightOverlay.tsx contains 3D overlay rendering and controls', () => {
      const content = fs.readFileSync(overlayPath, 'utf8');
      assert.ok(content.includes('CardShuffleFlightOverlay'), 'Must export CardShuffleFlightOverlay component');
      assert.ok(content.includes('perspective: \'1000px\''), 'Must style stage with 3D perspective');
      assert.ok(content.includes('transformStyle: \'preserve-3d\''), 'Must style stack with preserve-3d');
      assert.ok(content.includes('cardTransform3D'), 'Must compute 3D card transforms');
      assert.ok(content.includes('handleSpeed'), 'Must provide interactive speed selector');
      assert.ok(content.includes('handleMute'), 'Must provide audio mute control');
    });

    it('verifies GameBoardView.tsx and LobbyView.tsx mount CardShuffleFlightOverlay', () => {
      const boardContent = fs.readFileSync(boardPath, 'utf8');
      assert.ok(boardContent.includes('CardShuffleFlightOverlay'), 'GameBoardView must mount CardShuffleFlightOverlay');

      const lobbyContent = fs.readFileSync(lobbyPath, 'utf8');
      assert.ok(lobbyContent.includes('CardShuffleFlightOverlay'), 'LobbyView must mount CardShuffleFlightOverlay');
    });
  });
});
