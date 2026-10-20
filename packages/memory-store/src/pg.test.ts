import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE, FIXTURE_LOG, projectMemory } from '@hybrid/memory-domain';
import { loadLog } from './loadFixture';
import { PgEventStore, createPool, migrate, reset } from './pg';

// Runs only against a real PostgreSQL with pgvector (docker compose up postgres; CI provides one).
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('PgEventStore', () => {
  const pool = url ? createPool(url) : null;
  const store = pool ? new PgEventStore(pool) : null;

  beforeAll(async () => {
    await reset(pool!);
    expect(await migrate(pool!)).toEqual(['0001_init.sql']);
    expect(await migrate(pool!)).toEqual([]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('appends the fixture log and reads it back unchanged', async () => {
    expect(await loadLog(store!)).toBe(FIXTURE_LOG.events.length);
    const log = await store!.readLog();
    expect(log).toEqual(FIXTURE_LOG);
    expect(projectMemory(log, { label: FIXTURE.label })).toEqual(FIXTURE);
  });

  it('projects every record and every claim edge', async () => {
    const counts = await store!.countRecords();
    expect(counts.case).toBe(FIXTURE.cases.length);
    expect(counts.claim).toBe(FIXTURE.claims.length);
    expect(counts.entity).toBe(FIXTURE.entities.length);
    const edges = await pool!.query<{ n: string }>('SELECT count(*) AS n FROM edge');
    expect(Number(edges.rows[0]!.n)).toBe(FIXTURE.claims.length);
    const invalidated = await pool!.query<{ review_state: string; invalidated_at: Date | null }>(
      "SELECT review_state, invalidated_at FROM edge WHERE claim_id = 'cl-01'",
    );
    expect(invalidated.rows[0]).toMatchObject({ review_state: 'superseded' });
    expect(invalidated.rows[0]!.invalidated_at).not.toBeNull();
  });

  it('refuses updates and deletes on the log', async () => {
    await expect(
      pool!.query("UPDATE event_log SET actor_id = 'x' WHERE position = 1"),
    ).rejects.toThrow(/append-only/);
    await expect(pool!.query('DELETE FROM event_log WHERE position = 1')).rejects.toThrow(
      /append-only/,
    );
  });

  it('stores chunks with full-text search', async () => {
    await store!.storeChunks([
      {
        revisionId: 'rev-01',
        episodeId: 'ep-intake-1',
        index: 0,
        text: 'Replaced all DC string fuses on INV-MR-03; trips continued the next afternoon.',
        contextPrefix: 'WO-1001 Mesa Ridge INV-MR-03 DC fuse replacement, page 1',
        locator: { type: 'page', page: 1 },
        embedding: [],
        embeddingModel: 'none',
      },
    ]);
    const hit = await pool!.query<{ revision_id: string }>(
      "SELECT revision_id FROM chunk WHERE tsv @@ plainto_tsquery('english', 'fuses trips')",
    );
    expect(hit.rows.map((r) => r.revision_id)).toEqual(['rev-01']);
  });
});
