"""Intake of one file: hash and keep the original, parse it, chunk and embed it, submit it to the
API as source + revision + chunks, then (optionally) run extraction and submit the candidates."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from memory_worker import models
from memory_worker.client import MemoryApiClient
from memory_worker.embed import Embedder, NullEmbedder
from memory_worker.extract import Extractor, to_proposals
from memory_worker.hashing import content_hash
from memory_worker.objectstore import ObjectStore
from memory_worker.parsers import ParsedDocument, media_type_of, parse_file
from memory_worker.resolve import EntityIndex

METHOD = ("intake", "0.2")


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass
class IntakeResult:
    source_id: str
    revision_id: str
    episode_id: str
    chunks: int
    anchors: int = 0
    candidates: int = 0
    auto_accepted: list[str] = field(default_factory=list)
    queued: list[str] = field(default_factory=list)
    already_known: bool = False

    def summary(self) -> str:
        lines = [
            f"source {self.source_id} revision {self.revision_id} "
            f"({'already known' if self.already_known else 'new'})",
            f"episode {self.episode_id}: {self.chunks} chunks stored",
        ]
        if self.candidates:
            lines.append(
                f"{self.candidates} candidates with {self.anchors} anchors: "
                f"{len(self.auto_accepted)} auto-accepted, {len(self.queued)} queued for review"
            )
        return "\n".join(lines)


def record_base(record_id: str, access_scope: str, evidence_class: str = "documented") -> dict:
    return {
        "id": record_id,
        "recordVersion": 1,
        "accessScope": access_scope,
        "evidenceClass": evidence_class,
        "reviewState": "accepted",
        "reviewedBy": None,
        "reviewedAt": None,
        "effectiveFrom": None,
        "effectiveTo": None,
    }


def build_records(
    document: ParsedDocument,
    data: bytes,
    *,
    actor: str,
    site_ids: list[str],
    access_scope: str,
    received_at: str,
    media_type: str,
) -> tuple[models.Episode, models.Source, models.Revision]:
    digest = content_hash(data)
    short = digest.split(":", 1)[1][:12]
    source = models.Source.model_validate(
        {
            **record_base(f"src-{short}", access_scope),
            "kind": document.kind,
            "title": document.title,
            "originSystem": document.origin_system or "manual-upload",
            "externalId": document.external_id,
            "siteIds": site_ids,
        }
    )
    revision = models.Revision.model_validate(
        {
            **record_base(f"rev-{short}", access_scope),
            "sourceId": source.id,
            "contentHash": digest,
            "mediaType": media_type,
            "byteLength": len(data),
            "receivedAt": received_at,
            "supersedesRevisionId": None,
        }
    )
    correlation = f"intake-{uuid.uuid4()}"
    episode = models.Episode.model_validate(
        {
            **record_base(f"ep-{correlation}", access_scope),
            "startedAt": received_at,
            "actorId": actor,
            "method": {"name": METHOD[0], "version": METHOD[1]},
            "correlationId": correlation,
            "revisionIds": [revision.id],
        }
    )
    return episode, source, revision


def context_prefix(document: ParsedDocument, site_ids: list[str]) -> str:
    sites = f", sites {', '.join(site_ids)}" if site_ids else ""
    return f"{document.title} ({document.kind}{sites})"


def ingest_file(
    path: Path,
    *,
    client: MemoryApiClient,
    object_store: ObjectStore,
    actor: str,
    kind: str | None = None,
    site_ids: list[str] | None = None,
    access_scope: str = "standard",
    embedder: Embedder | None = None,
    extractor: Extractor | None = None,
    received_at: str | None = None,
) -> IntakeResult:
    site_ids = site_ids or []
    embedder = embedder or NullEmbedder()
    data = path.read_bytes()
    media_type = media_type_of(path)
    object_store.put(data, media_type)
    document = parse_file(path, kind)
    episode, source, revision = build_records(
        document,
        data,
        actor=actor,
        site_ids=site_ids,
        access_scope=access_scope,
        received_at=received_at or now_iso(),
        media_type=media_type,
    )

    known_before = client.memory(actor)
    prefix = context_prefix(document, site_ids)
    embeddings = embedder.embed([f"{prefix}\n\n{s.text}" for s in document.segments])
    chunks = [
        models.Chunk(
            index=i,
            text=segment.text,
            contextPrefix=prefix,
            locator=models.Locator.model_validate(segment.locator),
            embedding=embeddings[i],
            embeddingModel=embedder.model,
        )
        for i, segment in enumerate(document.segments)
    ]
    already_known = any(r.id == revision.id for r in known_before.revisions)
    submitted = client.submit_intake(
        models.SubmitIntakeRequest(
            episode=episode, source=source, revision=revision, chunks=chunks, actorId=actor
        )
    )
    result = IntakeResult(
        source_id=source.id,
        revision_id=revision.id,
        episode_id=episode.id,
        chunks=submitted.stored,
        already_known=already_known,
    )
    if extractor is None or not document.segments:
        return result

    extraction = extractor.extract(document, known_before)
    proposals = to_proposals(
        extraction,
        document,
        revision.id,
        episode.id,
        EntityIndex(known_before),
        (extractor.name, extractor.version),
        access_scope,
    )
    if not proposals.candidates:
        return result
    response = client.submit_candidates(
        models.SubmitCandidatesRequest(
            episode=episode,
            anchors=proposals.anchors,
            candidates=proposals.candidates,
            actorId=actor,
        )
    )
    result.anchors = len(proposals.anchors)
    result.candidates = len(proposals.candidates)
    result.auto_accepted = list(response.autoAccepted)
    result.queued = list(response.queued)
    return result
