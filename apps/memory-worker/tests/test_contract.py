"""Both languages must agree on the data: the fixture the TypeScript side projects validates
against the models generated from its contract, field for field."""

import pytest
from pydantic import ValidationError

from memory_worker import models
from memory_worker.contract import load_fixture, load_fixture_log


def test_fixture_validates_as_memory_dataset() -> None:
    dataset = models.MemoryDataset.model_validate(load_fixture())
    assert "synthetic" in dataset.label
    assert len(dataset.cases) == 12
    assert {c.id for c in dataset.claims} >= {"cl-01", "cl-06", "cl-07"}


def test_fixture_log_validates_and_round_trips() -> None:
    raw = load_fixture_log()
    log = models.EventLog.model_validate(raw)
    assert [e.position for e in log.events] == list(range(1, len(raw["events"]) + 1))
    again = models.EventLog.model_validate(log.model_dump(mode="json"))
    assert again == log


def test_contract_rejects_a_claim_without_anchor_role() -> None:
    claim = next(c for c in load_fixture()["claims"] if c["id"] == "cl-06")
    with pytest.raises(ValidationError):
        models.Claim.model_validate({**claim, "anchors": [{"anchorId": "anc-06"}]})


def test_submit_candidates_request_builds_from_fixture_records() -> None:
    fixture = load_fixture()
    request = models.SubmitCandidatesRequest.model_validate(
        {
            "episode": fixture["episodes"][1],
            "candidates": fixture["candidates"],
            "actorId": "worker:intake",
        }
    )
    assert request.episode.method.name == "intake-extract"
    assert request.candidates[0].uncertainty.level == "medium"
