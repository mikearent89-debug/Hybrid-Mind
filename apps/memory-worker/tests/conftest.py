import json

import httpx
import pytest

from memory_worker.contract import load_fixture

MINIMAL_PDF = b"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length 95 >>
stream
BT /F1 12 Tf 72 700 Td
(Work order WO-1090 Mesa Ridge INV-MR-03 firmware upgrade to 3.2.0 completed) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f 
trailer << /Root 1 0 R /Size 6 >>
startxref
0
%%EOF
"""


@pytest.fixture
def pdf_file(tmp_path):
    p = tmp_path / "wo-1090.pdf"
    p.write_bytes(MINIMAL_PDF)
    return p


@pytest.fixture
def eml_file(tmp_path):
    p = tmp_path / "hp02.eml"
    p.write_bytes(
        b"From: Morgan Hale <morgan@solaris.example>\r\n"
        b"To: Avery Moss <avery@example>\r\n"
        b"Subject: RE: High Plains INV-HP-02 still tripping\r\n"
        b"Message-ID: <abc123@solaris.example>\r\n"
        b"Content-Type: text/plain; charset=utf-8\r\n\r\n"
        b"I checked the controller screen myself and "
        b"the unit is on 3.1.4, same as before the visit.\r\n"
    )
    return p


@pytest.fixture
def csv_file(tmp_path):
    p = tmp_path / "export.csv"
    p.write_text(
        "inverter,model,firmware\nINV-RB-01,Helion X200,3.2.0\nINV-RB-04,Vantage C1500,7.0.2\n"
    )
    return p


class FakeApi:
    """Stands in for memory-api: records what the worker sends and answers like the real thing."""

    def __init__(self, known_revisions: list[str] | None = None) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.fixture = load_fixture()
        self.known_revisions = known_revisions or []

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        path = request.url.path
        self.calls.append((path, body))
        if path == "/health":
            return httpx.Response(200, json={"ok": True})
        if path == "/memory":
            dataset = dict(self.fixture)
            dataset["revisions"] = [
                r for r in self.fixture["revisions"] if r["id"] in self.known_revisions
            ] + [r for r in self.fixture["revisions"] if r["id"] not in self.known_revisions]
            return httpx.Response(200, json=dataset)
        if path == "/embed":
            return httpx.Response(
                200,
                json={
                    "model": "fake",
                    "dimensions": 3,
                    "embeddings": [[0.1, 0.2, 0.3] for _ in body["texts"]],
                },
            )
        if path == "/intake":
            return httpx.Response(
                201,
                json={
                    "episodePosition": 1,
                    "sourcePosition": 2,
                    "revisionPosition": 3,
                    "stored": len(body["chunks"]),
                },
            )
        if path == "/candidates":
            ids = [c["id"] for c in body["candidates"]]
            auto = [
                c["id"]
                for c in body["candidates"]
                if c["evidenceClass"] == "documented" and c["targetType"] == "claim"
            ]
            return httpx.Response(
                201,
                json={
                    "episodePosition": 1,
                    "autoAccepted": auto,
                    "queued": [i for i in ids if i not in auto],
                },
            )
        return httpx.Response(404, json={"error": "no route"})


@pytest.fixture
def fake_api():
    return FakeApi()
