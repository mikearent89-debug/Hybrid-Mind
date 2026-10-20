"""Content hashes name revisions and object-store keys: a replaced file is a new revision."""

from __future__ import annotations

import hashlib


def content_hash(data: bytes) -> str:
    """`sha256:<hex>`, the form the contract's Revision.contentHash requires."""
    return "sha256:" + hashlib.sha256(data).hexdigest()
