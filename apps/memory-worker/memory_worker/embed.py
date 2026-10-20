"""Embeddings come from the API's one model (POST /embed) so chunks and queries agree."""

from __future__ import annotations

from typing import Protocol

from memory_worker.client import MemoryApiClient


class Embedder(Protocol):
    model: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class ApiEmbedder:
    def __init__(self, client: MemoryApiClient, batch_size: int = 64) -> None:
        self._client = client
        self._batch_size = batch_size
        self.model = "api"

    def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), self._batch_size):
            response = self._client.embed(texts[i : i + self._batch_size])
            self.model = response.model
            out.extend(response.embeddings)
        return out


class NullEmbedder:
    """No vectors: the store falls back to full-text search for these chunks."""

    model = "none"

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [[] for _ in texts]
