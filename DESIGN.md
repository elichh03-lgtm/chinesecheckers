# Chinese Checkers Online — Design Document
### *A colonist.io-style multiplayer experience for Sternhalma*

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Target Audience](#2-target-audience)
3. [Core Game Rules](#3-core-game-rules)
4. [Feature Specification](#4-feature-specification)
5. [Tech Stack](#5-tech-stack)
6. [System Architecture](#6-system-architecture)
7. [Database Schema](#7-database-schema)
8. [REST API Design](#8-rest-api-design)
9. [WebSocket Event Protocol](#9-websocket-event-protocol)
10. [Game Engine Design](#10-game-engine-design)
11. [ELO Rating System](#11-elo-rating-system)
12. [UI/UX Design Guidelines](#12-uiux-design-guidelines)
13. [Deployment & Scaling](#13-deployment--scaling)
14. [Open Questions & Future Work](#14-open-questions--future-work)

---

## 1. Product Vision

**Chinese Checkers Online** is a browser-based, real-time multiplayer implementation of Chinese Checkers (Sternhalma). It takes direct inspiration from colonist.io's design philosophy: minimal friction to start playing, high fidelity game rendering, and a robust competitive layer for players who want to invest in ranked progression.

### Design Pillars

| Pillar | What it means |
|---|---|
| **Zero-friction entry** | Guest play requires no account. Click "Play" and you're in a game within seconds. |
| **Server-authoritative** | All move validation happens on the server. Clients only render what they're told. |
| **Competitive depth** | ELO ranking, match history, and replay mean skilled players have reasons to keep coming back. |
| **Beautiful board** | Smooth animations, clean aesthetics, clear marble coloring — the board should feel satisfying to play on. |
| **Spectator-first** | Watching games is a first-class experience, not an afterthought. |

---

## 2. Target Audience

**Primary:** Casual-to-competitive board game players aged 16–40 who want to play Chinese Checkers with friends or strangers online without downloading software.

**Secondary:** Competitive players seeking a ranked ladder, move history, and replay analysis.

**Tertiary:** Spectators and streamers who enjoy watching skilled players.

---

## 3. Core Game Rules

### 3.1 The Board

Chinese Checkers is played on a six-pointed star board (a Star of David shape) containing **121 holes** arranged in a triangular grid.

- The star has **6 triangular points** (one per player), each containing **10 holes** arranged in rows of 4-3-2-1 from base to tip.
- The center of the board is a regular hexagon with **61 holes**.
- Each player starts with **10 marbles** in their home triangle (one point of the star).
- In 2-player mode, players use opposite points. In 3-player mode, every other point. In 4-player mode, four adjacent points. In 6-player mode, all six points.

### 3.2 Objective

Be the **first player to move all 10 of your marbles** from your home triangle to the triangle directly opposite (your target triangle).

### 3.3 Legal Moves

On each turn, a player makes **exactly one move**, which is one of:

**a) Step move** — Move one marble to any directly adjacent empty hole (up to 6 directions in hex grid).

**b) Hop move (chain hops allowed)** — Jump over any adjacent marble (your own or an opponent's) to the empty hole directly beyond it. After landing, the player may continue hopping in any direction (not required to continue in the same direction). A player may stop hopping at any point. A marble may not hop back over a hole it already visited in that turn. There is no capturing — hopped-over marbles remain on the board.

### 3.4 Edge Cases & Rules

- A marble **may pass through or stop in the center** hexagon at any point.
- A marble that has already reached its target triangle **may move out and back in**, but may not use the target triangle as a "trampoline" to hop across the board without actually occupying it.
- In **2-player mode**, there is a specific rule variant: a player may not permanently park a marble in their opponent's home triangle — they must either continue moving it or use it as a hop waypoint. *(This is configurable as a room option.)*
- **Blocking rule (optional):** A player cannot intentionally leave marbles in their own home triangle indefinitely to block opponents from occupying it. If all opponents have cleared their home but this player still has marbles there, a timer applies. *(Configurable.)*

### 3.5 Turn Timer

All ranked games enforce a **60-second turn timer** (configurable in custom rooms from 15–180 seconds). If a player does not move within the time limit, a random valid step move is auto-played for them. Three consecutive time-outs triggers an **auto-resign**.

### 3.6 Win Condition

The first player to place all 10 marbles in the opposite triangle wins. In multiplayer games, play continues after the winner is determined to resolve 2nd–Nth place finishes (finishing order affects ELO).

---

## 4. Feature Specification

### 4.1 Authentication & Accounts

| Feature | Description |
|---|---|
| **Guest play** | Temporary session with auto-generated username (e.g., "TealMarble#4821"). No account required. Guests cannot access ranked matchmaking or persistent history. |
| **Email/password registration** | Standard email + bcrypt-hashed password. Email verification required. |
| **Google OAuth** | One-click sign in via Google. |
| **Profile page** | Avatar (upload or choose from 12 preset marble-themed avatars), display name, bio, country flag. |
| **Account settings** | Change password, notification prefs, privacy settings. |

### 4.2 Room System

#### Room Types

| Type | Description |
|---|---|
| **Quick Play (Casual)** | Auto-match into an available public room. No ELO impact. |
| **Ranked** | Auto-match by ELO bracket. Gains/losses recorded. Requires account. |
| **Custom Room** | Host creates a room with specific settings and shares a 6-character invite code. |

#### Custom Room Settings

| Setting | Options | Default |
|---|---|---|
| Player count | 2, 3, 4, or 6 | 4 |
| Privacy | Public (listed in lobby) / Private (invite code only) | Private |
| Turn timer | 15s, 30s, 60s, 90s, 120s, 180s, Off | 60s |
| Blocking rule | On / Off | On |
| Auto-resign on timeout | 3, 5, or Never | 3 |
| Spectators allowed | Yes / No | Yes |
| Spectator chat | Yes / No | Yes |

### 4.3 Lobby Browser

- Lists all **public custom rooms** with open seats.
- Shows: room name, host username, player count (current/max), privacy, timer setting.
- **Search/filter** by player count, timer setting.
- **Refresh** button + auto-refresh every 10 seconds.
- **Quick join** — one click to enter any open room.

### 4.4 In-Game Chat

- Text chat panel visible to all players and spectators during the game.
- **Emotes** — a set of 8 quick-reaction emotes shown as floating marble animations (e.g., "GG", "Nice move!", "Thinking…").
- Player and spectator messages are visually distinguished (spectator messages appear in italics with a 👁 icon).
- Chat is archived with the game and viewable during replay.
- **Profanity filter** — configurable at the room level (on by default).

### 4.5 Spectator Mode

- Spectators join via room link or lobby browser entry.
- Spectators see the **full live game board** in real time.
- Spectators see whose turn it is, the turn timer, and current move count.
- Spectators may **not** see any hidden info (there is none in Chinese Checkers — the game is fully public information).
- Spectators can chat with each other and players (if allowed by room settings).
- **Spectator count** is visible to all players as a small badge.

### 4.6 Game History & Replay

- Every ranked and custom game is stored server-side as a **move log**.
- Players can access their **game history** from their profile.
- **Replay viewer**: step through moves forward/backward with a slider, or play at 1×/2×/4× speed.
- Replay includes chat log synchronized with moves.
- Replays are shareable via URL.

### 4.7 ELO Rating System

*(Details in section 11)*

- Initial rating: **1200**
- Separate ratings for **2-player** and **multi-player (3–6)** modes.
- Ranked matchmaking pairs players within **±150 ELO** of each other (expanding to ±300 after 60 seconds of waiting).
- **Rating history chart** visible on profile page.
- **Ranked tiers**: Jade (0–999), Pearl (1000–1199), Coral (1200–1499), Amber (1500–1799), Obsidian (1800–2099), Diamond (2100+).

---

## 5. Tech Stack

### 5.1 Frontend

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **React 18 + TypeScript** | Component model fits game UI. Large ecosystem. Strong typing for complex game state. |
| Build tool | **Vite** | Fast HMR in development; optimized ESM output for production. |
| Board rendering | **HTML5 Canvas (via React wrapper)** | Smooth 60fps animations; efficient re-rendering of only changed marbles. SVG considered but Canvas wins for animation performance at 121+ nodes. |
| State management | **Zustand** | Lightweight, minimal boilerplate. Perfect for game state slices that update frequently. |
| Routing | **React Router v6** | SPA routing for Lobby, Game, Profile, etc. |
| Styling | **Tailwind CSS** | Rapid UI iteration. Custom design tokens for the game's color palette. |
| WebSocket client | **Socket.io-client** | Matches server-side Socket.io. Auto-reconnection, event namespacing. |
| HTTP client | **Axios** | REST calls for auth, lobby listing, profile fetching. |
| Animation | **Framer Motion** | UI transitions (modals, notifications). Canvas handles in-game marble animations natively. |
| Charts (profile) | **Recharts** | ELO history sparkline and bar charts. |

### 5.2 Backend

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | **Node.js 20 LTS** | Non-blocking I/O ideal for WebSocket-heavy workload. Same language as frontend. |
| Framework | **Express.js** | Minimal, well-understood. REST API routes are simple; complexity lives in the game engine and WebSocket layer. |
| WebSockets | **Socket.io** | Room management, namespaces, and broadcast primitives map directly onto game concepts. Built-in fallbacks. |
| Auth | **Passport.js** | Strategy-based auth; supports Local (email/pass) and Google OAuth strategies cleanly. |
| Session/tokens | **JWT (access) + Redis (refresh/blacklist)** | Stateless access tokens with server-side revocation capability. |
| Validation | **Zod** | Schema validation for all API inputs and WebSocket payloads. |
| Password hashing | **bcrypt** | Industry standard, configurable cost factor. |

### 5.3 Data Layer

| Layer | Choice | Rationale |
|---|---|---|
| Primary DB | **PostgreSQL 16** | Relational data (users, games, moves, ELO history) fits perfectly. ACID guarantees for ELO updates. |
| ORM | **Prisma** | Type-safe queries, auto-generated migration diffs, readable schema file. |
| Cache / ephemeral state | **Redis 7** | Active game state (board positions, turn order) lives here. Near-instant reads for WebSocket events. JWT refresh token blacklist. Session store. |
| File storage | **AWS S3** | User avatar uploads. Pre-signed URLs for direct client uploads. |

### 5.4 Infrastructure

| Layer | Choice |
|---|---|
| Containerization | Docker + Docker Compose (dev), ECS Fargate (prod) |
| Load balancer | AWS ALB with sticky sessions (required for Socket.io) |
| CI/CD | GitHub Actions → ECR → ECS rolling deploy |
| Monitoring | Datadog (metrics + APM) + Sentry (error tracking) |
| CDN | CloudFront for static assets |
| DNS | Route 53 |

---

## 6. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                         │
│  React SPA                                                        │
│  ┌───────────────┐   ┌─────────────────┐   ┌─────────────────┐  │
│  │  Lobby / Auth │   │  Game Board UI  │   │  Profile / Chat │  │
│  │  (REST+HTTP)  │   │  (Socket.io WS) │   │  (REST / WS)    │  │
│  └───────┬───────┘   └────────┬────────┘   └────────┬────────┘  │
└──────────┼────────────────────┼────────────────────┼────────────┘
           │ HTTPS              │ WSS                 │ HTTPS
           ▼                    ▼                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                    AWS Application Load Balancer                  │
│                  (sticky sessions for Socket.io)                  │
└──────────────────────────┬───────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
     ┌───────────┐   ┌───────────┐   ┌───────────┐
     │  App Node │   │  App Node │   │  App Node │   ← ECS Fargate
     │  (N)      │   │  (N+1)    │   │  (N+2)    │     tasks
     └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
           │               │               │
           └───────────────┼───────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
     ┌─────────────────┐     ┌──────────────────┐
     │   PostgreSQL    │     │      Redis         │
     │   (RDS Multi-AZ)│     │   (ElastiCache)    │
     │                 │     │                    │
     │  users          │     │  game:{id}:state   │
     │  games          │     │  game:{id}:players │
     │  moves          │     │  session:{token}   │
     │  elo_history    │     │  lobby:rooms       │
     │  chat_messages  │     │  ratelimit:{ip}    │
     └─────────────────┘     └──────────────────┘
```

### 6.1 Game State Flow

```
Player clicks marble → Canvas detects click → Zustand emits candidate move
→ Socket.io sends MOVE_ATTEMPT to server
→ Server validates move via Game Engine
  → Valid: update Redis game state, broadcast MOVE_CONFIRMED to all in room
  → Invalid: emit MOVE_REJECTED with reason to that socket only
→ Client receives MOVE_CONFIRMED → Canvas animates marble along path
→ Server checks win condition → if won, emit GAME_OVER to room
→ Server persists game record + move log to PostgreSQL
→ Server recalculates ELO, updates PostgreSQL, emits ELO_UPDATE to players
```

### 6.2 Server-Side Game Rooms

Each active game room corresponds to:
- A **Socket.io room** (identified by `game:{uuid}`)
- A **Redis hash** storing current board state, turn order, timer state
- A **PostgreSQL games row** recording metadata

When a room fills and starts:
1. Server generates initial board state in Redis
2. Server emits `GAME_START` with full board state to all sockets in room
3. Server starts turn timer with `setTimeout`, reset on each valid move
4. On game end, server writes final state to PostgreSQL and flushes Redis keys

---

## 7. Database Schema

### 7.1 `users`

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(32) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE,           -- NULL for guests (ephemeral)
  password_hash VARCHAR(255),                  -- NULL for OAuth users
  google_id     VARCHAR(255) UNIQUE,
  avatar_url    TEXT,
  country_code  CHAR(2),
  is_guest      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 7.2 `elo_ratings`

```sql
CREATE TABLE elo_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode        VARCHAR(16) NOT NULL CHECK (mode IN ('2p', 'multi')),
  rating      INTEGER NOT NULL DEFAULT 1200,
  games_played INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, mode)
);
```

### 7.3 `games`

```sql
CREATE TABLE games (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode         VARCHAR(16) NOT NULL CHECK (mode IN ('casual', 'ranked', 'custom')),
  player_count SMALLINT NOT NULL CHECK (player_count IN (2, 3, 4, 6)),
  status       VARCHAR(16) NOT NULL DEFAULT 'waiting'
                 CHECK (status IN ('waiting', 'active', 'completed', 'abandoned')),
  settings     JSONB NOT NULL DEFAULT '{}',   -- turn_timer, blocking_rule, etc.
  invite_code  CHAR(6) UNIQUE,                -- NULL for matchmade games
  started_at   TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 7.4 `game_players`

```sql
CREATE TABLE game_players (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id),
  color      VARCHAR(16) NOT NULL,            -- 'red','blue','green','yellow','purple','orange'
  home_point SMALLINT NOT NULL CHECK (home_point BETWEEN 0 AND 5),
  seat_order SMALLINT NOT NULL,
  finish_pos SMALLINT,                        -- NULL until player finishes (1=winner)
  elo_before INTEGER,
  elo_after  INTEGER,
  elo_delta  INTEGER,
  UNIQUE (game_id, color),
  UNIQUE (game_id, home_point)
);
```

### 7.5 `moves`

```sql
CREATE TABLE moves (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES game_players(id),
  move_number INTEGER NOT NULL,
  from_q      SMALLINT NOT NULL,             -- axial coord q of origin
  from_r      SMALLINT NOT NULL,             -- axial coord r of origin
  to_q        SMALLINT NOT NULL,             -- axial coord q of destination
  to_r        SMALLINT NOT NULL,             -- axial coord r of destination
  path        JSONB NOT NULL,               -- full hop path [{q,r}, ...] for animations
  is_timeout  BOOLEAN NOT NULL DEFAULT false,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, move_number)
);
```

### 7.6 `elo_history`

```sql
CREATE TABLE elo_history (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id   UUID NOT NULL REFERENCES games(id),
  mode      VARCHAR(16) NOT NULL,
  rating_before INTEGER NOT NULL,
  rating_after  INTEGER NOT NULL,
  delta         INTEGER NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 7.7 `chat_messages`

```sql
CREATE TABLE chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),     -- NULL = system message
  is_spectator BOOLEAN NOT NULL DEFAULT false,
  message_type VARCHAR(16) NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','emote','system')),
  content     TEXT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 8. REST API Design

All endpoints are prefixed with `/api/v1`. Authentication via `Authorization: Bearer <jwt>` header.

### 8.1 Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | None | Create account with email/password |
| POST | `/auth/login` | None | Returns access + refresh tokens |
| POST | `/auth/logout` | Required | Blacklists refresh token |
| POST | `/auth/refresh` | None (refresh token) | Issues new access token |
| GET | `/auth/google` | None | Initiates Google OAuth flow |
| GET | `/auth/google/callback` | None | OAuth callback |
| POST | `/auth/guest` | None | Creates ephemeral guest session |

### 8.2 Users & Profiles

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/:username` | Optional | Public profile data |
| PATCH | `/users/me` | Required | Update display name, avatar, country |
| GET | `/users/me/history` | Required | Paginated game history |
| GET | `/users/me/elo` | Required | ELO history for chart |

### 8.3 Lobby & Rooms

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/rooms` | Optional | List public open rooms (paginated) |
| POST | `/rooms` | Optional (guest OK) | Create a custom room |
| GET | `/rooms/:code` | Optional | Room details by invite code |
| POST | `/rooms/:code/join` | Optional | Join a room (returns game socket token) |

### 8.4 Matchmaking

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/matchmaking/join` | Required for ranked | Join matchmaking queue |
| DELETE | `/matchmaking/leave` | Required | Leave matchmaking queue |
| GET | `/matchmaking/status` | Required | Current queue position + estimated wait |

### 8.5 Games & Replays

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/games/:id` | Optional | Game metadata |
| GET | `/games/:id/moves` | Optional | Full move log for replay |
| GET | `/games/:id/chat` | Optional | Chat log |

### 8.6 Leaderboard

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/leaderboard` | None | Top 100 by mode (`?mode=2p` or `?mode=multi`) |

---

## 9. WebSocket Event Protocol

All WebSocket communication uses **Socket.io** over the `/game` namespace.

### 9.1 Client → Server Events

| Event | Payload | Description |
|---|---|---|
| `room:join` | `{ gameId, token }` | Join a game room's socket channel |
| `room:leave` | `{}` | Leave the current room |
| `game:move_attempt` | `{ fromQ, fromR, toQ, toR, path: [{q,r}] }` | Player submits a move |
| `game:request_preview` | `{ fromQ, fromR }` | Request valid destination highlights for a marble |
| `chat:send` | `{ content, type: 'text'|'emote' }` | Send a chat message |
| `game:resign` | `{}` | Voluntarily resign from the game |
| `spectator:join` | `{ gameId }` | Join as a spectator |

### 9.2 Server → Client Events

| Event | Payload | Description |
|---|---|---|
| `room:state` | Full room snapshot (players, settings, status) | Emitted on join |
| `room:player_joined` | `{ userId, username, color, seatOrder }` | A new player joined the lobby |
| `room:player_left` | `{ userId }` | A player left the pre-game lobby |
| `game:start` | `{ boardState, turnOrder, currentTurn, timerEndsAt }` | Game begins |
| `game:move_confirmed` | `{ moveId, fromQ, fromR, toQ, toR, path, nextTurn, timerEndsAt }` | Valid move; update board |
| `game:move_rejected` | `{ reason }` | Only to the mover; invalid move |
| `game:valid_destinations` | `{ destinations: [{q,r}] }` | Response to `game:request_preview` |
| `game:timer_tick` | `{ remainingMs, currentTurn }` | Every second while timer running |
| `game:timeout_move` | `{ move, nextTurn }` | Auto-move applied due to timeout |
| `game:player_resigned` | `{ userId, finishPos }` | A player resigned |
| `game:player_finished` | `{ userId, finishPos }` | A player completed their triangle |
| `game:over` | `{ finishOrder: [{userId, finishPos, eloDelta}] }` | Game complete |
| `chat:message` | `{ id, userId, username, isSpectator, type, content, sentAt }` | New chat message |
| `spectator:count` | `{ count }` | Spectator count updated |
| `error` | `{ code, message }` | Generic error |

### 9.3 Reconnection Handling

If a client disconnects and reconnects within **60 seconds**, the server re-syncs full game state via `game:start` (with `isReconnect: true`). The player's turn timer is paused for up to **15 seconds** to allow reconnection during their turn. After 60 seconds, the player is treated as having timed out.

---

## 10. Game Engine Design

### 10.1 Board Representation

The board uses **axial (hex) coordinates** `(q, r)`. This system simplifies neighbor calculation and distance math compared to offset coordinates.

The 121 valid board positions are stored as a **Set of coordinate strings** (`"q,r"`) for O(1) validity lookup. Each game state stores a `Map<"q,r", Marble | null>` where `Marble = { userId, color }`.

```typescript
// Board coordinate constants
const BOARD_POSITIONS: Set<string> // all 121 valid holes
const HOME_TRIANGLES: Record<PlayerId, Set<string>> // 10 holes per player
const TARGET_TRIANGLES: Record<PlayerId, Set<string>> // opposite home

// Six axial directions
const HEX_DIRECTIONS = [
  {q: 1, r: 0}, {q: -1, r: 0},
  {q: 0, r: 1}, {q: 0, r: -1},
  {q: 1, r: -1}, {q: -1, r: 1}
]
```

### 10.2 Move Validation Algorithm

```
FUNCTION validateMove(state, playerId, from, to, path):
  1. Assert it is playerId's turn
  2. Assert from is a valid board position
  3. Assert state.board[from].userId == playerId
  4. Assert to is a valid board position
  5. Assert state.board[to] is empty

  IF path.length == 1 (step move):
    6. Assert to is a direct neighbor of from (distance == 1 in axial)
    RETURN valid

  IF path.length > 1 (hop move):
    7. For each consecutive pair (current, next) in path:
       a. Assert next is a valid board position
       b. Assert next is empty
       c. midpoint = average(current, next) — must be a whole coordinate
       d. Assert midpoint is a valid board position
       e. Assert state.board[midpoint] is occupied (any marble)
       f. Assert next has not been visited earlier in path (no loops)
    RETURN valid

  RETURN invalid
```

### 10.3 Valid Move Generation (for `game:request_preview`)

```
FUNCTION getValidDestinations(state, playerId, from):
  destinations = Set()
  
  // Step moves
  FOR direction IN HEX_DIRECTIONS:
    neighbor = from + direction
    IF neighbor in BOARD_POSITIONS AND state.board[neighbor] is empty:
      destinations.add(neighbor)
  
  // Hop moves (BFS over hop graph)
  queue = [from]
  visited = Set([from])
  WHILE queue not empty:
    current = queue.dequeue()
    FOR direction IN HEX_DIRECTIONS:
      mid = current + direction
      landing = current + 2*direction
      IF mid in BOARD_POSITIONS
         AND state.board[mid] is occupied
         AND landing in BOARD_POSITIONS
         AND state.board[landing] is empty
         AND landing NOT in visited:
           visited.add(landing)
           destinations.add(landing)
           queue.enqueue(landing)
  
  destinations.remove(from)
  RETURN destinations
```

### 10.4 Win Condition Check

After each move, the server checks if the moving player's marbles entirely occupy their target triangle:

```
FUNCTION checkWin(state, playerId):
  target = TARGET_TRIANGLES[playerId]
  FOR hole IN target:
    IF state.board[hole]?.userId != playerId:
      RETURN false
  RETURN true
```

### 10.5 Game State Object (Redis JSON)

```json
{
  "gameId": "uuid",
  "status": "active",
  "playerCount": 4,
  "turnOrder": ["userId1", "userId2", "userId3", "userId4"],
  "currentTurnIndex": 0,
  "moveCount": 14,
  "timerEndsAt": 1715000000000,
  "timeoutStrikes": { "userId1": 0, "userId2": 1 },
  "finishedPlayers": [],
  "board": {
    "0,0": null,
    "1,0": { "userId": "userId1", "color": "red" }
  }
}
```

---

## 11. ELO Rating System

### 11.1 Two-Player ELO

Standard Elo formula:

```
Expected score for A: Ea = 1 / (1 + 10^((Rb - Ra) / 400))
New rating for A: Ra' = Ra + K * (Sa - Ea)
```

Where:
- `Sa` = 1 (win), 0.5 (draw — not possible in CC but reserved), 0 (loss)
- `K` = 32 for players with < 30 games; 24 for 30–100 games; 16 for 100+ games

### 11.2 Multi-Player ELO (3–6 players)

Multi-player ELO is computed by **decomposing results into pairwise comparisons**:

For each pair (A, B) where A finished before B, treat it as A beating B. Each player accumulates scores across all their pairwise results, then a weighted Elo update is applied.

```
FOR each unique pair (i, j) in finish order where i finished before j:
  Eij = 1 / (1 + 10^((Rj - Ri) / 400))
  delta_i += K_multi * (1 - Eij)
  delta_j += K_multi * (0 - (1 - Eij))

K_multi = K / (player_count - 1)   // scale K to avoid inflation
```

### 11.3 Rating Floor & Stability

- **Floor**: Rating cannot drop below **100** regardless of losses.
- **Provisional period**: First 10 games use `K = 40` for faster calibration.
- **Inactivity decay**: After 60 days with no ranked games, rating decays by 5 points per week (floor: 1200 for Jade-tier protection).

### 11.4 Tier Thresholds

| Tier | Rating | Icon |
|---|---|---|
| Jade | 0 – 999 | 🟢 |
| Pearl | 1000 – 1199 | ⚪ |
| Coral | 1200 – 1499 | 🔴 |
| Amber | 1500 – 1799 | 🟡 |
| Obsidian | 1800 – 2099 | ⚫ |
| Diamond | 2100+ | 💎 |

---

## 12. UI/UX Design Guidelines

### 12.1 Color Palette

| Role | Color | Hex |
|---|---|---|
| Background (dark) | Deep navy | `#0D1117` |
| Surface | Slate | `#161B22` |
| Border | Subtle grey | `#30363D` |
| Primary accent | Jade green | `#2EA043` |
| Text primary | Off-white | `#E6EDF3` |
| Text secondary | Muted grey | `#8B949E` |

**Marble Colors** (one per player position):

| Point | Color | Hex |
|---|---|---|
| 0 (top) | Ruby Red | `#E84040` |
| 1 | Sky Blue | `#4A9EFF` |
| 2 | Emerald | `#2EA043` |
| 3 | Sunflower | `#F0B429` |
| 4 | Violet | `#8B5CF6` |
| 5 | Coral Orange | `#F97316` |

### 12.2 Board Rendering

- Board holes rendered as **circles** with a subtle inner shadow to create depth.
- Marbles rendered as **radial gradient circles** with a specular highlight (top-left shine) to look three-dimensional.
- **Selected marble**: pulsing glow ring in the marble's color.
- **Valid destinations**: small pulsing dots (50% opacity of marble color) shown on hover/select.
- **Last move highlight**: origin and destination holes briefly flash after a move is confirmed.
- **Marble travel animation**: marbles animate along their hop path in sequence at ~300ms per hop. Step moves animate at ~200ms.
- Board uses a **flat-top hexagonal grid** orientation. The star is drawn with one point at the top.

### 12.3 Typography

| Role | Font | Weight |
|---|---|---|
| Game title / hero | Inter Display | 700 |
| UI labels | Inter | 400, 500 |
| Chat messages | Inter | 400 |
| Monospace (coords, debug) | JetBrains Mono | 400 |

### 12.4 Key Screens

| Screen | Primary Purpose |
|---|---|
| **Landing** | Hero + quick start (guest play) + sign in CTA |
| **Lobby** | Browse rooms, create room, enter invite code, matchmaking |
| **Pre-game room** | See who's joined, change color if allowed, start game |
| **Game board** | Main gameplay; left: board; right: player list + chat |
| **Post-game** | Finish order, ELO changes, chat archive, buttons: rematch/new game/home |
| **Profile** | Avatar, stats, ELO chart, game history table |
| **Replay viewer** | Board re-render with move slider, playback controls, synchronized chat |

### 12.5 Responsive Design

- **Desktop (1280px+)**: Full layout with side chat panel.
- **Tablet (768–1279px)**: Chat panel collapses to a drawer toggled by a button.
- **Mobile (< 768px)**: Board scales to fit viewport width. Player list and chat are drawers. Touch support for marble selection and move confirmation (tap to select, tap destination to move).

---

## 13. Deployment & Scaling

### 13.1 Environment Stages

| Stage | Description |
|---|---|
| **dev** | Docker Compose locally; hot reload; seeded test DB |
| **staging** | Single ECS task; mirrors prod config; used for QA |
| **prod** | Auto-scaling ECS Fargate; Multi-AZ RDS; ElastiCache cluster mode |

### 13.2 Scaling Considerations

- **Socket.io + Multi-node**: Socket.io's **Redis Adapter** (`@socket.io/redis-adapter`) syncs events across all Node instances. This is critical — without it, players on different nodes can't communicate.
- **Game state in Redis**: All active game state lives in Redis (not in-process memory), meaning any app node can handle any WebSocket event for any game.
- **Turn timers**: Timer logic runs on the server node that started the game. On node failure, the timer must be recovered. Use Redis to store `timerEndsAt` and recover via a scheduled poll on startup.
- **Horizontal scaling targets**: 1 app node per ~500 concurrent WebSocket connections. Target P99 WS latency < 80ms.

### 13.3 Security

- Rate limiting on all REST endpoints (`express-rate-limit`) and WebSocket events (custom Redis counter).
- Move validation is **100% server-side** — clients cannot force invalid moves.
- JWT access tokens expire in **15 minutes**. Refresh tokens expire in **7 days** and are single-use (rotation pattern).
- SQL injection prevention via Prisma's parameterized queries.
- XSS prevention via React's default escaping + Content Security Policy headers.
- WebSocket events are validated with Zod before processing.

---

## 14. Open Questions & Future Work

| Topic | Question / Idea |
|---|---|
| **AI bots** | Add bot opponents for solo play and to fill empty seats. Difficulty tiers from random-valid-move to minimax with hop-chain scoring heuristic. |
| **Tournaments** | Weekly single-elimination or Swiss-system tournaments with special rewards. |
| **Themes / skins** | Alternate board themes (e.g., Wood, Glass, Neon). Custom marble colors unlockable via play. |
| **Mobile app** | Native React Native app wrapping the same WebSocket protocol. |
| **Accessibility** | Screen reader support; high-contrast mode; keyboard navigation for marble selection. |
| **Rule variants** | "Fast game" (6 marbles per player), "Super Chinese Checkers" (larger board), "No pass-through" variant. |
| **In-game clock display** | Should the turn timer be a countdown ring around the active player's avatar, a top bar, or both? |
| **Abandonment handling** | If a player disconnects in ranked, how long before they're auto-resigned? Currently spec'd at 60s — validate with community. |
| **Anti-cheat** | Move timing analysis to detect engine-assisted play. Flag accounts where move quality is statistically anomalous. |

---

*Document version 0.1 — May 2026*
