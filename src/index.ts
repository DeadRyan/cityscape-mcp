import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { API_BASE, createCityscapeServer } from './server.js';

/**
 * stdio entry point — used by Claude Desktop and other local MCP hosts.
 */
async function main(): Promise<void> {
  const server = createCityscapeServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`CityScape MCP server running (API: ${API_BASE})`);
}

main().catch((e) => {
  console.error('CityScape MCP server failed to start:', e);
  process.exit(1);
});
