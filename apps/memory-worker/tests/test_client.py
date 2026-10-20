import json

import httpx
import pytest

from memory_worker import models
from memory_worker.client import MemoryApiClient, MemoryApiError
from memory_worker.contract import load_fixture


def _fake_api(calls: list[tuple[str, dict]]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        calls.append((request.url.path, body))
        if request.url.path == "/health":
            return httpx.Response(200, json={"ok": True})
        if request.url.path == "/candidates":
            ids = [c["id"] for c in body["candidates"]]
            return httpx.Response(
                201, json={"episodePosition": 70, "autoAccepted": ids[:1], "queued": ids[1:]}
            )
        if request.url.path == "/chunks":
            return httpx.Response(201, json={"stored": len(body["chunks"])})
        return httpx.Response(400, json={"error": "invalid event"})

    return httpx.MockTransport(handler)


def test_submit_candidates_sends_the_contract_shape() -> None:
    calls: list[tuple[str, dict]] = []
    fixture = load_fixture()
    with MemoryApiClient("http://memory-api", transport=_fake_api(calls)) as client:
        assert client.health()
        response = client.submit_candidates(
            models.SubmitCandidatesRequest.model_validate(
                {
                    "episode": fixture["episodes"][1],
                    "candidates": fixture["candidates"],
                    "actorId": "worker:intake",
                }
            )
        )
    assert response.autoAccepted == ["cand-01"]
    assert response.queued == ["cand-02"]
    path, body = calls[1]
    assert path == "/candidates"
    assert body["actorId"] == "worker:intake"
    assert body["candidates"][0]["uncertainty"]["reasons"].startswith("Name differs")
    # Nulls stay explicit nulls: the API distinguishes "no decision" from a missing field.
    assert body["candidates"][0]["decision"] is None


def test_submit_chunks_and_error_surface() -> None:
    calls: list[tuple[str, dict]] = []
    with MemoryApiClient("http://memory-api", transport=_fake_api(calls)) as client:
        stored = client.submit_chunks(
            models.SubmitChunksRequest.model_validate(
                {
                    "revisionId": "rev-01",
                    "episodeId": "ep-intake-1",
                    "chunks": [
                        {
                            "index": 0,
                            "text": "Replaced fuses",
                            "contextPrefix": "WO-1001, page 1",
                            "locator": {"type": "page", "page": 1},
                            "embedding": [0.1],
                            "embeddingModel": "test",
                        }
                    ],
                }
            )
        )
        assert stored.stored == 1
        with pytest.raises(MemoryApiError) as err:
            client.append_event(
                models.AppendEventRequest.model_validate(
                    {
                        "event": {
                            "type": "lesson-status-changed",
                            "lessonId": "lesson-01",
                            "status": "retired",
                            "reason": "x",
                        },
                        "actorId": "u-avery",
                    }
                )
            )
        assert err.value.status == 400
