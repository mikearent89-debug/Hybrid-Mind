import { describe, expect, it } from 'vitest';
import { AVERY, FIXTURE, FIXTURE_IDS, FIXTURE_LOG, JORDAN } from './fixture';
import {
  AUTO_ACCEPT_ACTOR,
  EMPTY_LOG,
  VersionConflictError,
  appendEvent,
  claimsValidAt,
  conflictingClaims,
  findRecord,
  parseLog,
  projectMemory,
  supersedeRecord,
} from './store';
import type { Case } from './types';

const at = (minute: number) => `2026-10-20T15:${String(minute).padStart(2, '0')}:00Z`;

describe('append-only event log', () => {
  it('numbers events consecutively and never changes earlier ones', () => {
    const positions = FIXTURE_LOG.events.map((e) => e.position);
    expect(positions).toEqual(positions.map((_, i) => i + 1));
    const longer = appendEvent(FIXTURE_LOG, FIXTURE_LOG.events[0]!.event, AVERY, at(1));
    expect(longer.events.slice(0, FIXTURE_LOG.events.length)).toEqual(FIXTURE_LOG.events);
    expect(longer.events.at(-1)?.position).toBe(FIXTURE_LOG.events.length + 1);
  });

  it('records effective and recorded time separately (bitemporal)', () => {
    const log = appendEvent(
      EMPTY_LOG,
      { type: 'lesson-status-changed', lessonId: 'lesson-01', status: 'retired', reason: 'x' },
      AVERY,
      at(5),
      { effectiveAt: at(1), correlationId: 'c-1' },
    );
    expect(log.events[0]).toMatchObject({
      position: 1,
      recordedAt: at(5),
      effectiveAt: at(1),
      correlationId: 'c-1',
      actorId: AVERY,
    });
  });

  it('projects the state at an earlier log position', () => {
    const firstEntityOnly = projectMemory(FIXTURE_LOG, { asOfPosition: 1 });
    expect(firstEntityOnly.entities).toHaveLength(1);
    expect(firstEntityOnly.claims).toEqual([]);
    const beforeInvalidation = projectMemory(FIXTURE_LOG, {
      asOfRecordedAt: '2026-09-24T00:00:00Z',
    });
    expect(findRecord(beforeInvalidation, 'claim', 'cl-01')?.invalidatedAt).toBeNull();
    expect(findRecord(FIXTURE, 'claim', 'cl-01')?.invalidatedAt).not.toBeNull();
  });

  it('refuses a superseding edit that was not based on the current version (record_version)', () => {
    const current = findRecord(FIXTURE, 'case', 'case-09')!;
    const edited: Case = { ...current, fix: 'Replaced the radio' };
    const next = supersedeRecord(FIXTURE_LOG, 'case', edited, 1, 'fix recorded', JORDAN, at(2));
    expect(findRecord(projectMemory(next), 'case', 'case-09')).toMatchObject({
      fix: 'Replaced the radio',
      recordVersion: 2,
    });
    expect(() => supersedeRecord(next, 'case', edited, 1, 'stale edit', JORDAN, at(3))).toThrow(
      VersionConflictError,
    );
  });

  it('keeps the prior version visible at the earlier position after a supersede', () => {
    const prop = findRecord(FIXTURE, 'proposal', 'prop-01')!;
    expect(prop.recordVersion).toBe(2);
    expect(prop.draft).not.toBeNull();
    const supersedePosition = FIXTURE_LOG.events.find(
      (e) => e.event.type === 'record-superseded' && e.event.record.id === 'prop-01',
    )!.position;
    const before = projectMemory(FIXTURE_LOG, { asOfPosition: supersedePosition - 1 });
    expect(findRecord(before, 'proposal', 'prop-01')).toMatchObject({
      recordVersion: 1,
      draft: null,
    });
  });
});

describe('event projections', () => {
  it('invalidates a claim without deleting it (FX-M07)', () => {
    const old = findRecord(FIXTURE, 'claim', 'cl-01')!;
    expect(old).toMatchObject({ reviewState: 'superseded', effectiveTo: '2026-09-09T15:00:00Z' });
    expect(claimsValidAt(FIXTURE.claims, '2026-09-05T00:00:00Z').map((c) => c.id)).toContain(
      'cl-01',
    );
    const now = claimsValidAt(FIXTURE.claims, '2026-10-01T00:00:00Z').map((c) => c.id);
    expect(now).not.toContain('cl-01');
    expect(now).toContain('cl-02');
  });

  it('marks an auto-accepted claim with the system actor (FX-M04)', () => {
    expect(findRecord(FIXTURE, 'claim', 'cl-06')).toMatchObject({
      reviewState: 'accepted',
      reviewedBy: AUTO_ACCEPT_ACTOR,
    });
  });

  it('reports a conflict instead of choosing (FX-M02)', () => {
    const disputed = findRecord(FIXTURE, 'claim', 'cl-05')!;
    expect(conflictingClaims(disputed, FIXTURE.claims).map((c) => c.id)).toEqual(['cl-04']);
    expect(conflictingClaims(findRecord(FIXTURE, 'claim', 'cl-02')!, FIXTURE.claims)).toEqual([]);
  });

  it('moves a proposal through both gates to published (FX-M09)', () => {
    const published = findRecord(FIXTURE, 'proposal', 'prop-01')!;
    expect(published).toMatchObject({ stage: 'published', reviewState: 'accepted' });
    expect(published.publishedAt).toBe('2026-09-30T16:00:00Z');
    const outcome = findRecord(FIXTURE, 'outcome', 'out-01')!;
    expect(outcome.proposalId).toBe('prop-01');
    expect(findRecord(FIXTURE, 'lesson', 'lesson-01')?.status).toBe('qualified');
  });

  it('records a candidate decision with reviewer and time (FX-M05)', () => {
    expect(findRecord(FIXTURE, 'candidate', 'cand-02')?.decision).toMatchObject({
      decision: 'accepted',
      by: AVERY,
      resultingId: 'cl-07',
    });
    expect(findRecord(FIXTURE, 'candidate', 'cand-01')?.decision).toBeNull();
  });

  it('merges a duplicate entity into its survivor and keeps its name as an alias (FX-M10)', () => {
    const merged = findRecord(FIXTURE, 'entity', FIXTURE_IDS.ORG_GRIDLINE_DUP)!;
    expect(merged.reviewState).toBe('superseded');
    const claim = findRecord(FIXTURE, 'claim', 'cl-13')!;
    expect(claim.object).toEqual({ type: 'entity', entityId: FIXTURE_IDS.ORG_GRIDLINE });
    expect(
      FIXTURE.aliases.some(
        (a) => a.entityId === FIXTURE_IDS.ORG_GRIDLINE && a.alias === 'Gridline Services LLC',
      ),
    ).toBe(true);
    expect(findRecord(FIXTURE, 'case', 'case-03')?.context.entityIds).toContain(
      FIXTURE_IDS.ORG_GRIDLINE,
    );
  });

  it('round-trips through JSON and rejects damaged logs', () => {
    expect(parseLog(JSON.parse(JSON.stringify(FIXTURE_LOG)))).toEqual(FIXTURE_LOG);
    expect(parseLog(null)).toBeNull();
    expect(parseLog({ schemaVersion: 2, events: [] })).toBeNull();
    const skipped = { ...FIXTURE_LOG, events: FIXTURE_LOG.events.slice(1) };
    expect(parseLog(skipped)).toBeNull();
    const unknownType = {
      ...FIXTURE_LOG,
      events: [{ ...FIXTURE_LOG.events[0]!, event: { type: 'record-deleted' } }],
    };
    expect(parseLog(unknownType)).toBeNull();
  });
});
