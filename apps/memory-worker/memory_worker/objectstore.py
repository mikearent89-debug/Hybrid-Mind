"""Originals are kept under their content hash and never replaced: a changed file is a new
revision, and every anchor keeps pointing at the bytes it was made from."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from memory_worker.hashing import content_hash


class ObjectStore(Protocol):
    def put(self, data: bytes, media_type: str) -> str:
        """Stores the bytes if absent and returns the `sha256:` key."""

    def get(self, key: str) -> bytes: ...

    def exists(self, key: str) -> bool: ...


class LocalObjectStore:
    """A directory tree keyed by hash: <root>/sha256/<ab>/<hash>. S3/MinIO lands in deployment."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        algo, digest = key.split(":", 1)
        return self.root / algo / digest[:2] / digest

    def put(self, data: bytes, media_type: str) -> str:
        key = content_hash(data)
        path = self._path(key)
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.with_suffix(".media-type").write_text(media_type)
        return key

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()
