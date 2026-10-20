import type {
  Candidate,
  CandidateDecision,
  Claim,
  Id,
  Instant,
  LessonStatus,
  MemoryDataset,
  MemoryRecord,
  Proposal,
  RecordByType,
  RecordType,
} from './types';

// The append-only change log (MEMORY-SPEC section 4; the same shape as EAM_MA DATA-SPEC 1a).
// Events are only ever appended; every table in the store is a projection of this log. Milestone
// M0 keeps the log in memory and in PostgreSQL with identical semantics.

type RecordAdded = {
  [K in RecordType]: { type: 'record-added'; recordType: K; record: RecordByType[K] };
}[RecordType];

type RecordSuperseded = {
  [K in RecordType]: {
    type: 'record-superseded';
    recordType: K;
    record: RecordByType[K];
    /** The version the edit was based on; a mismatch is a conflict, not an overwrite. */
    basedOnVersion: number;
    reason: string;
  };
}[RecordType];

export type ReviewGate = 1 | 2;
export type ReviewDecision = 'approve' | 'revise' | 'reject';

export type MemoryEvent =
  | RecordAdded
  | RecordSuperseded
  | {
      type: 'claim-invalidated';
      claimId: Id;
      invalidatedAt: Instant;
      reason: string;
      supersededByClaimId: Id | null;
    }
  | { type: 'claim-auto-accepted'; claimId: Id; rule: string }
  | {
      type: 'candidate-decided';
      candidateId: Id;
      decision: CandidateDecision;
      reason: string;
      resultingId: Id | null;
    }
  | {
      type: 'review-recorded';
      proposalId: Id;
      gate: ReviewGate;
      decision: ReviewDecision;
      notes: string;
    }
  | {
      type: 'proposal-published';
      proposalId: Id;
      publishedAt: Instant;
      workbenchLogPosition: number | null;
    }
  | { type: 'entities-merged'; survivorId: Id; mergedId: Id; reason: string }
  | { type: 'lesson-status-changed'; lessonId: Id; status: LessonStatus; reason: string };

export const EVENT_TYPES: ReadonlySet<string> = new Set([
  'record-added',
  'record-superseded',
  'claim-invalidated',
  'claim-auto-accepted',
  'candidate-decided',
  'review-recorded',
  'proposal-published',
  'entities-merged',
  'lesson-status-changed',
]);

export const RECORD_TYPES: readonly RecordType[] = [
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
];

/** Actor ID recorded on acceptances made by the auto-accept rule rather than a person. */
export const AUTO_ACCEPT_ACTOR: Id = 'system:auto-accept';

export interface LoggedEvent {
  /** 1-based position in the log; a position is a consistent version boundary. */
  position: number;
  /** When the memory learned it. */
  recordedAt: Instant;
  /** When it is true in the world; defaults to recordedAt when the event does not say. */
  effectiveAt: Instant;
  actorId: Id;
  /** Groups the events of one intake batch or one review session. */
  correlationId: string | null;
  event: MemoryEvent;
}

export interface EventLog {
  schemaVersion: 1;
  events: LoggedEvent[];
}

export const EMPTY_LOG: EventLog = { schemaVersion: 1, events: [] };

export interface AppendOptions {
  effectiveAt?: Instant;
  correlationId?: string;
}

export function appendEvent(
  log: EventLog,
  event: MemoryEvent,
  actorId: Id,
  recordedAt: Instant,
  options: AppendOptions = {},
): EventLog {
  return {
    ...log,
    events: [
      ...log.events,
      {
        position: log.events.length + 1,
        recordedAt,
        effectiveAt: options.effectiveAt ?? recordedAt,
        actorId,
        correlationId: options.correlationId ?? null,
        event,
      },
    ],
  };
}

export class VersionConflictError extends Error {
  constructor(
    readonly recordType: RecordType,
    readonly recordId: Id,
    readonly basedOnVersion: number,
    readonly currentVersion: number,
  ) {
    super(
      `${recordType} ${recordId}: edit based on version ${basedOnVersion}, current is ${currentVersion}`,
    );
    this.name = 'VersionConflictError';
  }
}

/**
 * Appends a superseding version of a record, refusing an edit that was not based on the current
 * version (DATA-SPEC 1a record versions). The new record's version is assigned here.
 */
export function supersedeRecord<K extends RecordType>(
  log: EventLog,
  recordType: K,
  record: RecordByType[K],
  basedOnVersion: number,
  reason: string,
  actorId: Id,
  recordedAt: Instant,
  options: AppendOptions = {},
): EventLog {
  const current = findRecord(projectMemory(log), recordType, record.id);
  const currentVersion = current?.recordVersion ?? 0;
  if (currentVersion !== basedOnVersion) {
    throw new VersionConflictError(recordType, record.id, basedOnVersion, currentVersion);
  }
  const next = { ...record, recordVersion: basedOnVersion + 1 } as RecordByType[K];
  const event = {
    type: 'record-superseded',
    recordType,
    record: next,
    basedOnVersion,
    reason,
  } as RecordSuperseded;
  return appendEvent(log, event, actorId, recordedAt, options);
}

export const EMPTY_DATASET: MemoryDataset = {
  label: '',
  sources: [],
  revisions: [],
  anchors: [],
  episodes: [],
  entities: [],
  aliases: [],
  claims: [],
  cases: [],
  lessons: [],
  candidates: [],
  proposals: [],
  outcomes: [],
};

type CollectionKey = Exclude<keyof MemoryDataset, 'label'>;

const COLLECTION: Record<RecordType, CollectionKey> = {
  source: 'sources',
  revision: 'revisions',
  anchor: 'anchors',
  episode: 'episodes',
  entity: 'entities',
  'entity-alias': 'aliases',
  claim: 'claims',
  case: 'cases',
  lesson: 'lessons',
  candidate: 'candidates',
  proposal: 'proposals',
  outcome: 'outcomes',
};

export function collectionOf<K extends RecordType>(
  dataset: MemoryDataset,
  recordType: K,
): RecordByType[K][] {
  return dataset[COLLECTION[recordType]] as RecordByType[K][];
}

export function findRecord<K extends RecordType>(
  dataset: MemoryDataset,
  recordType: K,
  id: Id,
): RecordByType[K] | undefined {
  return collectionOf(dataset, recordType).find((r) => r.id === id);
}

export interface ProjectionOptions {
  /** Replay the log only up to this position (inclusive). */
  asOfPosition?: number;
  /** Replay only events recorded at or before this instant. */
  asOfRecordedAt?: Instant;
  label?: string;
}

function upsert(rows: MemoryRecord[], record: MemoryRecord): MemoryRecord[] {
  const i = rows.findIndex((r) => r.id === record.id);
  if (i < 0) return [...rows, record];
  return rows.map((r, j) => (j === i ? record : r));
}

function patch<T extends MemoryRecord>(rows: T[], id: Id, change: (row: T) => T): T[] {
  return rows.map((r) => (r.id === id ? change(r) : r));
}

/** Current memory state as of a log position or recorded time (the whole log by default). */
export function projectMemory(log: EventLog, options: ProjectionOptions = {}): MemoryDataset {
  let d: MemoryDataset = { ...EMPTY_DATASET, label: options.label ?? '' };
  const maxPosition = options.asOfPosition ?? Infinity;
  for (const logged of log.events) {
    if (logged.position > maxPosition) break;
    if (options.asOfRecordedAt !== undefined && logged.recordedAt > options.asOfRecordedAt) break;
    d = applyEvent(d, logged);
  }
  return d;
}

function applyEvent(d: MemoryDataset, logged: LoggedEvent): MemoryDataset {
  const { event, recordedAt, actorId } = logged;
  switch (event.type) {
    case 'record-added':
    case 'record-superseded': {
      const key = COLLECTION[event.recordType];
      return { ...d, [key]: upsert(d[key], event.record) };
    }
    case 'claim-invalidated':
      return {
        ...d,
        claims: patch<Claim>(d.claims, event.claimId, (c) => ({
          ...c,
          invalidatedAt: event.invalidatedAt,
          effectiveTo: c.effectiveTo ?? event.invalidatedAt,
          reviewState: 'superseded',
        })),
      };
    case 'claim-auto-accepted':
      return {
        ...d,
        claims: patch<Claim>(d.claims, event.claimId, (c) => ({
          ...c,
          reviewState: 'accepted',
          reviewedBy: AUTO_ACCEPT_ACTOR,
          reviewedAt: recordedAt,
        })),
      };
    case 'candidate-decided':
      return {
        ...d,
        candidates: patch<Candidate>(d.candidates, event.candidateId, (c) => ({
          ...c,
          reviewState: event.decision,
          reviewedBy: actorId,
          reviewedAt: recordedAt,
          decision: {
            decision: event.decision,
            by: actorId,
            at: recordedAt,
            reason: event.reason,
            resultingId: event.resultingId,
          },
        })),
      };
    case 'review-recorded':
      return {
        ...d,
        proposals: patch<Proposal>(d.proposals, event.proposalId, (p) =>
          applyReview(p, event.gate, event.decision, actorId, recordedAt),
        ),
      };
    case 'proposal-published':
      return {
        ...d,
        proposals: patch<Proposal>(d.proposals, event.proposalId, (p) => ({
          ...p,
          stage: 'published',
          publishedAt: event.publishedAt,
          workbenchLogPosition: event.workbenchLogPosition,
        })),
      };
    case 'entities-merged':
      return mergeEntities(d, event.survivorId, event.mergedId, actorId, recordedAt);
    case 'lesson-status-changed':
      return {
        ...d,
        lessons: patch(d.lessons, event.lessonId, (l) => ({
          ...l,
          status: event.status,
          reviewedBy: actorId,
          reviewedAt: recordedAt,
        })),
      };
  }
}

/**
 * Review 1 approves the assessment so a draft may be prepared; review 2 accepts the draft so it may
 * be published. "Revise" returns the proposal for more work at either gate; "reject" ends it.
 */
function applyReview(
  p: Proposal,
  gate: ReviewGate,
  decision: ReviewDecision,
  by: Id,
  at: Instant,
): Proposal {
  const reviewed = { ...p, reviewedBy: by, reviewedAt: at };
  if (decision === 'reject') return { ...reviewed, stage: 'rejected', reviewState: 'rejected' };
  if (decision === 'revise') return { ...reviewed, stage: 'returned' };
  if (gate === 1) return { ...reviewed, stage: 'draft' };
  return { ...reviewed, stage: 'review-2', reviewState: 'accepted' };
}

function mergeEntities(
  d: MemoryDataset,
  survivorId: Id,
  mergedId: Id,
  actorId: Id,
  recordedAt: Instant,
): MemoryDataset {
  const merged = d.entities.find((e) => e.id === mergedId);
  const survivor = d.entities.find((e) => e.id === survivorId);
  if (!merged || !survivor || survivorId === mergedId) return d;
  const remap = (id: Id) => (id === mergedId ? survivorId : id);
  const aliasFromName = {
    ...merged,
    id: `${mergedId}:alias`,
    recordVersion: 1,
    reviewState: 'accepted' as const,
    reviewedBy: actorId,
    reviewedAt: recordedAt,
    entityId: survivorId,
    alias: merged.name,
    origin: 'reviewed' as const,
  };
  return {
    ...d,
    entities: d.entities.map((e) =>
      e.id === mergedId
        ? { ...e, reviewState: 'superseded', reviewedBy: actorId, reviewedAt: recordedAt }
        : e.id === survivorId
          ? { ...e, externalRefs: dedupeRefs([...e.externalRefs, ...merged.externalRefs]) }
          : e,
    ),
    aliases: [
      ...d.aliases.map((a) => (a.entityId === mergedId ? { ...a, entityId: survivorId } : a)),
      {
        id: aliasFromName.id,
        recordVersion: 1,
        accessScope: merged.accessScope,
        evidenceClass: merged.evidenceClass,
        reviewState: 'accepted',
        reviewedBy: actorId,
        reviewedAt: recordedAt,
        effectiveFrom: null,
        effectiveTo: null,
        entityId: survivorId,
        alias: merged.name,
        origin: 'reviewed',
      },
    ],
    claims: d.claims.map((c) => ({
      ...c,
      subjectId: remap(c.subjectId),
      object:
        c.object.type === 'entity' ? { ...c.object, entityId: remap(c.object.entityId) } : c.object,
    })),
    cases: d.cases.map((c) => ({
      ...c,
      context: { ...c.context, entityIds: [...new Set(c.context.entityIds.map(remap))] },
    })),
  };
}

function dedupeRefs<T extends { sourceSystem: string; externalId: string }>(refs: T[]): T[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.sourceSystem}\u0000${r.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Claims whose effective window covers the instant and that were not invalidated before it. */
export function claimsValidAt(claims: Claim[], instant: Instant): Claim[] {
  return claims.filter(
    (c) =>
      (c.effectiveFrom === null || c.effectiveFrom <= instant) &&
      (c.effectiveTo === null || c.effectiveTo > instant) &&
      (c.invalidatedAt === null || c.invalidatedAt > instant) &&
      c.reviewState !== 'rejected',
  );
}

function windowsOverlap(a: Claim, b: Claim): boolean {
  const aFrom = a.effectiveFrom ?? '';
  const bFrom = b.effectiveFrom ?? '';
  const aTo = a.effectiveTo ?? '￿';
  const bTo = b.effectiveTo ?? '￿';
  return aFrom < bTo && bFrom < aTo;
}

function sameObject(a: Claim, b: Claim): boolean {
  if (a.object.type !== b.object.type) return false;
  if (a.object.type === 'entity' && b.object.type === 'entity') {
    return a.object.entityId === b.object.entityId;
  }
  if (a.object.type === 'value' && b.object.type === 'value') {
    return a.object.value === b.object.value && a.object.unit === b.object.unit;
  }
  return false;
}

/**
 * Live claims that assert a different object for the same subject and relation over an
 * overlapping effective window. A conflict is reported, never resolved silently.
 */
export function conflictingClaims(claim: Claim, claims: Claim[]): Claim[] {
  return claims.filter(
    (other) =>
      other.id !== claim.id &&
      other.subjectId === claim.subjectId &&
      other.relation === claim.relation &&
      other.invalidatedAt === null &&
      other.reviewState !== 'rejected' &&
      other.reviewState !== 'superseded' &&
      !sameObject(other, claim) &&
      windowsOverlap(other, claim),
  );
}

/**
 * Reads a stored log. Returns null for anything that is not a well-formed log, including a log
 * whose positions are not consecutive from 1, so a damaged log is never partly replayed.
 */
export function parseLog(value: unknown): EventLog | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<EventLog>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.events)) return null;
  const valid = candidate.events.every(
    (e, i) =>
      typeof e === 'object' &&
      e !== null &&
      e.position === i + 1 &&
      typeof e.recordedAt === 'string' &&
      typeof e.effectiveAt === 'string' &&
      typeof e.actorId === 'string' &&
      (e.correlationId === null || typeof e.correlationId === 'string') &&
      typeof e.event === 'object' &&
      e.event !== null &&
      EVENT_TYPES.has(e.event.type) &&
      (!('recordType' in e.event) || RECORD_TYPES.includes(e.event.recordType)),
  );
  return valid ? (candidate as EventLog) : null;
}
