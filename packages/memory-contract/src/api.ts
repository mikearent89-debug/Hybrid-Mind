import { z } from 'zod';
import { MemoryEvent } from './events';
import {
  Anchor,
  Candidate,
  Case,
  Claim,
  Episode,
  Id,
  Instant,
  Locator,
  Revision,
  Source,
} from './records';

// Payloads of the HTTP API. The Python worker generates its models from these and may call
// nothing else; every write still goes through the API's own validation and the event log.

export const AppendEventRequest = z.object({
  event: MemoryEvent,
  actorId: Id,
  effectiveAt: Instant.optional(),
  correlationId: z.string().optional(),
});

export const AppendEventResponse = z.object({
  position: z.int().min(1),
  recordedAt: Instant,
});

/** One contextual chunk of a revision: the text, the context prefix it was embedded with, and where it sits. */
export const Chunk = z.object({
  index: z.int().min(0),
  text: z.string(),
  contextPrefix: z.string(),
  locator: Locator,
  embedding: z.array(z.number()),
  embeddingModel: z.string(),
});

export const SubmitChunksRequest = z.object({
  revisionId: Id,
  episodeId: Id,
  chunks: z.array(Chunk),
});

export const SubmitChunksResponse = z.object({ stored: z.int().min(0) });

/**
 * What the worker hands back after reading one file: the episode it ran under, the source and its
 * immutable revision, and the contextual chunks. Records are appended idempotently by ID.
 */
export const SubmitIntakeRequest = z.object({
  episode: Episode,
  source: Source,
  revision: Revision,
  chunks: z.array(Chunk),
  actorId: Id,
});

export const SubmitIntakeResponse = z.object({
  episodePosition: z.int().min(1),
  sourcePosition: z.int().min(1),
  revisionPosition: z.int().min(1),
  stored: z.int().min(0),
});

/** What the worker hands back from one extraction run: the episode and the candidates it produced. */
export const SubmitCandidatesRequest = z.object({
  episode: Episode,
  /** Anchors the candidates cite; appended before the candidates so every claim can point at one. */
  anchors: z.array(Anchor).default([]),
  candidates: z.array(Candidate),
  actorId: Id,
});

export const SubmitCandidatesResponse = z.object({
  episodePosition: z.int().min(1),
  /** Candidates the auto-accept rule accepted on arrival, by candidate ID. */
  autoAccepted: z.array(Id),
  /** Candidates waiting for a reviewer, by candidate ID. */
  queued: z.array(Id),
});

export const ApiError = z.object({
  error: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export const EmbedRequest = z.object({ texts: z.array(z.string()).min(1).max(256) });

export const EmbedResponse = z.object({
  model: z.string(),
  dimensions: z.int().min(0),
  embeddings: z.array(z.array(z.number())),
});

export const Signal = z.enum(['lexical', 'vector']);

/** One retrieved chunk with where it came from and which existing anchors and claims sit on it. */
export const SearchHit = z.object({
  revisionId: Id,
  sourceId: Id,
  sourceTitle: z.string(),
  sourceKind: z.string(),
  locator: Locator,
  locatorText: z.string(),
  contextPrefix: z.string(),
  text: z.string(),
  score: z.number(),
  signals: z.partialRecord(Signal, z.int().min(1)),
  anchorIds: z.array(Id),
  claimIds: z.array(Id),
  /** Cases that cite one of these anchors directly or through a claim. */
  caseIds: z.array(Id),
});

export const SearchResponse = z.object({
  query: z.string(),
  principalId: Id,
  hits: z.array(SearchHit),
  /** Accepted or unreviewed claims whose anchors fall on the hits, so an answer can cite facts. */
  claims: z.array(Claim),
  /** Pairs of claims in `claims` that contradict each other; an answer must disclose these. */
  conflicts: z.array(z.object({ claimId: Id, conflictsWith: z.array(Id) })),
  /** Which signals ran, for `explain`. */
  signalsRun: z.array(Signal),
});

export const QueueResponse = z.object({
  principalId: Id,
  candidates: z.array(Candidate),
});

export const CaseResponse = z.object({
  case: Case,
  claims: z.array(Claim),
  anchors: z.array(Anchor),
  sources: z.array(Source),
});
