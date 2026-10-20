import { describe, expect, it } from 'vitest';
import { FIXTURE, FIXTURE_CASES, FIXTURE_LABEL, FIXTURE_LOG, PRINCIPALS } from './fixture';
import { findRecord, type RECORD_TYPES } from './store';
import type { RecordType } from './types';

describe('synthetic fixture (MEMORY-SPEC section 10)', () => {
  it('is labeled synthetic', () => {
    expect(FIXTURE.label).toBe(FIXTURE_LABEL);
    expect(FIXTURE_LABEL).toMatch(/synthetic/);
  });

  it('covers the required spread of sites, vendors, models and firmware', () => {
    const kinds = (k: string) =>
      FIXTURE.entities.filter((e) => e.kind === k && e.reviewState !== 'superseded');
    expect(kinds('site')).toHaveLength(4);
    expect(kinds('organization').filter((o) => o.attributes.type === 'vendor')).toHaveLength(3);
    expect(kinds('equipment-model')).toHaveLength(2);
    expect(kinds('firmware')).toHaveLength(4);
    expect(FIXTURE.cases).toHaveLength(12);
  });

  it('has every named fixture case pointing at records that exist', () => {
    const all = new Set<string>();
    const keys: RecordType[] = [
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
    ] satisfies (typeof RECORD_TYPES)[number][];
    for (const key of keys) for (const id of [findRecord(FIXTURE, key, '')?.id ?? '']) all.add(id);
    for (const [, c] of Object.entries(FIXTURE_CASES)) {
      for (const id of c.ids) {
        const found = keys.some((k) => findRecord(FIXTURE, k, id) !== undefined);
        expect(found, `${id} should exist`).toBe(true);
      }
    }
    expect(Object.keys(FIXTURE_CASES)).toHaveLength(12);
  });

  it('gives every claim at least one anchor into a stored revision', () => {
    for (const c of FIXTURE.claims) {
      expect(c.anchors.length, c.id).toBeGreaterThan(0);
      for (const link of c.anchors) {
        const anchor = findRecord(FIXTURE, 'anchor', link.anchorId);
        expect(anchor, `${c.id} → ${link.anchorId}`).toBeDefined();
        expect(findRecord(FIXTURE, 'revision', anchor!.revisionId)).toBeDefined();
      }
    }
  });

  it('has one principal who can see restricted records and one who cannot', () => {
    expect(PRINCIPALS.map((p) => p.canSeeRestricted)).toEqual([true, false]);
  });

  it('is built entirely from log events', () => {
    expect(FIXTURE_LOG.events.length).toBeGreaterThan(50);
    const types = new Set(FIXTURE_LOG.events.map((e) => e.event.type));
    expect([...types].sort()).toEqual([
      'candidate-decided',
      'claim-auto-accepted',
      'claim-invalidated',
      'entities-merged',
      'lesson-status-changed',
      'proposal-published',
      'record-added',
      'record-superseded',
      'review-recorded',
    ]);
  });
});
