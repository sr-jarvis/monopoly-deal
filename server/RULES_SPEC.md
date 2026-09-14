# 🛡️ [STARK-DEAL-HUD] :: AUTHORITATIVE GAME RULES SPECIFICATION (v1.2)

- **Project:** Monopoly Deal Authoritative Server
- **Path:** `/home/agent/.hermes/profiles/shuri/projects/daily-builder/monopoly-deal/server/RULES_SPEC.md`
- **Owner:** Shuri, Lead Builder
- **Validator Engine:** `rules_validator.js`
- **Manager Engine:** `game_manager.js`

---

## 📌 Introduction

This document details the authoritative ruleset enforced by the Monopoly Deal server-side state machine. In compliance with the non-authoritative client mitigation plan, the server strictly validates all player actions, preventing spoofing and client-side gameplay hacks. Invalid actions are rejected with descriptive errors, while valid actions are applied to the game state and broadcasted as redacted player-specific views.

---

## 🔄 Turn structure & Phases

Each player's turn is divided into four distinct phases. Turn order is determined during game initialization and rotates sequentially.

### 1. DRAW Phase
- **Entry Condition:** Turn rotates to the active player.
- **Rules:**
  - If the player begins their turn with **0 cards in hand**, they must draw exactly **5 cards** from the draw pile.
  - If the player has **1 or more cards in hand**, they must draw exactly **2 cards** from the draw pile.
- **Allowed Actions:** `DRAW` (exactly once).
- **Transitions:** Drawing transitions the phase to `ACTION`.

### 2. ACTION Phase
- **Allowed Actions:** `PLAY_CARD`, `REARRANGE`, `END_TURN`, `JUST_SAY_NO`.
- **Card Play Limit:** The player may perform at most **3 actions/plays** per turn.
  - Playing a card from hand to the properties zone is 1 play.
  - Playing a money or action card to the bank is 1 play.
  - Playing an action card (e.g. Rent, Deal Breaker, Sly Deal) to the center discard pile as an action is 1 play.
  - Rearranging wildcards or property organizations is a **free action** (does not count against the 3-play limit).
- **Transitions:** Triggering `END_TURN` moves the player out of the ACTION phase.
  - If the hand size is **greater than 7**, transitions to `DISCARD` phase.
  - If the hand size is **7 or fewer**, transitions directly to `COMPLETE` (rotating the active turn to the next player).

### 3. DISCARD Phase
- **Entry Condition:** Player ended their turn with more than 7 cards in their hand.
- **Rules:**
  - Player must discard cards from their hand to the discard pile until their hand size is exactly **7 cards**.
  - Players cannot play cards to their bank or property piles during this phase.
  - Rearranging properties is still allowed as a free action.
- **Allowed Actions:** `DISCARD`, `REARRANGE`.
- **Transitions:** Discarding down to 7 cards automatically rotates the turn and transitions the phase to `COMPLETE`.

---

## 📁 Card & Zone Mechanics

The server tracks three distinct zones per player: **Hand**, **Bank**, and **Properties**.

### 1. Hand
- **Visibility:** Confidential. Opponents only see the count/size of the player's hand.
- **Cards:** Any card type (Money, Action, Property, Rent, Wildcard).

### 2. Bank
- **Visibility:** Fully Public.
- **Accepted Cards:** Money Cards and Action Cards (used as cash value).
- **Rules:** Once a card is placed in the Bank, it can only be used as currency. It cannot be moved back to the hand, nor can Action Cards placed in the bank be played for their action text later.

### 3. Properties Zone
- **Visibility:** Fully Public.
- **Accepted Cards:** Property Cards, Wildcards, Rent Cards (if co-packaged or placed, though Rent cards are normally action discard assets).
- **Organization:** Properties are grouped into columns/sets by color.
  - **Single-Color Cards:** Must match the group's color.
  - **Multi-Color Wildcards:** Can be placed in either of their designated colors and can be rearranged to change their active color group during the owner's ACTION or DISCARD phase.
  - **10-Color Wildcards:** Can be placed in any property group.

---

## 🏘️ Complete Sets & Winning Conditions

The objective of the game is to build complete property sets. A player wins immediately when they own **3 complete sets of different colors** at any point during their turn.

### Complete Set Criteria by Color:
- 🟫 **Brown:** 2 Cards
- 🟦 **Light Blue:** 3 Cards
- 🟪 **Pink:** 3 Cards
- 🟧 **Orange:** 3 Cards
- 🟥 **Red:** 3 Cards
- 🟨 **Yellow:** 3 Cards
- 🟩 **Green:** 3 Cards
- 🟦 **Dark Blue:** 2 Cards
- 🟤 **Utility (Black/Green):** 2 Cards
- 🚉 **Railroad (Black):** 4 Cards

---

## 🛡️ Security & Anti-Cheat Protocols

1. **Information Redaction:** The API endpoint `toClientView(state, playerId)` redacts opponent hand cards, the draw pile order, and secret metadata, preventing memory-scraping cheats.
2. **Phase Gating:** Actions performed out of turn or during the wrong phase are instantly rejected.
3. **Immutability:** State mutations are executed as deep-cloned transactions; validation failures leave the original state entirely untouched.
