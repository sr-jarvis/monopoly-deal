import { z } from 'zod';

export const CardTypeSchema = z.enum([
  'PROPERTY',
  'WILDCARD',
  'ACTION',
  'RENT',
  'MONEY'
]);
export type CardType = z.infer<typeof CardTypeSchema>;

export const PropertyColorSchema = z.enum([
  'Brown',
  'LightBlue',
  'Purple',
  'Orange',
  'Red',
  'Yellow',
  'Green',
  'DarkBlue',
  'Railroad',
  'Utility',
  'ALL'
]);
export type PropertyColor = z.infer<typeof PropertyColorSchema>;

export interface Card {
  id: string;
  title?: string;
  name?: string;
  type?: CardType | PropertyColor;
  kind?: CardType;
  value: number;
  color?: PropertyColor;
  colors?: PropertyColor[];
  imageLocation?: string;
  imageUrl?: string;
  actionType?: string;
}

export const ActionTypeSchema = z.enum([
  'DRAW',
  'END_TURN',
  'DISCARD',
  'PLAY_ACTION_CARD',
  'PAY_BANK',
  'DRAW_CARDS',
  'PLAY_CARD',
  'DISCARD_CARD',
  'PASS_TURN',
  'JUST_SAY_NO',
  'PAY_RENT',
  'REARRANGE'
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

// C -> S: game:action
export const GameActionPayloadSchema = z.object({
  type: ActionTypeSchema,
  cardId: z.string().optional(),
  targetZone: z.enum(['HAND', 'BANK', 'PROPERTY', 'ACTION_PILE', 'DISCARD', 'bank', 'properties', 'action']).optional(),
  propertyColor: PropertyColorSchema.optional(),
  targetPlayerId: z.string().optional(),
  targetPropertyColor: PropertyColorSchema.optional(),
  targetCardId: z.string().optional(),
  // Forced Deal: one offered actor property swapped for one requested target property.
  offeredCardId: z.string().optional(),
  offeredPropertyColor: PropertyColorSchema.optional(),
  requestedCardId: z.string().optional(),
  requestedPropertyColor: PropertyColorSchema.optional(),
  // Rent + Double The Rent: a separate DTR card in hand played atomically with
  // a Rent card. Costs 2 plays; doubles the rent after normal calculation.
  doubleRentCardId: z.string().optional(),
  paymentCardIds: z.array(z.string()).optional(),
  count: z.number().int().positive().optional(),
  seq: z.number().int().nonnegative().optional()
});
export type GameActionPayload = z.infer<typeof GameActionPayloadSchema>;

// C -> S: room:create
export const RoomCreatePayloadSchema = z.object({
  displayName: z.string().min(1).max(30)
});
export type RoomCreatePayload = z.infer<typeof RoomCreatePayloadSchema>;

// C -> S: room:join
export const RoomJoinPayloadSchema = z.object({
  roomCode: z.string().length(4),
  displayName: z.string().min(1).max(30).optional(),
  sessionToken: z.string().optional()
});
export type RoomJoinPayload = z.infer<typeof RoomJoinPayloadSchema>;

export const BOT_DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'GRANDMASTER'] as const;
export type BotDifficulty = typeof BOT_DIFFICULTIES[number];

// S -> C: room:state
export interface SeatState {
  seatIndex: number;
  playerId: string;
  displayName: string;
  connected: boolean;
  graceDeadline?: number;
  isBot?: boolean;
  difficulty?: string;
}

export interface RoomState {
  roomCode: string;
  status: 'LOBBY' | 'IN_PROGRESS' | 'FINISHED';
  hostPlayerId: string;
  seats: SeatState[];
}

// Additive, sparse per-color building state. Only colors that actually carry a
// building appear as keys; `properties` keeps its existing wire shape.
export type BuildingState = Partial<Record<PropertyColor, { house?: boolean; hotel?: boolean }>>;

// S -> C: game:state (Client View)
export interface PlayerClientView {
  id: string;
  displayName: string;
  connected: boolean;
  isBot?: boolean;
  difficulty?: string;
  handCount: number;
  bank: Card[];
  properties: Record<PropertyColor, Card[]>;
  buildings?: BuildingState;
  completedSetColors?: PropertyColor[];
}

// Public charge metadata for every seat. The debtor-only payment choices stay
// in pendingResolution below.
export interface PendingChargeSummary {
  sourceTitle: string;
  rentColor?: PropertyColor | null;
  fromPlayerId: string;
  debtors: Array<{ playerId: string; amountOwed: number }>;
}

export interface GameClientState {
  roomCode: string;
  seq: number;
  currentTurnPlayerId: string;
  turnPhase: 'DRAW' | 'ACTION' | 'DISCARD' | 'COMPLETE' | null;
  drawCount: number | null;
  actionCountRemaining: number;
  drawPileCount: number;
  discardPileCount: number;
  self: {
    id: string;
    hand: Card[];
    bank: Card[];
    properties: Record<PropertyColor, Card[]>;
    buildings?: BuildingState;
    completedSetColors?: PropertyColor[];
  };
  opponents: PlayerClientView[];
  pendingCharge?: PendingChargeSummary;
  pendingResolution?: {
    type: string;
    sourceTitle?: string;
    rentColor?: PropertyColor;
    targetPlayerId: string;
    amountOwed?: number;
    fromPlayerId?: string;
    deadline?: number;
  };
}

// S -> C: game:action-rejected
export interface GameActionRejectedPayload {
  code: string;
  reason: string;
  seq?: number;
}

// S -> C: game:event
export interface GameEventPayload {
  seq: number;
  ts: number;
  playerId: string;
  action: string;
  summary: string;
}

// S -> C: game:over
export interface GameOverPayload {
  winnerId: string;
  sets: number;
}
