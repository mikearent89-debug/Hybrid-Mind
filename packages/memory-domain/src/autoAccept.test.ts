import { describe, expect, it } from 'vitest';
import { autoAcceptable } from './autoAccept';
import { FIXTURE, FIXTURE_LOG } from './fixture';
import { findRecord, projectMemory } from './store';
import type { Claim } from './types';

// The rule is applied to claims as they arrive, so test against the state before any acceptance.
const acceptedPosition = FIXTURE_LOG.events.find(
  (e) => e.event.type === 'claim-auto-accepted',
)!.position;
const before = projectMemory(FIXTURE_LOG, { asOfPosition: acceptedPosition - 1 });
const fresh = (id: string): Claim => findRecord(before, 'claim', id)!;

describe('auto-accept rule (MEMORY-SPEC section 7)', () => {
  it('accepts a documented claim with one anchor, known entities and no conflict (FX-M04)', () => {
    expect(autoAcceptable(fresh('cl-06'), before)).toEqual({
      accepted: true,
      rule: 'auto-accept/v1',
      reasons: [],
    });
  });

  it('sends an inferred claim to review (FX-M05)', () => {
    const verdict = autoAcceptable(fresh('cl-07'), before);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons).toContain('evidence class is inferred, not documented');
  });

  it('sends a conflicting claim to review (FX-M02)', () => {
    const verdict = autoAcceptable(fresh('cl-05'), before);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons).toContain('conflicts with cl-04');
  });

  it('refuses a claim with no anchor, two anchors, or a missing anchor', () => {
    const ok = fresh('cl-06');
    expect(autoAcceptable({ ...ok, anchors: [] }, before).reasons).toContain(
      '0 anchors; exactly one supporting anchor is required',
    );
    expect(
      autoAcceptable(
        { ...ok, anchors: [...ok.anchors, { anchorId: 'anc-01', role: 'contextual' }] },
        before,
      ).accepted,
    ).toBe(false);
    expect(
      autoAcceptable({ ...ok, anchors: [{ anchorId: 'anc-none', role: 'supporting' }] }, before)
        .reasons,
    ).toContain('anchor does not exist');
  });

  it('refuses a claim whose entity was matched by alias rather than external ID', () => {
    const ok = fresh('cl-06');
    const unresolved = {
      ...before,
      entities: before.entities.map((e) =>
        e.id === ok.subjectId ? { ...e, externalRefs: [] } : e,
      ),
    };
    expect(autoAcceptable(ok, unresolved).reasons).toContain(
      'subject entity is not resolved by external ID',
    );
  });

  it('does nothing to a claim that is already reviewed', () => {
    expect(autoAcceptable(findRecord(FIXTURE, 'claim', 'cl-06')!, FIXTURE).reasons).toContain(
      'review state is accepted',
    );
  });
});
