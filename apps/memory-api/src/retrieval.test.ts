import { describe, expect, it } from 'vitest';
import { FIXTURE, FIXTURE_LOG, PRINCIPALS } from '@hybrid/memory-domain';
import { HashEmbedder, MemoryEventStore, loadFixtureChunks } from '@hybrid/memory-store';
import { createApp } from './app';
import { caseDetail, search } from './retrieval';

const [avery, jordan] = PRINCIPALS as [(typeof PRINCIPALS)[0], (typeof PRINCIPALS)[1]];
const embedder = new HashEmbedder();

async function stocked() {
  const store = new MemoryEventStore(FIXTURE_LOG);
  await loadFixtureChunks(store, embedder);
  return store;
}

describe('hybrid search as a principal', () => {
  it('returns chunks with their anchors and claims, and reports a conflict (FX-M02)', async () => {
    const store = await stocked();
    const r = await search(store, embedder, jordan, 'What firmware is INV-HP-02 running?');
    expect(r.signalsRun).toEqual(['lexical', 'vector']);
    const revisions = r.hits.map((h) => h.revisionId);
    expect(revisions).toEqual(expect.arrayContaining(['rev-03', 'rev-04']));
    const claimIds = r.claims.map((c) => c.id);
    expect(claimIds).toEqual(expect.arrayContaining(['cl-04', 'cl-05']));
    expect(r.conflicts).toEqual(
      expect.arrayContaining([
        { claimId: 'cl-04', conflictsWith: ['cl-05'] },
        { claimId: 'cl-05', conflictsWith: ['cl-04'] },
      ]),
    );
    const emailHit = r.hits.find((h) => h.revisionId === 'rev-03')!;
    expect(emailHit.anchorIds).toEqual(['anc-03']);
    expect(emailHit.sourceKind).toBe('email');
    expect(emailHit.claimIds).toEqual(['cl-05']);
  });

  it('never returns a restricted revision to a principal without restricted access (FX-M03)', async () => {
    const store = await stocked();
    const q = 'Coastal Flats warranty claim IGBT dispute';
    const asJordan = await search(store, embedder, jordan, q);
    expect(asJordan.hits.map((h) => h.revisionId)).not.toContain('rev-05');
    expect(asJordan.claims.map((c) => c.id)).not.toContain('cl-11');
    const asAvery = await search(store, embedder, avery, q);
    expect(asAvery.hits[0]?.revisionId).toBe('rev-05');
  });

  it('runs lexical only without an embedder', async () => {
    const store = await stocked();
    const r = await search(store, null, jordan, 'rodent damage combiner');
    expect(r.signalsRun).toEqual(['lexical']);
    expect(r.hits.slice(0, 2).map((h) => h.revisionId)).toContain('rev-07');
    expect(r.hits[0]?.signals).toEqual({ lexical: 1 });
  });

  it('describes a case with its claims, anchors and sources', () => {
    const detail = caseDetail(FIXTURE, 'case-01')!;
    expect(detail.claims.map((c) => c.id)).toEqual(['cl-01', 'cl-02', 'cl-03']);
    expect(detail.sources.map((s) => s.id).sort()).toEqual(['src-01', 'src-02']);
    expect(caseDetail(FIXTURE, 'nope')).toBeNull();
  });
});

describe('API read endpoints', () => {
  const build = async () => {
    const store = await stocked();
    return createApp({ store, embedder, principals: PRINCIPALS, label: FIXTURE.label });
  };

  it('serves search, cases and the review queue as the principal', async () => {
    const app = await build();
    const s = (await (
      await app.request('/search?principal=u-jordan&q=fuses%20replaced%20trips%20continued')
    ).json()) as {
      hits: { revisionId: string }[];
    };
    expect(s.hits[0]?.revisionId).toBe('rev-01');
    expect((await app.request('/search?principal=u-jordan')).status).toBe(400);
    expect((await app.request('/search?principal=nobody&q=x')).status).toBe(403);

    const c = (await (await app.request('/cases/case-01?principal=u-jordan')).json()) as {
      case: { id: string };
    };
    expect(c.case.id).toBe('case-01');
    expect((await app.request('/cases/case-03?principal=u-jordan')).status).toBe(404);
    expect((await app.request('/cases/case-03?principal=u-avery')).status).toBe(200);

    const q = (await (await app.request('/queue?principal=u-jordan')).json()) as {
      candidates: { id: string }[];
    };
    expect(q.candidates.map((x) => x.id)).toEqual(['cand-01']);
  });

  it('embeds through the API', async () => {
    const app = await build();
    const res = await app.request('/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: ['firmware upgrade'] }),
    });
    const body = (await res.json()) as {
      model: string;
      dimensions: number;
      embeddings: number[][];
    };
    expect(body.model).toBe('hash-bow/v1');
    expect(body.embeddings[0]).toHaveLength(64);
  });
});
