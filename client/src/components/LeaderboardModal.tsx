import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EloRatingTier,
  LeaderboardRow,
  SeasonTier,
  SeasonTierId,
  STRATEGY_PROFILE_IDS,
  StrategyProfileId,
  eloTierBadgeClass,
  filterLeaderboardRows,
  formatEloRange,
  loadLeaderboard,
  rankRowsByElo,
  seasonTierBadgeClass,
  seasonTierLabel,
  strategyBadgeClass,
  summarizeStrategyProfiles
} from '../utils/leaderboard';

type LeaderboardTab = 'SEASON' | 'ELO' | 'PROFILES';

const TABS: ReadonlyArray<{ id: LeaderboardTab; label: string }> = [
  { id: 'SEASON', label: 'Season Standings' },
  { id: 'ELO', label: 'Elo Ratings' },
  { id: 'PROFILES', label: 'Bot Profiles' }
];

const TIER_FILTERS: ReadonlyArray<SeasonTierId | 'ALL'> = [
  'ALL',
  'PREMIER_LEAGUE',
  'CHAMPIONSHIP',
  'DIVISION_ONE'
];

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

interface LeaderboardModalProps {
  onClose: () => void;
}

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({ onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const [tab, setTab] = useState<LeaderboardTab>('SEASON');
  const [search, setSearch] = useState('');
  const [strategyFilter, setStrategyFilter] = useState<StrategyProfileId | 'ALL'>('ALL');
  const [tierFilter, setTierFilter] = useState<SeasonTierId | 'ALL'>('ALL');

  const [, setSeasonTiers] = useState<SeasonTier[]>([]);
  const [eloTiers, setEloTiers] = useState<EloRatingTier[]>([]);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    loadLeaderboard()
      .then((data) => {
        setSeasonTiers(data.seasonTiers);
        setEloTiers(data.eloTiers);
        setRows(data.rows);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load league standings.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Escape closes from anywhere, even if focus has drifted outside the panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Move focus into the dialog on open, and hand it back on close.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    return () => restoreFocusRef.current?.focus();
  }, []);

  // aria-modal promises the rest of the page is inert, so trap Tab.
  const handleTabKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => el.offsetParent !== null);

    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const activeRows = useMemo(() => {
    if (tab === 'ELO') return rankRowsByElo(rows);
    return rows;
  }, [tab, rows]);

  const visibleRows = useMemo(() => {
    return filterLeaderboardRows(activeRows, {
      search,
      strategyProfile: strategyFilter,
      tier: tierFilter
    });
  }, [activeRows, search, strategyFilter, tierFilter]);

  const profileSummaries = useMemo(() => {
    return summarizeStrategyProfiles(rows);
  }, [rows]);

  const filtersActive = search.trim() !== '' || strategyFilter !== 'ALL' || tierFilter !== 'ALL';

  const renderTable = () => {
    if (visibleRows.length === 0) {
      return (
        <p className="p-8 text-center text-xs font-semibold text-slate-400">
          No bots match the selected filters.
        </p>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="md-leaderboard-table" aria-label="Tournament Standings Table">
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Bot</th>
              <th scope="col">Strategy</th>
              <th scope="col">Tier</th>
              <th scope="col" className="text-right">Points</th>
              <th scope="col" className="text-right">W - L - D</th>
              <th scope="col" className="text-right">Win Rate %</th>
              <th scope="col" className="text-right">Elo Rating</th>
              <th scope="col" className="text-right">Elo Tier</th>
              <th scope="col" className="text-right">Blunder Rate %</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const podiumClass =
                row.rank === 1
                  ? 'md-leaderboard-podium-1'
                  : row.rank === 2
                  ? 'md-leaderboard-podium-2'
                  : row.rank === 3
                  ? 'md-leaderboard-podium-3'
                  : '';

              return (
                <tr key={row.botId} className={podiumClass}>
                  <td className="md-leaderboard-rank">#{row.rank}</td>
                  <td>
                    <div className="font-bold text-slate-100">{row.botName}</div>
                    <div className="text-[10px] text-slate-400">{row.botId}</div>
                  </td>
                  <td>
                    <span className={strategyBadgeClass(row.strategyProfile)}>
                      {row.strategyProfile}
                    </span>
                  </td>
                  <td>
                    <span className={seasonTierBadgeClass(row.tier)}>
                      {seasonTierLabel(row.tier)}
                    </span>
                  </td>
                  <td className="text-right font-mono font-bold text-amber-300">{row.points}</td>
                  <td className="text-right font-mono text-slate-300">
                    {row.wins} - {row.losses} - {row.draws}
                  </td>
                  <td className="text-right font-mono font-bold text-emerald-400">
                    {row.winRatePct}%
                  </td>
                  <td className="text-right font-mono font-bold text-sky-300">{row.eloRating}</td>
                  <td className="text-right">
                    <span className={eloTierBadgeClass(row.eloTier)}>{row.eloTier}</span>
                  </td>
                  <td className="text-right font-mono text-rose-300">{row.blunderRatePct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderProfiles = () => {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {profileSummaries.map((summary) => (
            <div
              key={summary.strategyProfile}
              className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4 shadow-lg backdrop-blur-md"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className={strategyBadgeClass(summary.strategyProfile)}>
                  {summary.strategyProfile}
                </span>
                <span className="text-[10px] font-bold text-slate-400">
                  {summary.botCount} Bots
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Avg Win Rate:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {summary.avgWinRatePct}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Avg Elo Rating:</span>
                  <span className="font-mono font-bold text-sky-300">{summary.avgEloRating}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Avg Blunder Rate:</span>
                  <span className="font-mono font-bold text-rose-300">
                    {summary.avgBlunderRatePct}%
                  </span>
                </div>
                <div className="flex justify-between pt-1 text-[11px] text-slate-400">
                  <span>Matches Played:</span>
                  <span className="font-mono text-slate-200">{summary.matchesPlayed}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-300">
            Elo Rating Tiers Catalog
          </h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {eloTiers.map((tier) => (
              <div
                key={tier.id}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-center"
              >
                <span className={eloTierBadgeClass(tier.id)}>{tier.title}</span>
                <div className="mt-1 font-mono text-[11px] font-bold text-sky-300">
                  {formatEloRange(tier)}
                </div>
                <p className="mt-1 text-[10px] text-slate-400">{tier.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="md-leaderboard-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleTabKey}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leaderboard-modal-title"
        className="md-leaderboard-panel"
      >
        <header className="flex items-center justify-between border-b border-slate-700/60 px-5 py-4">
          <div>
            <h2 id="leaderboard-modal-title" className="text-lg font-bold text-slate-100">
              🏆 Tournament Leaderboard & League Standings
            </h2>
            <p className="text-xs text-slate-400">
              League standings, promotion tiers and global Elo ratings for every Jarvis bot.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close leaderboard"
            className="rounded-lg bg-slate-700/50 px-2 py-0.5 text-lg font-bold text-slate-400 transition hover:text-white"
          >
            ✕
          </button>
        </header>

        <div role="tablist" aria-label="Leaderboard views" className="flex gap-1 border-b border-slate-700/60 px-4 pt-3">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              id={`leaderboard-tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`leaderboard-panel-${entry.id}`}
              onClick={() => setTab(entry.id)}
              className={`rounded-t-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition ${
                tab === entry.id
                  ? 'bg-slate-800/80 text-amber-300 shadow-inner'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab !== 'PROFILES' && (
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-700/60 p-4">
            <div className="min-w-[12rem] flex-1">
              <label
                htmlFor="leaderboard-search"
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400"
              >
                Search Bots
              </label>
              <input
                id="leaderboard-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, id or strategy..."
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label
                htmlFor="leaderboard-strategy"
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400"
              >
                Strategy Profile
              </label>
              <select
                id="leaderboard-strategy"
                value={strategyFilter}
                onChange={(event) =>
                  setStrategyFilter(event.target.value as StrategyProfileId | 'ALL')
                }
                className="cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-bold uppercase text-amber-300 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="ALL">All</option>
                {STRATEGY_PROFILE_IDS.map((profile) => (
                  <option key={profile} value={profile}>
                    {profile}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="leaderboard-tier"
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400"
              >
                Season Tier
              </label>
              <select
                id="leaderboard-tier"
                value={tierFilter}
                onChange={(event) => setTierFilter(event.target.value as SeasonTierId | 'ALL')}
                className="cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-bold uppercase text-amber-300 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                {TIER_FILTERS.map((tierId) => (
                  <option key={tierId} value={tierId}>
                    {tierId === 'ALL' ? 'All' : seasonTierLabel(tierId)}
                  </option>
                ))}
              </select>
            </div>

            {filtersActive && (
              <button
                onClick={() => {
                  setSearch('');
                  setStrategyFilter('ALL');
                  setTierFilter('ALL');
                }}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-300 transition hover:text-white"
              >
                Reset
              </button>
            )}

            <span aria-live="polite" className="ml-auto text-[11px] font-semibold text-slate-400">
              {visibleRows.length} of {rows.length} bots
            </span>
          </div>
        )}

        <div
          role="tabpanel"
          id={`leaderboard-panel-${tab}`}
          aria-labelledby={`leaderboard-tab-${tab}`}
          tabIndex={-1}
          className="flex-1 overflow-auto p-4"
        >
          {loading && (
            <p role="status" className="p-8 text-center text-xs font-semibold text-slate-400">
              Calculating season standings...
            </p>
          )}

          {!loading && error && (
            <div role="alert" className="space-y-3 rounded-xl border border-rose-600/50 bg-rose-950/50 p-4 text-center">
              <p className="text-xs font-semibold text-rose-100">{error}</p>
              <button
                onClick={load}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-rose-500"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && (tab === 'PROFILES' ? renderProfiles() : renderTable())}
        </div>
      </div>
    </div>
  );
};
