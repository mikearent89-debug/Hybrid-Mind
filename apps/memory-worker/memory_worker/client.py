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

    def submit_intake(self, request: models.SubmitIntakeRequest) -> models.SubmitIntakeResponse:
        return self._post("/intake", request, models.SubmitIntakeResponse)

    def embed(self, texts: list[str]) -> models.EmbedResponse:
        return self._post("/embed", models.EmbedRequest(texts=texts), models.EmbedResponse)

    def memory(self, principal: str) -> models.MemoryDataset:
        response = self._http.get("/memory", params={"principal": principal})
        if response.status_code >= 400:
            raise MemoryApiError(response.status_code, response.json())
        return models.MemoryDataset.model_validate(response.json())

    def _post[T](self, path: str, request: object, response_type: type[T]) -> T:
        # Unset optional fields are left out (the API applies its defaults); explicit nulls stay,
        # because the API distinguishes "no decision" from a missing field.
        body = request.model_dump(mode="json", exclude_unset=True)  # type: ignore[attr-defined]
        response = self._http.post(path, json=body)
        if response.status_code >= 400:
            raise MemoryApiError(response.status_code, response.json())
        return response_type.model_validate(response.json())  # type: ignore[attr-defined]
