import {
  EMPTY_LOG,
  appendEvent,
  type AppendOptions,
  type EventLog,
  type Id,
  type Instant,
  type LoggedEvent,
  type MemoryEvent,
} from '@hybrid/memory-domain';
import { cosine, tokenize } from './embedding';
import type { ChunkHit } from './search';

/** Chunks arrive from the worker and are stored next to the revision they came from. */
export interface StoredChunk {
  revisionId: Id;
  episodeId: Id;
  index: number;
  text: string;
  contextPrefix: string;
  locator: unknown;
  embedding: number[];
  embeddingModel: string;
}

/**
 * The one write path. Every implementation appends events in order and can hand back the whole
 * log; projections are derived from it (in PostgreSQL, maintained in tables by the projector).
 */
export interface EventStore {
  append(
    event: MemoryEvent,
    actorId: Id,
    recordedAt: Instant,
    options?: AppendOptions,
  ): Promise<LoggedEvent>;
  readLog(afterPosition?: number): Promise<EventLog>;
  storeChunks(chunks: StoredChunk[]): Promise<number>;
  /** Top-k chunks by full-text match, best first. */
  lexicalSearch(query: string, k: number): Promise<ChunkHit[]>;
  /** Top-k chunks by vector similarity to the query embedding, best first. */
  vectorSearch(embedding: number[], k: number): Promise<ChunkHit[]>;
  close(): Promise<void>;
}

/** Keeps the log in memory. Used by tests and by the API when no DATABASE_URL is set. */
export class MemoryEventStore implements EventStore {
  private log: EventLog;
  readonly chunks: StoredChunk[] = [];

  constructor(initial: EventLog = EMPTY_LOG) {
    this.log = initial;
  }

  async append(
    event: MemoryEvent,
    actorId: Id,
    recordedAt: Instant,
    options: AppendOptions = {},
  ): Promise<LoggedEvent> {
    this.log = appendEvent(this.log, event, actorId, recordedAt, options);
    return this.log.events.at(-1)!;
  }

  async readLog(afterPosition = 0): Promise<EventLog> {
    return { ...this.log, events: this.log.events.filter((e) => e.position > afterPosition) };
  }

  async storeChunks(chunks: StoredChunk[]): Promise<number> {
    for (const chunk of chunks) {
      const i = this.chunks.findIndex(
        (c) => c.revisionId === chunk.revisionId && c.index === chunk.index,
      );
      if (i >= 0) this.chunks[i] = chunk;
      else this.chunks.push(chunk);
    }
    return chunks.length;
  }

  async lexicalSearch(query: string, k: number): Promise<ChunkHit[]> {
    const terms = new Set(tokenize(query));
    if (terms.size === 0) return [];
    const scored = this.chunks
      .map((chunk) => {
        const tokens = tokenize(`${chunk.contextPrefix} ${chunk.text}`);
        const present = new Set(tokens);
        let matched = 0;
        for (const t of terms) if (present.has(t)) matched += 1;
        // Fraction of query terms present, lightly favoring shorter chunks, like ts_rank_cd.
        const score = matched === 0 ? 0 : matched / terms.size + 1 / (10 + tokens.length);
        return { chunk, score };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.revisionId.localeCompare(b.chunk.revisionId));
    return scored.slice(0, k).map((h, i) => ({ ...h, rank: i + 1 }));
  }

  async vectorSearch(embedding: number[], k: number): Promise<ChunkHit[]> {
    if (embedding.length === 0) return [];
    return this.chunks
      .filter((c) => c.embedding.length === embedding.length)
      .map((chunk) => ({ chunk, score: cosine(embedding, chunk.embedding) }))
      .sort((a, b) => b.score - a.score || a.chunk.revisionId.localeCompare(b.chunk.revisionId))
      .slice(0, k)
      .map((h, i) => ({ ...h, rank: i + 1 }));
  }

  async close(): Promise<void> {}
}
