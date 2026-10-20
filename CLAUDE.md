# Hybrid-Mind — Solar Portfolio Memory

pnpm + Turborepo monorepo (TypeScript) plus one `uv`-managed Python package. A shared, evidence-backed memory of O&M cases, claims and lessons for a solar portfolio: one append-only PostgreSQL store, one API that writes, human review before anything is published, and lessons that are earned from recorded outcomes. The specification is in `docs/spec/`; read `MEMORY-SPEC.md` before changing behavior.

## Map

| Path                       | Package                   | What it is                                                                                                                    |
| -------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `docs/spec`                | —                         | MEMORY-SPEC (behavior and records), DATA-SPEC-MAPPING (each record's EAM_MA counterpart), EVALUATION (pass criteria)          |
| `packages/memory-domain`   | `@hybrid/memory-domain`   | Pure TypeScript: record types, the event log, projections, `visibleMemory()`, the auto-accept rule, alias resolution, fixture |
| `packages/memory-contract` | `@hybrid/memory-contract` | zod schemas for every record, event and API payload; `pnpm build` writes `generated/` (JSON Schema + fixture JSON)            |
| `packages/memory-store`    | `@hybrid/memory-store`    | PostgreSQL migrations, `PgEventStore`, `MemoryEventStore` (tests), the fixture loader                                         |
| `apps/memory-api`          | `@hybrid/memory-api`      | Hono HTTP API, the only process that writes; the MCP server joins it in M1                                                    |
| `apps/memory-worker`       | `memory-worker` (Python)  | Parsing, chunking, embeddings, Claude extraction, nightly reflect; talks to the API only                                      |

`@hybrid/memory-domain` ships TypeScript source (no build step). `@hybrid/memory-contract` builds `generated/`, which is committed; CI fails if it is stale. The Python models in `apps/memory-worker/memory_worker/models.py` are generated from `generated/contract.json` and also committed.

## Commands (run from the repo root)

- `pnpm check`: lint + typecheck + test + build for every TypeScript package (CI also runs `format:check`)
- `pnpm turbo run test --filter=@hybrid/memory-domain`: one package
- `pnpm --filter @hybrid/memory-domain exec vitest run src/store.test.ts`: one test file
- `pnpm --filter @hybrid/memory-contract build`: regenerate `generated/` after changing a schema, then `cd apps/memory-worker && uv run python scripts/generate_models.py`
- `docker compose up -d postgres minio`, then `DATABASE_URL=postgres://memory:memory@localhost:5432/memory pnpm --filter @hybrid/memory-store load-fixture`
- `pnpm --filter @hybrid/memory-api dev`: the API (in-memory log without `DATABASE_URL`)
- `cd apps/memory-worker && uv sync && uv run pytest && uv run ruff check . && uv run ruff format .`
- `pnpm format`: Prettier (CI fails on unformatted files)

## Conventions

- **Spec first.** Behavior comes from `docs/spec/MEMORY-SPEC.md`. If code needs to differ, change the spec in the same PR. Reference fixture cases (`FX-Mxx`) in tests and PRs.
- **One write path.** Only `apps/memory-api` appends to the log, through `EventStore.append`. The Python worker submits JSON through the API and never opens a database connection. Tables in PostgreSQL are projections of `event_log`; never write them directly.
- **Append only.** Never edit or delete logged events. A correction is a `record-superseded` or `claim-invalidated` event. `supersedeRecord()` refuses an edit that was not based on the current `recordVersion`.
- **Domain stays pure.** `packages/memory-domain` has no I/O, no React, no database. `projectMemory()` is deterministic: same log, same dataset.
- **Anchor or nothing.** A claim needs at least one anchor into an immutable revision; the fixture test enforces it. Uncertainty is `{ level, reasons }`, never a numeric score.
- **Access goes through `visibleMemory(principal)`.** Every read the API serves, every search, export and assistant context.
- **Auto-accept is narrow.** `autoAcceptable()` is the only path that accepts without a person: documented, one supporting anchor, entities resolved by external ID, no conflict. Everything else waits for review.
- **Synthetic data only.** `packages/memory-domain/src/fixture.ts` is invented and labeled "synthetic" wherever shown. Real portfolio material enters only the owner's deployment. Add a fixture case rather than real records.
- **Contract in both languages.** A record or payload change goes in `packages/memory-contract/src`, then rebuild `generated/` and regenerate the Python models. `satisfies z.ZodType<D.X>` keeps schema and domain type in step.
- Times are ISO strings: instants in UTC, date-only values as `YYYY-MM-DD`. Every event carries `recordedAt` (when memory learned it) and `effectiveAt` (when it is true in the world).
- TypeScript is strict with `noUncheckedIndexedAccess`. Keep `typescript` on 6.0.x, because typescript-eslint does not support TS 7 yet. Python is 3.13 with ruff.
