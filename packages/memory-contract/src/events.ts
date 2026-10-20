import type * as D from '@hybrid/memory-domain';
import { z } from 'zod';
import {
  Id,
  Instant,
  LessonStatus,
  CandidateDecision,
  RECORD_SCHEMAS,
  RecordType,
} from './records';

const added = <K extends keyof typeof RECORD_SCHEMAS>(recordType: K) =>
  z.object({
    type: z.literal('record-added'),
    recordType: z.literal(recordType),
    record: RECORD_SCHEMAS[recordType],
  });

const superseded = <K extends keyof typeof RECORD_SCHEMAS>(recordType: K) =>
  z.object({
    type: z.literal('record-superseded'),
    recordType: z.literal(recordType),
    record: RECORD_SCHEMAS[recordType],
    basedOnVersion: z.int().min(0),
    reason: z.string(),
  });

export const MemoryEvent = z.union([
  added('source'),
  added('revision'),
  added('anchor'),
  added('episode'),
  added('entity'),
  added('entity-alias'),
  added('claim'),
  added('case'),
  added('lesson'),
  added('candidate'),
  added('proposal'),
  added('outcome'),
  superseded('source'),
  superseded('revision'),
  superseded('anchor'),
  superseded('episode'),
  superseded('entity'),
  superseded('entity-alias'),
  superseded('claim'),
  superseded('case'),
  superseded('lesson'),
  superseded('candidate'),
  superseded('proposal'),
  superseded('outcome'),
  z.object({
    type: z.literal('claim-invalidated'),
    claimId: Id,
    invalidatedAt: Instant,
    reason: z.string(),
    supersededByClaimId: Id.nullable(),
  }),
  z.object({ type: z.literal('claim-auto-accepted'), claimId: Id, rule: z.string() }),
  z.object({
    type: z.literal('candidate-decided'),
    candidateId: Id,
    decision: CandidateDecision,
    reason: z.string(),
    resultingId: Id.nullable(),
  }),
  z.object({
    type: z.literal('review-recorded'),
    proposalId: Id,
    gate: z.union([z.literal(1), z.literal(2)]),
    decision: z.enum(['approve', 'revise', 'reject']),
    notes: z.string(),
  }),
  z.object({
    type: z.literal('proposal-published'),
    proposalId: Id,
    publishedAt: Instant,
    workbenchLogPosition: z.int().min(1).nullable(),
  }),
  z.object({
    type: z.literal('entities-merged'),
    survivorId: Id,
    mergedId: Id,
    reason: z.string(),
  }),
  z.object({
    type: z.literal('lesson-status-changed'),
    lessonId: Id,
    status: LessonStatus,
    reason: z.string(),
  }),
]) satisfies z.ZodType<D.MemoryEvent>;

export const LoggedEvent = z.object({
  position: z.int().min(1),
  recordedAt: Instant,
  effectiveAt: Instant,
  actorId: Id,
  correlationId: z.string().nullable(),
  event: MemoryEvent,
}) satisfies z.ZodType<D.LoggedEvent>;

export const EventLog = z.object({
  schemaVersion: z.literal(1),
  events: z.array(LoggedEvent),
}) satisfies z.ZodType<D.EventLog>;

export { RecordType };
