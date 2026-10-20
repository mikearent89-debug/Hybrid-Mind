from pathlib import Path

from memory_worker import models
from memory_worker.client import MemoryApiClient
from memory_worker.embed import ApiEmbedder
from memory_worker.extract import ExtractedClaim, ExtractedObject, Extraction
from memory_worker.intake import ingest_file
from memory_worker.objectstore import LocalObjectStore
from memory_worker.parsers import ParsedDocument
from tests.conftest import FakeApi


class FakeExtractor:
    name = "fake"
    version = "1"

    def extract(self, document: ParsedDocument, dataset: models.MemoryDataset) -> Extraction:
        return Extraction(
            entities=[],
            claims=[
                ExtractedClaim(
                    subject_name="INV-MR-03",
                    relation="runs-firmware",
                    object=ExtractedObject(entity_name="Helion X200 firmware 3.2.0"),
                    quote="firmware upgrade to 3.2.0 completed",
                    segment_index=0,
                    evidence_class="documented",
                    uncertainty_level="high",
                    uncertainty_reasons="stated",
                )
            ],
            case_matches=[],
        )


def test_ingest_stores_original_submits_intake_then_candidates(
    pdf_file: Path, tmp_path: Path, fake_api: FakeApi
) -> None:
    store = LocalObjectStore(tmp_path / "objects")
    with MemoryApiClient("http://memory-api", transport=fake_api.transport()) as client:
        result = ingest_file(
            pdf_file,
            client=client,
            object_store=store,
            actor="u-avery",
            kind="work-order",
            site_ids=["site-mesa-ridge"],
            embedder=ApiEmbedder(client),
            extractor=FakeExtractor(),
            received_at="2026-10-20T10:00:00Z",
        )
    paths = [p for p, _ in fake_api.calls]
    assert paths == ["/memory", "/embed", "/intake", "/candidates"]
    intake = next(b for p, b in fake_api.calls if p == "/intake")
    assert intake["source"]["kind"] == "work-order"
    assert intake["source"]["siteIds"] == ["site-mesa-ridge"]
    assert intake["revision"]["contentHash"].startswith("sha256:")
    assert intake["revision"]["mediaType"] == "application/pdf"
    assert intake["chunks"][0]["locator"] == {"type": "page", "page": 1}
    assert intake["chunks"][0]["embedding"] == [0.1, 0.2, 0.3]
    assert intake["chunks"][0]["embeddingModel"] == "fake"
    assert intake["chunks"][0]["contextPrefix"].startswith(
        "wo-1090 (work-order, sites site-mesa-ridge)"
    )
    assert store.exists(intake["revision"]["contentHash"])
    cands = next(b for p, b in fake_api.calls if p == "/candidates")
    assert len(cands["anchors"]) == 1 and len(cands["candidates"]) == 1
    assert cands["candidates"][0]["payload"]["subjectId"] == "eq-inv-mr-03"
    assert cands["episode"]["id"] == intake["episode"]["id"]
    assert result.candidates == 1 and result.auto_accepted == [cands["candidates"][0]["id"]]
    assert "1 auto-accepted, 0 queued" in result.summary()


def test_ingest_without_extractor_only_stores_and_chunks(
    csv_file: Path, tmp_path: Path, fake_api: FakeApi
) -> None:
    with MemoryApiClient("http://memory-api", transport=fake_api.transport()) as client:
        result = ingest_file(
            csv_file, client=client, object_store=LocalObjectStore(tmp_path), actor="u-jordan"
        )
    assert [p for p, _ in fake_api.calls] == ["/memory", "/intake"]
    assert result.chunks == 2 and result.candidates == 0
    intake = fake_api.calls[1][1]
    assert (
        intake["chunks"][1]["embedding"] == [] and intake["chunks"][1]["embeddingModel"] == "none"
    )


def test_same_bytes_give_same_revision_and_report_already_known(
    csv_file: Path, tmp_path: Path
) -> None:
    api = FakeApi()
    with MemoryApiClient("http://memory-api", transport=api.transport()) as client:
        first = ingest_file(
            csv_file, client=client, object_store=LocalObjectStore(tmp_path), actor="u-jordan"
        )
        api.known_revisions = [first.revision_id]
        api.fixture["revisions"].append({**api.fixture["revisions"][0], "id": first.revision_id})
        second = ingest_file(
            csv_file, client=client, object_store=LocalObjectStore(tmp_path), actor="u-jordan"
        )
    assert first.revision_id == second.revision_id
    assert not first.already_known and second.already_known
