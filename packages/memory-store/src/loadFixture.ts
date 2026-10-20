import { FIXTURE_DOCUMENTS, FIXTURE_LOG, type EventLog } from '@hybrid/memory-domain';
import type { Embedder } from './embedding';
import type { EventStore, StoredChunk } from './eventStore';

/** Replays a log into an empty store, event by event, keeping actors, times and correlation IDs. */
export async function loadLog(store: EventStore, log: EventLog = FIXTURE_LOG): Promise<number> {
  const existing = await store.readLog();
  if (existing.events.length > 0) {
    throw new Error(
      `store already holds ${existing.events.length} events; refusing to load on top`,
    );
  }
  for (const e of log.events) {
    await store.append(e.event, e.actorId, e.recordedAt, {
      effectiveAt: e.effectiveAt,
      correlationId: e.correlationId ?? undefined,
    });
  }
  return log.events.length;
}

/** The fixture documents as chunks, embedded with the given embedder, stored against their revisions. */
export async function loadFixtureChunks(store: EventStore, embedder: Embedder): Promise<number> {
  const chunks: StoredChunk[] = [];
  for (const doc of FIXTURE_DOCUMENTS) {
    const embeddings = await embedder.embed(
      doc.segments.map((s) => `${doc.contextPrefix}\n\n${s.text}`),
    );
    doc.segments.forEach((segment, index) => {
      chunks.push({
        revisionId: doc.revisionId,
        episodeId: 'ep-intake-1',
        index,
        text: segment.text,
        contextPrefix: doc.contextPrefix,
        locator: segment.locator,
        embedding: embeddings[index]!,
        embeddingModel: embedder.model,
      });
    });
  }
  return store.storeChunks(chunks);
}
