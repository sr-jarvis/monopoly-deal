/**
 * Tournament Leaderboard & League Standings data layer.
 *
 * Pulls the two server-owned catalogs (season tiers, Elo rating tiers) and the
 * server-calculated season standings, then merges them with the league roster
 * into flat rows the LeaderboardModal renders.
 *
 * Tier classification is deliberately data-driven off the fetched catalogs
 * rather than re-implemented here, so thresholds stay owned by the server
 * (`league_season_manager.js` / `league_elo_calculator.js`).
 */

const API_BASE = '/api/monopoly/bot';

export type SeasonTierId = 'PREMIER_LEAGUE' | 'CHAMPIONSHIP' | 'DIVISION_ONE';
export type EloTierId = 'NOVICE' | 'CLUB' | 'COMPETENT' | 'EXPERT' | 'MASTER';
export type StrategyProfileId = 'BALANCED' | 'AGGRESSIVE' | 'DEFENSIVE' | 'HOARDER';

export const STRATEGY_PROFILE_IDS: StrategyProfileId[] = [
  'BALANCED',
  'AGGRESSIVE',
  'DEFENSIVE',
  'HOARDER'
];

/** Mirrors the server default in `league_season_manager.calculateSeasonRankings`. */
export const DEFAULT_SEASON_TIER: SeasonTierId = 'CHAMPIONSHIP';
/** Mirrors `league_elo_calculator.DEFAULT_RATING`. */
export const DEFAULT_ELO_RATING = 1200;

export interface SeasonTier {
  id: SeasonTierId;
  title: string;
  rank: number;
  minPointsThreshold: number;
  promotionTargetTier: SeasonTierId | null;
  relegationTargetTier: SeasonTierId | null;
}

export interface EloRatingTier {
  id: EloTierId;
  title: string;
  minRating: number;
  /**
   * The server's top tier uses `Infinity`, which `JSON.stringify` emits as
   * `null`. Treat `null` as "no upper bound".
   */
  maxRating: number | null;
  description: string;
}

/** A single row of `POST /api/monopoly/bot/calculate-season-standings`. */
export interface SeasonStanding {
  rank: number;
  botId: string;
  botName: string;
  tier: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  totalTurns: number;
  totalBlunders: number;
  winRatePct: number;
  avgBlunders: number;
}

export interface LeagueBot {
  id: string;
  name: string;
  strategyProfile: StrategyProfileId;
  tier: SeasonTierId;
  eloRating: number;
}

export interface LeaderboardRow {
  rank: number;
  botId: string;
  botName: string;
  strategyProfile: StrategyProfileId;
  tier: SeasonTierId;
  points: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRatePct: number;
  eloRating: number;
  eloTier: EloTierId;
  blunderRatePct: number;
}

export interface MatchParticipant {
  id: string;
  name: string;
  tier: SeasonTierId;
  blunders: number;
}

export interface MatchResult {
  winnerId: string | null;
  turns: number;
  participants: MatchParticipant[];
}

export interface LeaderboardData {
  seasonTiers: SeasonTier[];
  eloTiers: EloRatingTier[];
  rows: LeaderboardRow[];
}

/**
 * The standing league roster. Elo ratings are spread across every band in the
 * server's Elo tier catalog so each badge is reachable in the UI.
 */
export const LEAGUE_ROSTER: LeagueBot[] = [
  { id: 'md-bot-01', name: 'Baron Vanderbilt', strategyProfile: 'AGGRESSIVE', tier: 'PREMIER_LEAGUE', eloRating: 1725 },
  { id: 'md-bot-02', name: 'Duchess Park Place', strategyProfile: 'BALANCED', tier: 'PREMIER_LEAGUE', eloRating: 1642 },
  { id: 'md-bot-03', name: 'Marvin Gardens', strategyProfile: 'HOARDER', tier: 'PREMIER_LEAGUE', eloRating: 1518 },
  { id: 'md-bot-04', name: 'Reading Railroad', strategyProfile: 'DEFENSIVE', tier: 'CHAMPIONSHIP', eloRating: 1470 },
  { id: 'md-bot-05', name: 'Boardwalk Bandit', strategyProfile: 'AGGRESSIVE', tier: 'CHAMPIONSHIP', eloRating: 1355 },
  { id: 'md-bot-06', name: 'Ventnor Vic', strategyProfile: 'BALANCED', tier: 'CHAMPIONSHIP', eloRating: 1288 },
  { id: 'md-bot-07', name: 'Baltic Rookie', strategyProfile: 'DEFENSIVE', tier: 'DIVISION_ONE', eloRating: 1144 },
  { id: 'md-bot-08', name: 'Mediterranean Mo', strategyProfile: 'HOARDER', tier: 'DIVISION_ONE', eloRating: 1042 }
];

/** Blunders scale with how much risk a strategy profile takes on. */
const BLUNDER_PROPENSITY: Record<StrategyProfileId, number> = {
  AGGRESSIVE: 0.9,
  HOARDER: 0.65,
  BALANCED: 0.55,
  DEFENSIVE: 0.4
};

const SEASON_SEED = 0x5eed1a;

/** Deterministic PRNG (mulberry32) — keeps the season reproducible run to run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard Elo expectation — used only to weight who wins a fixture. */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Builds the season's fixture list: a single round-robin over the roster.
 * Stronger bots win more often, but the schedule is fully deterministic so the
 * standings the server returns are stable.
 */
export function buildSeasonMatchResults(roster: LeagueBot[] = LEAGUE_ROSTER): MatchResult[] {
  const random = mulberry32(SEASON_SEED);
  const matches: MatchResult[] = [];

  for (let i = 0; i < roster.length; i += 1) {
    for (let j = i + 1; j < roster.length; j += 1) {
      const home = roster[i];
      const away = roster[j];

      const roll = random();
      const homeExpected = expectedScore(home.eloRating, away.eloRating);
      // A narrow band around the decision line resolves as a draw.
      const winnerId =
        Math.abs(roll - homeExpected) < 0.04 ? null : roll < homeExpected ? home.id : away.id;

      matches.push({
        winnerId,
        turns: 18 + Math.floor(random() * 20),
        participants: [home, away].map((bot) => ({
          id: bot.id,
          name: bot.name,
          tier: bot.tier,
          blunders: Math.round(random() * BLUNDER_PROPENSITY[bot.strategyProfile] * 4)
        }))
      });
    }
  }

  return matches;
}

/**
 * Resolves an Elo rating to a tier using the server catalog. `maxRating: null`
 * is the JSON encoding of the server's `Infinity` upper bound.
 */
export function resolveEloTier(rating: number, tiers: EloRatingTier[]): EloTierId {
  const ordered = [...tiers].sort((a, b) => a.minRating - b.minRating);
  const match = ordered.find(
    (tier) => rating >= tier.minRating && (tier.maxRating === null || rating <= tier.maxRating)
  );
  if (match) return match.id;
  if (ordered.length === 0) return 'NOVICE';
  // Below every band -> lowest tier; above every band -> highest.
  return rating < ordered[0].minRating ? ordered[0].id : ordered[ordered.length - 1].id;
}

/** Blunders per turn, expressed as a percentage rounded to one decimal. */
export function calculateBlunderRatePct(totalBlunders: number, totalTurns: number): number {
  if (!totalTurns || totalTurns <= 0) return 0;
  return Math.round((totalBlunders / totalTurns) * 1000) / 10;
}

function isSeasonTierId(value: string): value is SeasonTierId {
  return value === 'PREMIER_LEAGUE' || value === 'CHAMPIONSHIP' || value === 'DIVISION_ONE';
}

/** Merges server standings with roster metadata and the Elo tier catalog. */
export function toLeaderboardRows(
  standings: SeasonStanding[],
  roster: LeagueBot[],
  eloTiers: EloRatingTier[]
): LeaderboardRow[] {
  const rosterById = new Map(roster.map((bot) => [bot.id, bot]));

  return standings.map((standing) => {
    const bot = rosterById.get(standing.botId);
    const eloRating = bot ? bot.eloRating : DEFAULT_ELO_RATING;
    const tier = isSeasonTierId(standing.tier) ? standing.tier : DEFAULT_SEASON_TIER;

    return {
      rank: standing.rank,
      botId: standing.botId,
      botName: standing.botName,
      strategyProfile: bot ? bot.strategyProfile : 'BALANCED',
      tier,
      points: standing.points,
      matchesPlayed: standing.matchesPlayed,
      wins: standing.wins,
      losses: standing.losses,
      draws: standing.draws,
      winRatePct: standing.winRatePct,
      eloRating,
      eloTier: resolveEloTier(eloRating, eloTiers),
      blunderRatePct: calculateBlunderRatePct(standing.totalBlunders, standing.totalTurns)
    };
  });
}

/** Re-ranks rows by Elo rating for the Global Elo Rating Standings view. */
export function rankRowsByElo(rows: LeaderboardRow[]): LeaderboardRow[] {
  return [...rows]
    .sort((a, b) => {
      if (b.eloRating !== a.eloRating) return b.eloRating - a.eloRating;
      if (b.points !== a.points) return b.points - a.points;
      return a.botName.localeCompare(b.botName);
    })
    .map((row, idx) => ({ ...row, rank: idx + 1 }));
}

export interface LeaderboardFilters {
  search: string;
  strategyProfile: StrategyProfileId | 'ALL';
  tier: SeasonTierId | 'ALL';
}

/**
 * Filters rows by free-text search plus strategy/tier facets. Ranks are
 * preserved — a filtered view still shows real league positions.
 */
export function filterLeaderboardRows(
  rows: LeaderboardRow[],
  filters: LeaderboardFilters
): LeaderboardRow[] {
  const needle = filters.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.strategyProfile !== 'ALL' && row.strategyProfile !== filters.strategyProfile) {
      return false;
    }
    if (filters.tier !== 'ALL' && row.tier !== filters.tier) {
      return false;
    }
    if (!needle) return true;
    return (
      row.botName.toLowerCase().includes(needle) ||
      row.botId.toLowerCase().includes(needle) ||
      row.strategyProfile.toLowerCase().includes(needle)
    );
  });
}

export interface StrategyProfileSummary {
  strategyProfile: StrategyProfileId;
  botCount: number;
  matchesPlayed: number;
  wins: number;
  avgWinRatePct: number;
  avgEloRating: number;
  avgBlunderRatePct: number;
}

/** Aggregates the leaderboard by strategy profile for the Bot Profiles tab. */
export function summarizeStrategyProfiles(rows: LeaderboardRow[]): StrategyProfileSummary[] {
  return STRATEGY_PROFILE_IDS.map((strategyProfile) => {
    const group = rows.filter((row) => row.strategyProfile === strategyProfile);
    const botCount = group.length;
    const average = (pick: (row: LeaderboardRow) => number) =>
      botCount === 0
        ? 0
        : Math.round((group.reduce((sum, row) => sum + pick(row), 0) / botCount) * 10) / 10;

    return {
      strategyProfile,
      botCount,
      matchesPlayed: group.reduce((sum, row) => sum + row.matchesPlayed, 0),
      wins: group.reduce((sum, row) => sum + row.wins, 0),
      avgWinRatePct: average((row) => row.winRatePct),
      avgEloRating: Math.round(average((row) => row.eloRating)),
      avgBlunderRatePct: average((row) => row.blunderRatePct)
    };
  });
}

/* ---------------------------------------------------------------- API layer */

interface ApiEnvelope {
  status?: string;
  message?: string;
}

async function requestJson<T extends ApiEnvelope>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as T;
  if (payload.status !== 'ok') {
    throw new Error(payload.message || `Request to ${path} returned status "${payload.status}"`);
  }
  return payload;
}

export async function fetchSeasonTiers(): Promise<SeasonTier[]> {
  const payload = await requestJson<ApiEnvelope & { tiers: SeasonTier[] }>('/season-tiers');
  return payload.tiers;
}

export async function fetchEloRatingTiers(): Promise<EloRatingTier[]> {
  const payload = await requestJson<ApiEnvelope & { tiers: EloRatingTier[] }>('/elo-rating-tiers');
  return payload.tiers;
}

export async function fetchSeasonStandings(matchResults: MatchResult[]): Promise<SeasonStanding[]> {
  const payload = await requestJson<ApiEnvelope & { standings: SeasonStanding[] }>(
    '/calculate-season-standings',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchResults })
    }
  );
  return payload.standings;
}

/** Loads both catalogs and the calculated standings, merged into table rows. */
export async function loadLeaderboard(roster: LeagueBot[] = LEAGUE_ROSTER): Promise<LeaderboardData> {
  const [seasonTiers, eloTiers, standings] = await Promise.all([
    fetchSeasonTiers(),
    fetchEloRatingTiers(),
    fetchSeasonStandings(buildSeasonMatchResults(roster))
  ]);

  return {
    seasonTiers,
    eloTiers,
    rows: toLeaderboardRows(standings, roster, eloTiers)
  };
}

/* ------------------------------------------------------------ Badge styling */

export function seasonTierBadgeClass(tier: SeasonTierId): string {
  const suffix =
    tier === 'PREMIER_LEAGUE' ? 'premier' : tier === 'CHAMPIONSHIP' ? 'championship' : 'division';
  return `md-tier-badge md-tier-badge--${suffix}`;
}

export function eloTierBadgeClass(tier: EloTierId): string {
  return `md-elo-badge md-elo-badge--${tier.toLowerCase()}`;
}

export function strategyBadgeClass(profile: StrategyProfileId): string {
  return `md-strategy-badge md-strategy-badge--${profile.toLowerCase()}`;
}

const SEASON_TIER_LABELS: Record<SeasonTierId, string> = {
  PREMIER_LEAGUE: 'Premier League',
  CHAMPIONSHIP: 'Championship',
  DIVISION_ONE: 'Division One'
};

export function seasonTierLabel(tier: SeasonTierId): string {
  return SEASON_TIER_LABELS[tier];
}

/** Formats a catalog band as a readable range, e.g. "1700+" or "1100 – 1299". */
export function formatEloRange(tier: EloRatingTier): string {
  return tier.maxRating === null ? `${tier.minRating}+` : `${tier.minRating} – ${tier.maxRating}`;
}
