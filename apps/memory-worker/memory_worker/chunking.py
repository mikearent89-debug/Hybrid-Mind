"""Contextual chunking: each chunk is embedded together with a short prefix saying where it came
from (document title, site, page), so a sentence like "the unit is on 3.1.4" retrieves with its
context instead of as an orphan."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TextChunk:
    index: int
    text: str
    context_prefix: str
    start: int
    end: int

    @property
    def embedding_input(self) -> str:
        return f"{self.context_prefix}\n\n{self.text}"


def _split_paragraphs(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    cursor = 0
    for para in text.split("\n\n"):
        start = text.index(para, cursor) if para else cursor
        end = start + len(para)
        if para.strip():
            spans.append((start, end))
        cursor = end
    return spans


def chunk_text(text: str, context_prefix: str, max_chars: int = 1200) -> list[TextChunk]:
    """Paragraph-aligned chunks no longer than max_chars, each carrying the context prefix and the
    character span it covers, so a chunk always maps back to a span locator in its revision."""
    chunks: list[TextChunk] = []
    buf_start: int | None = None
    buf_end = 0
    for start, end in _split_paragraphs(text):
        if buf_start is not None and end - buf_start > max_chars:
            chunks.append(_make(len(chunks), text, context_prefix, buf_start, buf_end))
            buf_start = None
        if buf_start is None:
            buf_start = start
        buf_end = end
        while buf_end - buf_start > max_chars:
            cut = buf_start + max_chars
            chunks.append(_make(len(chunks), text, context_prefix, buf_start, cut))
            buf_start = cut
    if buf_start is not None and buf_end > buf_start:
        chunks.append(_make(len(chunks), text, context_prefix, buf_start, buf_end))
    return chunks


def _make(index: int, text: str, prefix: str, start: int, end: int) -> TextChunk:
    return TextChunk(index=index, text=text[start:end], context_prefix=prefix, start=start, end=end)
