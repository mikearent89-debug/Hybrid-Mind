# Solar Portfolio Memory — Specification

## v0.2, October 20, 2026. Status: **approved plan, M0 in review**

This document specifies the memory system; it does not report implemented software beyond what [README.md](../../README.md) lists as complete. Section references to DATA-SPEC are to the Portfolio World Workbench (EAM_MA) data specification v1.1; [DATA-SPEC-MAPPING.md](DATA-SPEC-MAPPING.md) maps each memory record to its Workbench counterpart. [EVALUATION.md](EVALUATION.md) holds the pass criteria per milestone.

## 1. Purpose

Remember the history of a solar portfolio's O&M work, connect the evidence, and learn what works: case histories organized by the conditions that made each solution work, every fact traceable to the exact place in an original document, human review before anything is published, and lessons whose standing is earned from recorded outcomes.

The owner's decisions (October 20, 2026): one custom system in this repository; one PostgreSQL store; TypeScript for records, log, review and API, Python for parsing and extraction, with one write path; real data only in the owner's deployment, development on a synthetic fixture.

## 2. What it is not

- Not a set of third-party memory products. Basic Memory, Graphiti/Zep, Claude-Mem, Mem0, Hindsight, Cognee and Letta are pattern references only (section 11).
- Not a place where real portfolio data meets a hosted service. The worker calls Claude for extraction over the owner's own API key from the owner's deployment; the store and originals stay there.
- Not a model that learns. Learning changes stored knowledge (claims, cases, lessons) through events; weights are never trained.

## 3. Principles

1. Every record has an immutable internal ID; external IDs live in `externalRefs`.
2. Nothing is deleted. A correction is a superseding or invalidating event.
3. Recorded time (when memory learned it) and effective time (when it is true in the world) are separate on every event and every claim.
4. A claim has at least one anchor into an immutable revision. A claim without one cannot leave `unreviewed`.
5. Uncertainty is a described property: a level (low, medium, high) with reasons. No invented numeric scores (DATA-SPEC principle 10).
6. Assistant output is distinguishable from recorded fact: it arrives as a candidate with its method and version, and becomes fact only by a decision event.
7. Access scope is on every record and applied by one function before any read.
8. Missing, unknown, unresolved and conflicting are distinct states; none becomes a default.
9. Synthetic data only in development and tests, labeled as such wherever shown.

## 4. Persistence shape

The store is an append-only event log; every table is a projection of it (DATA-SPEC section 1a, kept identical so publishing into the Workbench is a straight mapping).

- `event_log(position, recorded_at, effective_at, actor_id, correlation_id, event_type, event)`: the only table anything writes to. UPDATE, DELETE and TRUNCATE are refused by a trigger.
- `memory_record(record_type, id, record_version, access_scope, evidence_class, review_state, effective_from, effective_to, data, projected_from)`: the current version of every record, rewritten by the projector within the same transaction as the event.
- `edge(claim_id, from_id, relation, to_id | to_value + to_unit, valid_from, valid_to, invalidated_at, …)`: claims as bitemporal edges for graph-neighborhood queries (recursive CTEs).
- `chunk(revision_id, episode_id, chunk_index, text, context_prefix, locator, embedding vector, embedding_model, tsv)`: contextual chunks for lexical (`tsvector`) and vector (`pgvector`) retrieval.
- Originals live in an object store under their content hash; a `revision` row names the hash. A replaced file is a new revision; old anchors stay valid.

Positions are version boundaries: a projection as of position _n_ is the state any reader saw at _n_. A dedicated graph database is a later gate, taken only if traversal depth or latency forces it.

## 5. Records

Every record carries `id`, `recordVersion`, `accessScope` (standard | restricted), `evidenceClass` (documented | field-verified | inferred | illustrative | proposed | unknown), `reviewState` (unreviewed | accepted | rejected | superseded), `reviewedBy`, `reviewedAt`, `effectiveFrom`, `effectiveTo`. The authoritative field list is `packages/memory-domain/src/types.ts`; the contract in `packages/memory-contract/src/records.ts` enforces it.

| Record           | Holds                                                                                                                                                                                                                                                    | Notes                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **source**       | kind (email, work-order, report, photo, csv, note, document), title, origin system, external ID, site IDs                                                                                                                                                | A file or message as received                             |
| **revision**     | source ID, `sha256:` content hash, media type, byte length, received time, superseded revision                                                                                                                                                           | Immutable; also the object-store key                      |
| **anchor**       | revision ID, locator (page + region, text span + quote, row + column, time segment, image region, whole)                                                                                                                                                 | An exact place in a revision                              |
| **episode**      | start time, actor, method + version, correlation ID, revision IDs                                                                                                                                                                                        | One intake batch; how and when extraction ran             |
| **entity**       | kind (site, equipment-unit, equipment-model, firmware, organization, person, contract, region, operating-condition), name, attributes, external refs                                                                                                     | `externalRefs` link to Workbench IDs                      |
| **entity-alias** | entity ID, alias text, origin (seed, reviewed, proposed)                                                                                                                                                                                                 | Seeded from the owner's lists; fuzzy matches go to review |
| **claim**        | subject, relation, object (entity or value + unit), anchors with roles, episode, superseded claim, invalidated-at                                                                                                                                        | A bitemporal edge; invalidated, never deleted             |
| **case**         | title, symptom, context (entities + conditions), investigation (hypotheses, diagnostic actions, unresolved questions), actions tried with results, fix, cost, downtime, outcome, limitations, owner, claims, anchors, opened / closed                    | DATA-SPEC 5.3 investigation + 6.5 knowledge case          |
| **lesson**       | statement, conditions, action, expected outcome, supporting cases, counter-evidence cases, status (candidate, reviewed, qualified, retired), owner                                                                                                       | "Under conditions C, action A led to outcome O"           |
| **candidate**    | operation (add, update, merge, invalidate), target type and ID, merge source, payload, method + version, uncertainty, episode, decision                                                                                                                  | Nothing becomes fact without a decision                   |
| **proposal**     | case, stage, assessment (similar cases, key differences, evidence gaps, next steps, cause confidence, next-step confidence), draft (scope, owners, dates, dependencies, cost basis with anchors, success criteria), published-at, Workbench log position | Assessment → review 1 → draft → review 2 → published      |
| **outcome**      | proposal, description, result (succeeded, failed, partial, unknown), lessons tested, recorded by, occurred at, anchors                                                                                                                                   | The test of a lesson                                      |

Anchor roles: supporting, conflicting, contextual, superseding (DATA-SPEC 4.2).

## 6. Events

| Event                                                                           | Effect in the projection                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `record-added {recordType, record}`                                             | Inserts (or idempotently replaces by ID)                                                                      |
| `record-superseded {recordType, record, basedOnVersion, reason}`                | Replaces; `supersedeRecord()` refuses a `basedOnVersion` that is not current                                  |
| `claim-invalidated {claimId, invalidatedAt, reason, supersededByClaimId}`       | Sets `invalidatedAt`, closes `effectiveTo` if open, `reviewState = superseded`                                |
| `claim-auto-accepted {claimId, rule}`                                           | `reviewState = accepted`, `reviewedBy = system:auto-accept`                                                   |
| `candidate-decided {candidateId, decision, reason, resultingId}`                | Records the decision with the acting principal and time                                                       |
| `review-recorded {proposalId, gate 1 \| 2, approve \| revise \| reject, notes}` | Gate 1 approve → `draft`; gate 2 approve → `reviewState = accepted`; revise → `returned`; reject → `rejected` |
| `proposal-published {proposalId, publishedAt, workbenchLogPosition}`            | `stage = published`                                                                                           |
| `entities-merged {survivorId, mergedId, reason}`                                | Merged entity `superseded`; its name becomes a reviewed alias of the survivor; claims and cases re-point      |
| `lesson-status-changed {lessonId, status, reason}`                              | Sets the status                                                                                               |

Every logged event has `position`, `recordedAt`, `effectiveAt`, `actorId`, `correlationId`.

## 7. The auto-accept rule (`auto-accept/v1`)

A claim is accepted without a human review only when all of the following hold:

1. `evidenceClass = documented`;
2. exactly one anchor, with role `supporting`, pointing at an anchor that exists and names a stored revision;
3. the subject entity, and the object entity if the object is an entity, each carry at least one `externalRef` (resolved by external ID, not by a fuzzy alias);
4. no live claim in memory asserts a different object for the same subject and relation over an overlapping effective window;
5. the claim is `unreviewed`.

The acceptance is three events by the actor `system:auto-accept` (`record-added` claim, `claim-auto-accepted`, `candidate-decided`) and is reversible by a superseding event. Everything else (inferred claims, conflicts, merges, cases, lessons, proposals) waits for a reviewer. A daily digest lists what was auto-accepted (M2).

## 8. Access

`visibleMemory(dataset, principal)` is the only read path. A principal without restricted access sees no restricted record and nothing that hangs off one: revisions of a restricted source, anchors into them, claims that cite them or name a restricted entity, cases that cite such claims, proposals for such cases, outcomes of such proposals, and candidates that target any of them. Lessons keep their standard-scope statement but lose references to hidden cases. Milestone 1B of the Workbench replaces the fixture principals with real grants; the function does not change.

## 9. Pipeline

1. **Intake (worker):** file → `sha256` → object store → revision; parse (PDF, .eml/.msg, CSV, image via vision, note); contextual chunks (each prefixed with document, site and page context); embeddings; submit chunks. Backlog runs through batch processing with prompt caching; interactive requests use normal calls.
2. **Extraction (worker):** Claude proposes entities, claims and case matches, each with anchors and described uncertainty → `SubmitCandidatesRequest`.
3. **Arrival (API):** the episode and candidates are appended; each "add claim" candidate is tested by the auto-accept rule; the rest queue for review.
4. **Entity resolution:** `resolveEntity()` matches an exact name or seeded alias without review; a fuzzy match is a suggestion that becomes a `merge` candidate.
5. **Retrieval (M1):** full-text + vector + graph neighborhood + time filter → rerank → answer with anchors. Similar cases combine structured conditions (model, firmware, region, vendor) with text similarity and list key differences.
6. **Review:** gate 1 on the assessment, gate 2 on the draft; both are `review-recorded` events.
7. **Publish (M4):** accepted cases, lessons and proposals go to the Workbench as knowledge case, evidence links and decision records through its access policy, with the log position recorded on both sides.
8. **Outcome and reflect (M3):** outcomes are recorded against proposals; a nightly job proposes lesson strengthen / qualify / retire, duplicate cases and stale claims as candidates only.

## 10. Fixture

`packages/memory-domain/src/fixture.ts` is "Sunbelt Solar Portfolio memory (synthetic)": 4 sites, 3 vendors, 2 inverter models × 2 firmware versions, 12 cases, built entirely from log events. Named cases:

| Case   | Covers                                                                     |
| ------ | -------------------------------------------------------------------------- |
| FX-M01 | A failed fix followed by a successful one, both recorded with results      |
| FX-M02 | Two documents disagree on one fact; the conflict is reported, not resolved |
| FX-M03 | A restricted case, visible only to a principal with restricted access      |
| FX-M04 | A claim that qualifies for auto-accept                                     |
| FX-M05 | An inferred claim that must be reviewed, then is accepted by a person      |
| FX-M06 | Sibling cases at two sites for similar-case search                         |
| FX-M07 | A claim superseded when its subject was upgraded                           |
| FX-M08 | A lesson with supporting cases and counter-evidence on another model       |
| FX-M09 | A proposal through both gates, published, with a recorded outcome          |
| FX-M10 | Alias resolution and a reviewed entity merge                               |
| FX-M11 | A candidate awaiting review                                                |
| FX-M12 | A proposal blocked by the conflict in FX-M02                               |

## 11. Patterns taken from other systems

| Pattern                                                                             | Seen in        | Here                                                         |
| ----------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------ |
| Facts as edges with valid-from / valid-to and recorded-at; invalidate, never delete | Graphiti / Zep | `claim`, `edge`                                              |
| Every ingest batch is a traceable episode                                           | Graphiti       | `episode`                                                    |
| Retain / recall / reflect; lessons backed by combined evidence                      | Hindsight      | `lesson`, reflect job                                        |
| Human-readable notes with links                                                     | Basic Memory   | Markdown export (M2); the database stays the source of truth |
| Add / update / invalidate / no-op decided by the model, with conflict detection     | Mem0           | `candidate` with operation and decision                      |
| Chunk → extract → link; hybrid retrieval                                            | Cognee         | intake pipeline, `chunk`                                     |
| Core memory block + archival memory; background consolidation                       | Letta          | portfolio summary per principal (M2), reflect job (M3)       |

## 12. Interfaces

- HTTP API (`apps/memory-api`): `POST /events`, `POST /candidates`, `POST /chunks`, `GET /memory?principal=&asOfPosition=`, `GET /log?after=`, `GET /health`. Payloads are the contract's `AppendEventRequest`, `SubmitCandidatesRequest`, `SubmitChunksRequest`.
- MCP server (M1, same process): `ingest`, `search`, `get_case`, `similar_cases`, `explain`, `propose`, `review`, `publish`, `record_outcome`, `export_markdown`.
- Workbench publish (M4): a spec-first change in EAM_MA adding knowledge case, decision and richer evidence reference types, new `WorkbenchEvent` variants and a `knowledge-cases` view.

## 13. Milestones

| Milestone               | Delivers                                                                                     | Passes when                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| M0 Scaffold             | This repository: domain, contract, store, API skeleton, worker skeleton, fixture, this spec  | Fixture loads; as-of projections pass; the restricted case is invisible to the second principal; both languages validate the same fixture |
| M1 Intake + retrieval   | Document intake, hybrid search, MCP server used from Claude Desktop                          | 30-question set: ≥ 90 % cite the correct anchor; no answer without an anchor                                                              |
| M2 Cases, graph, review | Similar-case search, review workflow in the API and MCP, markdown export, auto-accept digest | Planted sibling case in the top 3 for every fixture case; every review is an event                                                        |
| M3 Lessons + outcomes   | Reflect job, `explain`, outcome recording                                                    | Reflect proposes, never writes; a recorded failed outcome qualifies its lesson                                                            |
| M4 Workbench publish    | Publication into EAM_MA through its access policy                                            | AC-17 holds end to end; a published case opens in the Workbench with its evidence                                                         |

## 14. Change log

| Version | Date       | Change                                                                                             |
| ------- | ---------- | -------------------------------------------------------------------------------------------------- |
| 0.1     | 2026-10-20 | One-pager plan with third-party candidates (superseded)                                            |
| 0.2     | 2026-10-20 | Custom single-store design; auto-accept rule; alias dictionary; batch + cached intake; M0 scaffold |
