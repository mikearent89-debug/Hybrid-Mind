"""Readers for the file kinds intake accepts. Each returns a ParsedDocument whose segments carry
the locator a chunk and an anchor will point at: page for PDFs, character span for text and
email, row for CSV, the whole image for a photo."""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from email import policy
from email.parser import BytesParser
from pathlib import Path

from memory_worker.chunking import chunk_text

SourceKind = str  # one of the contract's SourceKind values

EXTENSION_KINDS: dict[str, SourceKind] = {
    ".pdf": "document",
    ".eml": "email",
    ".csv": "csv",
    ".jpg": "photo",
    ".jpeg": "photo",
    ".png": "photo",
    ".md": "note",
    ".txt": "note",
}

MEDIA_TYPES: dict[str, str] = {
    ".pdf": "application/pdf",
    ".eml": "message/rfc822",
    ".csv": "text/csv",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".md": "text/markdown",
    ".txt": "text/plain",
}


@dataclass(frozen=True)
class Segment:
    locator: dict
    text: str


@dataclass
class ParsedDocument:
    kind: SourceKind
    title: str
    media_type: str
    segments: list[Segment] = field(default_factory=list)
    external_id: str | None = None
    origin_system: str | None = None

    @property
    def text(self) -> str:
        return "\n\n".join(s.text for s in self.segments)


def guess_kind(path: Path) -> SourceKind:
    try:
        return EXTENSION_KINDS[path.suffix.lower()]
    except KeyError as e:
        raise ValueError(f"unsupported file type {path.suffix!r}; pass --kind") from e


def media_type_of(path: Path) -> str:
    return MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")


def parse_file(path: Path, kind: SourceKind | None = None, max_chars: int = 1200) -> ParsedDocument:
    kind = kind or guess_kind(path)
    data = path.read_bytes()
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return parse_pdf(data, path.stem, kind, max_chars)
    if suffix == ".eml":
        return parse_email(data, kind, max_chars)
    if suffix == ".csv":
        return parse_csv(data, path.stem, kind)
    if suffix in (".jpg", ".jpeg", ".png"):
        return ParsedDocument(kind=kind, title=path.name, media_type=media_type_of(path))
    return parse_text(
        data.decode("utf-8", errors="replace"), path.stem, kind, media_type_of(path), max_chars
    )


def _span_segments(text: str, prefix: str, max_chars: int) -> list[Segment]:
    return [
        Segment(locator={"type": "span", "start": c.start, "end": c.end, "quote": ""}, text=c.text)
        for c in chunk_text(text, prefix, max_chars)
    ]


def parse_text(
    text: str, title: str, kind: SourceKind, media_type: str, max_chars: int
) -> ParsedDocument:
    return ParsedDocument(
        kind=kind,
        title=title,
        media_type=media_type,
        segments=_span_segments(text, title, max_chars),
    )


def parse_pdf(data: bytes, title: str, kind: SourceKind, max_chars: int) -> ParsedDocument:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    meta_title = (reader.metadata or {}).get("/Title") if reader.metadata else None
    doc = ParsedDocument(
        kind=kind, title=str(meta_title) if meta_title else title, media_type="application/pdf"
    )
    for number, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if not text:
            continue
        for piece in chunk_text(text, doc.title, max_chars):
            doc.segments.append(Segment(locator={"type": "page", "page": number}, text=piece.text))
    return doc


def parse_email(data: bytes, kind: SourceKind, max_chars: int) -> ParsedDocument:
    message = BytesParser(policy=policy.default).parsebytes(data)
    subject = str(message.get("Subject", "")).strip() or "(no subject)"
    body_part = message.get_body(preferencelist=("plain", "html"))
    body = body_part.get_content() if body_part is not None else ""
    header = "\n".join(
        f"{name}: {message.get(name)}"
        for name in ("From", "To", "Date", "Subject")
        if message.get(name)
    )
    text = f"{header}\n\n{body}".strip()
    doc = ParsedDocument(
        kind=kind,
        title=subject,
        media_type="message/rfc822",
        external_id=str(message.get("Message-ID", "")).strip() or None,
        origin_system="mailbox",
    )
    doc.segments = _span_segments(text, subject, max_chars)
    return doc


def parse_csv(data: bytes, title: str, kind: SourceKind, max_rows: int = 2000) -> ParsedDocument:
    reader = csv.reader(io.StringIO(data.decode("utf-8-sig", errors="replace")))
    rows = list(reader)
    doc = ParsedDocument(kind=kind, title=title, media_type="text/csv")
    if not rows:
        return doc
    header = rows[0]
    for number, row in enumerate(rows[1 : max_rows + 1], start=1):
        cells = ", ".join(
            f"{h.strip()} {v.strip()}" for h, v in zip(header, row, strict=False) if v.strip()
        )
        if cells:
            doc.segments.append(
                Segment(locator={"type": "row", "row": number}, text=f"row {number}: {cells}")
            )
    return doc
