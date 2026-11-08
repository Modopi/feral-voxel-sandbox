#!/usr/bin/env python3
"""Create one immutable, content-addressed copy of native C++ build inputs."""

from __future__ import annotations

import hashlib
import pathlib
import shutil
import sys
import tempfile


ARTIFACT_SUFFIXES = {".o", ".os", ".uid", ".pyc"}


def source_files(root: pathlib.Path):
    for top in ("src", "third_party"):
        directory = root / top
        if not directory.is_dir():
            raise RuntimeError(f"Missing native source directory: {directory}")
        for path in sorted(directory.rglob("*")):
            if path.is_file() and path.suffix not in ARTIFACT_SUFFIXES:
                yield path, pathlib.Path(top) / path.relative_to(directory)
    export_map = root / "feral.exports"
    if not export_map.is_file():
        raise RuntimeError(f"Missing GDExtension export map: {export_map}")
    yield export_map, pathlib.Path("feral.exports")


def digest_tree(root: pathlib.Path) -> str:
    digest = hashlib.sha256()
    for path, relative in source_files(root):
        digest.update(relative.as_posix().encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


def copy_inputs(source: pathlib.Path, destination: pathlib.Path) -> None:
    for path, relative in source_files(source):
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: snapshot-sources.py <native-project> <toolchain-dir>")
    source = pathlib.Path(sys.argv[1]).resolve()
    toolchain = pathlib.Path(sys.argv[2]).resolve()
    snapshot_root = toolchain / "native" / "source-snapshots"
    snapshot_root.mkdir(parents=True, exist_ok=True)

    expected = digest_tree(source)
    destination = snapshot_root / expected
    if destination.is_dir() and digest_tree(destination) == expected:
        if digest_tree(source) != expected:
            raise RuntimeError("Native C++ sources changed while selecting the cached snapshot; retry after edits settle")
        print(destination)
        return 0

    temporary = pathlib.Path(tempfile.mkdtemp(prefix=".snapshot-", dir=snapshot_root))
    try:
        copy_inputs(source, temporary)
        copied = digest_tree(temporary)
        current = digest_tree(source)
        if copied != expected or current != expected:
            raise RuntimeError("Native C++ sources changed during snapshot creation; retry after edits settle")
        if destination.exists():
            shutil.rmtree(destination)
        temporary.replace(destination)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary, ignore_errors=True)

    print(destination)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError) as error:
        print(f"native source snapshot failed: {error}", file=sys.stderr)
        raise SystemExit(1)
