"""`memory-worker` command line. Everything it does goes through the HTTP API."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from memory_worker.client import MemoryApiClient
from memory_worker.embed import ApiEmbedder, NullEmbedder
from memory_worker.intake import ingest_file
from memory_worker.objectstore import LocalObjectStore


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="memory-worker")
    parser.add_argument("--api", default=os.environ.get("MEMORY_API_URL", "http://localhost:8787"))
    parser.add_argument(
        "--objects",
        default=os.environ.get("OBJECT_STORE_DIR", str(Path.home() / ".hybrid-mind" / "objects")),
        help="directory for original files, keyed by content hash",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="store, chunk and extract one file")
    ingest.add_argument("path", type=Path)
    ingest.add_argument(
        "--kind", choices=["email", "work-order", "report", "photo", "csv", "note", "document"]
    )
    ingest.add_argument("--site", action="append", default=[], dest="sites")
    ingest.add_argument("--actor", default=os.environ.get("MEMORY_PRINCIPAL", "u-jordan"))
    ingest.add_argument("--restricted", action="store_true")
    ingest.add_argument("--no-extract", action="store_true", help="store and chunk only")
    ingest.add_argument(
        "--no-embed", action="store_true", help="skip embeddings (full-text search only)"
    )
    ingest.add_argument("--model", default=os.environ.get("EXTRACTION_MODEL", "claude-opus-5-5"))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "ingest":
        with MemoryApiClient(args.api) as client:
            if not client.health():
                print(f"memory-api at {args.api} is not healthy", file=sys.stderr)
                return 2
            extractor = None
            if not args.no_extract:
                if not (
                    os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                ):
                    print(
                        "no Anthropic credentials; storing and chunking only "
                        "(pass --no-extract to silence)",
                        file=sys.stderr,
                    )
                else:
                    from memory_worker.extract import ClaudeExtractor

                    extractor = ClaudeExtractor(model=args.model)
            result = ingest_file(
                args.path,
                client=client,
                object_store=LocalObjectStore(Path(args.objects)),
                actor=args.actor,
                kind=args.kind,
                site_ids=args.sites,
                access_scope="restricted" if args.restricted else "standard",
                embedder=NullEmbedder() if args.no_embed else ApiEmbedder(client),
                extractor=extractor,
            )
            print(result.summary())
            return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
