"""Where the shared contract lives and how the generated models are checked against it."""

from __future__ import annotations

import json
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = WORKER_DIR.parent.parent
CONTRACT_DIR = REPO_DIR / "packages" / "memory-contract" / "generated"
CONTRACT_SCHEMA = CONTRACT_DIR / "contract.json"
FIXTURE_JSON = CONTRACT_DIR / "fixture.json"
FIXTURE_LOG_JSON = CONTRACT_DIR / "fixture-log.json"


def load_fixture() -> dict:
    """The synthetic fixture exactly as the TypeScript side projects it."""
    return json.loads(FIXTURE_JSON.read_text())


def load_fixture_log() -> dict:
    return json.loads(FIXTURE_LOG_JSON.read_text())
