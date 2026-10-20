import { spawn } from 'node:child_process';
import {
  projectMemory,
  visibleMemory,
  describeLocator,
  type Principal,
} from '@hybrid/memory-domain';
import type { Embedder, EventStore } from '@hybrid/memory-store';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { caseDetail, pendingCandidates, search, type SearchResponseT } from './retrieval';

export interface McpOptions {
  store: EventStore;
  embedder: Embedder | null;
  /** The person the server acts as; every read is filtered to what they may see. */
  principal: Principal;
  label?: string;
  /** Where the Python worker should submit intake; `ingest` is disabled without it. */
  apiUrl?: string;
  /** Directory of the Python worker, for `uv run`. */
  workerDir?: string;
  /** Replaces the subprocess in tests. */
  runIngest?: (args: string[]) => Promise<{ code: number; output: string }>;
}

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

export function formatSearch(r: SearchResponseT, verbose = false): string {
  const lines: string[] = [];
  lines.push(`Search as ${r.principalId}: "${r.query}" (signals: ${r.signalsRun.join(' + ')})`);
  if (r.hits.length === 0)
    lines.push('No matching chunks. Nothing can be stated without an anchor.');
  r.hits.forEach((h, i) => {
    lines.push('');
    lines.push(
      `${i + 1}. [${h.sourceKind}] ${h.sourceTitle} — ${h.locatorText} (revision ${h.revisionId})`,
    );
    lines.push(`   ${h.text.replace(/\s+/g, ' ').slice(0, 400)}`);
    if (verbose) {
      const sig = Object.entries(h.signals)
        .map(([s, rank]) => `${s} rank ${rank}`)
        .join(', ');
      lines.push(`   why: ${sig}; fused score ${h.score.toFixed(4)}`);
    }
    if (h.anchorIds.length) lines.push(`   anchors: ${h.anchorIds.join(', ')}`);
    if (h.claimIds.length) lines.push(`   claims: ${h.claimIds.join(', ')}`);
    if (h.caseIds.length) lines.push(`   cases: ${h.caseIds.join(', ')}`);
  });
  if (r.claims.length) {
    lines.push('');
    lines.push('Claims on these chunks:');
    for (const c of r.claims) {
      const obj =
        c.object.type === 'entity'
          ? c.object.entityId
          : `${c.object.value}${c.object.unit ? ' ' + c.object.unit : ''}`;
      const validity = `${c.effectiveFrom ?? '…'} → ${c.effectiveTo ?? 'open'}`;
      lines.push(
        `- ${c.id}: ${c.subjectId} ${c.relation} ${obj} [${c.evidenceClass}, ${c.reviewState}, valid ${validity}]${c.invalidatedAt ? ' (invalidated)' : ''}`,
      );
    }
  }
  if (r.conflicts.length) {
    lines.push('');
    lines.push('CONFLICTS (disclose; do not pick a side):');
    for (const c of r.conflicts)
      lines.push(`- ${c.claimId} contradicts ${c.conflictsWith.join(', ')}`);
  }
  lines.push('');
  lines.push(
    'Cite anchors or revisions for every fact. Restricted records the principal cannot see are not in these results.',
  );
  return lines.join('\n');
}

/**
 * The memory as MCP tools. Same read path as the HTTP API: every tool runs as one principal and
 * sees only what visibleMemory() allows. Writes stay with the API; `ingest` hands a file to the
 * Python worker, which submits through the API like any other intake.
 */
export function createMcpServer(options: McpOptions): McpServer {
  const { store, embedder, principal, label } = options;
  const server = new McpServer({ name: 'portfolio-memory', version: '0.1.0' });
  const memory = async () =>
    visibleMemory(projectMemory(await store.readLog(), { label }), principal);

  server.registerTool(
    'search',
    {
      title: 'Search portfolio memory',
      description:
        'Hybrid (full-text + vector) search over the portfolio documents as the configured principal. Returns chunks with their source, exact location, anchors and the claims on them; conflicts are listed and must be disclosed.',
      inputSchema: { query: z.string().min(1), k: z.int().min(1).max(30).optional() },
    },
    async ({ query, k }) =>
      text(formatSearch(await search(store, embedder, principal, query, { k: k ?? 8 }))),
  );

  server.registerTool(
    'explain',
    {
      title: 'Explain a search',
      description:
        'Runs the same search and shows, per result, which signal found it and at what rank, plus what the principal could not see. Use it when a result looks surprising.',
      inputSchema: { query: z.string().min(1), k: z.int().min(1).max(30).optional() },
    },
    async ({ query, k }) => {
      const r = await search(store, embedder, principal, query, { k: k ?? 8 });
      const all = projectMemory(await store.readLog(), { label });
      const visible = await memory();
      const hidden = all.revisions.length - visible.revisions.length;
      return text(
        `${formatSearch(r, true)}\n\n${hidden} revision(s) exist that ${principal.id} may not see and were excluded before ranking.`,
      );
    },
  );

  server.registerTool(
    'get_case',
    {
      title: 'Get a case',
      description: 'A case with its claims, anchors and source documents.',
      inputSchema: { caseId: z.string().min(1) },
    },
    async ({ caseId }) => {
      const detail = caseDetail(await memory(), caseId);
      if (!detail) return text(`No case ${caseId} visible to ${principal.id}.`);
      const c = detail.case;
      const lines = [
        `${c.id}: ${c.title} [${c.reviewState}, ${c.evidenceClass}]`,
        `Symptom: ${c.symptom}`,
        `Context: ${c.context.entityIds.join(', ')} | ${c.context.conditions.join('; ')}`,
        `Hypotheses: ${c.investigation.hypotheses.join('; ') || '—'}`,
        `Actions tried: ${c.actionsTried.map((a) => `${a.description} → ${a.result}`).join('; ') || '—'}`,
        `Fix: ${c.fix ?? '—'} | Outcome: ${c.outcome ?? '—'}`,
        `Cost: ${c.cost ? `${c.cost.amount} ${c.cost.currency}` : '—'} | Downtime: ${c.downtimeHours ?? '—'} h`,
        `Limitations: ${c.limitations.join('; ') || '—'}`,
        `Unresolved: ${c.investigation.unresolvedQuestions.join('; ') || '—'}`,
        '',
        'Claims:',
        ...detail.claims.map(
          (cl) =>
            `- ${cl.id}: ${cl.subjectId} ${cl.relation} ${cl.object.type === 'entity' ? cl.object.entityId : cl.object.value} [${cl.evidenceClass}, ${cl.reviewState}] anchors ${cl.anchors.map((l) => l.anchorId).join(', ')}`,
        ),
        '',
        'Anchors:',
        ...detail.anchors.map((a) => {
          const rev = a.revisionId;
          const src =
            detail.sources.find((s) => s.id === rev.replace('rev-', 'src-'))?.title ?? rev;
          return `- ${a.id}: ${src}, ${describeLocator(a.locator)}`;
        }),
      ];
      return text(lines.join('\n'));
    },
  );

  server.registerTool(
    'queue',
    {
      title: 'Review queue',
      description: 'Candidates waiting for a human decision, as the configured principal.',
    },
    async () => {
      const pending = pendingCandidates(await memory());
      if (pending.length === 0) return text('The review queue is empty.');
      return text(
        pending
          .map(
            (c) =>
              `${c.id}: ${c.operation} ${c.targetType}${c.targetId ? ' ' + c.targetId : ''} — ${c.uncertainty.level}: ${c.uncertainty.reasons} (method ${c.method.name}/${c.method.version})`,
          )
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'ingest',
    {
      title: 'Ingest a file',
      description:
        'Hands a local file (PDF, .eml, .csv, image, .md/.txt) to the intake worker, which stores it as an immutable revision, chunks it, and submits extraction candidates for review. Nothing becomes fact without review except documented claims under the auto-accept rule.',
      inputSchema: {
        path: z.string().min(1),
        kind: z
          .enum(['email', 'work-order', 'report', 'photo', 'csv', 'note', 'document'])
          .optional(),
        siteIds: z.array(z.string()).optional(),
        extract: z.boolean().optional(),
      },
    },
    async ({ path, kind, siteIds, extract }) => {
      if (!options.apiUrl && !options.runIngest) {
        return text('ingest is disabled: MEMORY_API_URL is not set for this MCP server.');
      }
      const args = ['ingest', path, '--actor', principal.id];
      if (kind) args.push('--kind', kind);
      for (const s of siteIds ?? []) args.push('--site', s);
      if (extract === false) args.push('--no-extract');
      const run = options.runIngest ?? ((a) => runWorker(a, options));
      const result = await run(args);
      return text(
        result.code === 0
          ? result.output
          : `ingest failed (exit ${result.code}):\n${result.output}`,
      );
    },
  );

  return server;
}

function runWorker(args: string[], options: McpOptions): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('uv', ['run', 'memory-worker', ...args], {
      cwd: options.workerDir,
      env: { ...process.env, MEMORY_API_URL: options.apiUrl ?? '' },
    });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    child.on('error', (e) => resolve({ code: 127, output: `${output}\n${e.message}` }));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}
