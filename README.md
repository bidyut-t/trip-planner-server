# Trip Planner Server

Node.js API that creates intelligent trip itineraries using AI and partner data. Generates day-by-day schedules with restaurants, activities, transportation, and sightseeing recommendations.

## 🚀 Installation

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Setup

1. **Clone and install**
   ```bash
   git clone <repository-url>
   cd trip-planner-server
   npm install

   Incase facing certificate problem 
   
   NODE_TLS_REJECT_UNAUTHORIZED npm i

   
   ```

2. **Environment setup**
   ```bash
   cp .env.example .env
   ```

3. **Configure environment variables**
   ```env
   PORT=8081
   USE_OPENAI_SDK=true
   OPENAI_API_KEY=your-openai-api-key
   OPENAI_MODEL=gpt-4o-mini
   USE_CATALOG_MCP=true
   NEARBY_CATALOG_RADIUS_KM=4
   ```

## 🏃 Running the Server

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

### MCP Catalog Server (for AI tools)
```bash
npm run mcp:catalog
```

**Server URL:** `http://localhost:8081`

## 📋 API Endpoints

### Health Check
```bash
GET /health
```

**Response:**
```json
{
  "ok": true,
  "plannerMode": "openai"
}
```

### Trip Planning (Natural Language)
```bash
POST /api/trips/plan/natural
```

**Request:**
```json
{
  "prompt": "Plan a 3-day Jaipur trip for 2 people from March 1-5, 2024. We enjoy museums, local cuisine, and shopping. Keep it moderate pace."
}
```

**Response:**
```json
{
  "request": {
    "destination": "Jaipur, India",
    "startDate": "2024-03-01",
    "endDate": "2024-03-05",
    "interests": ["museums", "local cuisine", "shopping"],
    "travelers": 2,
    "pace": "moderate"
  },
  "plan": {
    "destination": { ... },
    "days": [
      {
        "date": "2024-03-01",
        "blocks": [
          {
            "start": "09:00",
            "end": "12:00",
            "type": "sightseeing",
            "title": "City Palace Museum",
            "partner": true,
            "provider": "Heritage Tours"
          }
        ]
      }
    ],
    "partnerPlacements": [...]
  }
}
```

### Streaming Support
Add `Accept: text/event-stream` header for real-time progress updates:

```bash
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"prompt": "3-day Jaipur trip for 2"}'
```

### View Destination Catalog
```bash
GET /api/catalog/:destination
```

**Example:**
```bash
GET /api/catalog/Jaipur%2C%20India
```

**Response:**
```json
{
  "destination": { ... },
  "restaurants": [...],
  "activities": [...],
  "cabs": [...],
  "games": [...],
  "pois": [...]
}
```

### List Available Models
```bash
GET /api/models
```

**Response:**
```json
{
  "count": 5,
  "models": [
    {
      "id": "gpt-4o-mini",
      "object": "model",
      "created": 1234567890
    }
  ]
}
```

## 🧪 Example Usage

### cURL
```bash
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "I want to visit Jaipur from March 1-5, 2024 with my spouse. We enjoy museums, local cuisine, and shopping. Keep it moderate pace."
  }'
```

### JavaScript/Node.js
```javascript
const response = await fetch('http://localhost:8081/api/trips/plan/natural', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: "Plan a romantic 2-day Delhi trip for couples, budget-friendly"
  })
});

const { request, plan } = await response.json();
console.log(`Planning ${plan.days.length} days in ${plan.destination.name}`);
```

### Python
```python
import requests

response = requests.post('http://localhost:8081/api/trips/plan/natural', 
  json={
    "prompt": "Adventure trip to Rajasthan for 4 days, love photography and local culture"
  }
)

data = response.json()
print(f"Trip plan: {len(data['plan']['days'])} days")
```

## 🗂️ Project Structure

```
trip-planner-server/
├── data/                     # Partner and destination data
│   ├── destinations.json     # Supported destinations
│   ├── partners.restaurants.json
│   ├── partners.activities.json
│   ├── partners.cabs.json
│   └── pois.jaipur.json     # Points of interest
├── src/
│   ├── index.ts             # Express server
│   ├── routes/              # API route handlers
│   ├── services/            # Business logic
│   ├── schemas/             # Data validation schemas
│   ├── utils/               # Helper utilities
│   └── mcp/                 # MCP server for AI tools
└── .env                     # Environment configuration
```

## 🔧 Features

- **AI-Powered Planning**: Uses OpenAI GPT models for intelligent trip generation
- **Partner Integration**: Real restaurant, activity, and transportation recommendations
- **Natural Language Processing**: Plain English trip requests
- **Streaming Responses**: Real-time progress updates
- **Caching Layer**: Optimized performance with in-memory caching
- **MCP Protocol**: Model Context Protocol for AI tool integration
- **Flexible Data**: JSON-based partner and destination catalogs

## 🚨 Error Handling

The API returns standard HTTP status codes:

- `200` - Success
- `400` - Bad Request (validation errors)
- `500` - Internal Server Error

**Error Response Format:**
```json
{
  "error": "Validation failed",
  "details": { ... }
}
```