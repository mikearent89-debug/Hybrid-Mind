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

  async close(): Promise<void> {}
}
