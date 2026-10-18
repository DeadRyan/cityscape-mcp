import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Shared MCP server factory + API client for the CityScape AI Booking API.
 * Used by both the stdio entry point (Claude Desktop / local hosts) and the
 * HTTP entry point (hosted on the VPS).
 *
 * Configuration (env):
 *   CITYSCAPE_API_BASE — API base URL (default https://api.cityscape.rentals)
 *   AGENT_API_KEY      — key for the write path (booking). Read-only tools
 *                        work without it.
 */

export const API_BASE = process.env.CITYSCAPE_API_BASE ?? 'https://api.cityscape.rentals';
export const AGENT_API_KEY = process.env.AGENT_API_KEY ?? '';

export type Json = Record<string, unknown>;

export async function callApi(
  path: string,
  options?: { method?: string; body?: unknown; apiKey?: string },
): Promise<Json> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = options?.apiKey ?? AGENT_API_KEY;
  if (key) headers['X-Api-Key'] = key;

  const res = await fetch(`${API_BASE}${path}`, {
    method: options?.method ?? 'GET',
    headers,
    ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep raw text for non-JSON errors
  }

  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return (data ?? {}) as Json;
}

function text(content: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }],
  };
}

function err(e: unknown): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  return { isError: true, content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
}

const bookingKindSchema = z
  .enum(['ai-assisted', 'corporate-ai'])
  .describe('ai-assisted = a human completes payment; corporate-ai = the AI completes payment (10% discount).');

const guestSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});

/** Build an MCP server with the CityScape tools registered. */
export function createCityscapeServer(): McpServer {
  const server = new McpServer({
    name: 'cityscape',
    version: '1.0.0',
  });

  server.registerTool(
    'cityscape_check_availability',
    {
      title: 'Check CityScape availability',
      description:
        'Check real-time availability and base nightly rates for a CityScape Toronto condo listing, for a date range.',
      inputSchema: {
        listingId: z.string().describe('Listing slug (e.g. ice-cloud-studio-downtown-toronto).'),
        from: z.string().describe('Check-in date (YYYY-MM-DD).'),
        to: z.string().describe('Check-out date (YYYY-MM-DD).'),
      },
    },
    async ({ listingId, from, to }) => {
      try {
        const data = await callApi(
          `/api/v1/agents/availability?listingId=${encodeURIComponent(listingId)}&from=${from}&to=${to}`,
        );
        return text(data);
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    'cityscape_get_quote',
    {
      title: 'Get a CityScape quote',
      description:
        'Get an itemized price quote for a CityScape Toronto condo. Pass bookingKind=corporate-ai to apply the 10% corporate AI discount.',
      inputSchema: {
        listingId: z.string().describe('Listing slug.'),
        from: z.string().describe('Check-in date (YYYY-MM-DD).'),
        to: z.string().describe('Check-out date (YYYY-MM-DD).'),
        guests: z.number().int().min(1).describe('Number of guests.'),
        bookingKind: bookingKindSchema,
      },
    },
    async ({ listingId, from, to, guests, bookingKind }) => {
      try {
        const data = await callApi('/api/v1/agents/quote', {
          method: 'POST',
          body: { listingId, from, to, guests, bookingKind },
        });
        return text(data);
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    'cityscape_create_booking',
    {
      title: 'Book a CityScape stay',
      description:
        "Create a CityScape booking on a user's behalf. ai-assisted returns a checkout link for the human to pay; corporate-ai charges a pre-authorized on-file card (10% discount) and requires a paymentMethodId.",
      inputSchema: {
        listingId: z.string().describe('Listing slug.'),
        from: z.string().describe('Check-in date (YYYY-MM-DD).'),
        to: z.string().describe('Check-out date (YYYY-MM-DD).'),
        guests: z.number().int().min(1).describe('Number of guests.'),
        bookingKind: bookingKindSchema,
        guest: guestSchema.optional(),
        paymentMethodId: z
          .string()
          .optional()
          .describe('Required for corporate-ai: a pre-authorized on-file Stripe PaymentMethod (pm_…).'),
        apiKey: z
          .string()
          .optional()
          .describe('API key for the write path. Required unless the server was started with AGENT_API_KEY.'),
      },
    },
    async ({ listingId, from, to, guests, bookingKind, guest, paymentMethodId, apiKey }) => {
      try {
        const key = apiKey ?? AGENT_API_KEY;
        if (!key) {
          return err(new Error('Booking requires an API key. Pass it as the `apiKey` argument.'));
        }
        const body: Json = { listingId, from, to, guests, bookingKind };
        if (guest) body.guest = guest as unknown as Json;
        if (paymentMethodId) body.paymentMethodId = paymentMethodId;
        const data = await callApi('/api/v1/agents/booking', { method: 'POST', body, apiKey: key });
        return text(data);
      } catch (e) {
        return err(e);
      }
    },
  );

  return server;
}
