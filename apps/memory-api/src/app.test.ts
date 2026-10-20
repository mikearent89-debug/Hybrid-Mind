import { describe, expect, it } from 'vitest';
import {
  AUTO_ACCEPT_ACTOR,
  FIXTURE,
  FIXTURE_IDS,
  FIXTURE_LOG,
  PRINCIPALS,
  findRecord,
  projectMemory,
  type Candidate,
  type Claim,
  type Episode,
  type MemoryDataset,
} from '@hybrid/memory-domain';
import { MemoryEventStore } from '@hybrid/memory-store';
import { createApp } from './app';

const NOW = '2026-10-20T16:00:00Z';
const build = () => {
  const store = new MemoryEventStore(FIXTURE_LOG);
  const app = createApp({ store, principals: PRINCIPALS, now: () => NOW, label: FIXTURE.label });
  return { store, app };
};
const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const episode: Episode = {
  ...FIXTURE.episodes[1]!,
  id: 'ep-intake-9',
  correlationId: 'intake-9',
  revisionIds: ['rev-06'],
};
const baseClaim = findRecord(FIXTURE, 'claim', 'cl-06')!;
const candidate = (id: string, claim: Claim): Candidate => ({
  ...FIXTURE.candidates[1]!,
  id,
  reviewState: 'unreviewed',
  reviewedBy: null,
  reviewedAt: null,
  targetType: 'claim',
  operation: 'add',
  targetId: null,
  payload: claim,
  episodeId: episode.id,
  decision: null,
});

describe('memory-api', () => {
  it('reports health', async () => {
    const { app } = build();
    expect(await (await app.request('/health')).json()).toEqual({ ok: true });
  });

  it('appends a validated event and rejects an invalid one', async () => {
    const { app, store } = build();
    const ok = await app.request(
      '/events',
      json({
        event: {
          type: 'lesson-status-changed',
          lessonId: 'lesson-02',
          status: 'reviewed',
          reason: 'ok',
        },
        actorId: 'u-avery',
        correlationId: 'review-9',
      }),
    );
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ position: FIXTURE_LOG.events.length + 1, recordedAt: NOW });
    expect((await store.readLog()).events.at(-1)?.correlationId).toBe('review-9');

    const bad = await app.request(
      '/events',
      json({ event: { type: 'record-deleted' }, actorId: 'x' }),
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('invalid event');
    expect((await store.readLog()).events).toHaveLength(FIXTURE_LOG.events.length + 1);
  });

  it('serves memory as the principal sees it (AC-17)', async () => {
    const { app } = build();
    const avery = (await (await app.request('/memory?principal=u-avery')).json()) as MemoryDataset;
    const jordan = (await (
      await app.request('/memory?principal=u-jordan')
    ).json()) as MemoryDataset;
    expect(avery.cases.map((c) => c.id)).toContain('case-03');
    expect(jordan.cases.map((c) => c.id)).not.toContain('case-03');
    expect(jordan.label).toBe(FIXTURE.label);
    expect((await app.request('/memory?principal=nobody')).status).toBe(403);
    const early = (await (
      await app.request('/memory?principal=u-avery&asOfPosition=1')
    ).json()) as MemoryDataset;
    expect(early.entities).toHaveLength(1);
  });

  it('auto-accepts a qualifying claim candidate and queues the rest', async () => {
    const { app, store } = build();
    const qualifying: Claim = {
      ...baseClaim,
      id: 'cl-90',
      subjectId: FIXTURE_IDS.INV_RB_04,
      relation: 'runs-firmware',
      object: { type: 'entity', entityId: 'fw-vantage-7.0.2' },
      reviewState: 'unreviewed',
      reviewedBy: null,
      reviewedAt: null,
      episodeId: episode.id,
    };
    const inferred: Claim = { ...qualifying, id: 'cl-91', evidenceClass: 'inferred' };
    const conflicting: Claim = {
      ...qualifying,
      id: 'cl-92',
      subjectId: FIXTURE_IDS.INV_HP_02,
      object: { type: 'entity', entityId: FIXTURE_IDS.FW_HELION_314 },
    };
    const res = await app.request(
      '/candidates',
      json({
        episode,
        candidates: [
          candidate('cand-90', qualifying),
          candidate('cand-91', inferred),
          candidate('cand-92', conflicting),
        ],
        actorId: 'worker:intake',
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      episodePosition: FIXTURE_LOG.events.length + 1,
      autoAccepted: ['cand-90'],
      queued: ['cand-91', 'cand-92'],
    });
    const after = projectMemory(await store.readLog());
    expect(findRecord(after, 'claim', 'cl-90')).toMatchObject({
      reviewState: 'accepted',
      reviewedBy: AUTO_ACCEPT_ACTOR,
      reviewedAt: NOW,
    });
    expect(findRecord(after, 'candidate', 'cand-90')?.decision).toMatchObject({
      decision: 'accepted',
      by: AUTO_ACCEPT_ACTOR,
      resultingId: 'cl-90',
    });
    expect(findRecord(after, 'claim', 'cl-91')).toBeUndefined();
    expect(findRecord(after, 'candidate', 'cand-91')?.decision).toBeNull();
    expect(findRecord(after, 'candidate', 'cand-92')?.decision).toBeNull();
    const actors = (await store.readLog()).events
      .slice(FIXTURE_LOG.events.length)
      .map((e) => e.actorId);
    expect(actors).toEqual([
      'worker:intake',
      'worker:intake',
      AUTO_ACCEPT_ACTOR,
      AUTO_ACCEPT_ACTOR,
      AUTO_ACCEPT_ACTOR,
      'worker:intake',
      'worker:intake',
    ]);
  });

  it('stores chunks against a revision', async () => {
    const { app, store } = build();
    const res = await app.request(
      '/chunks',
      json({
        revisionId: 'rev-01',
        episodeId: 'ep-intake-1',
        chunks: [
          {
            index: 0,
            text: 'Replaced fuses',
            contextPrefix: 'WO-1001, page 1',
            locator: { type: 'page', page: 1 },
            embedding: [0.1, 0.2],
            embeddingModel: 'test',
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ stored: 1 });
    expect(store.chunks[0]).toMatchObject({ revisionId: 'rev-01', index: 0 });
  });
});
