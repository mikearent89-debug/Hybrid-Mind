import { describe, expect, it } from 'vitest';
import { FIXTURE_LOG } from '@hybrid/memory-domain';
import { HashEmbedder, cosine } from './embedding';
import { MemoryEventStore } from './eventStore';
import { loadFixtureChunks } from './loadFixture';
import { fuseHits } from './search';

const embedder = new HashEmbedder();

async function stocked() {
  const store = new MemoryEventStore(FIXTURE_LOG);
  await loadFixtureChunks(store, embedder);
  return store;
}

describe('chunk search (memory store)', () => {
  it('finds the fuse replacement work order by words', async () => {
    const store = await stocked();
    const hits = await store.lexicalSearch('DC string fuses replaced trips continued', 5);
    expect(hits[0]?.chunk.revisionId).toBe('rev-01');
    expect(hits.map((h) => h.rank)).toEqual(hits.map((_, i) => i + 1));
  });

  it('finds the rodent email by vector similarity', async () => {
    const store = await stocked();
    const [q] = await embedder.embed(['rodents chewed the combiner wiring']);
    const hits = await store.vectorSearch(q!, 3);
    expect(hits.map((h) => h.chunk.revisionId)).toContain('rev-07');
  });

  it('fuses signals so a chunk found by both ranks first', async () => {
    const store = await stocked();
    const query = 'INV-MR-03 firmware 3.2.0 debounce';
    const [q] = await embedder.embed([query]);
    const fused = fuseHits({
      lexical: await store.lexicalSearch(query, 10),
      vector: await store.vectorSearch(q!, 10),
    });
    expect(fused[0]?.revisionId).toBe('rev-02');
    expect(fused[0]?.signals.lexical).toBe(1);
    expect(fused[0]?.signals.vector).toBeDefined();
  });

  it('embeds deterministically and distinguishes topics', async () => {
    const [a, b, c] = await embedder.embed([
      'firmware upgrade on the inverter',
      'inverter firmware upgrade',
      'vegetation shading on row twelve',
    ]);
    expect(cosine(a!, b!)).toBeGreaterThan(0.7);
    expect(cosine(a!, c!)).toBeLessThan(0.5);
    expect((await embedder.embed(['x']))[0]).toEqual((await embedder.embed(['x']))[0]);
  });
});
