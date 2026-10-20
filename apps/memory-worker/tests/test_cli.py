from memory_worker.cli import build_parser


def test_ingest_arguments() -> None:
    args = build_parser().parse_args(
        [
            "ingest",
            "/tmp/x.pdf",
            "--kind",
            "work-order",
            "--site",
            "a",
            "--site",
            "b",
            "--actor",
            "u-avery",
            "--no-extract",
        ]
    )
    assert args.command == "ingest"
    assert args.sites == ["a", "b"] and args.actor == "u-avery" and args.no_extract
