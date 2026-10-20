import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMPTY_LOG,
  appendEvent,
  parseLog,
  projectMemory,
  type AppendOptions,
  type Claim,
  type EventLog,
  type Id,
  type Instant,
  type LoggedEvent,
  type MemoryDataset,
  type MemoryEvent,
  type MemoryRecord,
  type RecordType,
} from '@hybrid/memory-domain';
import pg from 'pg';
import type { EventStore, StoredChunk } from './eventStore';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

export function createPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new pg.Pool({ connectionString });
}

/** Applies every migrations/*.sql file not yet recorded in schema_migration, in name order. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migration')).rows.map(
      (r) => r.name,
    ),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return ran;
}

/** Drops everything the migrations created. Tests only. */
export async function reset(pool: pg.Pool): Promise<void> {
  await pool.query(
    'DROP TABLE IF EXISTS chunk, edge, memory_record, event_log, schema_migration CASCADE; DROP FUNCTION IF EXISTS event_log_is_append_only CASCADE',
  );
}

const COLLECTIONS: [RecordType, Exclude<keyof MemoryDataset, 'label'>][] = [
  ['source', 'sources'],
  ['revision', 'revisions'],
  ['anchor', 'anchors'],
  ['episode', 'episodes'],
  ['entity', 'entities'],
  ['entity-alias', 'aliases'],
  ['claim', 'claims'],
  ['case', 'cases'],
  ['lesson', 'lessons'],
  ['candidate', 'candidates'],
  ['proposal', 'proposals'],
  ['outcome', 'outcomes'],
];

type Row = {
  position: string;
  recorded_at: Date;
  effective_at: Date;
  actor_id: string;
  correlation_id: string | null;
  event: MemoryEvent;
};

const iso = (d: Date): Instant => d.toISOString().replace(/\.000Z$/, 'Z');

function toLogged(row: Row): LoggedEvent {
  return {
    position: Number(row.position),
    recordedAt: iso(row.recorded_at),
    effectiveAt: iso(row.effective_at),
    actorId: row.actor_id,
    correlationId: row.correlation_id,
    event: row.event,
  };
}

/**
 * The PostgreSQL store. Each append runs in one transaction: insert the event, re-project the
 * records the event changed, and rewrite their rows. Rows are a cache of the log, never the truth.
 */
export class PgEventStore implements EventStore {
  constructor(private readonly pool: pg.Pool) {}

  async append(
    event: MemoryEvent,
    actorId: Id,
    recordedAt: Instant,
    options: AppendOptions = {},
  ): Promise<LoggedEvent> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize appends so positions and projections stay consistent under concurrent writers.
      await client.query('LOCK TABLE event_log IN SHARE ROW EXCLUSIVE MODE');
      const before = await this.readLogWith(client);
      const after = appendEvent(before, event, actorId, recordedAt, options);
      const logged = after.events.at(-1)!;
      const inserted = await client.query<{ position: string }>(
        `INSERT INTO event_log (recorded_at, effective_at, actor_id, correlation_id, event_type, event)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING position`,
        [
          logged.recordedAt,
          logged.effectiveAt,
          logged.actorId,
          logged.correlationId,
          event.type,
          JSON.stringify(event),
        ],
      );
      const position = Number(inserted.rows[0]!.position);
      if (position !== logged.position) {
        throw new Error(`log position ${position} does not follow ${before.events.length}`);
      }
      await this.project(client, projectMemory(before), projectMemory(after), position);
      await client.query('COMMIT');
      return logged;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async readLog(afterPosition = 0): Promise<EventLog> {
    const client = await this.pool.connect();
    try {
      return await this.readLogWith(client, afterPosition);
    } finally {
      client.release();
    }
  }

  private async readLogWith(client: pg.PoolClient, afterPosition = 0): Promise<EventLog> {
    const result = await client.query<Row>(
      'SELECT position, recorded_at, effective_at, actor_id, correlation_id, event FROM event_log WHERE position > $1 ORDER BY position',
      [afterPosition],
    );
    const events = result.rows.map(toLogged);
    if (afterPosition === 0) {
      const parsed = parseLog({ schemaVersion: 1, events });
      if (!parsed) throw new Error('event_log is damaged: positions are not consecutive');
      return parsed;
    }
    return { ...EMPTY_LOG, events };
  }

  private async project(
    client: pg.PoolClient,
    before: MemoryDataset,
    after: MemoryDataset,
    position: number,
  ): Promise<void> {
    for (const [recordType, key] of COLLECTIONS) {
      const previous = new Map(before[key].map((r) => [r.id, JSON.stringify(r)]));
      for (const record of after[key] as MemoryRecord[]) {
        const json = JSON.stringify(record);
        if (previous.get(record.id) === json) continue;
        await client.query(
          `INSERT INTO memory_record (record_type, id, record_version, access_scope, evidence_class, review_state, effective_from, effective_to, data, projected_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (record_type, id) DO UPDATE SET
             record_version = EXCLUDED.record_version, access_scope = EXCLUDED.access_scope,
             evidence_class = EXCLUDED.evidence_class, review_state = EXCLUDED.review_state,
             effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to,
             data = EXCLUDED.data, projected_from = EXCLUDED.projected_from`,
          [
            recordType,
            record.id,
            record.recordVersion,
            record.accessScope,
            record.evidenceClass,
            record.reviewState,
            record.effectiveFrom,
            record.effectiveTo,
            json,
            position,
          ],
        );
        if (recordType === 'claim') await this.projectEdge(client, record as Claim, position);
      }
    }
  }

  private async projectEdge(client: pg.PoolClient, claim: Claim, position: number): Promise<void> {
    const toId = claim.object.type === 'entity' ? claim.object.entityId : null;
    const toValue = claim.object.type === 'value' ? claim.object.value : null;
    const toUnit = claim.object.type === 'value' ? claim.object.unit : null;
    await client.query(
      `INSERT INTO edge (claim_id, from_id, relation, to_id, to_value, to_unit, valid_from, valid_to, invalidated_at, access_scope, evidence_class, review_state, projected_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (claim_id) DO UPDATE SET
         from_id = EXCLUDED.from_id, relation = EXCLUDED.relation, to_id = EXCLUDED.to_id,
         to_value = EXCLUDED.to_value, to_unit = EXCLUDED.to_unit, valid_from = EXCLUDED.valid_from,
         valid_to = EXCLUDED.valid_to, invalidated_at = EXCLUDED.invalidated_at,
         access_scope = EXCLUDED.access_scope, evidence_class = EXCLUDED.evidence_class,
         review_state = EXCLUDED.review_state, projected_from = EXCLUDED.projected_from`,
      [
        claim.id,
        claim.subjectId,
        claim.relation,
        toId,
        toValue,
        toUnit,
        claim.effectiveFrom,
        claim.effectiveTo,
        claim.invalidatedAt,
        claim.accessScope,
        claim.evidenceClass,
        claim.reviewState,
        position,
      ],
    );
  }

  async storeChunks(chunks: StoredChunk[]): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const c of chunks) {
        await client.query(
          `INSERT INTO chunk (revision_id, episode_id, chunk_index, text, context_prefix, locator, embedding, embedding_model)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (revision_id, chunk_index) DO UPDATE SET
             episode_id = EXCLUDED.episode_id, text = EXCLUDED.text, context_prefix = EXCLUDED.context_prefix,
             locator = EXCLUDED.locator, embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model`,
          [
            c.revisionId,
            c.episodeId,
            c.index,
            c.text,
            c.contextPrefix,
            JSON.stringify(c.locator),
            c.embedding.length > 0 ? `[${c.embedding.join(',')}]` : null,
            c.embeddingModel,
          ],
        );
      }
      await client.query('COMMIT');
      return chunks.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** The current projection as rows, for checks that the tables agree with the log. */
  async countRecords(): Promise<Record<string, number>> {
    const result = await this.pool.query<{ record_type: string; n: string }>(
      'SELECT record_type, count(*) AS n FROM memory_record GROUP BY record_type',
    );
    return Object.fromEntries(result.rows.map((r) => [r.record_type, Number(r.n)]));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
