"""Backlog extraction through the Message Batches API at half price. `submit` writes one request
per document and records the batch; `collect` turns finished results into candidates and submits
them to the API. The request shape is the same as the interactive extractor's, so prompt caching
applies across the batch too."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from memory_worker import models
from memory_worker.client import MemoryApiClient
from memory_worker.extract import ClaudeExtractor, Extraction, to_proposals
from memory_worker.parsers import ParsedDocument, Segment
from memory_worker.resolve import EntityIndex


@dataclass
class BatchItem:
    custom_id: str
    revision_id: str
    episode_id: str
    actor: str
    access_scope: str
    document: ParsedDocument

    def to_json(self) -> dict:
        return {
            "custom_id": self.custom_id,
            "revision_id": self.revision_id,
            "episode_id": self.episode_id,
            "actor": self.actor,
            "access_scope": self.access_scope,
            "document": {
                "kind": self.document.kind,
                "title": self.document.title,
                "media_type": self.document.media_type,
                "segments": [
                    {"locator": s.locator, "text": s.text} for s in self.document.segments
                ],
            },
        }

    @classmethod
    def from_json(cls, data: dict) -> BatchItem:
        doc = data["document"]
        return cls(
            custom_id=data["custom_id"],
            revision_id=data["revision_id"],
            episode_id=data["episode_id"],
            actor=data["actor"],
            access_scope=data["access_scope"],
            document=ParsedDocument(
                kind=doc["kind"],
                title=doc["title"],
                media_type=doc["media_type"],
                segments=[Segment(locator=s["locator"], text=s["text"]) for s in doc["segments"]],
            ),
        )


def submit_batch(
    items: list[BatchItem],
    dataset: models.MemoryDataset,
    extractor: ClaudeExtractor,
    manifest: Path,
) -> str:
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    requests = []
    for item in items:
        params = extractor.request_params(item.document, dataset)
        params["output_config"] = {
            "format": {"type": "json_schema", "schema": Extraction.model_json_schema()}
        }
        requests.append(
            Request(custom_id=item.custom_id, params=MessageCreateParamsNonStreaming(**params))
        )
    batch = extractor._client.messages.batches.create(requests=requests)
    manifest.write_text(
        json.dumps({"batch_id": batch.id, "items": [i.to_json() for i in items]}, indent=2) + "\n"
    )
    return batch.id


def collect_batch(
    manifest: Path, client: MemoryApiClient, extractor: ClaudeExtractor
) -> dict[str, str]:
    """Returns custom_id → outcome. Results arrive in any order, so everything keys on custom_id."""
    data = json.loads(manifest.read_text())
    items = {i["custom_id"]: BatchItem.from_json(i) for i in data["items"]}
    batch = extractor._client.messages.batches.retrieve(data["batch_id"])
    if batch.processing_status != "ended":
        return {cid: f"batch {batch.processing_status}" for cid in items}
    outcomes: dict[str, str] = {}
    for result in extractor._client.messages.batches.results(data["batch_id"]):
        item = items.get(result.custom_id)
        if item is None:
            continue
        if result.result.type != "succeeded":
            outcomes[result.custom_id] = result.result.type
            continue
        message = result.result.message
        if message.stop_reason == "refusal":
            outcomes[result.custom_id] = "refused"
            continue
        text = next((b.text for b in message.content if b.type == "text"), "")
        extraction = Extraction.model_validate_json(text)
        dataset = client.memory(item.actor)
        proposals = to_proposals(
            extraction,
            item.document,
            item.revision_id,
            item.episode_id,
            EntityIndex(dataset),
            (extractor.name, extractor.version),
            item.access_scope,
        )
        episode = next(e for e in dataset.episodes if e.id == item.episode_id)
        response = client.submit_candidates(
            models.SubmitCandidatesRequest(
                episode=episode,
                anchors=proposals.anchors,
                candidates=proposals.candidates,
                actorId=item.actor,
            )
        )
        outcomes[result.custom_id] = (
            f"{len(proposals.candidates)} candidates: {len(response.autoAccepted)} auto-accepted, "
            f"{len(response.queued)} queued"
        )
    return outcomes
