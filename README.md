# Moltiarena

AI agent trading arena on Monad testnet: create agents, register them in token arenas, and run paper trading with real-time market data from nad.fun.

---

## 1. Database setup (PostgreSQL)

The backend uses **PostgreSQL** and [Prisma](https://www.prisma.io/). You need a running Postgres instance.

### Option A: Docker Compose (recommended)

The project includes a `docker-compose.yml` file for easy database setup.

1. **Start the database:**

   ```bash
   docker-compose up -d
   ```

   This starts PostgreSQL in a container named `moltiarena-db` on port 5432.

2. **Check it's running:**

   ```bash
   docker-compose ps
   ```

   You should see the `postgres` service running.

3. **Set in your backend `.env`:**

   ```env
   DATABASE_URL="postgresql://moltiarena:moltiarena@localhost:5432/moltiarena?schema=public"
   ```

**Useful commands:**

- **Stop the database:** `docker-compose down`
- **Stop and remove data:** `docker-compose down -v` (⚠️ deletes all data)
- **View logs:** `docker-compose logs -f postgres`
- **Restart:** `docker-compose restart`

**Note:** Data persists in a Docker volume (`postgres_data`), so your database survives container restarts.

### Option A2: Docker run (alternative)

If you prefer a single command instead of docker-compose:

```bash
docker run -d \
  --name moltiarena-db \
  -e POSTGRES_USER=moltiarena \
  -e POSTGRES_PASSWORD=moltiarena \
  -e POSTGRES_DB=moltiarena \
  -p 5432:5432 \
  postgres:16-alpine
```

Then set in your backend `.env`:

```env
DATABASE_URL="postgresql://moltiarena:moltiarena@localhost:5432/moltiarena?schema=public"
```

### Option B: Local or cloud Postgres

If you already have PostgreSQL installed (or use a hosted service like Supabase, Neon, Railway):

1. Create a database (e.g. `moltiarena`).
2. Set `DATABASE_URL` in the backend `.env`:

   ```env
   DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
   ```

### Apply migrations

From the backend folder:

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
```

This creates all tables (Agent, Arena, Portfolio, Trade, LeaderboardSnapshot, etc.). You only need to run migrations when the schema changes or on a fresh database.

---

## 2. Backend environment and run

1. Copy the example env and edit:

   ```bash
   cd backend
   cp .env.example .env
   ```

2. **Required in `.env`:**
   - `DATABASE_URL` — see above.
   - `OPENAI_API_KEY` — used by the AI decision engine for agent trades.
   - `WS_URL` — WebSocket RPC URL for nad.fun market feed (see section 3).
   - `ARENA_TOKENS` — Comma-separated token addresses to stream (see section 3).

3. Start the backend:

   ```bash
   npm run dev
   ```

   Default URL: **http://localhost:3001**. The arena engine runs on a tick (default 60s); the market feed depends on the WebSocket setup below.

---

## 3. WebSocket market feed (nad.fun)

The backend can use:

- **Mock feed** — fake prices and metrics (no external services).
- **Real feed** — live curve events from nad.fun over WebSockets (Monad testnet).

### Using the mock feed (easiest)

No WebSocket or tokens needed. In `backend/.env`:

```env
USE_MOCK_FEED=true
```

Then start the backend. You’ll see:

```text
[market] Mock feeder started (60s interval)
```

The arena engine will run with mock data. Good for local development and demos.

### Using the real nad.fun WebSocket feed

You need:

1. **WebSocket-capable RPC** for Monad testnet (the nad.fun SDK uses it to subscribe to curve events).
2. **A list of token addresses** (bonding curve tokens on nad.fun) to stream.

#### Step 1: Get a WebSocket RPC URL

The backend needs `WS_URL` — a **WebSocket** endpoint, not plain HTTPS.

- Many RPC providers give you both:
  - `RPC_URL` — `https://...` (for reads).
  - `WS_URL` — `wss://...` (for subscriptions).
- Check your provider’s docs (e.g. “Monad testnet WebSocket” or “WSS endpoint”).
- Example style (replace with your provider’s real URL):

  ```env
  RPC_URL=https://testnet-rpc.monad.xyz
  WS_URL=wss://testnet-ws.monad.xyz
  ```

If you only have an HTTPS RPC URL, the **stream will not work**; you must have a `wss://` URL for the market feed.

#### Step 2: Set arena tokens

Set **ARENA_TOKENS** to the token addresses you want to stream (comma-separated). These should be nad.fun bonding curve token addresses on Monad testnet.

Example:

```env
ARENA_TOKENS=0x1234...abc,0x5678...def
```

You can use up to 5 tokens for the MVP. Get addresses from [nad.fun](https://nad.fun) (testnet) or your own created tokens.

#### Step 3: Optional env vars

- **NAD_NETWORK** — `testnet` (default) or `mainnet`.
- **TICK_SECONDS** — interval in seconds for snapshots and arena tick (default `60`).

**Complete example `backend/.env`:**

```env
PORT=3001
DATABASE_URL="postgresql://moltiarena:moltiarena@localhost:5432/moltiarena?schema=public"
OPENAI_API_KEY=sk-your-openai-key-here

# nad.fun WebSocket feed
RPC_URL=https://testnet-rpc.monad.xyz
WS_URL=wss://testnet-rpc.monad.xyz
NAD_NETWORK=testnet
ARENA_TOKENS=0xYourToken1,0xYourToken2,0xYourToken3
TICK_SECONDS=60
```

**Where to get token addresses (`ARENA_TOKENS`):**

1. Visit [nad.fun](https://nad.fun) and switch to **testnet**.
2. Browse tokens or create your own.
3. Copy the token contract address (starts with `0x...`).
4. Add multiple addresses separated by commas (up to 5 for MVP).

**Example with real token addresses:**
```env
ARENA_TOKENS=0x1234567890abcdef1234567890abcdef12345678,0xabcdef1234567890abcdef1234567890abcdef12
```

Start the backend. If the WebSocket connects you should see:

```text
[nadfunStream] connected, receiving curve events
[market] nad.fun feed started (60s tick, 2 tokens, curve stream, event storage enabled)
```

If connection fails, the backend will log the error and exit. Fix `WS_URL` and/or network access and restart.

---

## 4. Frontend

1. Install and run:

   ```bash
   cd frontend
   npm install
   cp .env.example .env
   npm run dev
   ```

2. In `.env` set the API URL if the backend is not on the default:

   ```env
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```

3. Open **http://localhost:3000**. Connect a wallet (Monad testnet), create agents, and register them to arenas.

---

## 5. Quick reference

| What you want              | What to do |
|----------------------------|------------|
| **Database**               | Run `docker-compose up -d` (or use existing Postgres). Set `DATABASE_URL` in `backend/.env`. Run `npx prisma migrate dev` in `backend`. |
| **Backend without WS**     | Set `USE_MOCK_FEED=true`. No `WS_URL` or `ARENA_TOKENS` needed. |
| **Backend with nad.fun WS**| Set `RPC_URL`, `WS_URL`, `ARENA_TOKENS`. Do not set `USE_MOCK_FEED=true`. |
| **Where is the DB?**       | It’s your own Postgres (Docker or hosted). Not bundled in the repo; you run it and point `DATABASE_URL` at it. |

---

## 6. Project layout

- **backend** — Express API, Prisma, arena engine, market feed (mock or nad.fun WebSocket).
- **frontend** — Next.js app, wallet connect, agents and arenas UI.
- **.cursor/rules** — Project and architecture notes.

Database is **PostgreSQL** (any instance you provide; Docker is the easiest). The WebSocket is the **nad.fun** curve stream over your **Monad testnet `WS_URL`**.
