"""Extraction: Claude reads a parsed document and proposes entities, claims and case matches,
each tied to a quote in a specific segment. The proposals become candidates with anchors; the
API decides what is auto-accepted and what waits for a reviewer. Nothing here writes memory."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from memory_worker import models
from memory_worker.parsers import ParsedDocument
from memory_worker.resolve import EntityIndex

DEFAULT_MODEL = "claude-opus-5-5"

SYSTEM_PROMPT = """You extract operations-and-maintenance facts from documents about a solar
portfolio into a shared memory.

Rules:
- Every claim must quote the exact text it rests on, copied verbatim from one segment, and name
  that segment's index.
- Use evidence class "documented" only when the document states the fact directly; "inferred"
  when it is a reading of the document; "proposed" for a suggestion.
- Do not invent numbers, dates or versions that the text does not contain. If the document
  disagrees with itself, emit both claims.
- Refer to entities by the name used in the document. Equipment units are usually tags like
  INV-MR-03; firmware is "<model> firmware <version>".
- Relations are short kebab-case verbs such as runs-firmware, had-fault, had-fault-cause,
  serviced-by, operates-under, located-at.
- Uncertainty is a level (low, medium, high) with a one-sentence reason, never a number.
- Case matches name an existing case ID from the list you are given and say what is the same and
  what differs."""


class ExtractedEntity(BaseModel):
    name: str
    kind: Literal[
        "site",
        "equipment-unit",
        "equipment-model",
        "firmware",
        "organization",
        "person",
        "contract",
        "region",
        "operating-condition",
    ]
    attributes: dict[str, str] = Field(default_factory=dict)


class ExtractedObject(BaseModel):
    entity_name: str | None = None
    value: str | None = None
    unit: str | None = None


class ExtractedClaim(BaseModel):
    subject_name: str
    relation: str
    object: ExtractedObject
    quote: str
    segment_index: int
    evidence_class: Literal["documented", "inferred", "proposed"]
    effective_from: str | None = None
    effective_to: str | None = None
    uncertainty_level: Literal["low", "medium", "high"]
    uncertainty_reasons: str


class CaseMatch(BaseModel):
    case_id: str
    same: list[str]
    different: list[str]
    uncertainty_level: Literal["low", "medium", "high"]
    uncertainty_reasons: str


class Extraction(BaseModel):
    entities: list[ExtractedEntity]
    claims: list[ExtractedClaim]
    case_matches: list[CaseMatch]


class Extractor(Protocol):
    name: str
    version: str

    def extract(self, document: ParsedDocument, dataset: models.MemoryDataset) -> Extraction: ...


def context_block(dataset: models.MemoryDataset) -> str:
    """Known entities and open cases, sorted so the block is byte-stable and caches well."""
    entities = sorted(
        (e for e in dataset.entities if e.reviewState != "superseded"),
        key=lambda e: (e.kind, e.name),
    )
    aliases: dict[str, list[str]] = {}
    for a in dataset.aliases:
        aliases.setdefault(a.entityId, []).append(a.alias)
    lines = ["Known entities (name | kind | aliases):"]
    for e in entities:
        lines.append(f"- {e.name} | {e.kind} | {', '.join(sorted(aliases.get(e.id, [])))}")
    lines.append("")
    lines.append("Open cases (id | title | symptom):")
    for c in sorted(dataset.cases, key=lambda c: c.id):
        if c.closedAt is None:
            lines.append(f"- {c.id} | {c.title} | {c.symptom}")
    return "\n".join(lines)


def document_block(document: ParsedDocument) -> str:
    parts = [f"Document: {document.title} ({document.kind})"]
    for i, segment in enumerate(document.segments):
        parts.append(
            f"[segment {i}, {json.dumps(segment.locator, sort_keys=True)}]\n{segment.text}"
        )
    return "\n\n".join(parts)


class ClaudeExtractor:
    """Calls Claude with structured output. The system prompt and the entity context are cached
    across documents; the document is the only part that changes per call."""

    name = "claude-extract"

    def __init__(self, model: str = DEFAULT_MODEL, client=None) -> None:
        import anthropic

        self._client = client or anthropic.Anthropic()
        self.model = model
        self.version = model

    def request_params(self, document: ParsedDocument, dataset: models.MemoryDataset) -> dict:
        return {
            "model": self.model,
            "max_tokens": 16000,
            "system": [
                {"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}},
                {
                    "type": "text",
                    "text": context_block(dataset),
                    "cache_control": {"type": "ephemeral"},
                },
            ],
            "messages": [{"role": "user", "content": document_block(document)}],
        }

    def extract(self, document: ParsedDocument, dataset: models.MemoryDataset) -> Extraction:
        response = self._client.messages.parse(
            **self.request_params(document, dataset), output_format=Extraction
        )
        if response.stop_reason == "refusal":
            raise RuntimeError(f"extraction refused: {response.stop_details}")
        parsed = response.parsed_output
        if parsed is None:
            raise RuntimeError("extraction returned no structured output")
        return parsed


@dataclass
class Proposals:
    anchors: list[models.Anchor]
    candidates: list[models.Candidate]


def _record_base(record_id: str, evidence_class: str, access_scope: str) -> dict:
    return {
        "id": record_id,
        "recordVersion": 1,
        "accessScope": access_scope,
        "evidenceClass": evidence_class,
        "reviewState": "unreviewed",
        "reviewedBy": None,
        "reviewedAt": None,
        "effectiveFrom": None,
        "effectiveTo": None,
    }


def to_proposals(
    extraction: Extraction,
    document: ParsedDocument,
    revision_id: str,
    episode_id: str,
    index: EntityIndex,
    method: tuple[str, str],
    access_scope: str = "standard",
) -> Proposals:
    """Turns an extraction into anchors and candidates. Entities the index resolves get their IDs;
    unknown ones become `add entity` candidates whose provisional IDs the claims reuse, so a
    reviewer accepting the entity makes the claims resolvable."""
    anchors: list[models.Anchor] = []
    candidates: list[models.Candidate] = []
    provisional: dict[str, str] = {}
    method_model = models.Method(name=method[0], version=method[1])

    def entity_id_for(name: str, kind: str | None) -> str:
        resolved = index.resolve(name)
        if resolved:
            return resolved.entity_id
        key = name.strip().lower()
        if key in provisional:
            return provisional[key]
        entity_id = f"ent-{uuid.uuid5(uuid.NAMESPACE_URL, f'{revision_id}/{key}')}"
        provisional[key] = entity_id
        extracted = next((e for e in extraction.entities if e.name.strip().lower() == key), None)
        entity = models.Entity.model_validate(
            {
                **_record_base(entity_id, "inferred", access_scope),
                "kind": kind or (extracted.kind if extracted else "operating-condition"),
                "name": name.strip(),
                "attributes": extracted.attributes if extracted else {},
                "externalRefs": [],
            }
        )
        candidates.append(
            models.Candidate.model_validate(
                {
                    **_record_base(f"cand-{uuid.uuid4()}", "inferred", access_scope),
                    "operation": "add",
                    "targetType": "entity",
                    "targetId": None,
                    "mergeSourceId": None,
                    "payload": entity.model_dump(mode="json"),
                    "method": method_model.model_dump(),
                    "uncertainty": {
                        "level": "medium",
                        "reasons": (
                            f'"{name}" matched no known entity or alias; '
                            "a reviewer confirms it is new or merges it"
                        ),
                    },
                    "episodeId": episode_id,
                    "decision": None,
                }
            )
        )
        return entity_id

    for claim in extraction.claims:
        if not (0 <= claim.segment_index < len(document.segments)):
            continue
        segment = document.segments[claim.segment_index]
        start = segment.text.find(claim.quote)
        if start < 0 or not claim.quote.strip():
            continue  # a claim whose quote is not in the text cannot be anchored, so it is dropped
        locator = dict(segment.locator)
        if locator.get("type") == "span":
            locator = {
                "type": "span",
                "start": locator["start"] + start,
                "end": locator["start"] + start + len(claim.quote),
                "quote": claim.quote,
            }
        locator_key = json.dumps(locator, sort_keys=True)
        anchor_id = f"anc-{uuid.uuid5(uuid.NAMESPACE_URL, f'{revision_id}/{locator_key}')}"
        if all(a.id != anchor_id for a in anchors):
            anchors.append(
                models.Anchor.model_validate(
                    {
                        **_record_base(anchor_id, "documented", access_scope),
                        "revisionId": revision_id,
                        "locator": locator,
                    }
                )
            )
        subject_kind = next(
            (e.kind for e in extraction.entities if e.name == claim.subject_name), None
        )
        subject_id = entity_id_for(claim.subject_name, subject_kind)
        if claim.object.entity_name:
            object_kind = next(
                (e.kind for e in extraction.entities if e.name == claim.object.entity_name), None
            )
            obj: dict = {
                "type": "entity",
                "entityId": entity_id_for(claim.object.entity_name, object_kind),
            }
        else:
            obj = {"type": "value", "value": claim.object.value or "", "unit": claim.object.unit}
        claim_id = f"cl-{uuid.uuid4()}"
        claim_record = models.Claim.model_validate(
            {
                **_record_base(claim_id, claim.evidence_class, access_scope),
                "effectiveFrom": claim.effective_from,
                "effectiveTo": claim.effective_to,
                "subjectId": subject_id,
                "relation": claim.relation,
                "object": obj,
                "anchors": [{"anchorId": anchor_id, "role": "supporting"}],
                "episodeId": episode_id,
                "supersedesClaimId": None,
                "invalidatedAt": None,
            }
        )
        candidates.append(
            models.Candidate.model_validate(
                {
                    **_record_base(f"cand-{uuid.uuid4()}", claim.evidence_class, access_scope),
                    "operation": "add",
                    "targetType": "claim",
                    "targetId": None,
                    "mergeSourceId": None,
                    "payload": claim_record.model_dump(mode="json"),
                    "method": method_model.model_dump(),
                    "uncertainty": {
                        "level": claim.uncertainty_level,
                        "reasons": claim.uncertainty_reasons,
                    },
                    "episodeId": episode_id,
                    "decision": None,
                }
            )
        )

    for match in extraction.case_matches:
        candidates.append(
            models.Candidate.model_validate(
                {
                    **_record_base(f"cand-{uuid.uuid4()}", "proposed", access_scope),
                    "operation": "update",
                    "targetType": "case",
                    "targetId": match.case_id,
                    "mergeSourceId": None,
                    "payload": {
                        "revisionId": revision_id,
                        "same": match.same,
                        "different": match.different,
                    },
                    "method": method_model.model_dump(),
                    "uncertainty": {
                        "level": match.uncertainty_level,
                        "reasons": match.uncertainty_reasons,
                    },
                    "episodeId": episode_id,
                    "decision": None,
                }
            )
        )
    return Proposals(anchors=anchors, candidates=candidates)
