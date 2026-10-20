import { describe, expect, it } from 'vitest';
import { FIXTURE, FIXTURE_DOCUMENTS, QUOTES } from './index';
import { describeLocator, locatorCovers } from './locator';

describe('fixture documents', () => {
  it('has one document per non-restricted-or-restricted source, pointing at a stored revision', () => {
    expect(FIXTURE_DOCUMENTS).toHaveLength(FIXTURE.sources.length);
    for (const d of FIXTURE_DOCUMENTS) {
      expect(FIXTURE.revisions.find((r) => r.id === d.revisionId)?.sourceId).toBe(d.sourceId);
      expect(d.segments.length).toBeGreaterThan(0);
    }
  });

  it('has a segment covering every anchor in the fixture', () => {
    for (const anchor of FIXTURE.anchors) {
      const doc = FIXTURE_DOCUMENTS.find((d) => d.revisionId === anchor.revisionId)!;
      const covered = doc.segments.some((s) => locatorCovers(anchor.locator, s.locator));
      expect(covered, `${anchor.id} ${describeLocator(anchor.locator)}`).toBe(true);
    }
  });

  it('computes span anchors from the quoted text', () => {
    const anchor = FIXTURE.anchors.find((a) => a.id === 'anc-03')!;
    expect(anchor.locator.type).toBe('span');
    if (anchor.locator.type !== 'span') return;
    const text = FIXTURE_DOCUMENTS.find((d) => d.sourceId === 'src-03')!.segments[0]!.text;
    expect(text.slice(anchor.locator.start, anchor.locator.end)).toBe(QUOTES.HP02_STILL_314);
  });
});

describe('locatorCovers', () => {
  it('matches pages, overlapping spans and rows, and whole against anything', () => {
    expect(locatorCovers({ type: 'page', page: 2 }, { type: 'page', page: 2 })).toBe(true);
    expect(locatorCovers({ type: 'page', page: 2 }, { type: 'page', page: 3 })).toBe(false);
    expect(
      locatorCovers(
        { type: 'span', start: 10, end: 20, quote: 'x' },
        { type: 'span', start: 15, end: 40, quote: '' },
      ),
    ).toBe(true);
    expect(
      locatorCovers(
        { type: 'span', start: 10, end: 20, quote: 'x' },
        { type: 'span', start: 20, end: 40, quote: '' },
      ),
    ).toBe(false);
    expect(locatorCovers({ type: 'row', row: 7, column: 'a' }, { type: 'row', row: 7 })).toBe(true);
    expect(locatorCovers({ type: 'whole' }, { type: 'page', page: 9 })).toBe(true);
    expect(locatorCovers({ type: 'page', page: 1 }, { type: 'row', row: 1 })).toBe(false);
  });
});
