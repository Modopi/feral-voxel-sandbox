#!/usr/bin/env python3
"""Verify that each GDExtension exposes only its required C entry point."""

from __future__ import annotations

import argparse
import pathlib
import subprocess
import sys


ENTRY_POINT = "feral_library_init"


def exported_symbols(library: pathlib.Path) -> set[str]:
    result = subprocess.run(
        ["readelf", "--dyn-syms", "--wide", str(library)],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    exported: set[str] = set()
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) < 8 or not fields[0].endswith(":"):
            continue
        bind, visibility, section = fields[4], fields[5], fields[6]
        if section == "UND" or bind not in {"GLOBAL", "WEAK"} or visibility not in {"DEFAULT", "PROTECTED"}:
            continue
        exported.add(fields[7].split("@", 1)[0])
    return exported


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("libraries", nargs="+", type=pathlib.Path)
    args = parser.parse_args()

    failed = False
    for library in args.libraries:
        symbols = exported_symbols(library)
        unexpected = symbols - {ENTRY_POINT}
        if ENTRY_POINT not in symbols:
            print(f"{library}: missing exported {ENTRY_POINT}", file=sys.stderr)
            failed = True
        if unexpected:
            sample = sorted(unexpected)[:12]
            suffix = f", and {len(unexpected) - len(sample)} more" if len(unexpected) > len(sample) else ""
            print(f"{library}: {len(unexpected)} unexpected dynamic exports: {', '.join(sample)}{suffix}", file=sys.stderr)
            failed = True
        if not unexpected and ENTRY_POINT in symbols:
            print(f"{library}: only {ENTRY_POINT} is exported")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
