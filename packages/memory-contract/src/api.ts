import { z } from 'zod';
import { MemoryEvent } from './events';
import { Candidate, Episode, Id, Instant, Locator } from './records';

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

/** What the worker hands back from one extraction run: the episode and the candidates it produced. */
export const SubmitCandidatesRequest = z.object({
  episode: Episode,
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
