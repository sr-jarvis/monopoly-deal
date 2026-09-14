# Monopoly Deal Modernization — ROADMAP
**Repository Intake, Git Clone & Security/Dependency Audit**

Sources: [rusdog2784/MonopolyDeal](https://github.com/rusdog2784/MonopolyDeal) (client) and [rusdog2784/MonopolyDeal_Server](https://github.com/rusdog2784/MonopolyDeal_Server) (backend). Target: `daily-builder/monopoly-deal/`.

## 1. Safe Clone Procedure
Principle: both repos are untrusted third-party code until audited. Clone → read → install (only inside a sandbox), never install blindly.
- Scaffold: `monopoly-deal/{client,server,docs,.manifest}/`
- Clone over HTTPS, not SSH — public repos, no credentials needed. (Completed successfully)
- Verify authenticity: confirm git remote -v matches the exact owner/repo, record git rev-parse HEAD + clone timestamp.
- Trademark Notice: "Monopoly Deal" is Hasbro-trademarked IP — fine for private/personal use, not for public redistribution.

## 2. Deep Audit Plan → produces `docs/AUDIT_REPORT.md`
1. **Structure/language discovery**: classify by manifest files present (`package.json`, `*.csproj`, `requirements.txt`, etc.).
2. **Framework/version inventory**: extract every pinned dependency, diff against latest stable majors to quantify drift.
3. **Vulnerability scanning**: `npm audit` / `osv-scanner` against lockfiles, `gitleaks` secret scan, `trivy fs` sweep.
4. **Formatting/quality audit**: run linters in check-only mode.
5. **Architecture audit**: client↔server contract (REST vs. WebSocket), state storage model, auth/session handling.

## 3. Modernization Roadmap (Sequenced Slices)
1. **Containerization** — multi-stage Dockerfiles + `docker-compose` (client, server, Redis), dev/prod overlays, healthchecks.
2. **Game Engine Hardening** — extract rules into a framework-agnostic domain module modeled as an explicit **finite state machine** (turn phases, "Just Say No" chains, Sly/Forced Deal targeting, House-before-Hotel, win detection), using XState/Stateless so illegal states are structurally unrepresentable.
3. **State Machine Verification** — exhaustive unit + property-based/fuzz tests per card and edge case.
4. **Realtime Sync Hardening** — server-authoritative broadcast, optimistic client reconciliation, reconnect/resume.
5. **Reactive UI Modernization** — current framework major, reactive state management, componentized board/cards, responsive layout, PWA/React Native evaluation.
6. **Unified Test Suite + CI** — rules unit tests, API/WebSocket integration tests, Playwright/Cypress e2e.
7. **Observability** — structured logging, basic health/error metrics.

## 4. Secure, Local-only Validation Plan
- No public exposure — compose services bind localhost/internal-only; remote playtesting is VPN/Tailscale only.
- Synthetic player/game data only, no real user data.
- First install of each repo's dependencies runs in an ephemeral container, never on host.
- Everything reversible — repos/containers can be destroyed and re-cloned any time.
