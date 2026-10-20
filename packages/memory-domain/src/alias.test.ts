import { describe, expect, it } from 'vitest';
import { nameSimilarity, normalizeName, resolveEntity } from './alias';
import { FIXTURE, FIXTURE_IDS } from './fixture';

describe('entity resolution (FX-M10)', () => {
  it('normalizes punctuation, case and spacing', () => {
    expect(normalizeName('  Solaris   O&M, LLC. ')).toBe('solaris o m llc');
  });

  it('resolves an exact entity name or seeded alias without review', () => {
    expect(resolveEntity('solaris o&m', FIXTURE.entities, FIXTURE.aliases)).toEqual({
      match: 'exact',
      entityId: FIXTURE_IDS.ORG_SOLARIS,
      via: 'name',
    });
    expect(resolveEntity('SunServ', FIXTURE.entities, FIXTURE.aliases)).toEqual({
      match: 'exact',
      entityId: FIXTURE_IDS.ORG_SOLARIS,
      via: 'alias',
    });
  });

  it('resolves the merged duplicate name to its survivor', () => {
    expect(resolveEntity('Gridline Services LLC', FIXTURE.entities, FIXTURE.aliases)).toEqual({
      match: 'exact',
      entityId: FIXTURE_IDS.ORG_GRIDLINE,
      via: 'alias',
    });
  });

  it('offers fuzzy candidates for review instead of guessing', () => {
    const r = resolveEntity('Mesa Ridge Solar Park', FIXTURE.entities, FIXTURE.aliases);
    expect(r.match).toBe('fuzzy');
    if (r.match !== 'fuzzy') return;
    expect(r.candidates[0]?.entityId).toBe(FIXTURE_IDS.SITE_MESA);
    expect(r.candidates[0]?.similarity).toBeCloseTo(0.75);
  });

  it('restricts by kind and reports no match', () => {
    expect(
      resolveEntity('Mesa Ridge', FIXTURE.entities, FIXTURE.aliases, { kind: 'organization' }),
    ).toEqual({
      match: 'none',
    });
    expect(nameSimilarity('', 'x')).toBe(0);
  });
});
