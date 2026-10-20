"""The worker's only way to change memory: the HTTP API, with payloads validated against the shared
contract on both sides."""

from __future__ import annotations

import httpx

from memory_worker import models


class MemoryApiError(RuntimeError):
    def __init__(self, status: int, body: object) -> None:
        super().__init__(f"memory-api responded {status}: {body}")
        self.status = status
        self.body = body


class MemoryApiClient:
    def __init__(self, base_url: str, *, transport: httpx.BaseTransport | None = None) -> None:
        self._http = httpx.Client(base_url=base_url, transport=transport, timeout=30.0)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> MemoryApiClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def health(self) -> bool:
        return self._http.get("/health").json().get("ok") is True

    def submit_candidates(
        self, request: models.SubmitCandidatesRequest
    ) -> models.SubmitCandidatesResponse:
        return self._post("/candidates", request, models.SubmitCandidatesResponse)

    def submit_chunks(self, request: models.SubmitChunksRequest) -> models.SubmitChunksResponse:
        return self._post("/chunks", request, models.SubmitChunksResponse)

    def append_event(self, request: models.AppendEventRequest) -> models.AppendEventResponse:
        return self._post("/events", request, models.AppendEventResponse)

    def _post[T](self, path: str, request: object, response_type: type[T]) -> T:
        body = request.model_dump(mode="json", exclude_none=False)  # type: ignore[attr-defined]
        response = self._http.post(path, json=body)
        if response.status_code >= 400:
            raise MemoryApiError(response.status_code, response.json())
        return response_type.model_validate(response.json())  # type: ignore[attr-defined]
