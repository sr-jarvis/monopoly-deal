# Monopoly Deal — Server-Authoritative Rules Specification

**Status:** APPROVED — v1.2 slice, turn-structure rules
**Author:** Shuri (Coder/Builder)
**Date:** 2026-07-24
**Companion implementation:** `server/rules_validator.js`

## 0. Purpose

The current server (`server/app.js`) is a non-authoritative event broker: it rebroadcasts whatever a client claims happened. This document specifies the subset of Monopoly Deal turn-structure rules the server must start enforcing, as the first piece of a fully authoritative rules engine.

## 1. Source and citation status

The rules below (draw count, 3-card play limit, Just Say No timing, 7-card hand limit) are standard, well-documented Monopoly Deal mechanics from Hasbro's official *Monopoly Deal Card Game – Rules of Play* rulebook ("Your Turn", "Discarding Cards", and "Just Say No!" sections).

We consulted Watcher (the research and fact-checking specialist) to verify official rule clarifications and edge cases:
- **"Just Say No" countering:** Yes, you can play a "Just Say No" on a "Just Say No" to block it. Doing so can be done at any time (out-of-turn or in-turn) and does *not* count towards the 3-play turn limit.
- **Draw count:** At the start of a turn, draw 2 cards. If a player starts their turn with exactly 0 cards in hand, they draw 5 cards instead of 2.
- **Hand limit & Discarding:** Max hand size is 7 cards at the end of a turn. Discarding excess cards is done at the end of the turn (without counting towards plays/actions).
- **Rearranging:** Rearranging properties/wildcards on the board can only be done during one's own turn and does *not* count as an action.

## 2. Turn structure overview

```
 ┌────────  draw required count   ┌────────  up to 3 plays    ┌──────────┐
 │  DRAW  │ ─────────────────────▶│ ACTION │ ────────────────▶│ (choice) │
 └────────┘                       └────────┘                    └────┬─────┘
                                          ▲                             │
                                          │ Just Say No / rearrange     │ hand ≤ 7?
                                          │ (free, no phase change)     │
                                          │                             ▼
                                   ┌─────────────┐   discard to 7   ┌──────────┐
                                   │  DISCARD    │◀─────────────────│ COMPLETE │
                                   │ (if hand>7) │─────────────────▶│ (advance)│
                                   └─────────────┘   hand == 7      └──────────┘
```

Just Say No may be interjected by an eligible responder at any point, in-turn or out-of-turn, without changing the acting player's phase or consuming a play. The same is true of rearranging one's own board (e.g. reassigning what color a wildcard counts as).

## 3. Draw phase

- A turn begins in the `DRAW` phase. The active player must draw before taking any other action (except responding to a Just Say No situation, which is timing-independent).
- **Normal draw:** 2 cards.
- **Empty-hand draw:** if the player's hand contained **exactly 0 cards** at the moment their turn started (before drawing), they draw **5 cards** instead of 2.
- The draw count is fixed by `handSizeAtStartOfTurn`, a snapshot taken when the turn begins.
- Exactly one draw action is permitted per turn; drawing transitions the phase from `DRAW` to `ACTION`.

## 4. Action phase — the 3-play limit

- Once in the `ACTION` phase, the active player may play **up to 3 cards** from hand (money, property, or action cards) before their turn must end.
- Playing fewer than 3 is always allowed; the player may end their turn early.
- **Explicitly excluded from the 3-play count:**
  - **Just Say No**, whether played by the active player in response to being targeted, or by any other eligible player interrupting out-of-turn. Just Say No is a *response*, not a play, and has no play budget of its own.
  - **Rearranging** cards already on one's own board (e.g. reassigning a property wildcard's active color, or reorganizing groups) — this is bookkeeping, not a play.
- A 4th `PLAY_CARD` action in the same turn is rejected regardless of what the card is.

## 5. Just Say No timing

- Just Say No is validated against a `pendingActionResolution` on the game state (set whenever an action card that can be countered is played against one or more targets).
- Only a player listed in `pendingActionResolution.eligibleResponderIds` may play Just Say No against it, and only while that resolution is pending. This is intentionally decoupled from `turn.playerId` / `turn.phase`, since the responder is frequently *not* the active player.

## 6. End-of-turn discard / hand limit

- The hand limit is **7 cards**.
- A player may end their turn once their hand is at or below the limit.
- If, when the player chooses to end their turn, their hand exceeds 7 cards, the turn transitions to a `DISCARD` phase instead of completing: the player must discard cards one at a time until their hand size is exactly 7.
- Discards **never** count toward the 3-play limit, and are not permitted at any other time.
- Once the hand is back at 7 (or was already ≤ 7), the turn moves to `COMPLETE` and play advances to the next player in `turnOrder`.

## 7. Explicitly out of scope for this slice

The validator introduced here governs *turn structure* only. The following remain client-reported / unvalidated today and are tracked as future slices:
- Legality of individual card effects (Sly Deal/Forced Deal targeting rules, Deal Breaker, Debt Collector amounts, rent calculation by color and property count, House/Hotel prerequisites and eligibility).
- Deck/draw-pile management (shuffling, reshuffling a discard pile, running out of cards).
- Win-condition detection (3 complete property sets).
- Multi-game/lobby state.
- Reconnect/resume handling for dropped connections.
