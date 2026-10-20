import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_LABEL, PRINCIPALS } from '@hybrid/memory-domain';
import { MemoryEventStore, PgEventStore, createPool, migrate } from '@hybrid/memory-store';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createEmbedder } from './embedder';
import { createMcpServer } from './mcpServer';

// stdio MCP server for Claude Desktop and Claude Code. Reads the same PostgreSQL as the HTTP API
// (DATABASE_URL); without it, the synthetic fixture in memory. Acts as MEMORY_PRINCIPAL.

const url = process.env.DATABASE_URL;
let store;
if (url) {
  const pool = createPool(url);
  await migrate(pool);
  store = new PgEventStore(pool);
} else {
  const { FIXTURE_LOG } = await import('@hybrid/memory-domain');
  const { HashEmbedder, loadFixtureChunks } = await import('@hybrid/memory-store');
  store = new MemoryEventStore(FIXTURE_LOG);
  await loadFixtureChunks(store, new HashEmbedder());
  process.env.EMBEDDING_MODEL ??= 'hash';
  console.error('DATABASE_URL not set; serving the synthetic fixture from memory');
}

const principalId = process.env.MEMORY_PRINCIPAL ?? 'u-jordan';
const principal = PRINCIPALS.find((p) => p.id === principalId);
if (!principal) {
  console.error(
    `unknown MEMORY_PRINCIPAL ${principalId}; known: ${PRINCIPALS.map((p) => p.id).join(', ')}`,
  );
  process.exit(1);
}

const server = createMcpServer({
  store,
  embedder: createEmbedder(),
  principal,
  label: FIXTURE_LABEL,
  apiUrl: process.env.MEMORY_API_URL,
  workerDir: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'memory-worker'),
});
await server.connect(new StdioServerTransport());
console.error(`portfolio-memory MCP server ready as ${principal.id}`);
