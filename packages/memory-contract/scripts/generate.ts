import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE, FIXTURE_LOG } from '@hybrid/memory-domain';
import { z } from 'zod';
import * as api from '../src/api';
import * as events from '../src/events';
import * as records from '../src/records';

// Writes the JSON Schema the Python worker generates its models from, and the fixture as JSON so
// both languages test against the same data. CI fails if the output differs from what is committed.

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'generated');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'schema'), { recursive: true });

// Shared sub-schemas get their own names so the Python models reuse one class for each.
const shared: Record<string, z.ZodType> = {
  confidence: records.Confidence,
  'record-base': records.RecordBase,
  locator: records.Locator,
  method: records.Method,
  'external-ref': records.ExternalRef,
  'claim-object': records.ClaimObject,
  'anchor-link': records.AnchorLink,
  'action-tried': records.ActionTried,
  assessment: records.Assessment,
  'proposal-draft': records.ProposalDraft,
  chunk: api.Chunk,
};

const named: Record<string, z.ZodType> = {
  ...shared,
  ...records.RECORD_SCHEMAS,
  'memory-dataset': records.MemoryDataset,
  'memory-event': events.MemoryEvent,
  'logged-event': events.LoggedEvent,
  'event-log': events.EventLog,
  'append-event-request': api.AppendEventRequest,
  'append-event-response': api.AppendEventResponse,
  'submit-chunks-request': api.SubmitChunksRequest,
  'submit-chunks-response': api.SubmitChunksResponse,
  'submit-candidates-request': api.SubmitCandidatesRequest,
  'submit-candidates-response': api.SubmitCandidatesResponse,
  'submit-intake-request': api.SubmitIntakeRequest,
  'submit-intake-response': api.SubmitIntakeResponse,
  'embed-request': api.EmbedRequest,
  'embed-response': api.EmbedResponse,
  'search-hit': api.SearchHit,
  'search-response': api.SearchResponse,
  'queue-response': api.QueueResponse,
  'case-response': api.CaseResponse,
  'api-error': api.ApiError,
};

const write = (name: string, value: unknown) =>
  writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');

for (const [name, schema] of Object.entries(named)) {
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
    io: 'input',
  });
  write(join('schema', `${name}.json`), {
    $id: `https://hybrid-mind.local/schema/${name}.json`,
    title: name,
    ...json,
  });
}
// One document with every schema under $defs, cross-referenced, for datamodel-codegen.
const pascal = (name: string) =>
  name.replace(/(^|-)([a-z])/g, (_, __, ch: string) => ch.toUpperCase());
for (const [name, schema] of Object.entries(named))
  schema.register(z.globalRegistry, { id: pascal(name) });
const registry = z.toJSONSchema(z.globalRegistry, {
  target: 'draft-2020-12',
  unrepresentable: 'any',
  io: 'input',
  uri: (id) => `#/$defs/${id}`,
});
write('contract.json', {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://hybrid-mind.local/schema/contract.json',
  title: 'Hybrid-Mind memory contract',
  $defs: Object.fromEntries(
    Object.entries(registry.schemas).map(([id, def]) => {
      const rest = { ...(def as Record<string, unknown>) };
      delete rest.$schema;
      delete rest.$id;
      return [id, rest];
    }),
  ),
});
write('fixture.json', FIXTURE);
write('fixture-log.json', FIXTURE_LOG);
write('manifest.json', { schemas: Object.keys(named).sort(), fixtureLabel: FIXTURE.label });
console.log(`wrote ${Object.keys(named).length} schemas and the fixture to ${out}`);
