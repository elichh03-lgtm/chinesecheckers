# Chinese Checkers Online — Claude Code Context

> This file is read automatically by Claude Code at session start.
> It contains everything needed to work on this project without re-explanation.

---

## What This Project Is

A real-time multiplayer Chinese Checkers (Sternhalma) web app modeled after colonist.io. Players join rooms, play live games via WebSockets, and compete on an ELO ladder. No download required — browser only.

**Reference docs in this folder:**
- `DESIGN.md` — full technical specification (architecture, DB schema, API, WebSocket events, ELO math)
- `BUILDOUT.html` — phased build plan with all tasks
- `wireframes.html` — all 8 screens as interactive wireframes

---

## Monorepo Structure

```
/
├── apps/
│   ├── server/          # Node.js + Express + Socket.io backend
│   └── web/             # React + Vite frontend
├── packages/
│   ├── game-engine/     # Pure TS game logic — NO dependencies, NO side effects
│   └── shared-types/    # TypeScript interfaces shared by server + web
├── docker-compose.yml   # postgres:16, redis:7, adminer
├── DESIGN.md
├── BUILDOUT.html
├── wireframes.html
└── CLAUDE.md            ← you are here
```

**Package manager:** pnpm workspaces. Always use `pnpm` — never `npm` or `yarn`.

---

## Key Commands

```bash
# Start everything locally
docker compose up -d          # Postgres + Redis
pnpm dev                      # Runs server + web concurrently (from root)

# Individual apps
pnpm --filter server dev      # Server with ts-node-dev hot reload, port 3001
pnpm --filter web dev         # Vite dev server, port 5173 (proxy → 3001)

# Database
pnpm --filter server db:migrate   # Run Prisma migrations
pnpm --filter server db:seed      # Seed 6 test users + 2 completed games
pnpm --filter server db:studio    # Open Prisma Studio (or use Adminer at :8080)
pnpm --filter server db:reset     # Drop + recreate + seed (dev only)

# Testing
pnpm test                     # All tests across all packages
pnpm --filter game-engine test --coverage   # Engine tests (must stay at 100%)
pnpm --filter server test:integration       # API + WebSocket integration tests
pnpm --filter server test:load              # k6 load tests (requires k6 installed)

# Build
pnpm build                    # Build all packages for production
pnpm --filter web build       # Vite build → dist/

# Lint / typecheck
pnpm lint                     # ESLint across all packages
pnpm typecheck                # tsc --noEmit across all packages
```

---

## Tech Stack — Quick Reference

| Layer | Choice | Notes |
|---|---|---|
| Frontend framework | React 18 + TypeScript | Strict mode on |
| Frontend build | Vite | Path alias: `@/` → `src/` |
| Board rendering | HTML5 Canvas | NOT SVG — performance |
| State | Zustand | Three slices: auth, game, lobby |
| Routing | React Router v6 | |
| Styling | Tailwind CSS | Custom tokens in tailwind.config |
| HTTP client | Axios | Auto-attach JWT, auto-refresh |
| Backend | Node.js 20 + Express | |
| WebSockets | Socket.io | Namespace: `/game` |
| Auth | Passport.js | Local + Google OAuth strategies |
| Tokens | JWT (15m) + Redis refresh (7d) | Rotation pattern |
| ORM | Prisma | Never write raw SQL |
| Primary DB | PostgreSQL 16 | |
| Cache / state | Redis 7 (ioredis) | All active game state lives here |
| Validation | Zod | On all API inputs AND socket payloads |
| Testing | Vitest + Supertest | |

---

## The Game Engine (`packages/game-engine`)

**This is the most critical package. All game rules live here. It must be:**
- Pure TypeScript — no Express, no Prisma, no Redis, no side effects
- 100% statement and function coverage; branch coverage may have unreachable defensive paths documented in tests
- Immutable — functions return new state, never mutate arguments

### Board Coordinate System

The board uses **axial hex coordinates** `{ q: number, r: number }`.

```
// Six directions in axial coords
const HEX_DIRECTIONS = [
  { q: 1,  r:  0 },  // right
  { q: -1, r:  0 },  // left
  { q: 0,  r:  1 },  // down-right
  { q: 0,  r: -1 },  // up-left
  { q: 1,  r: -1 },  // up-right
  { q: -1, r:  1 },  // down-left
]

// Distance between two hexes
function hexDistance(a: Hex, b: Hex): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2
}

// Serialize hex to string key (for Set/Map lookups — O(1))
const key = (h: Hex) => `${h.q},${h.r}`
```

**The board:** 121 valid holes total. 6 triangular points (home areas), each with 10 holes (rows of 1-2-3-4 from tip to base). Center hexagon with 61 holes. All 121 coordinates are hardcoded as a `Set<string>`.

**Player configs:**
- 2P: points 0 and 3 (opposite)
- 3P: points 0, 2, 4
- 4P: points 0, 1, 3, 4
- 6P: all six points (0–5)

### Core Types

```typescript
// packages/shared-types/src/index.ts

type Hex = { q: number; r: number }

type Marble = { userId: string; color: PlayerColor }

type PlayerColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange'

type GameState = {
  gameId: string
  status: 'waiting' | 'active' | 'completed'
  playerCount: 2 | 3 | 4 | 6
  turnOrder: string[]          // userIds in turn order
  currentTurnIndex: number
  moveCount: number
  timerEndsAt: number          // unix ms — stored in Redis
  timeoutStrikes: Record<string, number>
  finishedPlayers: Array<{ userId: string; finishPos: number }>
  board: Map<string, Marble | null>   // key = "q,r"
}

type Move = {
  fromQ: number
  fromR: number
  toQ: number
  toR: number
  path: Array<{ q: number; r: number }>  // full waypoint list for animation
}

type ValidationResult =
  | { valid: true }
  | { valid: false; reason: 'NOT_YOUR_TURN' | 'NO_MARBLE' | 'INVALID_DESTINATION'
                           | 'PATH_INVALID' | 'REVISITED_HOP' | 'NOT_BOARD_POSITION' }
```

### Game Engine API

```typescript
// packages/game-engine/src/index.ts — these are the ONLY public exports

createInitialBoard(playerCount: 2|3|4|6, playerIds: string[]): GameState
validateMove(state: GameState, playerId: string, move: Move): ValidationResult
applyMove(state: GameState, move: Move): GameState        // immutable — returns new state
getValidDestinations(state: GameState, from: Hex): Set<string>  // returns Set of "q,r" strings
getAllValidMoves(state: GameState, playerId: string): Move[]     // for auto-timeout move
checkWin(state: GameState, playerId: string): boolean
```

---

## Server Architecture (`apps/server`)

```
apps/server/src/
├── index.ts              # Entry point — starts Express + Socket.io
├── app.ts                # Express app (no socket logic here)
├── socket/
│   ├── index.ts          # Socket.io server setup, Redis adapter
│   ├── middleware.ts      # JWT auth middleware for sockets
│   ├── handlers/
│   │   ├── room.ts       # room:join, room:leave
│   │   ├── game.ts       # game:move_attempt, game:request_preview, game:resign
│   │   ├── chat.ts       # chat:send
│   │   └── spectator.ts  # spectator:join
│   └── timer.ts          # Turn timer management (read/write Redis)
├── routes/
│   ├── auth.ts
│   ├── users.ts
│   ├── rooms.ts
│   ├── matchmaking.ts
│   ├── games.ts
│   └── leaderboard.ts
├── services/
│   ├── elo.ts            # ELO calculation — pure functions, no DB calls
│   ├── gameState.ts      # Redis game state helpers (get/set/delete)
│   └── matchmaking.ts    # Queue logic (Redis sorted set)
├── middleware/
│   ├── auth.ts           # JWT verify middleware
│   ├── rateLimit.ts
│   └── validate.ts       # Zod request validation wrapper
├── lib/
│   ├── prisma.ts         # Prisma client singleton
│   ├── redis.ts          # ioredis client singleton
│   └── logger.ts         # Winston logger
└── env.ts                # Zod-validated env schema — import this, never process.env directly
```

### Redis Key Conventions

```
game:{gameId}:state          # JSON-serialized GameState (Map becomes Array of entries)
game:{gameId}:timer          # { timerEndsAt: number, timeoutFn: NodeJS.Timeout }
session:{refreshToken}       # userId — TTL 7 days
ratelimit:{ip}:{route}       # Counter — TTL 60s
matchmaking:2p               # Sorted set, score = ELO
matchmaking:multi            # Sorted set, score = ELO
lobby:rooms                  # Cached list of public rooms — TTL 10s
```

### WebSocket Event Contracts

All events typed in `packages/shared-types`. Never use raw strings — always import from shared-types.

**Client → Server (player must be authenticated and in the room):**
- `room:join` `{ gameId: string, token: string }`
- `game:move_attempt` `{ fromQ, fromR, toQ, toR, path: Hex[] }`
- `game:request_preview` `{ fromQ: number, fromR: number }`
- `chat:send` `{ content: string, type: 'text' | 'emote' }`
- `game:resign` `{}`
- `spectator:join` `{ gameId: string }`

**Server → Client:**
- `game:start` `{ boardState, turnOrder, currentTurn, timerEndsAt, isReconnect? }`
- `game:move_confirmed` `{ moveId, fromQ, fromR, toQ, toR, path, nextTurn, timerEndsAt }`
- `game:move_rejected` `{ reason }` — emitted only to the mover
- `game:valid_destinations` `{ destinations: Hex[] }`
- `game:over` `{ finishOrder: Array<{ userId, finishPos, eloDelta }> }`
- `chat:message` `{ id, userId, username, isSpectator, type, content, sentAt }`

---

## Frontend Architecture (`apps/web`)

```
apps/web/src/
├── main.tsx
├── App.tsx               # Router + global providers
├── pages/
│   ├── Landing.tsx
│   ├── Lobby.tsx
│   ├── Game.tsx          # Wraps Board + Sidebar
│   ├── Profile.tsx
│   └── Replay.tsx
├── components/
│   ├── board/
│   │   ├── GameBoard.tsx       # Canvas element + resize logic
│   │   ├── BoardRenderer.ts    # ALL canvas draw calls (not a component)
│   │   ├── useAnimationLoop.ts # rAF loop hook
│   │   └── hitTest.ts         # pixel → hex click detection
│   ├── lobby/
│   ├── game/
│   │   ├── PlayerList.tsx
│   │   ├── TurnTimer.tsx
│   │   ├── ChatPanel.tsx
│   │   └── SpectatorBanner.tsx
│   └── ui/               # Generic: Button, Modal, Toast, Input, Avatar
├── stores/
│   ├── auth.ts           # Zustand auth slice
│   ├── game.ts           # Zustand game slice (updated by socket events)
│   └── lobby.ts          # Zustand lobby slice
├── socket/
│   ├── client.ts         # Socket.io singleton, typed emit/on
│   └── bridge.ts         # Maps socket events → Zustand dispatches
├── api/
│   ├── client.ts         # Axios instance with interceptors
│   ├── auth.ts
│   ├── rooms.ts
│   ├── users.ts
│   └── games.ts
└── lib/
    ├── hexMath.ts        # Pixel↔hex conversion (imported from game-engine)
    └── constants.ts      # Player colors, tier thresholds
```

### Canvas Rendering Rules

The `BoardRenderer.ts` file is a plain TS module (not a React component). It exports a single `render(ctx, state, uiState)` function called from the rAF loop.

**Render order (back to front):**
1. Board background
2. Home zone tints (15% player color over holes)
3. All 121 board holes (grey circles)
4. Valid destination overlays (pulsing dots — only if marble selected)
5. All marbles (radial gradient for 3D look)
6. Selected marble ring (pulsing outline)
7. Animating marble (drawn last, on top of everything)
8. Last-move flash overlay (fades out over 600ms)

**Never put canvas draw calls inside React components.** Components manage Canvas ref + state; `BoardRenderer.ts` does all drawing.

### State Management Rules

- Game state flows: `socket event → bridge.ts → Zustand → React re-render → Canvas`
- Never call socket emit from inside a Zustand action. Emit from React event handlers, update store from socket events.
- The `game` store slice mirrors the server's `GameState` exactly. When `game:move_confirmed` arrives, update the store; the board re-renders automatically via the rAF loop reading the store.

---

## Database Rules

**Always use Prisma — never write raw SQL.** If Prisma can't express a query efficiently, use `prisma.$queryRaw` with `Prisma.sql` tagged templates (parameterized, never interpolation).

**Migrations:** never edit migration files after they've been applied. Create a new migration instead: `pnpm --filter server db:migrate -- --name describe_the_change`.

**Transactions:** ELO updates must be wrapped in `prisma.$transaction`. The elo_ratings row and elo_history row must be written atomically.

```typescript
// Good — atomic ELO update
await prisma.$transaction([
  prisma.eloRatings.update({ where: { userId_mode }, data: { rating: newRating } }),
  prisma.eloHistory.create({ data: { userId, gameId, mode, ratingBefore, ratingAfter, delta } }),
])
```

---

## Coding Conventions

### TypeScript
- Strict mode on everywhere. Never use `any` — use `unknown` and narrow.
- Prefer `type` over `interface` for data shapes. Use `interface` only when you need declaration merging.
- All function parameters and return types explicitly annotated (no implicit `any`).
- Use `const` by default. `let` only when the variable is reassigned.

### Naming
- Files: `camelCase.ts` for modules/utilities, `PascalCase.tsx` for React components
- Types/interfaces: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- React components: `PascalCase`, one component per file

### Error Handling
- Server: all async route handlers wrapped in `asyncHandler` utility (catches and forwards to Express error handler)
- Never swallow errors silently — log with Winston, re-throw or respond with typed error
- Client: Axios error responses typed as `ApiError { code: string; message: string }`
- Socket errors: always emit `error` event back to the client, never just `console.error`

### Imports
- Absolute paths via `@/` alias (web) or `~/` (server)
- Group imports: Node built-ins → third-party → internal packages → local
- No barrel files (`index.ts`) that re-export everything — import directly from the file

---

## Testing Rules

### Game Engine — 100% coverage, always
```bash
pnpm --filter game-engine test --coverage
# Must show 100% statements, branches, functions, lines
# CI will fail if coverage drops below 100%
```

### What to test in the game engine
Every function should have tests for:
- Happy path (valid move, correct result)
- All error cases (each `ValidationResult.reason` variant)
- Edge cases: chain hop of 5+ jumps, hop back to near-origin, hopping in 2P/3P/4P/6P configs
- Win detection: exactly 10 marbles in target, not 9, not 10 + 1 enemy marble

### Integration tests (server)
Use Supertest with a real test database (separate `TEST_DATABASE_URL`). Each test wraps in a transaction that's rolled back. Never use mocks for Prisma — test against real DB.

Socket.io integration tests use two `socket.io-client` instances to simulate two players. Test the full flow: join room → game:start → move → move_confirmed → win → game:over.

### What NOT to test
- Prisma model shapes (trust Prisma's types)
- Third-party library behavior (Socket.io, Redis)
- React component rendering (use manual browser testing for UI)

---

## Things Never To Do

1. **Never put game logic in the server's socket handlers.** All rules go in `packages/game-engine`. Handlers call engine functions only.
2. **Never trust the client.** The client sends move intent. The server validates 100% server-side via the game engine before accepting.
3. **Never store game board state in PostgreSQL during an active game.** Active game state is Redis only. Postgres gets the final state on game over.
4. **Never write to Redis from inside Prisma transactions.** Redis and Postgres are separate systems — they can't share transactions.
5. **Never mutate GameState.** `applyMove` returns a new state. The old state is discarded.
6. **Never use `setInterval` for the turn timer.** Use `setTimeout` only. Store `timerEndsAt` in Redis so state survives restarts.
7. **Never put canvas draw calls in React render.** All drawing in `BoardRenderer.ts`, called from the rAF loop.
8. **Never use `localStorage` for game state.** Only JWT token is in localStorage. Game state is ephemeral and in-memory (Zustand).
9. **Never merge a PR that drops game-engine test coverage below 100%.**
10. **Never interpolate user input into Redis keys or Zod-unvalidated data into SQL.** Always parameterize.

---

## Environment Variables

All env vars are validated at startup by Zod in `apps/server/src/env.ts`. Adding a new env var means: add to `.env.example`, add to Zod schema, use from `env.ts` — never from `process.env` directly.

```
# Required for local dev
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/chinesecheckers
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-secret-change-in-prod
JWT_REFRESH_SECRET=dev-refresh-secret-change-in-prod
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:3001/api/v1/auth/google/callback
AWS_REGION=us-east-1
AWS_S3_BUCKET=cc-avatars-dev
```

---

## Common Patterns

### Validated route handler
```typescript
// apps/server/src/routes/rooms.ts
import { z } from 'zod'
import { asyncHandler } from '../middleware/asyncHandler'
import { validate } from '../middleware/validate'

const CreateRoomSchema = z.object({
  name: z.string().min(1).max(50),
  playerCount: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(6)]),
  timer: z.number().min(15).max(180).optional().default(60),
  isPublic: z.boolean().default(false),
  allowSpectators: z.boolean().default(true),
  blockingRule: z.boolean().default(true),
})

router.post('/', requireAuth, validate(CreateRoomSchema), asyncHandler(async (req, res) => {
  const data = req.validatedBody  // fully typed
  // ...
}))
```

### Socket handler with validation
```typescript
// apps/server/src/socket/handlers/game.ts
socket.on('game:move_attempt', async (payload: unknown) => {
  const result = MoveAttemptSchema.safeParse(payload)
  if (!result.success) {
    socket.emit('error', { code: 'INVALID_PAYLOAD', message: result.error.message })
    return
  }
  const { fromQ, fromR, toQ, toR, path } = result.data
  // get game state from Redis, validate with engine, apply, broadcast
})
```

### Game state round-trip (Redis serialization)
```typescript
// GameState.board is a Map — serialize to array for Redis JSON
function serializeGameState(state: GameState): string {
  return JSON.stringify({
    ...state,
    board: Array.from(state.board.entries()),
  })
}

function deserializeGameState(json: string): GameState {
  const raw = JSON.parse(json)
  return {
    ...raw,
    board: new Map(raw.board),
  }
}
```

### Zustand game slice update from socket
```typescript
// apps/web/src/socket/bridge.ts
socket.on('game:move_confirmed', (event) => {
  useGameStore.getState().applyConfirmedMove(event)
  // Do NOT emit anything from here — bridge is receive-only
})
```

---

## Current Project Status

> Update this section as phases complete.

- [x] Phase 1: Foundation — pnpm monorepo, docker-compose, root configs
- [x] Phase 2: Game Engine — board, validators, moves, winCheck (52 tests, ~98% coverage)
- [x] Phase 3: Backend API — Express + Zod; Prisma persists users, refresh tokens, completed games, ELO. Active room state still in-memory.
- [x] Phase 4: WebSocket Layer — Socket.io `/game` namespace, full event contract, turn timer w/ auto-move, moveLog cap → auto-stalemate
- [x] Phase 5: Frontend Scaffold — Vite, React, Tailwind, Zustand stores, React Router
- [x] Phase 6: Board Renderer — Canvas: marbles, hop animation, valid-dest pulses, last-move flash
- [x] Phase 7: Lobby & Rooms UI — public room list, create-room form, 2s polling
- [x] Phase 8: Full Game Flow — click-to-select, preview, move, timer countdown, game-over modal
- [x] Phase 9: Auth & Profiles — bcrypt + JWT (15m) + DB-backed refresh tokens (7d, rotated). Google OAuth optional. Profile pages with ratings, recent games, GDPR export + delete.
- [~] Phase 10: Polish — confetti, brand applied, sounds in; mobile responsive layout still partial
- [ ] Phase 11: Testing — Playwright E2E + server integration tests landed; k6 load suite still open
- [ ] Phase 12: Infrastructure — Dockerfiles, CI, deploy (see [docs/DEPLOY.md](docs/DEPLOY.md) for current manual deploy)

**Tracks A + B complete** — real auth, ELO + game persistence, GDPR endpoints, admin diagnostic. Remaining: Redis-backed game state for horizontal scale, mobile polish, k6 load suite, Docker/CI.

---

## How to Ask Claude Code for Help

Some prompts that work well with this codebase:

```
"Implement the validateMove function in packages/game-engine/src/validators.ts 
 following the algorithm in DESIGN.md §10.2. Write tests first."

"Add the POST /rooms endpoint to apps/server/src/routes/rooms.ts using the 
 CreateRoomSchema pattern from CLAUDE.md and the DB schema from DESIGN.md §7.3."

"Implement the board hole rendering in apps/web/src/components/board/BoardRenderer.ts. 
 Use the hexToPixel function and draw flat-top hexagons. All 121 holes, 
 home zones subtly tinted."

"Write integration tests for the game:move_attempt socket handler. Use two 
 socket.io-client instances. Test a valid move and an invalid move (wrong turn)."
```

Always specify the file path, the relevant spec section, and whether you want tests written first.
