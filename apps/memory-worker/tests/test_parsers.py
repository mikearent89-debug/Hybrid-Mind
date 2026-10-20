from pathlib import Path

import pytest

from memory_worker.parsers import guess_kind, parse_file


def test_pdf_pages_become_page_segments(pdf_file: Path) -> None:
    doc = parse_file(pdf_file)
    assert doc.kind == "document"
    assert doc.media_type == "application/pdf"
    assert [s.locator for s in doc.segments] == [{"type": "page", "page": 1}]
    assert "WO-1090" in doc.segments[0].text


def test_email_headers_and_body_with_span_locators(eml_file: Path) -> None:
    doc = parse_file(eml_file)
    assert doc.kind == "email"
    assert doc.title == "RE: High Plains INV-HP-02 still tripping"
    assert doc.external_id == "<abc123@solaris.example>"
    seg = doc.segments[0]
    assert seg.locator["type"] == "span"
    quote = "the unit is on 3.1.4, same as before the visit"
    start = seg.text.find(quote)
    assert start > 0
    assert seg.text[start : start + len(quote)] == quote


def test_csv_rows_become_row_segments(csv_file: Path) -> None:
    doc = parse_file(csv_file)
    assert doc.kind == "csv"
    assert [s.locator for s in doc.segments] == [
        {"type": "row", "row": 1},
        {"type": "row", "row": 2},
    ]
    assert doc.segments[0].text == "row 1: inverter INV-RB-01, model Helion X200, firmware 3.2.0"


def test_note_and_photo(tmp_path: Path) -> None:
    note = tmp_path / "call.md"
    note.write_text("# Vendor call\n\nGridline will visit on 2026-10-08.")
    doc = parse_file(note, kind="note")
    assert doc.segments[0].locator["type"] == "span"
    photo = tmp_path / "combiner.jpg"
    photo.write_bytes(b"\xff\xd8\xff")
    assert parse_file(photo).segments == []
    assert guess_kind(photo) == "photo"
    with pytest.raises(ValueError):
        guess_kind(tmp_path / "x.docx")
