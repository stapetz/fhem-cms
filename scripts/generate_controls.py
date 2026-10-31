#!/usr/bin/env python3
"""Generate the single FHEM update controls file for this repository."""

import subprocess
from datetime import datetime, timezone
from pathlib import Path

DEPLOYABLE_ROOTS = (Path("FHEM"), Path("www/fhem-cms"))
OUTPUT = Path("controls_fhem-cms.txt")


def last_update(path: Path) -> str:
    result = subprocess.run(
        [
            "git",
            "log",
            "-1",
            "--format=%cd",
            "--date=format:%Y-%m-%d_%H:%M:%S",
            "--",
            path.as_posix(),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    timestamp = result.stdout.strip()
    if timestamp:
        return timestamp
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).strftime(
        "%Y-%m-%d_%H:%M:%S"
    )


def deployable_files() -> list[Path]:
    files = []
    for root in DEPLOYABLE_ROOTS:
        if not root.exists():
            continue
        files.extend(
            path
            for path in root.rglob("*")
            if path.is_file() and not path.is_symlink() and path.name != ".gitkeep"
        )
    return sorted(files, key=lambda path: path.as_posix())


def main() -> None:
    lines = []
    for path in deployable_files():
        lines.append(f"UPD {last_update(path)} {path.stat().st_size} {path.as_posix()}")
    OUTPUT.write_text("\n".join(lines) + "\n", encoding="ascii")


if __name__ == "__main__":
    main()
