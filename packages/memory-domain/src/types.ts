// Memory records from docs/spec/MEMORY-SPEC.md. Each maps to an EAM_MA DATA-SPEC record
// (docs/spec/DATA-SPEC-MAPPING.md) so publishing into the Workbench is a straight mapping.
// Times are ISO 8601 strings: instants in UTC ("2026-10-20T15:00:00Z"), dates as "YYYY-MM-DD".

export type Id = string;
export type Instant = string;
export type LocalDate = string;

/** Record audience, mirroring the Workbench. Restricted records need a principal with restricted access. */
export type AccessScope = 'standard' | 'restricted';

/** DATA-SPEC section 2. Applied per record here and per claim where a record combines sources. */
export type EvidenceClass =
  'documented' | 'field-verified' | 'inferred' | 'illustrative' | 'proposed' | 'unknown';

/** DATA-SPEC section 2. */
export type ReviewState = 'unreviewed' | 'accepted' | 'rejected' | 'superseded';

/** Uncertainty is a described property (DATA-SPEC principle 10): a level plus the reasons, never a score. */
export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface Confidence {
  level: ConfidenceLevel;
  reasons: string;
}

export interface Principal {
  id: Id;
  name: string;
  canSeeRestricted: boolean;
}

/** Fields every memory record carries. */
export interface RecordBase {
  id: Id;
  /** Incremented by each superseding version; an edit names the version it was based on. */
  recordVersion: number;
  accessScope: AccessScope;
  evidenceClass: EvidenceClass;
  reviewState: ReviewState;
  reviewedBy: Id | null;
  reviewedAt: Instant | null;
  /** When the record is true in the world. null means not stated, never "forever". */
  effectiveFrom: Instant | null;
  effectiveTo: Instant | null;
}

export type SourceKind = 'email' | 'work-order' | 'report' | 'photo' | 'csv' | 'note' | 'document';

/** A file or message as it was received (DATA-SPEC 4.1 document, 6.8 communication). */
export interface Source extends RecordBase {
  kind: SourceKind;
  title: string;
  /** Where the source came from, when known; for example a mailbox or CMMS export. */
  originSystem: string | null;
  externalId: string | null;
  siteIds: Id[];
}

/** One immutable version of a source. A replaced file is a new revision; old anchors stay valid. */
export interface Revision extends RecordBase {
  sourceId: Id;
  /** SHA-256 of the bytes; also the object store key. */
  contentHash: string;
  mediaType: string;
  byteLength: number;
  receivedAt: Instant;
  supersedesRevisionId: Id | null;
}

export type Locator =
  | { type: 'page'; page: number; region?: { x: number; y: number; w: number; h: number } }
  | { type: 'span'; start: number; end: number; quote: string }
  | { type: 'row'; row: number; column?: string }
  | { type: 'time'; startSeconds: number; endSeconds: number }
  | { type: 'image-region'; x: number; y: number; w: number; h: number }
  | { type: 'whole' };

/** An exact location in an immutable revision (DATA-SPEC 4.1 anchor). */
export interface Anchor extends RecordBase {
  revisionId: Id;
  locator: Locator;
}

/** One intake batch, so every extraction traces back to how and when it was produced. */
export interface Episode extends RecordBase {
  startedAt: Instant;
  actorId: Id;
  method: { name: string; version: string };
  correlationId: string;
  revisionIds: Id[];
}

export type EntityKind =
  | 'site'
  | 'equipment-unit'
  | 'equipment-model'
  | 'firmware'
  | 'organization'
  | 'person'
  | 'contract'
  | 'region'
  | 'operating-condition';

export interface ExternalRef {
  /** For example "workbench" for EAM_MA record IDs. */
  sourceSystem: string;
  externalId: string;
}

export interface Entity extends RecordBase {
  kind: EntityKind;
  name: string;
  attributes: Record<string, string>;
  externalRefs: ExternalRef[];
}

/** A known name for an entity. Seeded from the owner's lists; fuzzy matches go to review. */
export interface EntityAlias extends RecordBase {
  entityId: Id;
  alias: string;
  origin: 'seed' | 'reviewed' | 'proposed';
}

export type ClaimObject =
  { type: 'entity'; entityId: Id } | { type: 'value'; value: string; unit: string | null };

export type AnchorRole = 'supporting' | 'conflicting' | 'contextual' | 'superseding';

export interface AnchorLink {
  anchorId: Id;
  role: AnchorRole;
}

/**
 * One atomic assertion as a bitemporal edge: subject —relation→ object, valid for a period in the
 * world, recorded at a log position. A claim is superseded or invalidated, never deleted.
 */
export interface Claim extends RecordBase {
  subjectId: Id;
  relation: string;
  object: ClaimObject;
  anchors: AnchorLink[];
  episodeId: Id;
  supersedesClaimId: Id | null;
  /** Set when a later event invalidated the claim; the reason is on that event. */
  invalidatedAt: Instant | null;
}

export type ActionResult = 'succeeded' | 'failed' | 'partial' | 'unknown';

export interface ActionTried {
  description: string;
  result: ActionResult;
  occurredAt: Instant | null;
  claimIds: Id[];
}

/** An investigated issue and what was done about it (DATA-SPEC 5.3 investigation + 6.5 knowledge case). */
export interface Case extends RecordBase {
  title: string;
  symptom: string;
  context: { entityIds: Id[]; conditions: string[] };
  investigation: {
    hypotheses: string[];
    diagnosticActions: string[];
    unresolvedQuestions: string[];
  };
  actionsTried: ActionTried[];
  fix: string | null;
  cost: { amount: number; currency: string } | null;
  downtimeHours: number | null;
  outcome: string | null;
  limitations: string[];
  ownerId: Id;
  claimIds: Id[];
  anchors: AnchorLink[];
  openedAt: Instant;
  closedAt: Instant | null;
}

export type LessonStatus = 'candidate' | 'reviewed' | 'qualified' | 'retired';

/** "Under conditions C, action A led to outcome O", with the cases that support or contradict it. */
export interface Lesson extends RecordBase {
  statement: string;
  conditions: string[];
  action: string;
  expectedOutcome: string;
  supportingCaseIds: Id[];
  counterEvidenceCaseIds: Id[];
  status: LessonStatus;
  ownerId: Id;
}

export type RecordType =
  | 'source'
  | 'revision'
  | 'anchor'
  | 'episode'
  | 'entity'
  | 'entity-alias'
  | 'claim'
  | 'case'
  | 'lesson'
  | 'candidate'
  | 'proposal'
  | 'outcome';

export type CandidateOperation = 'add' | 'update' | 'merge' | 'invalidate';

export type CandidateDecision = 'accepted' | 'rejected';

/** A proposed change to memory (DATA-SPEC 6.8 extraction candidate). Nothing becomes fact without a decision. */
export interface Candidate extends RecordBase {
  operation: CandidateOperation;
  targetType: RecordType;
  /** The record an update, merge or invalidate applies to; null for add. */
  targetId: Id | null;
  /** For merge: the record that would be folded into targetId. */
  mergeSourceId: Id | null;
  /** The proposed record or field changes, validated by the contract for targetType. */
  payload: unknown;
  method: { name: string; version: string };
  uncertainty: Confidence;
  episodeId: Id;
  decision: {
    decision: CandidateDecision;
    by: Id;
    at: Instant;
    reason: string;
    resultingId: Id | null;
  } | null;
}

export type ProposalStage =
  'assessment' | 'review-1' | 'draft' | 'review-2' | 'published' | 'returned' | 'rejected';

export interface Assessment {
  similarCaseIds: Id[];
  keyDifferences: string[];
  evidenceGaps: string[];
  nextSteps: string[];
  causeConfidence: Confidence;
  nextStepConfidence: Confidence;
}

export interface ProposalDraft {
  scope: string;
  ownerIds: Id[];
  targetDates: { label: string; date: LocalDate }[];
  dependencies: string[];
  /** Where each cost figure comes from; a number without a basis is not stored. */
  costBasis: { description: string; amount: number; currency: string; anchorId: Id }[];
  successCriteria: string[];
  anchors: AnchorLink[];
}

/** Assessment → review 1 → draft → review 2 → published (DATA-SPEC 6.5 decision). */
export interface Proposal extends RecordBase {
  caseId: Id;
  stage: ProposalStage;
  assessment: Assessment;
  /** Prepared only after review 1 approves. */
  draft: ProposalDraft | null;
  publishedAt: Instant | null;
  /** The Workbench log position the publication was recorded at. */
  workbenchLogPosition: number | null;
}

/** What actually happened after a published proposal; the test of the lessons it names. */
export interface Outcome extends RecordBase {
  proposalId: Id;
  description: string;
  result: ActionResult;
  lessonIds: Id[];
  recordedBy: Id;
  occurredAt: Instant;
  anchors: AnchorLink[];
}

export type MemoryRecord =
  | Source
  | Revision
  | Anchor
  | Episode
  | Entity
  | EntityAlias
  | Claim
  | Case
  | Lesson
  | Candidate
  | Proposal
  | Outcome;

export interface RecordByType {
  source: Source;
  revision: Revision;
  anchor: Anchor;
  episode: Episode;
  entity: Entity;
  'entity-alias': EntityAlias;
  claim: Claim;
  case: Case;
  lesson: Lesson;
  candidate: Candidate;
  proposal: Proposal;
  outcome: Outcome;
}

/** Current memory state as projected from the log. */
export interface MemoryDataset {
  label: string;
  sources: Source[];
  revisions: Revision[];
  anchors: Anchor[];
  episodes: Episode[];
  entities: Entity[];
  aliases: EntityAlias[];
  claims: Claim[];
  cases: Case[];
  lessons: Lesson[];
  candidates: Candidate[];
  proposals: Proposal[];
  outcomes: Outcome[];
}
