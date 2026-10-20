import {
  AUTO_ACCEPT_ACTOR,
  autoAcceptable,
  findRecord,
  projectMemory,
  visibleMemory,
  type Candidate,
  type Claim,
  type Id,
  type Instant,
  type MemoryEvent,
  type Principal,
  type RecordByType,
  type RecordType,
} from '@hybrid/memory-domain';
import {
  AppendEventRequest,
  EmbedRequest,
  RECORD_SCHEMAS,
  SubmitCandidatesRequest,
  SubmitChunksRequest,
  SubmitIntakeRequest,
} from '@hybrid/memory-contract';
import type { Embedder, EventStore } from '@hybrid/memory-store';
import { Hono } from 'hono';
import type { z } from 'zod';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from './mcpServer';
import { caseDetail, pendingCandidates, search } from './retrieval';

export interface AppOptions {
  store: EventStore;
  /** Embeds chunks and queries; null runs lexical search only. */
  embedder?: Embedder | null;
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
export function createApp({ store, embedder = null, principals, now, label }: AppOptions): Hono {
  const clock = now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const app = new Hono();
  const principalOf = (c: { req: { query(name: string): string | undefined } }) =>
    principals.find((p) => p.id === c.req.query('principal'));
  const memoryFor = async (principal: Principal, asOfPosition?: number) =>
    visibleMemory(projectMemory(await store.readLog(), { label, asOfPosition }), principal);

  app.get('/health', (c) =>
    c.json({ ok: true, embedder: embedder ? { model: embedder.model } : null }),
  );

  app.post('/embed', async (c) => {
    if (!embedder) return c.json({ error: 'no embedder configured' }, 503);
    const parsed = EmbedRequest.safeParse(await c.req.json());
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: issues(parsed.error) }, 400);
    const embeddings = await embedder.embed(parsed.data.texts);
    return c.json({ model: embedder.model, dimensions: embedder.dimensions, embeddings });
  });

  /** Appends a record unless the log already holds it (intake retries are idempotent by ID). */
  async function addOnce<K extends RecordType>(
    recordType: K,
    record: RecordByType[K],
    actorId: Id,
    correlationId: string,
  ): Promise<number> {
    const existing = findRecord(projectMemory(await store.readLog()), recordType, record.id);
    if (existing) {
      const position = (await store.readLog()).events.find(
        (e) =>
          (e.event.type === 'record-added' || e.event.type === 'record-superseded') &&
          e.event.recordType === recordType &&
          e.event.record.id === record.id,
      )!.position;
      return position;
    }
    const logged = await store.append(
      { type: 'record-added', recordType, record } as MemoryEvent,
      actorId,
      clock(),
      { correlationId },
    );
    return logged.position;
  }

  app.post('/intake', async (c) => {
    const parsed = SubmitIntakeRequest.safeParse(await c.req.json());
    if (!parsed.success)
      return c.json({ error: 'invalid intake', issues: issues(parsed.error) }, 400);
    const { episode, source, revision, chunks, actorId } = parsed.data;
    if (revision.sourceId !== source.id) {
      return c.json({ error: 'revision.sourceId must name the submitted source' }, 400);
    }
    const correlationId = episode.correlationId;
    const episodePosition = await addOnce('episode', episode, actorId, correlationId);
    const sourcePosition = await addOnce('source', source, actorId, correlationId);
    const revisionPosition = await addOnce('revision', revision, actorId, correlationId);
    const stored = await store.storeChunks(
      chunks.map((ch) => ({ revisionId: revision.id, episodeId: episode.id, ...ch })),
    );
    return c.json({ episodePosition, sourcePosition, revisionPosition, stored }, 201);
  });

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
    const { episode, anchors, candidates, actorId } = parsed.data;
    const correlationId = episode.correlationId;
    const episodePosition = await addOnce('episode', episode, actorId, correlationId);
    for (const anchor of anchors) await addOnce('anchor', anchor, actorId, correlationId);
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
    return c.json({ episodePosition, autoAccepted, queued }, 201);
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
    const principal = principalOf(c);
    if (!principal) return c.json({ error: 'unknown principal' }, 403);
    const asOfPosition = c.req.query('asOfPosition');
    return c.json(await memoryFor(principal, asOfPosition ? Number(asOfPosition) : undefined));
  });

  app.get('/search', async (c) => {
    const principal = principalOf(c);
    if (!principal) return c.json({ error: 'unknown principal' }, 403);
    const q = c.req.query('q')?.trim();
    if (!q) return c.json({ error: 'q is required' }, 400);
    const k = Number(c.req.query('k') ?? 8);
    const lexicalOnly = c.req.query('signals') === 'lexical';
    return c.json(await search(store, embedder, principal, q, { k, lexicalOnly }));
  });

  app.get('/cases/:id', async (c) => {
    const principal = principalOf(c);
    if (!principal) return c.json({ error: 'unknown principal' }, 403);
    const detail = caseDetail(await memoryFor(principal), c.req.param('id'));
    return detail ? c.json(detail) : c.json({ error: 'no such case' }, 404);
  });

  app.get('/queue', async (c) => {
    const principal = principalOf(c);
    if (!principal) return c.json({ error: 'unknown principal' }, 403);
    return c.json({
      principalId: principal.id,
      candidates: pendingCandidates(await memoryFor(principal)),
    });
  });

  // Stateless MCP over HTTP: one server and transport per request, acting as ?principal=.
  app.all('/mcp', async (c) => {
    const principal = principalOf(c);
    if (!principal) return c.json({ error: 'unknown principal' }, 403);
    const server = createMcpServer({ store, embedder, principal, label });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await transport.close();
    }
  });

  app.get('/log', async (c) => {
    const after = Number(c.req.query('after') ?? 0);
    return c.json(await store.readLog(after));
  });

  return app;
}
