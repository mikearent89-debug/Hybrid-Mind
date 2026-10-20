import {
  conflictingClaims,
  describeLocator,
  locatorCovers,
  projectMemory,
  visibleMemory,
  type Anchor,
  type Candidate,
  type Id,
  type Locator,
  type MemoryDataset,
  type Principal,
} from '@hybrid/memory-domain';
import { fuseHits, type Embedder, type EventStore, type Signal } from '@hybrid/memory-store';
import type { z } from 'zod';
import type { SearchResponse } from '@hybrid/memory-contract';

export type SearchResponseT = z.infer<typeof SearchResponse>;

export interface SearchOptions {
  k?: number;
  /** Candidates fetched per signal before fusion. */
  perSignal?: number;
  /** Skip the vector signal (no embedder, or an explain run that wants lexical only). */
  lexicalOnly?: boolean;
}

/**
 * Hybrid retrieval as one principal: full-text and vector candidates are fused by reciprocal rank,
 * chunks of revisions the principal may not see are dropped, and the anchors and claims that sit
 * on each surviving chunk are attached so an answer can cite them. Conflicts among the attached
 * claims are reported, never resolved.
 */
export async function search(
  store: EventStore,
  embedder: Embedder | null,
  principal: Principal,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponseT> {
  const k = options.k ?? 8;
  const perSignal = options.perSignal ?? Math.max(20, k * 3);
  const memory = visibleMemory(projectMemory(await store.readLog()), principal);
  const visibleRevisions = new Map(memory.revisions.map((r) => [r.id, r]));

  const signalsRun: Signal[] = ['lexical'];
  const lexical = await store.lexicalSearch(query, perSignal);
  let vector: Awaited<ReturnType<EventStore['vectorSearch']>> = [];
  if (embedder && !options.lexicalOnly) {
    const [q] = await embedder.embed([query]);
    vector = await store.vectorSearch(q!, perSignal);
    signalsRun.push('vector');
  }

  const fused = fuseHits({ lexical, vector }).filter((r) => visibleRevisions.has(r.revisionId));
  const hits = fused.slice(0, k).map((r) => {
    const revision = visibleRevisions.get(r.revisionId)!;
    const source = memory.sources.find((s) => s.id === revision.sourceId)!;
    const anchors = anchorsOn(memory, r.revisionId, r.locator);
    const anchorIds = new Set(anchors.map((a) => a.id));
    const claimIds = memory.claims
      .filter((c) => c.anchors.some((l) => anchorIds.has(l.anchorId)))
      .map((c) => c.id);
    const claimIdSet = new Set(claimIds);
    const caseIds = memory.cases
      .filter(
        (k) =>
          k.anchors.some((l) => anchorIds.has(l.anchorId)) ||
          k.claimIds.some((id) => claimIdSet.has(id)),
      )
      .map((k) => k.id);
    return {
      revisionId: r.revisionId,
      sourceId: source.id,
      sourceTitle: source.title,
      sourceKind: source.kind,
      locator: r.locator,
      locatorText: describeLocator(r.locator),
      contextPrefix: r.chunk.contextPrefix,
      text: r.chunk.text,
      score: r.score,
      signals: r.signals,
      anchorIds: [...anchorIds],
      claimIds,
      caseIds,
    };
  });

  const citedClaimIds = new Set(hits.flatMap((h) => h.claimIds));
  const claims = memory.claims.filter(
    (c) => citedClaimIds.has(c.id) && c.reviewState !== 'rejected',
  );
  const conflicts = claims
    .map((c) => ({
      claimId: c.id,
      conflictsWith: conflictingClaims(c, memory.claims).map((o) => o.id),
    }))
    .filter((c) => c.conflictsWith.length > 0);

  return { query, principalId: principal.id, hits, claims, conflicts, signalsRun };
}

function anchorsOn(memory: MemoryDataset, revisionId: Id, locator: Locator): Anchor[] {
  return memory.anchors.filter(
    (a) => a.revisionId === revisionId && locatorCovers(a.locator, locator),
  );
}

/** A case with everything a reader needs to check it: its claims, their anchors, the sources. */
export function caseDetail(memory: MemoryDataset, caseId: Id) {
  const found = memory.cases.find((c) => c.id === caseId);
  if (!found) return null;
  const claims = memory.claims.filter((c) => found.claimIds.includes(c.id));
  const anchorIds = new Set([
    ...found.anchors.map((l) => l.anchorId),
    ...claims.flatMap((c) => c.anchors.map((l) => l.anchorId)),
  ]);
  const anchors = memory.anchors.filter((a) => anchorIds.has(a.id));
  const revisionIds = new Set(anchors.map((a) => a.revisionId));
  const sourceIds = new Set(
    memory.revisions.filter((r) => revisionIds.has(r.id)).map((r) => r.sourceId),
  );
  const sources = memory.sources.filter((s) => sourceIds.has(s.id));
  return { case: found, claims, anchors, sources };
}

export function pendingCandidates(memory: MemoryDataset): Candidate[] {
  return memory.candidates.filter((c) => c.decision === null);
}
