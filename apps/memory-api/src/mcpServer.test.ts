import { describe, expect, it } from 'vitest';
import { FIXTURE, FIXTURE_LOG, PRINCIPALS } from '@hybrid/memory-domain';
import { HashEmbedder, MemoryEventStore, loadFixtureChunks } from '@hybrid/memory-store';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './mcpServer';

const jordan = PRINCIPALS[1]!;

async function connected(
  runIngest?: (args: string[]) => Promise<{ code: number; output: string }>,
) {
  const store = new MemoryEventStore(FIXTURE_LOG);
  const embedder = new HashEmbedder();
  await loadFixtureChunks(store, embedder);
  const server = createMcpServer({
    store,
    embedder,
    principal: jordan,
    label: FIXTURE.label,
    runIngest,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
}

const textOf = (r: unknown) =>
  (r as { content: { type: string; text: string }[] }).content.map((c) => c.text).join('\n');

describe('portfolio-memory MCP server', () => {
  it('lists its tools', async () => {
    const client = await connected();
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['explain', 'get_case', 'ingest', 'queue', 'search']);
  });

  it('searches with anchors, claims and conflicts disclosed (FX-M02)', async () => {
    const client = await connected();
    const out = textOf(
      await client.callTool({ name: 'search', arguments: { query: 'INV-HP-02 firmware' } }),
    );
    expect(out).toContain('anc-03');
    expect(out).toContain('CONFLICTS');
    expect(out).toContain('cl-05 contradicts cl-04');
    expect(out).not.toContain('rev-05');
  });

  it('explains ranks and what was hidden (FX-M03)', async () => {
    const client = await connected();
    const out = textOf(
      await client.callTool({ name: 'explain', arguments: { query: 'rodent damage combiner' } }),
    );
    expect(out).toMatch(/lexical rank \d/);
    expect(out).toMatch(/vector rank \d/);
    expect(out).toContain('1 revision(s) exist that u-jordan may not see');
  });

  it('describes a case and the review queue', async () => {
    const client = await connected();
    const c = textOf(await client.callTool({ name: 'get_case', arguments: { caseId: 'case-01' } }));
    expect(c).toContain('Replaced all DC string fuses (WO-1001) → failed');
    expect(c).toContain('anc-02');
    const hidden = textOf(
      await client.callTool({ name: 'get_case', arguments: { caseId: 'case-03' } }),
    );
    expect(hidden).toContain('No case case-03 visible');
    const q = textOf(await client.callTool({ name: 'queue', arguments: {} }));
    expect(q).toContain('cand-01: merge entity site-mesa-ridge');
  });

  it('hands ingest to the worker with the principal as actor', async () => {
    const calls: string[][] = [];
    const client = await connected(async (args) => {
      calls.push(args);
      return { code: 0, output: 'ingested rev-x' };
    });
    const out = textOf(
      await client.callTool({
        name: 'ingest',
        arguments: { path: '/tmp/wo.pdf', kind: 'work-order', siteIds: ['site-mesa-ridge'] },
      }),
    );
    expect(out).toBe('ingested rev-x');
    expect(calls[0]).toEqual([
      'ingest',
      '/tmp/wo.pdf',
      '--actor',
      'u-jordan',
      '--kind',
      'work-order',
      '--site',
      'site-mesa-ridge',
    ]);
  });

  it('refuses ingest when no API is configured', async () => {
    const client = await connected();
    const out = textOf(
      await client.callTool({ name: 'ingest', arguments: { path: '/tmp/x.pdf' } }),
    );
    expect(out).toContain('ingest is disabled');
  });
});
