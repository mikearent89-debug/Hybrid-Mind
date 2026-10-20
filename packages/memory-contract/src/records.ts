import type * as D from '@hybrid/memory-domain';
import { z } from 'zod';

// Schemas for every memory record. Each `satisfies z.ZodType<...>` keeps the schema and the domain
// type in step: a field added to the type without a schema change fails to typecheck.

export const Id = z.string().min(1);
export const Instant = z.iso.datetime({ offset: true });
export const LocalDate = z.iso.date();

export const AccessScope = z.enum(['standard', 'restricted']);
export const EvidenceClass = z.enum([
  'documented',
  'field-verified',
  'inferred',
  'illustrative',
  'proposed',
  'unknown',
]);
export const ReviewState = z.enum(['unreviewed', 'accepted', 'rejected', 'superseded']);
export const ConfidenceLevel = z.enum(['low', 'medium', 'high']);
export const Confidence = z.object({ level: ConfidenceLevel, reasons: z.string() });

export const RecordBase = z.object({
  id: Id,
  recordVersion: z.int().min(1),
  accessScope: AccessScope,
  evidenceClass: EvidenceClass,
  reviewState: ReviewState,
  reviewedBy: Id.nullable(),
  reviewedAt: Instant.nullable(),
  effectiveFrom: Instant.nullable(),
  effectiveTo: Instant.nullable(),
});

export const SourceKind = z.enum([
  'email',
  'work-order',
  'report',
  'photo',
  'csv',
  'note',
  'document',
]);

export const Source = RecordBase.extend({
  kind: SourceKind,
  title: z.string(),
  originSystem: z.string().nullable(),
  externalId: z.string().nullable(),
  siteIds: z.array(Id),
}) satisfies z.ZodType<D.Source>;

export const Revision = RecordBase.extend({
  sourceId: Id,
  contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  mediaType: z.string(),
  byteLength: z.int().min(0),
  receivedAt: Instant,
  supersedesRevisionId: Id.nullable(),
}) satisfies z.ZodType<D.Revision>;

const Region = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const Locator = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page'), page: z.int().min(1), region: Region.optional() }),
  z.object({
    type: z.literal('span'),
    start: z.int().min(0),
    end: z.int().min(0),
    quote: z.string(),
  }),
  z.object({ type: z.literal('row'), row: z.int().min(0), column: z.string().optional() }),
  z.object({
    type: z.literal('time'),
    startSeconds: z.number().min(0),
    endSeconds: z.number().min(0),
  }),
  z.object({ type: z.literal('image-region'), ...Region.shape }),
  z.object({ type: z.literal('whole') }),
]);

export const Anchor = RecordBase.extend({
  revisionId: Id,
  locator: Locator,
}) satisfies z.ZodType<D.Anchor>;

export const Method = z.object({ name: z.string(), version: z.string() });

export const Episode = RecordBase.extend({
  startedAt: Instant,
  actorId: Id,
  method: Method,
  correlationId: z.string(),
  revisionIds: z.array(Id),
}) satisfies z.ZodType<D.Episode>;

export const EntityKind = z.enum([
  'site',
  'equipment-unit',
  'equipment-model',
  'firmware',
  'organization',
  'person',
  'contract',
  'region',
  'operating-condition',
]);

export const ExternalRef = z.object({ sourceSystem: z.string(), externalId: z.string() });

export const Entity = RecordBase.extend({
  kind: EntityKind,
  name: z.string(),
  attributes: z.record(z.string(), z.string()),
  externalRefs: z.array(ExternalRef),
}) satisfies z.ZodType<D.Entity>;

export const EntityAlias = RecordBase.extend({
  entityId: Id,
  alias: z.string(),
  origin: z.enum(['seed', 'reviewed', 'proposed']),
}) satisfies z.ZodType<D.EntityAlias>;

export const ClaimObject = z.discriminatedUnion('type', [
  z.object({ type: z.literal('entity'), entityId: Id }),
  z.object({ type: z.literal('value'), value: z.string(), unit: z.string().nullable() }),
]);

export const AnchorRole = z.enum(['supporting', 'conflicting', 'contextual', 'superseding']);
export const AnchorLink = z.object({ anchorId: Id, role: AnchorRole });

export const Claim = RecordBase.extend({
  subjectId: Id,
  relation: z.string(),
  object: ClaimObject,
  anchors: z.array(AnchorLink),
  episodeId: Id,
  supersedesClaimId: Id.nullable(),
  invalidatedAt: Instant.nullable(),
}) satisfies z.ZodType<D.Claim>;

export const ActionResult = z.enum(['succeeded', 'failed', 'partial', 'unknown']);

export const ActionTried = z.object({
  description: z.string(),
  result: ActionResult,
  occurredAt: Instant.nullable(),
  claimIds: z.array(Id),
});

export const Case = RecordBase.extend({
  title: z.string(),
  symptom: z.string(),
  context: z.object({ entityIds: z.array(Id), conditions: z.array(z.string()) }),
  investigation: z.object({
    hypotheses: z.array(z.string()),
    diagnosticActions: z.array(z.string()),
    unresolvedQuestions: z.array(z.string()),
  }),
  actionsTried: z.array(ActionTried),
  fix: z.string().nullable(),
  cost: z.object({ amount: z.number(), currency: z.string().length(3) }).nullable(),
  downtimeHours: z.number().min(0).nullable(),
  outcome: z.string().nullable(),
  limitations: z.array(z.string()),
  ownerId: Id,
  claimIds: z.array(Id),
  anchors: z.array(AnchorLink),
  openedAt: Instant,
  closedAt: Instant.nullable(),
}) satisfies z.ZodType<D.Case>;

export const LessonStatus = z.enum(['candidate', 'reviewed', 'qualified', 'retired']);

export const Lesson = RecordBase.extend({
  statement: z.string(),
  conditions: z.array(z.string()),
  action: z.string(),
  expectedOutcome: z.string(),
  supportingCaseIds: z.array(Id),
  counterEvidenceCaseIds: z.array(Id),
  status: LessonStatus,
  ownerId: Id,
}) satisfies z.ZodType<D.Lesson>;

export const RecordType = z.enum([
  'source',
  'revision',
  'anchor',
  'episode',
  'entity',
  'entity-alias',
  'claim',
  'case',
  'lesson',
  'candidate',
  'proposal',
  'outcome',
]);

export const CandidateOperation = z.enum(['add', 'update', 'merge', 'invalidate']);
export const CandidateDecision = z.enum(['accepted', 'rejected']);

export const Candidate = RecordBase.extend({
  operation: CandidateOperation,
  targetType: RecordType,
  targetId: Id.nullable(),
  mergeSourceId: Id.nullable(),
  payload: z.unknown(),
  method: Method,
  uncertainty: Confidence,
  episodeId: Id,
  decision: z
    .object({
      decision: CandidateDecision,
      by: Id,
      at: Instant,
      reason: z.string(),
      resultingId: Id.nullable(),
    })
    .nullable(),
}) satisfies z.ZodType<D.Candidate>;

export const ProposalStage = z.enum([
  'assessment',
  'review-1',
  'draft',
  'review-2',
  'published',
  'returned',
  'rejected',
]);

export const Assessment = z.object({
  similarCaseIds: z.array(Id),
  keyDifferences: z.array(z.string()),
  evidenceGaps: z.array(z.string()),
  nextSteps: z.array(z.string()),
  causeConfidence: Confidence,
  nextStepConfidence: Confidence,
});

export const ProposalDraft = z.object({
  scope: z.string(),
  ownerIds: z.array(Id),
  targetDates: z.array(z.object({ label: z.string(), date: LocalDate })),
  dependencies: z.array(z.string()),
  costBasis: z.array(
    z.object({
      description: z.string(),
      amount: z.number(),
      currency: z.string().length(3),
      anchorId: Id,
    }),
  ),
  successCriteria: z.array(z.string()),
  anchors: z.array(AnchorLink),
});

export const Proposal = RecordBase.extend({
  caseId: Id,
  stage: ProposalStage,
  assessment: Assessment,
  draft: ProposalDraft.nullable(),
  publishedAt: Instant.nullable(),
  workbenchLogPosition: z.int().min(1).nullable(),
}) satisfies z.ZodType<D.Proposal>;

export const Outcome = RecordBase.extend({
  proposalId: Id,
  description: z.string(),
  result: ActionResult,
  lessonIds: z.array(Id),
  recordedBy: Id,
  occurredAt: Instant,
  anchors: z.array(AnchorLink),
}) satisfies z.ZodType<D.Outcome>;

export const RECORD_SCHEMAS = {
  source: Source,
  revision: Revision,
  anchor: Anchor,
  episode: Episode,
  entity: Entity,
  'entity-alias': EntityAlias,
  claim: Claim,
  case: Case,
  lesson: Lesson,
  candidate: Candidate,
  proposal: Proposal,
  outcome: Outcome,
} as const;

export const MemoryDataset = z.object({
  label: z.string(),
  sources: z.array(Source),
  revisions: z.array(Revision),
  anchors: z.array(Anchor),
  episodes: z.array(Episode),
  entities: z.array(Entity),
  aliases: z.array(EntityAlias),
  claims: z.array(Claim),
  cases: z.array(Case),
  lessons: z.array(Lesson),
  candidates: z.array(Candidate),
  proposals: z.array(Proposal),
  outcomes: z.array(Outcome),
}) satisfies z.ZodType<D.MemoryDataset>;
