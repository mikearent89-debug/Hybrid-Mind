import { serve } from '@hono/node-server';
import { FIXTURE_LABEL, PRINCIPALS } from '@hybrid/memory-domain';
import { MemoryEventStore, PgEventStore, createPool, migrate } from '@hybrid/memory-store';
import { createApp } from './app';
import { createEmbedder } from './embedder';

// Development server. With DATABASE_URL it runs on PostgreSQL; without, on an in-memory log that
// is lost on exit. Principals come from the synthetic fixture until 1B replaces them with grants.

const port = Number(process.env.PORT ?? 8787);
const url = process.env.DATABASE_URL;
let store;
if (url) {
  const pool = createPool(url);
  await migrate(pool);
  store = new PgEventStore(pool);
} else {
  console.warn('DATABASE_URL not set; using an in-memory store that is lost on exit');
  store = new MemoryEventStore();
}

const embedder = createEmbedder();
const app = createApp({ store, embedder, principals: PRINCIPALS, label: FIXTURE_LABEL });
serve({ fetch: app.fetch, port }, () => {
  console.log(
    `memory-api listening on http://localhost:${port} (${url ? 'postgres' : 'memory'}, embeddings: ${embedder.model})`,
  );
});
