import { describe, expect, it } from 'vitest';
import { visibleMemory } from './access';
import { FIXTURE, FIXTURE_IDS, PRINCIPALS } from './fixture';
import type { MemoryDataset } from './types';

const avery = PRINCIPALS[0]!;
const jordan = PRINCIPALS[1]!;

const idsOf = (d: MemoryDataset, key: Exclude<keyof MemoryDataset, 'label'>) =>
  d[key].map((r) => r.id);

describe('visibleMemory (AC-17)', () => {
  it('shows everything to a principal with restricted access', () => {
    expect(visibleMemory(FIXTURE, avery)).toBe(FIXTURE);
  });

  it('hides the restricted case and everything that hangs off it (FX-M03)', () => {
    const v = visibleMemory(FIXTURE, jordan);
    expect(idsOf(v, 'cases')).not.toContain('case-03');
    expect(idsOf(v, 'sources')).not.toContain('src-05');
    expect(idsOf(v, 'revisions')).not.toContain('rev-05');
    expect(idsOf(v, 'anchors')).not.toContain('anc-05');
    expect(idsOf(v, 'claims')).not.toContain('cl-11');
    expect(idsOf(v, 'episodes')).not.toContain('ep-intake-restricted');
    expect(v.episodes.every((e) => !e.revisionIds.includes('rev-05'))).toBe(true);
  });

  it('keeps standard records that are not attached to restricted ones', () => {
    const v = visibleMemory(FIXTURE, jordan);
    expect(v.cases).toHaveLength(FIXTURE.cases.length - 1);
    expect(idsOf(v, 'entities')).toContain(FIXTURE_IDS.INV_CF_01);
    expect(idsOf(v, 'proposals')).toEqual(idsOf(FIXTURE, 'proposals'));
    expect(idsOf(v, 'outcomes')).toEqual(idsOf(FIXTURE, 'outcomes'));
    expect(idsOf(v, 'lessons')).toEqual(idsOf(FIXTURE, 'lessons'));
  });

  it('strips hidden case references from lessons rather than leaking them', () => {
    const restrictedLesson: MemoryDataset = {
      ...FIXTURE,
      lessons: [
        {
          ...FIXTURE.lessons[0]!,
          id: 'lesson-x',
          supportingCaseIds: ['case-01', 'case-03'],
          counterEvidenceCaseIds: [],
        },
      ],
    };
    const v = visibleMemory(restrictedLesson, jordan);
    expect(v.lessons[0]?.supportingCaseIds).toEqual(['case-01']);
  });
});
