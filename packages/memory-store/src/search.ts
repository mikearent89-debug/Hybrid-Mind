import type { Id, Locator } from '@hybrid/memory-domain';
import type { StoredChunk } from './eventStore';

/** One chunk returned by a lexical or vector query, with the signal that returned it. */
export interface ChunkHit {
  chunk: StoredChunk;
  /** Rank within its own signal's result list, 1-based. */
  rank: number;
  score: number;
}

export type Signal = 'lexical' | 'vector';

export interface SearchResult {
  chunk: StoredChunk;
  revisionId: Id;
  locator: Locator;
  /** Reciprocal-rank-fusion score across signals. */
  score: number;
  /** Which signals returned the chunk and at what rank, so an answer can explain itself. */
  signals: Partial<Record<Signal, number>>;
}

const chunkKey = (c: StoredChunk) => `${c.revisionId}#${c.index}`;

/**
 * Reciprocal rank fusion: a chunk's score is the sum over signals of 1 / (k + rank). Robust to the
 * two signals' incomparable scales, and a chunk found by both rises above one found by either.
 */
export function fuseHits(lists: Record<Signal, ChunkHit[]>, k = 60): SearchResult[] {
  const merged = new Map<string, SearchResult>();
  for (const signal of Object.keys(lists) as Signal[]) {
    for (const hit of lists[signal]) {
      const key = chunkKey(hit.chunk);
      const entry = merged.get(key) ?? {
        chunk: hit.chunk,
        revisionId: hit.chunk.revisionId,
        locator: hit.chunk.locator as Locator,
        score: 0,
        signals: {},
      };
      entry.score += 1 / (k + hit.rank);
      entry.signals[signal] = hit.rank;
      merged.set(key, entry);
    }
  }
  return [...merged.values()].sort(
    (a, b) => b.score - a.score || chunkKey(a.chunk).localeCompare(chunkKey(b.chunk)),
  );
}
