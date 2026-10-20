# Hybrid-Mind — Solar Portfolio Memory

A shared memory for a solar portfolio's operations and maintenance: what went wrong at which site, on which equipment and firmware, what was tried, what it cost, and what actually worked. Every fact points at the exact place in the original document it came from, people review anything that involves judgment before it is published, and lessons are strengthened, qualified or retired by recorded outcomes.

It is one custom system, not a set of memory products: one append-only PostgreSQL store, one API that writes, a Python worker that reads documents and asks Claude to propose candidates, and an MCP server (milestone M1) so Claude Desktop, Claude Code and the Portfolio World Workbench (EAM_MA) all use the same tools.

The specification is in [`docs/spec/MEMORY-SPEC.md`](docs/spec/MEMORY-SPEC.md). All data in this repository is synthetic.

## Getting started

Requires Node 22, pnpm 10, Python 3.13 and uv. Docker is optional (PostgreSQL + MinIO for integration tests).

```sh
pnpm install
pnpm check                                   # lint, typecheck, test, build (TypeScript)
cd apps/memory-worker && uv sync && uv run pytest   # Python worker

docker compose up -d postgres minio
export DATABASE_URL=postgres://memory:memory@localhost:5432/memory
pnpm --filter @hybrid/memory-store load-fixture   # fixture records + document chunks
pnpm --filter @hybrid/memory-api dev              # http://localhost:8787
curl 'http://localhost:8787/search?principal=u-jordan&q=INV-HP-02+firmware' | head -c 600
```

The first search downloads the embedding model (`Xenova/bge-small-en-v1.5`, about 130 MB) into the transformers.js cache; set `EMBEDDING_MODEL=hash` to skip that with a dependency-free bag-of-words embedder.

### Ingest a document

```sh
cd apps/memory-worker
export MEMORY_API_URL=http://localhost:8787
uv run memory-worker ingest ~/Downloads/WO-1001.pdf --kind work-order --site site-mesa-ridge --actor u-avery
```

The worker hashes the file into `~/.hybrid-mind/objects`, parses it (PDF, `.eml`, `.csv`, `.md`/`.txt`, photos), chunks and embeds it through the API, and submits it as source + revision + chunks. With `ANTHROPIC_API_KEY` set it then asks Claude to extract entities, claims and case matches; documented claims that meet the auto-accept rule are accepted at once, everything else lands in the review queue. `--no-extract` stores and chunks only.

### Use it from Claude Desktop

Add the stdio MCP server to `claude_desktop_config.json` (the HTTP API must be running for `ingest`; search works without it):

```json
{
  "mcpServers": {
    "portfolio-memory": {
      "command": "pnpm",
      "args": ["--filter", "@hybrid/memory-api", "mcp"],
      "cwd": "/path/to/Hybrid-Mind",
      "env": {
        "DATABASE_URL": "postgres://memory:memory@localhost:5432/memory",
        "MEMORY_API_URL": "http://localhost:8787",
        "MEMORY_PRINCIPAL": "u-avery"
      }
    }
  }
}
```

Tools: `search`, `explain`, `get_case`, `queue`, `ingest`. Every tool runs as `MEMORY_PRINCIPAL` and sees only what that principal may see. Without `DATABASE_URL` the server serves the synthetic fixture from memory. The same tools are available over HTTP at `POST /mcp?principal=…` for remote clients.

## Layout

- `packages/memory-domain`: records, the event log, projections, access, the auto-accept rule, alias resolution, and the synthetic fixture.
- `packages/memory-contract`: zod schemas, exported as JSON Schema for the Python worker.
- `packages/memory-store`: PostgreSQL migrations and stores.
- `apps/memory-api`: the HTTP API (and later the MCP server).
- `apps/memory-worker`: the Python intake and reflect worker.
- `docs/spec`: specification, mapping to the Workbench data spec, evaluation protocol.

## Status

| Milestone                 | State                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| M0 — Scaffold             | In review: domain, contract, store, API skeleton, worker skeleton, fixture, specification            |
| M1 — Intake + retrieval   | Not started: PDF / email / CSV / photo intake, hybrid search, MCP server, 30-question evaluation set |
| M2 — Cases, graph, review | Not started                                                                                          |
| M3 — Lessons + outcomes   | Not started                                                                                          |
| M4 — Workbench publish    | Not started; waits for EAM_MA milestone 1B                                                           |
