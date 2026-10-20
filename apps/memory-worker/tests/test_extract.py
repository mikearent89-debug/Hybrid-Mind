from memory_worker import models
from memory_worker.contract import load_fixture
from memory_worker.extract import (
    CaseMatch,
    ClaudeExtractor,
    ExtractedClaim,
    ExtractedEntity,
    ExtractedObject,
    Extraction,
    context_block,
    document_block,
    to_proposals,
)
from memory_worker.parsers import ParsedDocument, Segment
from memory_worker.resolve import EntityIndex, normalize_name

DATASET = models.MemoryDataset.model_validate(load_fixture())

DOC = ParsedDocument(
    kind="work-order",
    title="WO-1090",
    media_type="application/pdf",
    segments=[
        Segment(
            locator={"type": "page", "page": 1},
            text=(
                "INV-MR-03 now runs firmware 3.2.0 after the upgrade. "
                "Technician: Casey Nguyen of SunServ."
            ),
        )
    ],
)


def extraction() -> Extraction:
    return Extraction(
        entities=[
            ExtractedEntity(name="INV-MR-03", kind="equipment-unit"),
            ExtractedEntity(name="Helion X200 firmware 3.2.0", kind="firmware"),
            ExtractedEntity(name="Casey Nguyen", kind="person"),
        ],
        claims=[
            ExtractedClaim(
                subject_name="INV-MR-03",
                relation="runs-firmware",
                object=ExtractedObject(entity_name="Helion X200 firmware 3.2.0"),
                quote="INV-MR-03 now runs firmware 3.2.0",
                segment_index=0,
                evidence_class="documented",
                uncertainty_level="high",
                uncertainty_reasons="Stated directly",
            ),
            ExtractedClaim(
                subject_name="Casey Nguyen",
                relation="works-for",
                object=ExtractedObject(entity_name="SunServ"),
                quote="Casey Nguyen of SunServ",
                segment_index=0,
                evidence_class="documented",
                uncertainty_level="medium",
                uncertainty_reasons="Role not stated",
            ),
            ExtractedClaim(
                subject_name="INV-MR-03",
                relation="had-fault",
                object=ExtractedObject(value="made-up fault"),
                quote="this text is not in the document",
                segment_index=0,
                evidence_class="inferred",
                uncertainty_level="low",
                uncertainty_reasons="x",
            ),
        ],
        case_matches=[
            CaseMatch(
                case_id="case-01",
                same=["same unit"],
                different=["later date"],
                uncertainty_level="high",
                uncertainty_reasons="Same tag",
            )
        ],
    )


def test_resolution_uses_names_and_aliases() -> None:
    index = EntityIndex(DATASET)
    assert index.resolve("inv-mr-03").entity_id == "eq-inv-mr-03"
    assert index.resolve("SunServ").entity_id == "org-solaris"
    assert index.resolve("Gridline Services LLC").entity_id == "org-gridline"
    assert index.resolve("Nobody Known") is None
    assert normalize_name("  Solaris   O&M, LLC. ") == "solaris o m llc"


def test_proposals_anchor_every_claim_and_route_unknown_entities_to_review() -> None:
    proposals = to_proposals(
        extraction(), DOC, "rev-x", "ep-x", EntityIndex(DATASET), ("test", "1")
    )
    # One anchor for page 1 (both anchored claims share the page locator); the claim whose
    # quote is not in the text is dropped.
    assert len(proposals.anchors) == 1
    assert proposals.anchors[0].locator.root.type == "page"
    claims = [c for c in proposals.candidates if c.targetType == "claim"]
    entities = [c for c in proposals.candidates if c.targetType == "entity"]
    cases = [c for c in proposals.candidates if c.targetType == "case"]
    assert len(claims) == 2 and len(cases) == 1
    first = claims[0].payload
    assert first["subjectId"] == "eq-inv-mr-03"
    assert first["object"] == {"type": "entity", "entityId": "fw-helion-3.2.0"}
    assert first["anchors"] == [{"anchorId": proposals.anchors[0].id, "role": "supporting"}]
    assert first["evidenceClass"] == "documented"
    # Casey Nguyen is unknown: an `add entity` candidate carries a provisional ID the claim reuses.
    assert [e.payload["name"] for e in entities] == ["Casey Nguyen"]
    assert claims[1].payload["subjectId"] == entities[0].payload["id"]
    assert claims[1].payload["object"]["entityId"] == "org-solaris"
    assert claims[1].uncertainty.reasons == "Role not stated"
    assert cases[0].targetId == "case-01"
    for c in proposals.candidates:
        assert c.decision is None and c.reviewState == "unreviewed"


def test_span_anchor_is_narrowed_to_the_quote() -> None:
    doc = ParsedDocument(
        kind="email",
        title="t",
        media_type="message/rfc822",
        segments=[
            Segment(
                locator={"type": "span", "start": 100, "end": 160, "quote": ""},
                text="Header line. The unit is on 3.1.4 today.",
            )
        ],
    )
    ex = Extraction(
        entities=[],
        claims=[
            ExtractedClaim(
                subject_name="INV-HP-02",
                relation="runs-firmware",
                object=ExtractedObject(entity_name="Helion X200 firmware 3.1.4"),
                quote="The unit is on 3.1.4",
                segment_index=0,
                evidence_class="documented",
                uncertainty_level="high",
                uncertainty_reasons="stated",
            )
        ],
        case_matches=[],
    )
    proposals = to_proposals(ex, doc, "rev-y", "ep-y", EntityIndex(DATASET), ("test", "1"))
    locator = proposals.anchors[0].locator.root
    assert (locator.type, locator.start, locator.end, locator.quote) == (
        "span",
        113,
        133,
        "The unit is on 3.1.4",
    )


def test_request_params_cache_stable_prefix_and_put_document_last() -> None:
    extractor = ClaudeExtractor(model="claude-opus-5-5", client=object())
    params = extractor.request_params(DOC, DATASET)
    assert params["model"] == "claude-opus-5-5"
    assert [b["cache_control"] for b in params["system"]] == [
        {"type": "ephemeral"},
        {"type": "ephemeral"},
    ]
    assert params["system"][1]["text"] == context_block(DATASET)
    assert params["messages"][-1]["content"] == document_block(DOC)
    assert context_block(DATASET) == context_block(DATASET)
    assert "Gridline Services LLC" in params["system"][1]["text"]  # alias of a known entity
    assert "[segment 0, " in params["messages"][-1]["content"]
