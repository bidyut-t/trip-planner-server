# Trip Planner Server

Node.js API that builds **time-based trip itineraries** with partner restaurants, cabs, activities, and games. Uses a **mock planner** by default; optional **Cursor SDK** when configured.

## Folder location

```
C:\Users\ACER\trip-planner-server
```

## Quick start

```powershell
cd C:\Users\ACER\trip-planner-server
copy .env.example .env
npm install
npm run dev
```

Server: **http://localhost:8081** (or `PORT` from `.env`)

## API

### Health

```bash
curl http://localhost:8081/health
```

### Plan a trip (natural language)

Uses the same planning rules (catalog partners, POIs, 14-day max, mock or Cursor planner).

Parsing pipeline (optimized for speed):

1. **keyword-extractor** — interest hints from the prompt (local, instant).
2. **One AI call** — infers destination, dates, travelers, pace, and builds the schedule. Partner names come from **trip-catalog MCP tools** (on demand, not embedded catalog JSON).
3. **Response shaping** (local) — maps AI JSON to the API `TripPlan` shape (no catalog file matching).

Requires `CURSOR_API_KEY`. Set `CURSOR_MODEL=gemini-3-flash` (default) for faster responses.

**Why this is faster:** the old flow used **two** AI calls and sent the **full catalog** on the second call (~2 min). The new flow uses **one** AI call; catalog is loaded via MCP tools when needed.

```bash
curl -X POST http://localhost:8081/api/trips/plan/natural ^
  -H "Content-Type: application/json" ^
  -d "{\"prompt\":\"Plan a relaxed 3-day Jaipur trip for 2 people from 2026-06-10. We love history, food, and photography.\"}"
```

**PowerShell:**

```powershell
$body = @{
  prompt = "Plan a relaxed 3-day Jaipur trip for 2 people from 2026-06-10. We love history, food, and photography."
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8081/api/trips/plan/natural" -Method Post -Body $body -ContentType "application/json"
```

Response shape: `{ "request": { ... }, "plan": { ... } }` — `request` is the parsed structured input used for planning.

### View catalog for a destination

```bash
curl http://localhost:8081/api/catalog/Jaipur%2C%20India
```

### Natural language (`POST /api/trips/plan/natural`)

| Field | Required | Description |
|-------|----------|-------------|
| `prompt` | yes | Free-text trip description (3–2000 chars) |

Describe the trip in plain language (e.g. “3-day relaxed Jaipur trip for 2, love history and food, starting June 10 2026”). AI resolves dates and traveler count.

## Mock data

| File | Purpose |
|------|---------|
| `data/partners.cabs.json` | Partner cab services |
| `data/partners.restaurants.json` | Partner restaurants |
| `data/partners.activities.json` | Partner activities |
| `data/partners.games.json` | Partner games |
| `data/pois.jaipur.json` | Tourist spots |
| `data/destinations.json` | Destination metadata |

## Catalog MCP (for AI)

Mock catalog data is exposed as an MCP server so the Cursor agent can **call tools** instead of embedding JSON in prompts.

**Run the server (stdio):**

```powershell
npm run mcp:catalog
```

**Tools:** `list_destinations`, `get_destination`, `list_cabs`, `list_restaurants`, `list_activities`, `list_games`, `get_catalog_bundle`

**Trip planner API:** When `USE_CURSOR_SDK=true`, `runCursorPrompt` attaches the server via `src/utils/mcp-catalog-config.ts` (`USE_CATALOG_MCP=false` to disable). MCP wiring is in code, not `.cursor/` config, so it can be reused when swapping AI SDKs.

## Cursor SDK (optional)

```powershell
npm install @cursor/sdk
```

In `.env`:

```
USE_CURSOR_SDK=true
CURSOR_API_KEY=your-key-from-cursor-dashboard
```

If the SDK fails, the server **falls back to the mock planner**.

## Project structure

```
trip-planner-server/
  data/           # mock partners & POIs
  src/
    index.ts      # Express app
    routes/
    schemas/
    services/
      planner.mock.ts
      planner.cursor.ts
      planner.service.ts
      nlp-parser.ai.ts
      nlp-parser.keywords.ts
      catalog.service.ts
    mcp/
      catalog-server.ts
```
