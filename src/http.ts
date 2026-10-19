import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { API_BASE, createCityscapeServer } from './server.js';

/**
 * Hosted HTTP entry point — runs on the VPS behind Caddy at
 * `https://api.cityscape.rentals/mcp`, so remote MCP clients (ChatGPT plugins,
 * web registries, other machines) can reach the CityScape tools without any
 * local configuration.
 *
 * Configuration (env):
 *   PORT               — listen port (default 3002)
 *   MCP_BEARER_TOKEN   — optional; when set, every request must send
 *                        `Authorization: Bearer <token>`. The write path is
 *                        additionally protected by the API's AGENT_API_KEY.
 */

const PORT = Number(process.env.PORT ?? 3002);
const BEARER = process.env.MCP_BEARER_TOKEN ?? '';

/**
 * Static server card (SEP-1649 / Smithery "Static Server Card"). Served
 * WITHOUT auth at `/.well-known/mcp/server-card.json` so MCP registries and
 * scanners can discover the server's tools even when the `/mcp` endpoint is
 * behind a bearer token. This is the machine-readable "advertisement" that
 * powers directory listings.
 */
const SERVER_CARD = {
  serverInfo: {
    name: 'CityScape Rentals',
    version: '1.0.0',
  },
  description:
    'AI Booking API for CityScape Rentals: real-time availability, itemized ' +
    'quotes, and booking of Downtown Toronto condos. Corporate AI bookings ' +
    '(where the AI completes payment) receive a 10% discount.',
  authentication: {
    required: false,
    schemes: [],
    note: 'Availability and quote are public. Booking requires an API key (passed per request via the `apiKey` argument).',
  },
  tools: [
    {
      name: 'cityscape_check_availability',
      title: 'Check CityScape availability',
      description:
        'Check real-time availability and base nightly rates for a CityScape Toronto condo listing, for a date range.',
      inputSchema: {
        type: 'object',
        properties: {
          listingId: { type: 'string', description: 'Listing slug (e.g. ice-cloud-studio-downtown-toronto).' },
          from: { type: 'string', description: 'Check-in date (YYYY-MM-DD).' },
          to: { type: 'string', description: 'Check-out date (YYYY-MM-DD).' },
        },
        required: ['listingId', 'from', 'to'],
      },
    },
    {
      name: 'cityscape_get_quote',
      title: 'Get a CityScape quote',
      description:
        'Get an itemized price quote. Pass bookingKind=corporate-ai to apply the 10% corporate AI discount.',
      inputSchema: {
        type: 'object',
        properties: {
          listingId: { type: 'string', description: 'Listing slug.' },
          from: { type: 'string', description: 'Check-in date (YYYY-MM-DD).' },
          to: { type: 'string', description: 'Check-out date (YYYY-MM-DD).' },
          guests: { type: 'integer', minimum: 1, description: 'Number of guests.' },
          bookingKind: {
            type: 'string',
            enum: ['ai-assisted', 'corporate-ai'],
            description: 'ai-assisted = human completes payment; corporate-ai = AI completes payment (10% discount).',
          },
        },
        required: ['listingId', 'from', 'to', 'guests', 'bookingKind'],
      },
    },
    {
      name: 'cityscape_create_booking',
      title: 'Book a CityScape stay',
      description:
        "Create a CityScape booking on a user's behalf. ai-assisted returns a checkout link for the human to pay; corporate-ai charges a pre-authorized on-file card (10% discount) and requires a paymentMethodId.",
      inputSchema: {
        type: 'object',
        properties: {
          listingId: { type: 'string', description: 'Listing slug.' },
          from: { type: 'string', description: 'Check-in date (YYYY-MM-DD).' },
          to: { type: 'string', description: 'Check-out date (YYYY-MM-DD).' },
          guests: { type: 'integer', minimum: 1, description: 'Number of guests.' },
          bookingKind: { type: 'string', enum: ['ai-assisted', 'corporate-ai'] },
          guest: {
            type: 'object',
            properties: {
              firstName: { type: 'string' },
              lastName: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
            },
          },
          paymentMethodId: { type: 'string', description: 'Required for corporate-ai (pm_…).' },
        },
        required: ['listingId', 'from', 'to', 'guests', 'bookingKind'],
      },
    },
  ],
  resources: [],
  prompts: [],
};

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, X-Api-Key, Authorization, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

async function main(): Promise<void> {
  const http = createServer(async (req, res) => {
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      res.setHeader(k, v);
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health / info endpoints (excluded from bearer auth for uptime probes).
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'cityscape-mcp', api: API_BASE }));
      return;
    }

    // Static server card — public discovery metadata for MCP registries.
    if (req.url === '/.well-known/mcp/server-card.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(SERVER_CARD));
      return;
    }

    // Optional bearer gate for the MCP endpoint itself.
    if (BEARER) {
      const auth = req.headers.authorization ?? '';
      if (auth !== `Bearer ${BEARER}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    // Stateless mode: a fresh server + transport per request. The SDK allows
    // only ONE transport per Protocol instance, and a stateful transport
    // rejects any second `initialize` ("Server already initialized") — which
    // breaks directory health-checkers like Glama that open a fresh MCP
    // connection every hour. Creating a fresh stateless server per request
    // makes every request (including repeated `initialize`) independent.
    const server = createCityscapeServer();
    const transport = new StreamableHTTPServerTransport({});
    await server.connect(transport);
    try {
      await transport.handleRequest(req, res);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
    }
  });

  http.listen(PORT, () => {
    console.error(`CityScape MCP HTTP server listening on :${PORT} (API: ${API_BASE})`);
  });
}

main().catch((e) => {
  console.error('CityScape MCP HTTP server failed to start:', e);
  process.exit(1);
});
