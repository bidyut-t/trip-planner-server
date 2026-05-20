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

### Plan a trip (structured JSON)

```bash
curl -X POST http://localhost:8081/api/trips/plan ^
  -H "Content-Type: application/json" ^
  -d "{\"destination\":\"Jaipur, India\",\"startDate\":\"2026-06-10\",\"endDate\":\"2026-06-12\",\"interests\":[\"history\",\"food\",\"photography\"]}"
```

**PowerShell:**

```powershell
$body = @{
  destination = "Jaipur, India"
  startDate   = "2026-06-10"
  endDate     = "2026-06-12"
  interests   = @("history", "food", "photography")
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8081/api/trips/plan" -Method Post -Body $body -ContentType "application/json"
```

### Plan a trip (natural language)

Same planning rules as `/plan` (catalog partners, POIs, 14-day max, mock or Cursor planner).

Parsing pipeline (optimized for speed):

1. **keyword-extractor** — interest hints from the prompt (local, instant).
2. **One AI call** — infers destination, dates, travelers, pace, and a **generic day schedule** (no catalog JSON in the prompt).
3. **Catalog enrich** (local) — swaps generic blocks for your partner POIs, cabs, restaurants, etc.

Requires `CURSOR_API_KEY`. Set `CURSOR_MODEL=gemini-3-flash` (default) for faster responses.

**Why this is faster:** the old flow used **two** AI calls and sent the **full catalog** on the second call (~2 min). The new flow uses **one** small AI call + milliseconds of local catalog matching.

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

## Request body

| Field | Required | Description |
|-------|----------|-------------|
| `destination` | yes | e.g. `Jaipur, India` |
| `startDate` | yes | `YYYY-MM-DD` |
| `endDate` | yes | `YYYY-MM-DD` |
| `interests` | no | e.g. `["history","food"]` |
| `travelers` | no | default `2` |
| `pace` | no | `relaxed` \| `moderate` \| `packed` |

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
```
