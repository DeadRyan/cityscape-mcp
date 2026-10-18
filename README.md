# CityScape Rentals — MCP Server

An [MCP](https://modelcontextprotocol.io) server exposing the **CityScape
Rentals AI Booking API** to AI assistants (Claude, Cursor, ChatGPT plugins, and
any MCP-compatible client).

CityScape Rentals provides premium short-term condo rentals in Downtown Toronto —
minutes from the Metro Toronto Convention Centre, Financial District, Scotiabank
Arena, Rogers Centre and Union Station.

## 💸 Corporate AI discount

**Corporate AI bookings receive a 10% discount.** When the AI (not a human)
performs the final payment step against a pre-authorized on-file card, pass
`bookingKind: "corporate-ai"` and the quote automatically applies 10% off
everything except the Stripe processing fee.

## Tools

| Tool | Action | Auth |
|---|---|---|
| `cityscape_check_availability` | Real-time availability + base nightly rates | Public |
| `cityscape_get_quote` | Itemized quote (10% off with `corporate-ai`) | Public |
| `cityscape_create_booking` | Create a booking (`ai-assisted` or `corporate-ai`) | API key |

## Quick start (local stdio — Claude Desktop)

```bash
npm install
npm run build
```

Then in Claude Desktop → **Settings → Developer → Edit Config**, add:

```json
{
  "mcpServers": {
    "cityscape": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": { "AGENT_API_KEY": "YOUR_AGENT_API_KEY" }
    }
  }
}
```

Restart Claude Desktop, then ask: *"Check availability for
ice-cloud-studio-downtown-toronto from 2026-11-01 to 2026-11-05."*

## Hosted endpoint (no local config)

A hosted Streamable-HTTP instance is available at:

```
https://api.cityscape.rentals/mcp
```

- **Read-only tools** (`availability`, `quote`) are public.
- **Booking** requires an API key, passed as the `apiKey` argument to
  `cityscape_create_booking`.

Discovery metadata (for MCP registries / scanners):

```
https://api.cityscape.rentals/.well-known/mcp/server-card.json
```

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `CITYSCAPE_API_BASE` | no | `https://api.cityscape.rentals` | API base URL |
| `AGENT_API_KEY` | for booking | — | Key for the write path (stdin/local usage) |
| `PORT` | no | `3002` | HTTP listen port (`start:http` only) |
| `MCP_BEARER_TOKEN` | no | — | Optional bearer gate for the HTTP endpoint |

## HTTP server

```bash
npm run build
PORT=3002 node dist/http.js
```

Endpoints:

| Path | Purpose |
|---|---|
| `/health` (or `/`) | Liveness probe (no auth) |
| `/.well-known/mcp/server-card.json` | Static server card for registries |
| `/mcp` | MCP Streamable HTTP |
