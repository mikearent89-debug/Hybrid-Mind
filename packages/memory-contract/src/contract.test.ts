import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE, FIXTURE_LOG } from '@hybrid/memory-domain';
import type * as D from '@hybrid/memory-domain';
import type { z } from 'zod';
import { EventLog, MemoryDataset, RECORD_SCHEMAS } from './index';

const generated = join(import.meta.dirname, '..', 'generated');

describe('contract', () => {
  it('accepts every fixture record', () => {
    const collection: Record<
      keyof typeof RECORD_SCHEMAS,
      Exclude<keyof D.MemoryDataset, 'label'>
    > = {
      source: 'sources',
      revision: 'revisions',
      anchor: 'anchors',
      episode: 'episodes',
      entity: 'entities',
      'entity-alias': 'aliases',
      claim: 'claims',
      case: 'cases',
      lesson: 'lessons',
      candidate: 'candidates',
      proposal: 'proposals',
      outcome: 'outcomes',
    };
    for (const type of Object.keys(RECORD_SCHEMAS) as (keyof typeof RECORD_SCHEMAS)[]) {
      const schema: z.ZodType = RECORD_SCHEMAS[type];
      for (const record of FIXTURE[collection[type]]) {
        const result = schema.safeParse(record);
        expect(
          result.success,
          `${type} ${record.id}: ${JSON.stringify(result.error?.issues)}`,
        ).toBe(true);
      }
    }
    expect(MemoryDataset.safeParse(FIXTURE).success).toBe(true);
  });

  it('accepts the whole fixture log and rejects an unknown event', () => {
    expect(EventLog.safeParse(FIXTURE_LOG).success).toBe(true);
    const bad = { ...FIXTURE_LOG, events: [{ ...FIXTURE_LOG.events[0], event: { type: 'nope' } }] };
    expect(EventLog.safeParse(bad).success).toBe(false);
  });

  it('rejects a record that drifts from the contract', () => {
    const claim = FIXTURE.claims[0]!;
    expect(RECORD_SCHEMAS.claim.safeParse({ ...claim, anchors: [{ anchorId: 'x' }] }).success).toBe(
      false,
    );
    expect(
      RECORD_SCHEMAS.revision.safeParse({ ...FIXTURE.revisions[0], contentHash: 'md5:1' }).success,
    ).toBe(false);
  });

  it('has a committed JSON Schema for every named schema (run `pnpm build` after a change)', () => {
    const manifest = JSON.parse(readFileSync(join(generated, 'manifest.json'), 'utf8')) as {
      schemas: string[];
    };
    const files = readdirSync(join(generated, 'schema'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
    expect(files).toEqual(manifest.schemas);
    expect(files).toContain('claim');
    expect(files).toContain('submit-candidates-request');
  });
});
