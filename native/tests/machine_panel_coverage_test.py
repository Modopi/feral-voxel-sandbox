#!/usr/bin/env python3
"""Static reachability contract for the native machine panel and Simulation handlers."""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PANEL = (ROOT / "native/src/machine_panel.cpp").read_text(encoding="utf-8")
SIMULATION = (ROOT / "native/src/simulation.cpp").read_text(encoding="utf-8")

REQUIRED = {
    "machine.create",
    "machine.attach",
    "machine.remove",
    "machine.repair",
    "machine.install",
    "machine.remove_component",
    "machine.active",
    "machine.refuel",
    "machine.charge",
    "machine.drain",
    "machine.control",
    "machine.anchor",
    "machine.connect",
    "machine.fluid.fill",
    "machine.fluid.drain",
    "machine.fluid.connect",
    "machine.fluid.disconnect",
    "machine.cargo.load",
    "machine.cargo.unload",
    "machine.example",
    "machine.return_to_pad",
}

coverage_body = PANEL.split("Json MachinePanel::command_coverage()", 1)[1].split("} // namespace feral", 1)[0]
command_pattern = r"machine(?:\.[a-z_]+)+"
reported = set(re.findall(r'"(' + command_pattern + r')"', coverage_body))
reachable = set(re.findall(r'"(' + command_pattern + r')"', PANEL))
implemented = set()
for condition in re.findall(r'if\(name==([^\n]+?)\)', SIMULATION):
    implemented.update(re.findall(r'"(' + command_pattern + r')"', condition))

missing_report = sorted(REQUIRED - reported)
missing_ui = sorted(REQUIRED - reachable)
missing_simulation = sorted(REQUIRED - implemented)
summary = {
    "requiredCommands": len(REQUIRED),
    "reportedCommands": len(REQUIRED & reported),
    "uiCommands": len(REQUIRED & reachable),
    "simulationHandlers": len(REQUIRED & implemented),
    "allReachable": not (missing_report or missing_ui or missing_simulation),
    "missingReport": missing_report,
    "missingUi": missing_ui,
    "missingSimulation": missing_simulation,
}
print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
assert summary["allReachable"], summary
