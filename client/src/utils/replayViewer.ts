/**
 * Utility layer for Match Replay & Tactical Telemetry Viewer.
 */

export interface ReplayEvent {
  seq: number;
  type: string;
  playerId?: string;
  playerName?: string;
  displayName?: string;
  action?: string;
  cardName?: string;
  cardTitle?: string;
  cardId?: string;
  targetPlayerId?: string;
  targetPlayerName?: string;
  amount?: number;
  propertyColor?: string;
  turn?: number;
  message?: string;
  timestamp?: number | string;
  blunder?: {
    type: string;
    description: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    alternativeAction?: string;
  };
  details?: Record<string, unknown>;
}

export interface ReplayAnalysis {
  botPlayerId?: string;
  blunderCount: number;
  blunders: Array<{
    seq: number;
    ruleId: string;
    ruleName: string;
    description: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    suggestedAlternative?: string;
  }>;
  tacticalEfficiencyScore?: number;
  summaryNote?: string;
}

export interface ReplaySummary {
  roomCode: string;
  totalSteps: number;
  totalTurns: number;
  players: string[];
  cardsPlayedCount: number;
  moneyBankedTotal: number;
  blunderCount: number;
  winnerName?: string;
}

/**
 * Fetch match replay log from server API.
 */
export async function fetchRoomReplay(roomCode: string): Promise<ReplayEvent[]> {
  try {
    const res = await fetch(`/api/monopoly/rooms/${roomCode.toUpperCase()}/replay?limit=500`);
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    return Array.isArray(data.events) ? data.events : [];
  } catch {
    return [];
  }
}

/**
 * Request tactical blunder analysis for replay events.
 */
export async function fetchReplayAnalysis(
  historyEvents: ReplayEvent[]
): Promise<ReplayAnalysis | null> {
  try {
    const botPlayerId = historyEvents.find((e) => e.playerId || e.displayName)?.playerId || 'bot';
    const res = await fetch('/api/monopoly/bot/analyze-replay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replayLog: historyEvents, botPlayerId })
    });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    return data.analysis || data;
  } catch {
    return null;
  }
}

/**
 * Summarize match telemetry from replay events and analysis.
 */
export function summarizeReplay(
  roomCode: string,
  events: ReplayEvent[],
  analysis?: ReplayAnalysis | null
): ReplaySummary {
  const playersSet = new Set<string>();
  let totalTurns = 0;
  let cardsPlayedCount = 0;
  let moneyBankedTotal = 0;
  let winnerName: string | undefined = undefined;

  events.forEach((evt) => {
    const pName = evt.displayName || evt.playerName || evt.playerId;
    if (pName && pName !== 'SYSTEM') {
      playersSet.add(pName);
    }
    if (typeof evt.turn === 'number' && evt.turn > totalTurns) {
      totalTurns = evt.turn;
    }
    const evtType = (evt.type || evt.action || '').toUpperCase();
    if (
      evtType.includes('PLAY') ||
      evtType.includes('CARD') ||
      evtType.includes('RENT') ||
      evtType.includes('ACTION')
    ) {
      cardsPlayedCount++;
    }
    if (evtType.includes('BANK') || evtType.includes('PAY_BANK')) {
      if (typeof evt.amount === 'number') {
        moneyBankedTotal += evt.amount;
      }
    }
    if (evtType.includes('WIN') || evtType.includes('GAME_OVER')) {
      winnerName = pName;
    }
  });

  return {
    roomCode,
    totalSteps: events.length,
    totalTurns: Math.max(totalTurns, 1),
    players: Array.from(playersSet),
    cardsPlayedCount,
    moneyBankedTotal,
    blunderCount: analysis?.blunderCount || 0,
    winnerName
  };
}

/**
 * Human-readable description for a replay event step.
 */
export function formatReplayEventDescription(evt: ReplayEvent): string {
  if (evt.message) return evt.message;
  const actor = evt.displayName || evt.playerName || evt.playerId || 'Player';
  const type = (evt.type || evt.action || 'ACTION').toUpperCase();

  switch (type) {
    case 'DRAW':
    case 'DRAW_CARDS':
      return `${actor} drew 2 cards from the deck.`;
    case 'PLAY_CARD':
    case 'PLAY_ACTION_CARD':
      return `${actor} played ${evt.cardName || evt.cardTitle || 'a card'}${evt.propertyColor ? ` on ${evt.propertyColor}` : ''}.`;
    case 'PAY_BANK':
      return `${actor} deposited $${evt.amount || 0}M into their bank.`;
    case 'PAY_RENT':
      return `${actor} paid $${evt.amount || 0}M rent to ${evt.targetPlayerName || evt.targetPlayerId || 'opponent'}.`;
    case 'DISCARD':
    case 'DISCARD_CARD':
      return `${actor} discarded extra card(s) down to hand limit.`;
    case 'END_TURN':
      return `${actor} ended their turn.`;
    default:
      return `${actor} performed ${type}.`;
  }
}
