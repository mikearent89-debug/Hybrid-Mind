import {
  AUTO_ACCEPT_ACTOR,
  autoAcceptable,
  projectMemory,
  visibleMemory,
  type Candidate,
  type Claim,
  type Id,
  type Instant,
  type Principal,
} from '@hybrid/memory-domain';
import {
  AppendEventRequest,
  RECORD_SCHEMAS,
  SubmitCandidatesRequest,
  SubmitChunksRequest,
} from '@hybrid/memory-contract';
import type { EventStore } from '@hybrid/memory-store';
import { Hono } from 'hono';
import type { z } from 'zod';

export interface AppOptions {
  store: EventStore;
  /** Who may read, and whether they may see restricted records. Replaced by real grants in 1B. */
  principals: Principal[];
  now?: () => Instant;
  label?: string;
}

const issues = (error: z.ZodError) =>
  error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

/**
 * Builds the API. Writes: POST /events (any event), POST /candidates (the worker's extraction
 * results, with the auto-accept rule applied on arrival), POST /chunks. Reads: GET /memory as a
 * principal, GET /log. Nothing here touches a table directly; the store does, from events.
 */
export function createApp({ store, principals, now, label }: AppOptions): Hono {
  const clock = now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/events', async (c) => {
    const parsed = AppendEventRequest.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: 'invalid event', issues: issues(parsed.error) }, 400);
    }
    const { event, actorId, effectiveAt, correlationId } = parsed.data;
    const logged = await store.append(event, actorId, clock(), { effectiveAt, correlationId });
    return c.json({ position: logged.position, recordedAt: logged.recordedAt }, 201);
  });

  app.post('/chunks', async (c) => {
    const parsed = SubmitChunksRequest.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: 'invalid chunks', issues: issues(parsed.error) }, 400);
    }
    const { revisionId, episodeId, chunks } = parsed.data;
    const stored = await store.storeChunks(chunks.map((ch) => ({ revisionId, episodeId, ...ch })));
    return c.json({ stored }, 201);
  });

  app.post('/candidates', async (c) => {
    const parsed = SubmitCandidatesRequest.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: 'invalid candidates', issues: issues(parsed.error) }, 400);
    }
    const { episode, candidates, actorId } = parsed.data;
    const correlationId = episode.correlationId;
    const logged = await store.append(
      { type: 'record-added', recordType: 'episode', record: episode },
      actorId,
      clock(),
      { correlationId },
    );
    const autoAccepted: Id[] = [];
    const queued: Id[] = [];
    for (const candidate of candidates) {
      await store.append(
        { type: 'record-added', recordType: 'candidate', record: candidate },
        actorId,
        clock(),
        { correlationId },
      );
      if (await tryAutoAccept(candidate, correlationId)) autoAccepted.push(candidate.id);
      else queued.push(candidate.id);
    }
    return c.json({ episodePosition: logged.position, autoAccepted, queued }, 201);
  });

  /**
   * The narrow rule: an "add claim" candidate whose claim is documented, singly anchored, resolved
   * by external ID and unopposed is written and accepted at once, by the system actor, as events.
   */
  async function tryAutoAccept(candidate: Candidate, correlationId: string): Promise<boolean> {
    if (candidate.operation !== 'add' || candidate.targetType !== 'claim') return false;
    const claim = RECORD_SCHEMAS.claim.safeParse(candidate.payload);
    if (!claim.success) return false;
    const dataset = projectMemory(await store.readLog());
    const verdict = autoAcceptable(claim.data as Claim, dataset);
    if (!verdict.accepted) return false;
    const at = clock();
    await store.append(
      { type: 'record-added', recordType: 'claim', record: claim.data as Claim },
      AUTO_ACCEPT_ACTOR,
      at,
      { correlationId },
    );
    await store.append(
      { type: 'claim-auto-accepted', claimId: claim.data.id, rule: verdict.rule },
      AUTO_ACCEPT_ACTOR,
      at,
      { correlationId },
    );
    await store.append(
      {
        type: 'candidate-decided',
        candidateId: candidate.id,
        decision: 'accepted',
        reason: `${verdict.rule}: documented, one anchor, entities by external ID, no conflict`,
        resultingId: claim.data.id,
      },
      AUTO_ACCEPT_ACTOR,
      at,
      { correlationId },
    );
    return true;
  }

  app.get('/memory', async (c) => {
    const principalId = c.req.query('principal');
    const principal = principals.find((p) => p.id === principalId);
    if (!principal) return c.json({ error: 'unknown principal' }, 403);
    const asOfPosition = c.req.query('asOfPosition');
    const dataset = projectMemory(await store.readLog(), {
      label,
      asOfPosition: asOfPosition ? Number(asOfPosition) : undefined,
    });
    return c.json(visibleMemory(dataset, principal));
  });

  app.get('/log', async (c) => {
    const after = Number(c.req.query('after') ?? 0);
    return c.json(await store.readLog(after));
  });

  return app;
}
