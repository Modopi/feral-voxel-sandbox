#!/usr/bin/env python3
"""Derive a small godot-cpp profile from the Godot class headers used by FERAL."""

from __future__ import annotations

import json
import pathlib
import re
import sys


def camel_to_snake(name: str) -> str:
    name = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    name = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name)
    return name.replace("2_D", "2D").replace("3_D", "3D").lower()


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("Usage: build-profile.py <extension_api.json> <native/src> <output.json>")
    api_path, source_dir, output_path = map(pathlib.Path, sys.argv[1:])
    api = json.loads(api_path.read_text())
    by_header: dict[str, list[str]] = {}
    for engine_class in api["classes"]:
        by_header.setdefault(camel_to_snake(engine_class["name"]), []).append(engine_class["name"])

    include_pattern = re.compile(r"^\s*#include\s*[<\"]godot_cpp/classes/([^>\"]+)\.hpp[>\"]", re.MULTILINE)
    classes: set[str] = set()
    missing: set[str] = set()
    for source in sorted(source_dir.glob("*.cpp")) + sorted(source_dir.glob("*.hpp")):
        for header in include_pattern.findall(source.read_text(encoding="utf-8")):
            matches = by_header.get(header, [])
            if len(matches) == 1:
                classes.add(matches[0])
            elif not matches:
                missing.add(header)
            else:
                raise RuntimeError(f"Header {header}.hpp maps to multiple Godot classes: {matches}")
    if missing:
        raise RuntimeError("No Godot API class matches included headers: " + ", ".join(sorted(missing)))
    if not classes:
        raise RuntimeError(f"No godot-cpp class headers found in {source_dir}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({"enabled_classes": sorted(classes)}, indent=2) + "\n")
    print(f"Generated godot-cpp profile with {len(classes)} directly used classes: {output_path}")


if __name__ == "__main__":
    main()
