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

Server: **http://localhost:3000**

## API

### Health

```bash
curl http://localhost:3000/health
```

### Plan a trip (mock planner)

```bash
curl -X POST http://localhost:3000/api/trips/plan ^
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

Invoke-RestMethod -Uri "http://localhost:3000/api/trips/plan" -Method Post -Body $body -ContentType "application/json"
```

### View catalog for a destination

```bash
curl http://localhost:3000/api/catalog/Jaipur%2C%20India
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
      catalog.service.ts
```
