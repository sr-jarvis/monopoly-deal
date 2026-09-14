# Monopoly Deal — Product Requirements Document (PRD)

- **Project:** Monopoly Deal Server-Authoritative Web Application
- **Document status:** Authoritative — supersedes informal notes in ROADMAP.md and AUDIT_REPORT.md
- **Version:** 1.0
- **Date:** 2026-07-25
- **Owner:** Shuri, Lead Builder
- **Architecture sign-off:** Chief Software Architect
- **Companion documents:** `IMPLEMENTATION_PLAN.md` (execution roadmap), `server/RULES_SPEC.md` (authoritative game rules)

---

## 1. Executive Summary

Monopoly Deal is a two-player (scaling to 2–5) real-time online card game. The existing system is a 2017-era prototype: an Express + Socket.io 2.x server holding a single implicit game in module-level globals, paired with a legacy Ionic 3 / node-sass client that no longer builds on modern toolchains.

This project modernizes the product into a **secure, server-authoritative, multi-room, reconnection-resilient Progressive Web App**:

- The **server** owns all game truth — deck generation, shuffling, dealing, and rule enforcement via the pure-function `rules_validator.js` engine and the `game_manager.js` state manager.
- The **client** is rewritten from scratch (Roadmap **Option B**) on **Vite + React + Tailwind CSS** as an installable **PWA**, responsive from phone to wall display.
- **Multiple concurrent matches** run in isolated rooms; **match state persists** across server restarts and player disconnections via **SQLite (Prisma)**, with a **2-minute reconnect grace period**.
- The whole stack ships as **Docker containers running as the unprivileged `pirate` user (UID 1004, GID 1005)** for deployment on **Services VLAN 40**.

## 2. Background & Current State

### 2.1 What exists today (in `server/`)

| Component | File(s) | Status |
|---|---|---|
| HTTP + Socket.io entrypoint | `app.js` | Working prototype; single implicit room, module-level globals |
| Turn-structure rules engine | `rules_validator.js` | Solid; pure functions, phase machine (DRAW → ACTION → DISCARD → COMPLETE), 3-play limit, 7-card hand limit, 2-vs-5 draw rule |
| Authoritative state manager | `game_manager.js` | Working; deck creation, redacted `toClientView()`, immutable `applyAction()` transactions |
| Card domain models | `models/*.js` (Deck, Card, ActionCard, PropertyCard, MoneyCard, RentCard, Wildcard, PropertyType) | Working; generates the 108-card deck |
| Lobby snapshot | `room_view.js` + `GET /api/monopoly/rooms` | Read-only, single hardcoded `default` room |
| Test suite | `test/rules_validator.test.js`, `test/game_manager.test.js`, `test/room_view.test.js` (Mocha/Chai) | Passing; covers turn-structure rules |
| Rules specification | `RULES_SPEC.md` | Authoritative game-rule reference |
| Container image | `Dockerfile`, `.dockerignore` | Drafted; `pirate` user already defined, but **stale** (omits `game_manager.js`, `rules_validator.js`, `room_view.js`) |
| CLI playtest harness | `playtest_cli.js` | Developer tool |

### 2.2 Known defects and gaps (audit findings; formalized here as requirements input)

These are the defects this PRD exists to eliminate:

1. **Any disconnect destroys everything.** `app.js`'s `disconnect` handler resets `players`, `clients`, and `gameState` globally — one dropped Wi-Fi packet ends every game on the server.
2. **Single implicit room.** All state lives in module globals; a third connecting player corrupts the active match. No concurrent matches are possible.
3. **Identity is the ephemeral `socket.id`.** A reconnecting player gets a new socket id and can never be re-associated with their seat.
4. **Client-supplied objects are trusted in places.** Legacy per-card-type events (`action-card`, `money-card`, `property-card`, `wildcard-card`, `rent-card`) accept a full `card` and `player` object from the client and rebroadcast them verbatim; only turn-structure legality is server-checked. Card identity, value, and text must instead be resolved server-side from `cardId`.
5. **Card effects are not resolved server-side.** Rent calculation, payment collection, Sly Deal / Forced Deal / Deal Breaker targeting, Just Say No stacks, and win detection are unimplemented on the server (explicitly out of scope of `rules_validator.js` v1 — see its header comment and `RULES_SPEC.md`).
6. **Deck integrity risks.** `models/Deck.js` pushes the *same object instance* multiple times for duplicate cards (e.g. one `dealBreaker` object pushed twice); every physical copy must be a distinct instance with a unique server-stamped id, or id-based hand lookup and redaction break.
7. **Weak shuffle.** `Math.random()`-based Fisher–Yates in `game_manager.js`; must move to a CSPRNG (`crypto.randomInt`).
8. **No input validation layer.** Socket payloads are consumed without schema validation.
9. **Legacy client is unbuildable.** The Ionic 3 / node-sass toolchain fails on modern Node — the trigger for the Option B rewrite decision.
10. **Aging dependencies.** Socket.io 2.1, Express 4.16; both must be brought to current majors (Socket.io 4.x, Express current, Node 22 LTS).

## 3. Goals & Non-Goals

### 3.1 Goals

- **G1 — Trustworthy gameplay:** No client can gain information or advantage by modifying its code, memory, or network traffic. The server is the single source of truth.
- **G2 — Complete rules:** The full Monopoly Deal ruleset per `RULES_SPEC.md` — including action-card effects, payments, Just Say No, and win detection — is enforced server-side.
- **G3 — Concurrent matches:** N independent rooms run simultaneously with zero state bleed.
- **G4 — Resilience:** A dropped connection, page refresh, or server restart never destroys an active match. Players get a 2-minute reconnect grace window.
- **G5 — Universal client:** One responsive PWA serves phone, tablet/iPad, desktop browser, and wall display, installable to the home screen.
- **G6 — Secure deployment:** Reproducible, unprivileged (`pirate` 1004:1005) containerized deployment on Services VLAN 40 via `docker-compose.yml`.
- **G7 — Verified quality:** Every rule and state transition covered by automated tests; regression-proof refactoring.

### 3.2 Non-Goals (this release)

- Accounts, authentication providers, rankings, or matchmaking beyond room codes. (Identity is a per-match session token.)
- More than 5 players per room, spectator mode, or replays. (The event-log persistence model deliberately leaves the door open — see §7.3.)
- Native app-store distribution (the PWA covers install-to-home-screen).
- AI/bot opponents (the `playtest_cli.js` harness remains a dev tool only).
- Horizontal scaling across multiple server nodes (single-node deployment; the room registry is in-process).

## 4. Users & Platforms

| Persona | Context | Key needs |
|---|---|---|
| **Phone player** | One-handed, portrait, small screen, flaky mobile network | Compact hand fan, large touch targets, seamless reconnect |
| **iPad / tablet player** | Couch play, landscape | Full board visible: own board + opponents + play area at once |
| **Desktop browser player** | Keyboard/mouse | Same layout as tablet; hover affordances are enhancements, never requirements |
| **Wall display** | Large shared screen, possibly read-mostly | Legible at distance; can act as a player seat or an ambient board view |

Supported: evergreen Chrome, Safari (incl. iOS), Firefox, Edge — last 2 major versions. Minimum viewport 360×640; fluid up to 4K.

## 5. Product Requirements

Requirements are numbered for traceability into `IMPLEMENTATION_PLAN.md`. **MUST** = release blocker, **SHOULD** = strongly desired, **MAY** = opportunistic.

### 5.1 Server-Authoritative Game Engine (FR-1xx)

- **FR-101 (MUST):** The server generates, shuffles (CSPRNG), and deals the deck. The full deck order never leaves the server process.
- **FR-102 (MUST):** Every physical card copy is a distinct object with a unique, server-stamped instance id. Clients reference cards *only* by id.
- **FR-103 (MUST):** Clients send **instruction events only** (e.g. `game:action { type: 'PLAY_CARD', cardId, targetZone, propertyColor }`). The server resolves the card from the acting player's hand by id; any client-supplied card body is ignored.
- **FR-104 (MUST):** Every action is validated through `rules_validator.js` (turn/phase/limits) **and** the card-effects engine (targeting, payment sufficiency, set completeness) before any state change. Illegal actions are rejected with a machine-readable code and human-readable reason; state is untouched (guaranteed by the immutable transaction semantics already in `game_manager.applyAction`).
- **FR-105 (MUST):** State broadcast uses `toClientView(state, playerId)` redaction: opponents' hands become counts, the draw pile becomes a count, and no secret metadata (deck order, other players' hand contents) is ever serialized to a client.
- **FR-106 (MUST):** Full card-effect resolution server-side, per `RULES_SPEC.md`: Pass Go; Rent (+ Double The Rent pairing); Debt Collector; It's My Birthday; Sly Deal; Forced Deal; Deal Breaker; House/Hotel placement rules; payment selection from bank/properties with the "no change given" rule; property-wildcard color constraints (a wildcard may only occupy one of its printed colors; 10-color wildcards any group).
- **FR-107 (MUST):** **Just Say No** flow: when a targeted action resolves, eligible targets receive a response window; JSN can be countered by JSN (stack depth ≥ 2); JSN never counts toward the 3-play limit. The pending-resolution model (`pendingActionResolution`) blocks other game actions until resolved or timed out (server-enforced response timeout, default 30 s → auto-accept).
- **FR-108 (MUST):** Win detection: the server declares victory immediately when a player owns 3 complete sets of different colors (set sizes per `RULES_SPEC.md`), locks the room state to `FINISHED`, and broadcasts the result.
- **FR-109 (MUST):** Turn structure exactly as `RULES_SPEC.md`: draw 2 (or 5 on empty hand), max 3 plays, rearrange free, end-of-turn discard to 7, automatic turn rotation, discard-pile reshuffle when the draw pile empties.
- **FR-110 (SHOULD):** An append-only, per-room event log (action + resulting state hash) for debugging, auditability, and future replay.

### 5.2 Multi-Room Lobby (FR-2xx)

- **FR-201 (MUST):** Players create rooms and receive a short human-shareable room code (4–6 chars, unambiguous alphabet). Joining requires the code (or a share link encoding it).
- **FR-202 (MUST):** Each room is a fully isolated `GameRoom` instance (own deck, state, timers); Socket.io **rooms** (one namespace, `room:<code>` channels) scope all gameplay traffic. No cross-room event leakage.
- **FR-203 (MUST):** Room lifecycle: `LOBBY` (players joining; host may start when ≥2 seated) → `IN_PROGRESS` → `FINISHED`; abandoned rooms (all players past grace period, or `FINISHED` + idle timeout) are garbage-collected from memory and marked closed in the store.
- **FR-204 (MUST):** `GET /api/monopoly/rooms` returns the multi-room snapshot (evolving today's `room_view.js`): room code, display name, player count/capacity, status, current turn summary, deck counts — never any hand contents.
- **FR-205 (MUST):** Launch capacity target: ≥ 25 concurrent rooms / 50 concurrent sockets on a single node. Rooms support 2 players at launch; the engine and data model are written for 2–5 (turn order is already a rotating list).
- **FR-206 (SHOULD):** In-room presence UI: seated players, connection status (active / reconnecting with countdown), whose turn it is.

### 5.3 Session Persistence & Reconnection (FR-3xx)

- **FR-301 (MUST):** On joining a room, the server issues a cryptographically random **session token** (per player, per match), delivered once and stored client-side (localStorage). All identity checks use the token, never `socket.id`.
- **FR-302 (MUST):** Match state is persisted to **SQLite via Prisma** (decision rationale §7.2): rooms, seats/tokens, a serialized game-state snapshot after every applied action, and the event log. Single-writer, WAL mode.
- **FR-303 (MUST):** On disconnect, the player is marked `INACTIVE` and a **2-minute grace timer** starts. The room continues to exist; the opponent sees "reconnecting…" status. The game does **not** reset.
- **FR-304 (MUST):** On reconnect with a valid token, the player is re-bound to their seat, receives a full redacted state resync (`game:state` with a state sequence number), and play resumes.
- **FR-305 (MUST):** If the grace period expires, the match is marked abandoned by that player; the remaining player is offered a claim-win / close-room choice. (Auto-forfeit after grace expiry — no infinite zombie rooms.)
- **FR-306 (MUST):** On **server restart**, active rooms are rehydrated from the store; all players are treated as freshly disconnected (grace timers restart at boot time). A crash costs at most the last in-flight action, never the match.
- **FR-307 (SHOULD):** State messages carry a monotonic `seq`; clients detect gaps and request `game:resync` rather than trusting incremental assumptions.

## 5.4 Modern Responsive PWA Client (FR-4xx)

- **FR-401 (MUST):** Ground-up client in **Vite + React (TypeScript) + Tailwind CSS**. No Ionic, no node-sass, no legacy code carried over. Lives in a new `client/` workspace.
- **FR-402 (MUST):** Installable **PWA**: web manifest, icons, service worker precaching the app shell. Offline behavior: the shell loads and shows a clear "reconnecting to server" state (gameplay itself requires connectivity).
- **FR-403 (MUST):** Responsive layouts per §4: portrait phone (stacked: opponent summary strip / center piles / own board / bottom hand drawer), landscape tablet+ (side-by-side boards), wall (auto-scaling typography, high contrast). One codebase, breakpoint/container-query driven.
- **FR-404 (MUST):** Client renders **exclusively from the server's redacted state**. Client-side derived values (bank totals, set completion) are display sugar recomputed from that state, never sent back.
- **FR-405 (MUST):** Full game UI: hand management, drag-or-tap to play (bank / property group / action), color pickers for wildcards and rent targets, payment-selection modal (choose which bank/property cards to surrender), Just Say No prompt with countdown, discard-phase flow, turn/play-counter indicators, win screen.
- **FR-406 (MUST):** Optimistic-free correctness: an action shows as pending until the server confirms; rejections surface the server's reason as a toast with no state divergence.
- **FR-407 (MUST):** Reconnect UX: automatic token-based resume on load/refresh; visible grace countdown when the opponent drops.
- **FR-408 (SHOULD):** Accessibility: WCAG 2.1 AA contrast, full keyboard operability on desktop, card colors always paired with text/icon labels (color-blind safety).
- **FR-409 (SHOULD):** Game event feed ("Riri played Sly Deal on Scott") driven by server `game:event` messages.
- **FR-410 (MAY):** Sound/haptic cues and lightweight animations (Tailwind transitions; no heavy animation runtime).

### 5.5 Security (FR-5xx)

- **FR-501 (MUST):** All inbound socket payloads validated against schemas (zod) before touching game logic; malformed input → rejection, never a crash.
- **FR-502 (MUST):** Anti-cheat invariants (extends `RULES_SPEC.md` security section): information redaction (FR-105), phase gating, id-only card references (FR-103), immutable transactions, CSPRNG shuffle (FR-101).
- **FR-503 (MUST):** Per-socket rate limiting on action events; oversized payloads dropped (`maxHttpBufferSize`); CORS restricted to the deployed client origin.
- **FR-504 (MUST):** Session tokens are ≥128-bit random, scoped to one room, invalidated when the room closes. Tokens never appear in logs or the rooms API.
- **FR-505 (MUST):** Containers run as `pirate` (UID 1004 / GID 1005), `no-new-privileges`, read-only root filesystem where feasible, only the SQLite data volume writable.
- **FR-506 (SHOULD):** `npm audit`/lockfile hygiene in CI; base images pinned and rebuilt on schedule.

### 5.6 Non-Functional Requirements (NFR)

- **NFR-1 Performance:** Server action-processing p95 < 50 ms; end-to-end action→opponent-render p95 < 250 ms on LAN. Client Lighthouse: Performance ≥ 90, PWA installable, initial JS < 300 KB gzipped.
- **NFR-2 Reliability:** Zero match loss on single-process crash (FR-306). Server uptime target 99.5% (homelab-grade).
- **NFR-3 Testability:** Rules engine and game manager remain pure/deterministic (injectable RNG seed) so every rule is unit-testable; coverage gate ≥ 90% lines on `rules_validator.js`, `game_manager.js`, and the card-effects module.
- **NFR-4 Operability:** Structured JSON logs (pino), `/healthz` liveness endpoint (Docker HEALTHCHECK target), room-count/socket-count metrics endpoint.
- **NFR-5 Maintainability:** Node 22 LTS, Socket.io 4.x, Express current; ESLint + Prettier; shared TypeScript types for the socket protocol consumed by both client and server.

## 6. System Architecture (target)

```
┌──────────────────────────── Services VLAN 40 ────────────────────────────┐
│                                                                          │
│  ┌────────────────────┐        ┌───────────────────────────────────────┐ │
│  │  client container  │        │  server container                     │ │
│  │  nginx (unpriv.,   │        │  (user: pirate 1004:1005)             │ │
│  │  pirate 1004:1005) │        │  Node 22 · Express · Socket.io 4      │ │
│  │  serves Vite/React │        │                                       │ │
│  │  PWA static bundle │        │  RoomRegistry ──► GameRoom (×N)       │ │
│  └─────────┬──────────┘        │        │             │                 │ │
│            │                   │        │      game_manager.js          │ │
│  HTTPS/WSS │  (reverse proxy   │        │             │                 │ │
│            │   or direct)      │        │      rules_validator.js       │ │
│  ┌─────────┴──────────┐        │        │      card_effects.js          │ │
│  │ Phones · iPads ·   │◄──────►│        ▼                               │ │
│  │ Browsers · Wall    │  WSS   │  Prisma ──► SQLite (WAL, volume)      │ │
│  └────────────────────┘        └───────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

**Canonical socket protocol (replaces the per-card-type events):**

| Direction | Event | Payload (schema-validated) |
|---|---|---|
| C→S | `room:create` | `{ displayName }` |
| C→S | `room:join` | `{ roomCode, displayName?, sessionToken? }` (token ⇒ reconnect) |
| C→S | `room:start` | `{}` (host only, ≥2 seated) |
| C→S | `game:action` | `{ type, cardId?, targetZone?, propertyColor?, targetPlayerId?, paymentCardIds?, count?, seq }` — the **only** gameplay channel |
| C→S | `game:resync` | `{}` |
| S→C | `room:state` | Lobby/seat/presence snapshot |
| S→C | `game:state` | Redacted `toClientView` + `seq` |
| S→C | `game:action-required` | Pending resolution: pay rent, JSN window, discard needed (with deadline) |
| S→C | `game:action-rejected` | `{ code, reason, seq }` |
| S→C | `game:event` | Public event-feed entry |
| S→C | `game:over` | `{ winnerId, sets }` |

Legacy events (`player-entered`, `action-card`, `money-card`, …) survive behind a compatibility shim only until the new client reaches parity, then are deleted (see IMPLEMENTATION_PLAN Phase 3 exit criteria).

## 7. Key Decisions & Rationale

### 7.1 Client rewrite (Roadmap Option B) — **Decided**
Reviving the Ionic 3 / node-sass toolchain (Option A) would pin dead tooling to Node-8-era binaries for a UI that still wouldn't serve tablets or wall displays. A Vite + React + Tailwind PWA removes the compilation blockers permanently, and Tailwind's utility breakpoints make the four target form factors one styling system rather than four stylesheets.

### 7.2 SQLite via Prisma over Redis — **Decided**
Both were on the table; SQLite wins for this deployment: a durable, zero-extra-container, single-file store that matches the single-node VLAN-40 topology and gives relational queries over rooms/events for free. Redis would add a second stateful service, its own persistence configuration (AOF/RDB), and memory-bound durability for no benefit at 25-room scale. Redis remains the documented migration path if we ever scale past one node — the persistence layer sits behind a repository interface (IMPLEMENTATION_PLAN Phase 2) precisely so this swap stays cheap.

### 7.3 Snapshot + event-log persistence
Persist a full serialized snapshot after each applied action (cheap at this state size, <50 KB) *plus* the append-only action log. Snapshots make restart-rehydration trivial (FR-306); the log enables audit/debug and keeps future replay/spectator features possible without schema changes.

### 7.4 Socket.io rooms over namespaces — **Decided**
One namespace, dynamic `room:<code>` rooms. Namespaces are static-by-design and add handshake complexity; rooms are the idiomatic Socket.io 4 mechanism for dynamic match channels and work unchanged with a future Redis adapter.

## 8. Release Criteria & Success Metrics

**Release gate (all MUST requirements, plus):**

1. Full rules-engine test suite green (every effect card, JSN stacks, payment edge cases, win detection) with coverage ≥ 90% on engine modules.
2. Two-device playthrough (phone + iPad) of a complete match, including: one mid-game refresh on each device, one 90-second network drop with successful resume, and one server restart mid-match with successful rehydration.
3. Lighthouse: PWA installable, Performance ≥ 90 on a mid-range phone profile.
4. `docker compose up` from a clean checkout yields a playable deployment on VLAN 40; `id` inside both containers reports `uid=1004(pirate) gid=1005(pirate)`; containers pass health checks.
5. Security checklist (FR-5xx) verified, including a manual cheat-attempt session — forged card ids, out-of-turn actions, oversized/malformed payloads, replayed tokens — all rejected without server crash or information leak.

**Post-launch success metrics:** match completion rate > 90% (matches that start reach `FINISHED`); reconnect success rate > 95% within the grace window; zero state-corruption incidents.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Card-effects engine complexity (JSN stacks, payment "no change" rules) balloons | Schedule slip, rule bugs | Ships in Phase 1 as pure functions with exhaustive unit tests *before* any UI exists; `playtest_cli.js` drives full matches headlessly |
| Rewrite-in-place breaks the working prototype | Lost demo capability | Compatibility shim keeps the legacy event surface alive until the new client reaches parity (Phase 3 gate) |
| SQLite write contention under bursty rooms | Latency spikes | WAL mode + per-process single-writer queue; snapshots are small; load-tested in Phase 5 |
| iOS PWA/service-worker quirks | Broken installs on iPhone | Test on real iOS Safari from Phase 3 onward; PWA features degrade gracefully to plain web app |
| Scope creep toward 3–5 players / spectators | Delays core release | Engine is written N-player-ready; UI and release gate are 2-player only (§3.2) |
