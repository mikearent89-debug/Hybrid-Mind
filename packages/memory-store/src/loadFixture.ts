import { FIXTURE_LOG, type EventLog } from '@hybrid/memory-domain';
import type { EventStore } from './eventStore';

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
