const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const app = require('../app');
const league_elo_calculator = require('../league_elo_calculator');
const league_season_manager = require('../league_season_manager');

const CLIENT_SRC = path.join(__dirname, '../../client/src');

function readClientFile(relPath) {
  const full = path.join(CLIENT_SRC, relPath);
  assert.strictEqual(fs.existsSync(full), true, `${relPath} must exist`);
  return fs.readFileSync(full, 'utf8');
}

function getJson(baseUrl, urlPath, cb) {
  http.get(`${baseUrl}${urlPath}`, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => cb(null, res.statusCode, JSON.parse(body)));
  }).on('error', cb);
}

function postJson(baseUrl, urlPath, payload, cb) {
  const data = JSON.stringify(payload);
  const req = http.request(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  }, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => cb(null, res.statusCode, JSON.parse(body)));
  });
  req.on('error', cb);
  req.write(data);
  req.end();
}

/* Reference implementations mirroring client/src/utils/leaderboard.ts. */
function resolveEloTier(rating, tiers) {
  const ordered = [...tiers].sort((a, b) => a.minRating - b.minRating);
  const match = ordered.find(
    (t) => rating >= t.minRating && (t.maxRating === null || rating <= t.maxRating)
  );
  if (match) return match.id;
  if (ordered.length === 0) return 'NOVICE';
  return rating < ordered[0].minRating ? ordered[0].id : ordered[ordered.length - 1].id;
}

function calculateBlunderRatePct(totalBlunders, totalTurns) {
  if (!totalTurns || totalTurns <= 0) return 0;
  return Math.round((totalBlunders / totalTurns) * 1000) / 10;
}

function rankRowsByElo(rows) {
  return [...rows]
    .sort((a, b) => {
      if (b.eloRating !== a.eloRating) return b.eloRating - a.eloRating;
      if (b.points !== a.points) return b.points - a.points;
      return a.botName.localeCompare(b.botName);
    })
    .map((row, idx) => ({ ...row, rank: idx + 1 }));
}

describe('Tournament Leaderboard & League Standings Modal (UI contracts)', function () {
  let server;
  let baseUrl;

  before(function (done) {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  after(function (done) {
    if (server) server.close(done);
    else done();
  });

  describe('API contracts the modal depends on', function () {
    it('GET /season-tiers returns the three tiers the badges render', function (done) {
      getJson(baseUrl, '/api/monopoly/bot/season-tiers', (err, status, json) => {
        if (err) return done(err);
        assert.strictEqual(status, 200);
        assert.strictEqual(json.status, 'ok');
        assert.deepStrictEqual(
          json.tiers.map((t) => t.id),
          ['PREMIER_LEAGUE', 'CHAMPIONSHIP', 'DIVISION_ONE']
        );
        json.tiers.forEach((tier) => {
          assert.ok(typeof tier.title === 'string' && tier.title.length > 0);
          assert.strictEqual(typeof tier.rank, 'number');
          assert.strictEqual(typeof tier.minPointsThreshold, 'number');
        });
        done();
      });
    });

    it('GET /elo-rating-tiers returns five bands with the top band unbounded as null', function (done) {
      getJson(baseUrl, '/api/monopoly/bot/elo-rating-tiers', (err, status, json) => {
        if (err) return done(err);
        assert.strictEqual(status, 200);
        assert.deepStrictEqual(
          json.tiers.map((t) => t.id),
          ['NOVICE', 'CLUB', 'COMPETENT', 'EXPERT', 'MASTER']
        );

        // Infinity is not representable in JSON — it arrives as null, and the
        // client treats null as "no upper bound".
        const master = json.tiers.find((t) => t.id === 'MASTER');
        assert.strictEqual(master.maxRating, null);
        assert.strictEqual(master.minRating, 1700);

        // Bands must be contiguous or a rating could resolve to no tier.
        for (let i = 1; i < json.tiers.length; i += 1) {
          assert.strictEqual(json.tiers[i].minRating, json.tiers[i - 1].maxRating + 1);
        }
        done();
      });
    });

    it('POST /calculate-season-standings returns every field the metrics table maps', function (done) {
      const matchResults = [
        {
          winnerId: 'md-bot-01',
          turns: 24,
          participants: [
            { id: 'md-bot-01', name: 'Baron Vanderbilt', tier: 'PREMIER_LEAGUE', blunders: 2 },
            { id: 'md-bot-02', name: 'Duchess Park Place', tier: 'PREMIER_LEAGUE', blunders: 5 }
          ]
        },
        {
          winnerId: null,
          turns: 30,
          participants: [
            { id: 'md-bot-01', name: 'Baron Vanderbilt', tier: 'PREMIER_LEAGUE', blunders: 1 },
            { id: 'md-bot-02', name: 'Duchess Park Place', tier: 'PREMIER_LEAGUE', blunders: 3 }
          ]
        }
      ];

      postJson(baseUrl, '/api/monopoly/bot/calculate-season-standings', { matchResults }, (err, status, json) => {
        if (err) return done(err);
        assert.strictEqual(status, 200);
        assert.strictEqual(json.status, 'ok');
        assert.strictEqual(json.standings.length, 2);

        const leader = json.standings[0];
        assert.strictEqual(leader.botId, 'md-bot-01');
        assert.strictEqual(leader.rank, 1);
        assert.strictEqual(leader.points, 4);     // 3 for the win + 1 for the draw
        assert.strictEqual(leader.wins, 1);
        assert.strictEqual(leader.draws, 1);
        assert.strictEqual(leader.matchesPlayed, 2);
        assert.strictEqual(leader.winRatePct, 50);
        assert.strictEqual(leader.totalTurns, 54);
        assert.strictEqual(leader.totalBlunders, 3);
        assert.strictEqual(leader.tier, 'PREMIER_LEAGUE');
        done();
      });
    });

    it('POST /calculate-season-standings rejects a non-array payload', function (done) {
      postJson(baseUrl, '/api/monopoly/bot/calculate-season-standings', { matchResults: 'nope' }, (err, status, json) => {
        if (err) return done(err);
        assert.strictEqual(status, 400);
        assert.strictEqual(json.status, 'error');
        done();
      });
    });
  });

  describe('Client data mapping', function () {
    it('client Elo tier lookup agrees with the server across the rating range', function () {
      // Round-trip the catalog through JSON so Infinity becomes null, exactly
      // as the browser receives it.
      const wireCatalog = JSON.parse(JSON.stringify(league_elo_calculator.getEloRatingTiersCatalog()));

      for (let rating = 0; rating <= 2400; rating += 7) {
        assert.strictEqual(
          resolveEloTier(rating, wireCatalog),
          league_elo_calculator.getTierForRating(rating).id,
          `Elo tier mismatch at rating ${rating}`
        );
      }
    });

    it('resolves the exact band boundaries', function () {
      const wireCatalog = JSON.parse(JSON.stringify(league_elo_calculator.getEloRatingTiersCatalog()));
      assert.strictEqual(resolveEloTier(1099, wireCatalog), 'NOVICE');
      assert.strictEqual(resolveEloTier(1100, wireCatalog), 'CLUB');
      assert.strictEqual(resolveEloTier(1699, wireCatalog), 'EXPERT');
      assert.strictEqual(resolveEloTier(1700, wireCatalog), 'MASTER');
      assert.strictEqual(resolveEloTier(99999, wireCatalog), 'MASTER');
    });

    it('derives Blunder Rate % from the totals the standings expose', function () {
      const standings = league_season_manager.calculateSeasonRankings([
        {
          winnerId: 'bot-a',
          turns: 20,
          participants: [
            { id: 'bot-a', name: 'Bot A', tier: 'CHAMPIONSHIP', blunders: 3 },
            { id: 'bot-b', name: 'Bot B', tier: 'CHAMPIONSHIP', blunders: 6 }
          ]
        }
      ]);

      const botA = standings.find((s) => s.botId === 'bot-a');
      const botB = standings.find((s) => s.botId === 'bot-b');

      assert.strictEqual(calculateBlunderRatePct(botA.totalBlunders, botA.totalTurns), 15);
      assert.strictEqual(calculateBlunderRatePct(botB.totalBlunders, botB.totalTurns), 30);
      assert.strictEqual(calculateBlunderRatePct(0, 0), 0);
    });

    it('re-ranks rows by Elo for the global Elo standings view', function () {
      const rows = [
        { rank: 1, botId: 'a', botName: 'A', points: 9, eloRating: 1300 },
        { rank: 2, botId: 'b', botName: 'B', points: 6, eloRating: 1725 },
        { rank: 3, botId: 'c', botName: 'C', points: 3, eloRating: 1500 }
      ];

      assert.deepStrictEqual(
        rankRowsByElo(rows).map((r) => [r.rank, r.botId]),
        [[1, 'b'], [2, 'c'], [3, 'a']]
      );
      // Season ordering must not be mutated in place.
      assert.strictEqual(rows[0].botId, 'a');
    });
  });

  describe('Component contracts', function () {
    it('leaderboard util exports the mapping surface the modal imports', function () {
      const util = readClientFile('utils/leaderboard.ts');
      [
        'export function resolveEloTier',
        'export function calculateBlunderRatePct',
        'export function toLeaderboardRows',
        'export function rankRowsByElo',
        'export function filterLeaderboardRows',
        'export function summarizeStrategyProfiles',
        'export async function fetchSeasonTiers',
        'export async function fetchEloRatingTiers',
        'export async function fetchSeasonStandings',
        'export async function loadLeaderboard'
      ].forEach((marker) => {
        assert.ok(util.includes(marker), `leaderboard.ts must declare "${marker}"`);
      });

      ['/season-tiers', '/elo-rating-tiers', '/calculate-season-standings'].forEach((route) => {
        assert.ok(util.includes(route), `leaderboard.ts must call ${route}`);
      });
    });

    it('LeaderboardModal exposes accessible dialog semantics', function () {
      const modal = readClientFile('components/LeaderboardModal.tsx');
      assert.ok(modal.includes('role="dialog"'), 'modal must set role="dialog"');
      assert.ok(modal.includes('aria-modal="true"'), 'modal must set aria-modal="true"');
      assert.ok(modal.includes('aria-labelledby'), 'modal must be labelled');
      assert.ok(modal.includes("=== 'Escape'"), 'modal must handle the Escape key');
      assert.ok(modal.includes('role="tablist"'), 'modal must expose a tablist');
      assert.ok(modal.includes('aria-selected'), 'tabs must expose selection state');
      assert.ok(modal.includes('role="tabpanel"'), 'modal must expose a tabpanel');
    });

    it('LeaderboardModal renders all three tabs and every metric column', function () {
      const modal = readClientFile('components/LeaderboardModal.tsx');
      ['Season Standings', 'Elo Ratings', 'Bot Profiles'].forEach((tab) => {
        assert.ok(modal.includes(tab), `modal must offer the "${tab}" tab`);
      });
      ['Rank', 'Bot', 'Strategy', 'Tier', 'Points', 'Win Rate %', 'Elo Rating', 'Elo Tier', 'Blunder Rate %']
        .forEach((column) => {
          assert.ok(modal.includes(`>${column}<`), `metrics table must include a "${column}" column`);
        });
      assert.ok(modal.includes('leaderboard-search'), 'modal must expose a search input');
      assert.ok(modal.includes('leaderboard-strategy'), 'modal must expose a strategy filter');
      assert.ok(modal.includes('leaderboard-tier'), 'modal must expose a tier filter');
    });

    it('index.css defines the glassmorphic panel and every badge variant', function () {
      const css = readClientFile('index.css');
      [
        '.md-leaderboard-overlay',
        '.md-leaderboard-panel',
        '.md-tier-badge--premier',
        '.md-tier-badge--championship',
        '.md-tier-badge--division',
        '.md-elo-badge--novice',
        '.md-elo-badge--club',
        '.md-elo-badge--competent',
        '.md-elo-badge--expert',
        '.md-elo-badge--master',
        '.md-strategy-badge--balanced',
        '.md-strategy-badge--aggressive',
        '.md-strategy-badge--defensive',
        '.md-strategy-badge--hoarder',
        '.md-leaderboard-table'
      ].forEach((selector) => {
        assert.ok(css.includes(selector), `index.css must define ${selector}`);
      });
      assert.ok(css.includes('backdrop-filter'), 'panel must use a glassmorphic backdrop-filter');
      assert.ok(css.includes('@keyframes leaderboardRise'), 'index.css must define leaderboardRise');
    });

    it('LobbyView and GameBoardView both trigger the modal', function () {
      ['components/LobbyView.tsx', 'components/GameBoardView.tsx'].forEach((relPath) => {
        const source = readClientFile(relPath);
        assert.ok(source.includes('LeaderboardModal'), `${relPath} must render LeaderboardModal`);
        assert.ok(source.includes('setShowLeaderboard'), `${relPath} must toggle leaderboard state`);
        assert.ok(source.includes('🏆'), `${relPath} must render the 🏆 leaderboard affordance`);
      });
    });

    it('vite dev and preview servers proxy /api to the game server', function () {
      const config = fs.readFileSync(path.join(CLIENT_SRC, '../vite.config.ts'), 'utf8');
      const proxyCount = (config.match(/'\/api'/g) || []).length;
      assert.strictEqual(proxyCount, 2, 'both server.proxy and preview.proxy must forward /api');
    });
  });
});
