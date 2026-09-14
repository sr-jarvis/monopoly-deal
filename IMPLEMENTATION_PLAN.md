# Monopoly Deal — Implementation Plan

- **Project:** Monopoly Deal Server-Authoritative Web Application
- **Version:** 1.0 · **Date:** 2026-07-25
- **Companion documents:** `PRD.md` (requirements; FR-xxx references below), `server/RULES_SPEC.md` (game rules)
- **Sizing legend:** S = ≤1 day · M = 2–4 days · L = ~1 week of focused work

## Guiding Principles

1. **Engine before pixels.** The complete, tested rules engine (Phases 0–1) lands before any client work; `playtest_cli.js` and the Mocha suite are the UI until then.
2. **Never break the prototype.** The legacy socket events stay functional behind a compatibility shim until the new client reaches parity; each phase leaves `master` deployable.
3. **Every phase has exit criteria.** A phase is done when its criteria pass, not when its code merges.
4. **Determinism is a feature.** RNG is injected (seedable) everywhere so full matches replay identically in tests.
5. **Small, reviewed increments.** One work item per PR, tests in the same PR.

## Phase Overview

| Phase | Theme | Size | PRD coverage |
|---|---|---|---|
| 0 | Foundation & defect burn-down | M | FR-101, FR-102, FR-501 (partial), NFR-5 |
| 1 | Complete rules engine + multi-room server | L | FR-103–110, FR-201–206, FR-502, FR-503 |
| 2 | Persistence & reconnection | L | FR-301–307, FR-504 |
| 3 | PWA client rewrite | L+ | FR-401–410 |
| 4 | Containerization & deployment | M | FR-505, FR-506, NFR-4 |
| 5 | Hardening, QA & launch | M | §8 release gate, NFR-1/2 |

Dependencies are strictly sequential at the phase level, with one sanctioned overlap: Phase 3 scaffolding (3.1–3.3) may start once the Phase 1 protocol (1.2) is frozen.

---

## Phase 0 — Foundation & Defect Burn-Down

Goal: a trustworthy substrate. No features; kill the audit findings that would poison later phases.

### 0.1 Toolchain & dependency modernization (S)
- Pin Node 22 LTS (`.nvmrc`, `engines` in `package.json`).
- Upgrade `socket.io` 2.x → 4.x and `express` to current. Socket.io 4's default CORS-deny will surface immediately: configure allowed origins explicitly.
- Add ESLint + Prettier + `npm run lint`; add `c8` coverage to `npm test` (Mocha/Chai suite stays — it passes and grows through Phase 1).
- **Files:** `package.json`, `.eslintrc`, minor `app.js` API updates for Socket.io 4.

### 0.2 Deck integrity & CSPRNG shuffle (S) — FR-101, FR-102
- Fix `models/Deck.js`: duplicate cards are currently pushed as the **same object reference** (e.g. one `dealBreaker` instance appears twice). Construct a fresh instance per physical copy.
- Stamp a unique instance id (`crypto.randomUUID()`) on every card at deck build; assert 108 distinct ids in a test.
- Replace the `Math.random()` Fisher–Yates in `game_manager.js` with `crypto.randomInt`; expose an injectable RNG so tests can seed it (NFR-3).
- Shuffle the draw pile at creation (today `Deck.cards` order is the construction order until first reshuffle).
- **Files:** `models/Deck.js`, `models/Card.js`, `game_manager.js`, `test/deck.test.js` (new).

### 0.3 Stop the disconnect apocalypse (S)
- Remove the global wipe in `app.js` (`players = []; gameState = null` on any disconnect). Interim behavior until Phase 2: mark the seat disconnected and keep state; a room reset requires explicit action or server restart.
- **Files:** `app.js`.

### 0.4 Input validation scaffold (S) — FR-501
- Add `zod`; define schemas for every inbound event payload; wrap all socket handlers in a validator + try/catch envelope that emits `game:action-rejected { code: 'BAD_PAYLOAD' }` instead of crashing.
- **Files:** `schemas.js` (new), `app.js`.

**Exit criteria:** suite green on Node 22 with Socket.io 4; deck test proves 108 unique instances/ids; killing one socket mid-match no longer destroys state; fuzzed junk payloads (`null`, 1 MB strings, wrong types) produce rejections, zero crashes.

---

## Phase 1 — Complete Rules Engine & Multi-Room Server

Goal: the server plays *real* Monopoly Deal, many games at once, over one clean protocol.

### 1.1 `GameRoom` + `RoomRegistry` (M) — FR-201, FR-202, FR-203, FR-204
- New `game_room.js`: encapsulates one match — game state, seats, timers, event log; all today's per-match globals move inside it.
- New `room_registry.js`: create/join/lookup/GC; room codes from an unambiguous alphabet (no `0/O/1/I`); lifecycle `LOBBY → IN_PROGRESS → FINISHED`.
- Socket.io: on join, `socket.join('room:' + code)`; all broadcasts scoped to the room channel. Per-player emits (redacted views) stay per-socket.
- Rewrite `room_view.js` to snapshot the registry (multi-room array replaces today's single synthesized entry); `GET /api/monopoly/rooms` unchanged in shape per entry.
- **Files:** `game_room.js`, `room_registry.js` (new), `app.js`, `room_view.js`, `test/room_registry.test.js`.

### 1.2 Unified `game:action` protocol + legacy shim (M) — FR-103, FR-503
- Implement the canonical protocol from PRD §6. One handler: validate schema → resolve room → resolve card **by id from server-side hand** → `game_manager.applyAction` → broadcast.
- Delete all trust in client card/player bodies. Legacy events (`action-card`, `money-card`, `property-card`, `wildcard-card`, `rent-card`, `end-turn`, `player-entered`) become thin translators into `game:action` / `room:join` in `legacy_shim.js`, clearly marked for deletion at Phase 3 exit.
- Per-socket token-bucket rate limit (e.g. 10 actions/5 s) on `game:action`.
- **Files:** `app.js`, `legacy_shim.js` (new), `schemas.js`.

### 1.3 Card-effects engine (L) — FR-106
- New `card_effects.js`, pure functions in the style of `rules_validator.js` (validate → apply, no mutation), invoked from `game_manager.applyAction` when a `PLAY_CARD` targets the action zone or a placement needs card-level checks:
  - **Placement rules:** single-color property → matching group only; 2-color wildcard → one of its printed colors; 10-color wildcard → any group; House/Hotel → complete non-utility/railroad sets only; money & action-as-money → bank.
  - **Pass Go** (draw 2, reshuffle-aware), **Debt Collector** (5M demand), **It's My Birthday** (2M from each opponent), **Rent** (color-matched, computed from set size + house/hotel bonuses per `RULES_SPEC.md`), **Double The Rent** (must accompany a rent play; consumes one of the 3 plays), **Sly Deal** / **Forced Deal** (no cards from complete sets), **Deal Breaker** (complete set incl. buildings).
  - **Payments:** debtor selects `paymentCardIds` from bank and/or properties; server verifies ownership + sufficiency; overpay allowed, no change given; property cards received go to the payee's property zone (color rules re-applied); a debtor with nothing pays nothing.
- Extend the `GameState` with a `pendingActionResolution` payload rich enough for payment demands (who owes whom how much, deadline).
- **Files:** `card_effects.js` (new), `game_manager.js`, `rules_validator.js` (only if a new phase-gate is needed), `test/card_effects.test.js` (largest single test file in the repo — one `describe` per card).

### 1.4 Just Say No & pending-resolution flow (M) — FR-107
- Generalize `pendingActionResolution` into a small stack: targeted action → JSN window (eligible responders per `rules_validator.validateJustSayNoAction`) → JSN counter-window → resolve or cancel. Server timeout (30 s default, injectable for tests) auto-resolves as "no response".
- While a resolution is pending, all other `game:action`s from any player are rejected with `PENDING_RESOLUTION`.
- **Files:** `game_manager.js`, `card_effects.js`, `test/just_say_no.test.js`.

### 1.5 Win detection & set accounting (S) — FR-108
- `computeCompleteSets(player)` per `RULES_SPEC.md` set sizes (wildcards count where placed; a 10-color wildcard can complete only one set at a time). Checked after every applied action; on 3 complete distinct-color sets → state `FINISHED`, `game:over` broadcast, room locked.
- **Files:** `card_effects.js` or `scoring.js` (new), `test/scoring.test.js`.

### 1.6 Event log & feed (S) — FR-110, FR-409
- Append `{ seq, ts, playerId, action, summary }` per applied action inside `GameRoom`; emit the public-safe `summary` as `game:event`.
- **Files:** `game_room.js`.

### 1.7 Full-match verification (M) — NFR-3
- Extend `playtest_cli.js` into a scripted + random ("monkey") driver over the real engine with a seeded RNG; add a soak test playing 1,000 random matches asserting invariants every step: total card count conserved at 108, no duplicate ids across zones, no negative piles, every match terminates (win or deck-cycle cap).
- **Files:** `playtest_cli.js`, `test/soak.test.js`.

**Exit criteria:** two matches run concurrently over websockets with zero bleed (integration test with 4 socket.io-client sockets); every card effect has passing unit tests incl. JSN-on-JSN and partial-payment edge cases; soak test green; engine coverage ≥ 90%; legacy shim still drives the old flow end-to-end.

---

## Phase 2 — Persistence & Reconnection

Goal: matches survive disconnects, refreshes, and server restarts. This retires the last "purge on drop" behavior.

### 2.1 Prisma + SQLite storage layer (M) — FR-302
- Add Prisma with SQLite (WAL mode). Schema:
  - `Room` (id, code, status, createdAt, closedAt)
  - `Seat` (id, roomId, playerName, tokenHash, seatIndex, connectionStatus, lastSeenAt)
  - `Snapshot` (roomId, seq, stateJson, createdAt) — latest-per-room is authoritative for rehydration; keep last N=20 for debugging
  - `EventLog` (roomId, seq, playerId, actionJson, summary, ts)
- Wrap behind `match_store.js` (repository interface: `saveSnapshot`, `loadActiveRooms`, `recordEvent`, `upsertSeat`, …) so a Redis implementation stays a drop-in (PRD §7.2). Per-process write queue; persistence is post-broadcast async with failure logging (a lost write costs one action on crash — accepted, FR-306).
- **Files:** `prisma/schema.prisma`, `match_store.js` (new), `game_room.js`.

### 2.2 Session tokens replace `socket.id` (M) — FR-301, FR-504
- On seat assignment: issue `crypto.randomBytes(32)` token, send once in `room:state`, store only its SHA-256 hash. All action authorization resolves seat-by-token (socket ↔ seat binding kept in memory per connection). `socket.id` no longer appears in game state.
- **Files:** `game_room.js`, `app.js`, `schemas.js`.

### 2.3 Disconnect → grace period (M) — FR-303, FR-305
- On disconnect: seat → `INACTIVE`, broadcast presence with `graceDeadline` (now + 120 s), start room timer. On expiry: mark abandoned, offer opponent claim-win/close via `game:action-required`; either choice → `FINISHED`.
- If a pending resolution (e.g. payment demand) targets the disconnected player, its own timeout still governs that resolution.
- **Files:** `game_room.js`, `test/reconnect.test.js`.

### 2.4 Reconnect & resync (M) — FR-304, FR-307
- `room:join` with `sessionToken`: rebind socket to seat, cancel grace timer, emit full `game:state` (+`seq`), broadcast presence recovery. All `game:state` messages carry `seq`; `game:resync` returns the current full view. Client-side gap detection lands in Phase 3.
- **Files:** `game_room.js`, `app.js`.

### 2.5 Server-restart rehydration (M) — FR-306
- On boot: `loadActiveRooms()` → rebuild `GameRoom`s from latest snapshots; every seat starts `INACTIVE` with fresh grace timers; expired/`FINISHED` rooms closed in store. Nightly GC prunes closed-room snapshots/logs older than 30 days.
- **Files:** `app.js` (boot sequence), `match_store.js`.

**Exit criteria:** integration tests prove — mid-match socket kill + rejoin-with-token resumes play with identical state hash; `kill -9` + restart mid-match rehydrates and both clients resume; grace expiry produces claim-win flow; token replay from a second socket while the first is live is rejected; stolen/garbage tokens rejected; tokens absent from logs and `/api/monopoly/rooms`.

---

## Phase 3 — PWA Client Rewrite (Vite + React + Tailwind)

Goal: one responsive, installable client for phone / iPad / desktop / wall. May begin at 3.1 once the 1.2 protocol is frozen.

### 3.1 Repository restructure & scaffold (S) — FR-401
- Promote the repo root one level so the tree becomes `monopoly-deal/{server/, client/, shared/, docs}` under a single git root with npm workspaces (`PRD.md` and this file live at that root). Today `.git` lives *inside* `server/` — move it up (`git mv` of server contents into `server/`), preserving history.
- Scaffold `client/`: Vite + React + TypeScript + Tailwind; ESLint/Prettier shared config; `vite-plugin-pwa`.
- **Files:** root `package.json` (workspaces), `client/*`.

### 3.2 Shared protocol types (S) — NFR-5
- `shared/protocol.ts`: TypeScript types + zod schemas for every event in PRD §6, consumed by client directly and by the server via zod (single source of truth; server stays JS + zod until a later TS migration).
- **Files:** `shared/protocol.ts`, `server/schemas.js` (re-export/derive).

### 3.3 Connection & state layer (M) — FR-404, FR-406, FR-407, FR-307
- `socket.io-client` wrapper: connect/reconnect with stored session token, `seq` gap detection → `game:resync`, pending-action tracking (action in flight until confirmed/rejected → toast).
- Store: Zustand slices — `session` (token, roomCode, persisted to localStorage), `room` (presence), `game` (latest redacted state), `feed` (events). Rendering is a pure function of server state (FR-404).
- **Files:** `client/src/net/`, `client/src/store/`.

### 3.4 Lobby & room flow (M) — FR-201, FR-206
- Screens: home (create / join-by-code), room lobby (seats, presence badges with grace countdowns, host start button), shareable join link (`/#/room/CODE`).
- **Files:** `client/src/pages/`.

### 3.5 Game board UI (L) — FR-403, FR-405
- Layout system: portrait phone = stacked (opponent summary strip / center piles / own board / bottom hand drawer); ≥ md landscape = side-by-side boards + persistent hand; wall = auto-scaling `clamp()` typography, high-contrast, feed prominent.
- Components: `Card` (color chip + label + value, per FR-408), `PropertyGroup` (set-progress ring), `Bank`, `HandDrawer` (tap → context sheet: Bank / Play as property [color picker] / Play action [target picker]), `PaymentModal` (select surrendered cards until debt met, live sum), `JsnPrompt` (countdown, Just Say No if held), `DiscardPrompt`, `TurnHud` (phase + plays-remaining pips), `WinScreen`, `EventFeed`.
- Every interaction emits `game:action` and waits for confirmation; rejection reasons render as toasts (FR-406).
- **Files:** `client/src/components/`, `client/src/features/game/`.

### 3.6 PWA packaging (S) — FR-402
- Manifest (icons, portrait-any orientation, standalone), service worker precaching the shell, offline fallback screen ("reconnecting…"). Verify install + resume on real iOS Safari and Android Chrome.
- **Files:** `client/vite.config.ts`, `client/public/`.

### 3.7 Parity gate & legacy deletion (S)
- Full two-browser match on the new client covering every card type, a payment, a JSN, a discard phase, and a win. Then delete `server/legacy_shim.js` and the legacy event names.
- **Files:** delete `server/legacy_shim.js`.

**Exit criteria:** complete match playable phone↔iPad; refresh mid-match resumes via token; Lighthouse PWA installable + Performance ≥ 90 (mid-range phone profile); keyboard-only match completable on desktop; contrast checks pass (FR-408); legacy events removed and integration tests updated to the canonical protocol only.

---

## Phase 4 — Containerization & Deployment (VLAN 40)

### 4.1 Server image (S) — FR-505
- Fix the stale `server/Dockerfile`: multi-stage on `node:22-alpine`; `npm ci --omit=dev`; **copy all runtime modules** (today it omits `game_manager.js`, `rules_validator.js`, `room_view.js` — ship `*.js`, `models/`, `prisma/`); keep `pirate` 1004:1005; `prisma migrate deploy` on entrypoint; HEALTHCHECK → `/healthz`.
### 4.2 Client image (S) — FR-505
- Stage 1: `node:22-alpine` builds the Vite bundle. Stage 2: `nginxinc/nginx-unprivileged` re-mapped to UID 1004/GID 1005 serving static bundle; SPA fallback; long-cache hashed assets, no-cache `index.html`; listens on an unprivileged port (8080).
### 4.3 `docker-compose.yml` (M) — FR-505
- Services `client` + `server` on an internal bridge attached to Services VLAN 40 (host-side macvlan/bridge per homelab convention — parameterized via `.env`).
- Both services: `user: "1004:1005"`, `security_opt: [no-new-privileges:true]`, `read_only: true` with tmpfs where needed; named volume `monopoly-data` (SQLite, owned 1004:1005) as the **only** writable mount; `restart: unless-stopped`; healthchecks; server CORS pinned to the client origin; WSS/TLS terminates at the existing reverse proxy (documented in `docs/DEPLOY.md`).
### 4.4 CI pipeline (S) — FR-506
- On push: lint → server unit/integration tests → client build + tests → `docker build` both images → `npm audit --omit=dev` (fail on high/critical). Images tagged by git SHA.

**Exit criteria:** clean-checkout `docker compose up -d` → playable match from two devices on VLAN 40; `docker exec … id` reports `uid=1004(pirate) gid=1005(pirate)` in both containers; `docker restart` of the server mid-match rehydrates (Phase 2 behavior verified *in-container*); writable-path audit shows only the data volume.

---

## Phase 5 — Hardening, QA & Launch

### 5.1 End-to-end suite (M)
- Playwright, two browser contexts vs. the compose stack: full scripted match; mid-match reload; simulated 90 s offline (context offline toggle) + resume; grace-expiry claim-win path.
### 5.2 Load & soak (S) — NFR-1, FR-205
- Socket.io load driver: 25 rooms / 50 clients playing scripted turns for 30 min. Assert action p95 < 50 ms, no memory growth trend, SQLite write queue stays bounded.
### 5.3 Security verification (M) — FR-5xx
- Scripted cheat battery (extends Phase 0 fuzzing): forged/out-of-hand card ids, out-of-turn and wrong-phase actions, wildcard-to-illegal-color, underpayment, JSN when ineligible, token replay/brute-force, event flooding vs. rate limit, oversized payloads. Assert every response is a clean rejection and redacted views never contain opponent hand contents or draw-pile order (snapshot-diff test on `toClientView`).
### 5.5 Observability (S) — NFR-4
- pino JSON logs (room code + seq context, no tokens), `/healthz`, `/metrics` (room count, socket count, action latency histogram); compose log rotation.
### 5.6 Launch (S)
- Execute PRD §8 release-gate checklist end-to-end; tag `v2.0.0`; archive legacy client code; `docs/DEPLOY.md` + `docs/RUNBOOK.md` (restart, backup = copy SQLite file, restore drill).

**Exit criteria:** PRD §8 gate fully green — ship.

---

## Traceability Matrix (PRD → Plan)

| PRD requirement | Delivered by |
|---|---|
| FR-101, FR-102 | 0.2 |
| FR-103 | 1.2 |
| FR-104, FR-106 | 1.3 |
| FR-107 | 1.4 |
| FR-108 | 1.5 |
| FR-109 | existing `rules_validator.js` + 1.3 regression suite |
| FR-110 | 1.6, 2.1 |
| FR-201–206 | 1.1, 1.2, 3.4 |
| FR-301–307 | 2.1–2.5, 3.3 |
| FR-401–410 | 3.1–3.7 |
| FR-501 | 0.4 |
| FR-502 | 0.2, 1.2, 1.3, 5.3 |
| FR-503 | 1.2, 4.3 |
| FR-504 | 2.2 |
| FR-505 | 4.1–4.3 |
| FR-506 | 4.4 |
| NFR-1 | 3.6, 5.2 |
| NFR-2 | 2.5, 5.1 |
| NFR-3 | 0.2, 1.7 |
| NFR-4 | 5.4 |
| NFR-5 | 0.1, 3.2 |

## Rollback Strategy

- Every phase merges behind a deployable `master`; images are tagged per git SHA, so rollback = redeploy previous tag.
- Phase 2 schema changes ship as forward-only Prisma migrations; the SQLite file is backed up (file copy) before each deploy.
- The legacy shim (1.2) is the safety net for the entire client rewrite window and is deleted only at the 3.7 parity gate.
