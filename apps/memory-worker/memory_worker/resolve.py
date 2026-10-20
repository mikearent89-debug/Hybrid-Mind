"""Entity resolution on the worker side, mirroring resolveEntity() in memory-domain: an exact
name or known alias resolves; anything else becomes a reviewed candidate, never a silent match."""

from __future__ import annotations

import re
from dataclasses import dataclass

from memory_worker import models


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w]+", " ", name.lower(), flags=re.UNICODE)).strip()


@dataclass(frozen=True)
class Resolved:
    entity_id: str
    via: str  # "name" | "alias"


class EntityIndex:
    def __init__(self, dataset: models.MemoryDataset) -> None:
        self._by_name: dict[str, str] = {}
        self._by_alias: dict[str, str] = {}
        self.known: dict[str, models.Entity] = {}
        for e in dataset.entities:
            if e.reviewState == "superseded":
                continue
            self.known[e.id] = e
            self._by_name.setdefault(normalize_name(e.name), e.id)
        for a in dataset.aliases:
            if a.origin != "proposed" and a.entityId in self.known:
                self._by_alias.setdefault(normalize_name(a.alias), a.entityId)

    def resolve(self, name: str) -> Resolved | None:
        key = normalize_name(name)
        if key in self._by_name:
            return Resolved(self._by_name[key], "name")
        if key in self._by_alias:
            return Resolved(self._by_alias[key], "alias")
        return None
