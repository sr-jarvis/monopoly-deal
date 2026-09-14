# Monopoly Deal — Full-Stack Application & AI Game Engine

An interactive, full-stack digital implementation of **Monopoly Deal** built with React, TypeScript, Node.js, Socket.io, and a custom AI Bot Decision Engine.

![Monopoly Deal Architecture](docs/architecture.png)

## Overview

- **React Client (`/client`)**: Modern React 18 + TypeScript + Vite + Tailwind CSS frontend featuring:
  - Hardware-accelerated 3D CSS transforms for card movements.
  - Interactive **3D Card Shuffle, Cut & Multi-Seat Deck Dealer Flight Animation Engine**.
  - Interactive **3D Rent Charge & Multi-Seat Payment Cascade Flight Animation Engine**.
  - WebAudio sound engine for synchronized card flips, draws, coins, and rent payment SFX.
- **Node.js Game Server (`/server`)**: Express + Socket.io backend handling state management, room lobbies, action card resolution, turn limits, and multiplayer synchronization.
- **AI Bot & Rules Engine**: High-performance Bot Engine with heuristic turn planning, combo optimization, dealbreaker defense, payment optimization, opponent profiling, and tournament simulation.
- **Shared Schemas (`/shared`)**: Canonical Monopoly Deal card definitions, property sets, rules, and game constants.
- **Legacy Ionic Client (`/client-legacy-ionic`)**: Historical Ionic/Angular mobile client preserved for reference.

---

## Architecture

```
monopoly-deal/
├── client/                 # React + TypeScript + Vite + Tailwind CSS frontend
│   ├── src/
│   │   ├── components/     # GameBoard, PaymentModal, CardShuffleOverlay, etc.
│   │   ├── utils/          # Card flight engines, sound engine, socket clients
│   │   └── types/          # Game state & card type definitions
├── server/                 # Express + Socket.io Node.js backend
│   ├── models/             # Card, Deck, MoneyCard, PropertyCard, Wildcard, etc.
│   ├── bot_engine.js       # AI Bot decision engine & strategic heuristics
│   ├── game_manager.js     # Multiplayer state machine & game loops
│   ├── rules_validator.js  # Move validation & rule enforcement
│   └── test/               # Comprehensive 600+ test suite
├── shared/                 # Card catalog, rules catalog, and shared constants
├── docs/                   # PRD, Rules Specification, and Implementation Plans
└── docker-compose.yml      # Container orchestration
```

---

## Features

### 3D Card Animation Engines
- **Parabolic Bezier Trajectories**: Cards fly along 3D quadratic/cubic Bezier curves with height/depth arcs.
- **Multi-Seat Stagger Scheduling**: Staggered flight paths for 2–5 players when dealing, demanding rent, or settling debt.
- **Speed Control & Audio Sync**: Presets (`slow`, `normal`, `fast`, `turbo`) with WebAudio spatial sound effects.

### AI Bot Decision Engine
- Evaluates turn options using turn planning, combo search, and payment minimization.
- Includes opponent profiling, dealbreaker counter-plays, rent mitigation, and tournament simulation.

---

## Quickstart

### Running with Docker Compose

```bash
docker-compose up --build
```

- **Client**: `http://localhost:5173`
- **Server**: `http://localhost:3000`

### Local Development

#### Server
```bash
cd server
npm install
npm start
```

#### Client
```bash
cd client
npm install
npm run dev
```

### Running Tests

```bash
cd server
npm test
```

---

## License

MIT
