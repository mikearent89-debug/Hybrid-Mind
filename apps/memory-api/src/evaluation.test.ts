import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE, FIXTURE_LOG, PRINCIPALS } from '@hybrid/memory-domain';
import { HashEmbedder, MemoryEventStore, loadFixtureChunks } from '@hybrid/memory-store';
import { search, type SearchResponseT } from './retrieval';

// The retrieval evaluation from docs/spec/EVALUATION.md, run on the synthetic fixture. Scores
// anchor hit rate, unanchored results, access leaks and conflict disclosure; the free-text answer
// checks need a model and run by hand from Claude Desktop.

interface Question {
  id: string;
  principal: string;
  question: string;
  expectedAnchors?: string[];
  expectedRevisions?: string[];
  expectedClaims?: string[];
  expectedCases?: string[];
  mustNotCite?: string[];
  mustDiscloseConflict?: boolean;
  fixtureCase: string;
}

const file = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'docs',
  'spec',
  'evaluation',
  'questions.json',
);
const spec = JSON.parse(readFileSync(file, 'utf8')) as { k: number; questions: Question[] };

interface Score {
  id: string;
  anchored: boolean | null;
  leaks: string[];
  conflictDisclosed: boolean | null;
  casesFound: boolean | null;
  topRevisions: string[];
}

function score(q: Question, r: SearchResponseT): Score {
  const anchorsHit = new Set(r.hits.flatMap((h) => h.anchorIds));
  const revisionsHit = new Set(r.hits.map((h) => h.revisionId));
  const casesHit = new Set(r.hits.flatMap((h) => h.caseIds));
  const expectsSomething =
    (q.expectedAnchors?.length ?? 0) + (q.expectedRevisions?.length ?? 0) > 0;
  const anchored = expectsSomething
    ? (q.expectedAnchors ?? []).some((a) => anchorsHit.has(a)) ||
      (q.expectedRevisions ?? []).some((rev) => revisionsHit.has(rev))
    : null;
  const cited = new Set([
    ...anchorsHit,
    ...revisionsHit,
    ...casesHit,
    ...r.claims.map((c) => c.id),
    ...r.hits.flatMap((h) => h.claimIds),
  ]);
  const leaks = (q.mustNotCite ?? []).filter((id) => cited.has(id));
  const conflictDisclosed = q.mustDiscloseConflict
    ? r.conflicts.some(
        (c) =>
          (q.expectedClaims ?? []).includes(c.claimId) &&
          c.conflictsWith.some((o) => (q.expectedClaims ?? []).includes(o)),
      )
    : null;
  const casesFound = q.expectedCases?.length
    ? q.expectedCases.some((id) => casesHit.has(id))
    : null;
  return {
    id: q.id,
    anchored,
    leaks,
    conflictDisclosed,
    casesFound,
    topRevisions: [...revisionsHit],
  };
}

describe('retrieval evaluation (EVALUATION.md, synthetic fixture)', async () => {
  const store = new MemoryEventStore(FIXTURE_LOG);
  const embedder = new HashEmbedder();
  await loadFixtureChunks(store, embedder);
  const scores: Score[] = [];
  for (const q of spec.questions) {
    const principal = PRINCIPALS.find((p) => p.id === q.principal)!;
    const r = await search(store, embedder, principal, q.question, { k: spec.k });
    expect(
      r.hits.every((h) => h.revisionId && h.locator),
      `${q.id}: every hit has a location`,
    ).toBe(true);
    scores.push(score(q, r));
  }

  it('has thirty questions, each tied to a fixture case', () => {
    expect(spec.questions).toHaveLength(30);
    for (const q of spec.questions) expect(q.fixtureCase).toMatch(/^FX-M\d\d$/);
    expect(FIXTURE.label).toMatch(/synthetic/);
  });

  it('finds the expected anchor or revision in the top k for at least 90 % of questions', () => {
    const graded = scores.filter((s) => s.anchored !== null);
    const hits = graded.filter((s) => s.anchored).length;
    const misses = graded
      .filter((s) => !s.anchored)
      .map((s) => `${s.id} → ${s.topRevisions.join(', ')}`);
    expect(hits / graded.length, `misses: ${misses.join('; ')}`).toBeGreaterThanOrEqual(0.9);
  });

  it('never cites a restricted record to a principal without restricted access (AC-17)', () => {
    for (const s of scores) expect(s.leaks, s.id).toEqual([]);
  });

  it('discloses the conflict on every disputed fact (FX-M02)', () => {
    for (const s of scores)
      if (s.conflictDisclosed !== null) expect(s.conflictDisclosed, s.id).toBe(true);
  });

  it('surfaces an expected case on at least 80 % of case questions', () => {
    const graded = scores.filter((s) => s.casesFound !== null);
    const found = graded.filter((s) => s.casesFound).length;
    const misses = graded.filter((s) => !s.casesFound).map((s) => s.id);
    expect(found / graded.length, `misses: ${misses.join(', ')}`).toBeGreaterThanOrEqual(0.8);
  });
});
