# Private standard Monopoly Deal v1

Owner: Forge. Purpose: standard manual-complete two-to-five-player personal LAN game for Scott and family. Canonical source: sr-jarvis/monopoly-deal; durable clone /home/hermes/projects/monopoly-deal. Dependencies: Node/npm React/Vite workspace and existing Agent Services Prod Docker stack. Review/retirement: project retirement or runtime/rules-edition change. Private `.delivery/` retains release, test, manual source, review and rollback evidence; do not copy it into images. No new infrastructure, accounts, public listeners or paid services.

## Two-person quick start

1. On the home network open http://10.10.40.112:18080 on each person's device. Use separate browsers/profiles (one private seat per browser profile).
2. The youngest player creates a room, enters a name, and shares the four-character code. The other enters their name/code and joins. Creator starts. Seats run clockwise in join order; supports 2–5 players.
3. Tap a hand card to bank it, place a property or choose an action/target. Property cards never bank. Select an existing property group or a new same-color set. Wild cards can move between legal groups on your turn without using a play.
4. Start each later turn with Draw 2 (Draw 5 only when empty at the start). Play zero to three cards, then End Turn. If over seven, select and discard extras.
5. Actions targeting you open a response dialog. Accept or play a held Just Say No; the opponent may counter or pass. Other actions wait. For debts, select your bank/property/building cards; no hand payment or change. If insolvent, select all payable assets; zero-value rainbow wilds stay yours.
6. Three completed DIFFERENT colors wins immediately after any pending action is accepted. Use the win dialog's new-game/rematch control to return both players to the lobby.
7. Refresh/reconnect automatically resumes the same seat and hand. Keep the private session token in this browser; do not share browser storage. Tokens expire after 24h without reconnect. A second tab takes over that profile's seat; use another profile for another player.

## Rules and limitations

See MANUAL_COVERAGE.md for primary Hasbro sources and rule-by-rule tests. Modern E3113 setup/payment text controls the regular-wild banking discrepancy with older B0965; B0965 supplies detailed action-card descriptions. Youngest-first is a social setup instruction (youngest creates), not age collection. Additional same-color sets are independently targeted but only distinct colors count toward victory. Legacy overfull piles transfer one printed set-size subset, not all cards of a color.

Rooms/sessions remain in memory: server restart or deployment ends current matches. This v1 adds refresh/reconnect recovery, not crash/restart persistence. Do not deploy while people are playing. No accounts, public matchmaking or public exposure. LAN HTTP is intentional; play only on the trusted home network. Browser install/PWA secure-context support is NOT promised for a private HTTP IP. Legacy bot strategy is preserved, not redesigned; bots accept reaction windows rather than add new cancellation strategy. Human JSN/counter-JSN is complete. Broad screen-reader/contrast certification is not claimed.

## Verification / security

Canonical gates: `npm ci --ignore-scripts`, `npm test` (server behavior and socket tests plus client tsc/Vite/PWA build), `npm --workspace=client run lint`, `npm audit --omit=dev`, Docker client/server builds. A lightweight least-privilege GitHub verify workflow runs these gates; it does not deploy or use secrets.

Scoped dependency remediation updates compatible transitives plus Zod 4.6.7 (shared schema tests/typebuild verified) and qs 6.17.1 override. Production audit zero. Full development audit still reports toolchain-only picomatch/glob/minimatch/diff/serialize-javascript/Vite/esbuild advisories; tools run only on trusted repository data in private fixtures, never served as production dev servers. These do not ship in the production server or static client runtime. Review on next toolchain maintenance; do not blindly force major upgrades to silence them.

Server-authoritative held-card validation, hidden-hand/draw-pile redaction, opaque 256-bit hashed seat tokens, bounded socket payloads/message rate and explicit production browser-origin allowlist protect normal play. Legacy HTTP reset/delete and live-room advisors are denied; synthetic-state analytics remain compatible. This is a private game, not an Internet-hardened authenticated service.

## Delivery / rollback

Deploy only the exact merged verified commit. Build both images with `APP_REVISION=<commit>`; server `/api/monopoly/version`, client `/revision.txt`, and both OCI labels must agree. The old client inherited its base Nginx image revision label: that historical label was NOT proof of application revision.

Preserve the old app tree, Compose/environment, exact image IDs/tags and public room/replay observations in a restrictive host-local release backup. The old app has no disk game database; disconnected in-memory games cannot be restored by an ordinary container restart. Backups protect source/images/config, not a false promise of resumable RAM. Require zero connected real players immediately before recreation.

Update only the existing monopoly-deal-prod stack. Retain private bind 10.10.40.112:18080 and internal server:9000, existing JSON log rotation, and unrelated services. Set `MONOPOLY_ALLOWED_ORIGINS=http://10.10.40.112:18080`. Rollback restores the saved app/Compose/environment and tags saved images as monopoly-deal-{client,server}:local, then `docker compose up -d --no-build` for only this stack. Verify private binding, health and UI after rollback. Actual release SHA, paths, exact commands and readbacks live in `.delivery/RELEASE.md`.
