from memory_worker.chunking import chunk_text
from memory_worker.hashing import content_hash


def test_chunks_align_to_paragraphs_and_keep_spans() -> None:
    text = "First paragraph about INV-MR-03.\n\nSecond paragraph.\n\n" + ("x" * 50)
    chunks = chunk_text(text, "WO-1001 Mesa Ridge, page 1", max_chars=60)
    assert [c.index for c in chunks] == [0, 1]
    assert chunks[0].text == "First paragraph about INV-MR-03.\n\nSecond paragraph."
    assert text[chunks[1].start : chunks[1].end] == "x" * 50
    assert chunks[0].embedding_input.startswith("WO-1001 Mesa Ridge, page 1\n\n")


def test_long_paragraph_is_cut_hard_at_max_chars() -> None:
    chunks = chunk_text("a" * 250, "ctx", max_chars=100)
    assert [len(c.text) for c in chunks] == [100, 100, 50]
    assert chunks[2].start == 200


def test_empty_text_has_no_chunks() -> None:
    assert chunk_text("\n\n  \n\n", "ctx") == []


def test_content_hash_matches_contract_form() -> None:
    h = content_hash(b"hello")
    assert h.startswith("sha256:") and len(h) == 7 + 64
