# Native regression checks

The focused headless C++ checks cover action timing and the Godot-free collision geometry used by the adapter. From the repository root:

```sh
g++ -std=c++17 -Inative/src -Inative/third_party native/src/actions.cpp native/tests/actions_test.cpp -o /tmp/feral-actions-test
/tmp/feral-actions-test
g++ -std=c++17 -Inative/src -Inative/third_party native/tests/contact_geometry_test.cpp -o /tmp/feral-contact-test
/tmp/feral-contact-test
```

The simulation integration test loads the exported content, asset and runtime-module JSON and drives the same `World`, `Gameplay` and `Simulation` command/tick/save paths used by the game. It checks machine-field grants and example reload idempotence, fuel-backed force and energy accounting, pump fluid conservation, cargo and fuel mass/payment accounting, rejection atomicity for invalid or unaffordable machine designs, creature shell/bone strike geometry and wound re-entry, and first-signal supply/harvest/travel persistence:

```sh
g++ -std=c++17 -O1 -Inative/src -Inative/third_party native/src/world.cpp native/src/gameplay.cpp native/src/simulation.cpp native/tests/simulation_test.cpp -o /tmp/feral-simulation-test
/tmp/feral-simulation-test
```

The Godot integration harness is a separate check. The root launcher selects `NativePhysicsHarness` for `--feral-physics-check`. It runs 1,000 callbacks at 60 Hz in the configured Godot 4.6 Jolt world and writes `user://native-physics-harness.json`. The check verifies that a sphere passes through and then lands/sleeps below an exact compound ring, three branch-and-trunk compounds contact the ground without reporting self-contact, separate rigid bodies collide, and three collision-disabled leaves continue through ground while their Area sensors register the floor. It also compares action events while one timeline is visually sampled and the other is not.

The report records exact engine physics-frame deltas, fixed-step bounds, callback intervals measured with `steady_clock`, harness callback time, and the active renderer/adapter. Callback interval includes Godot's frame work around the harness; it is not an isolated Jolt solver CPU measurement. `harnessCallback*` measures only harness callback work. Renderer and software-renderer labels describe the machine that ran the check. These results do not estimate phone frame rate or performance.

The native machine panel exposes its command coverage and checks that each assembly, mount, energy, control, anchor, and machine-field action reaches a `Simulation` handler:

```sh
python3 native/tests/machine_panel_coverage_test.py
```

The storage migration integration check builds a real snapshot through the shipped JavaScript runtime and `ExpeditionSave`, exports it in the old WebView localStorage/IndexedDB shape, then runs Storage, World, Gameplay and Simulation against every launcher preset. It verifies public native inventory, research, jobs, terrain edits, detached-body motion, creature wounds, machine state and first-signal progress, and checks that the exact original envelopes plus full WebView archive remain after native saves. Regenerate its fixture from the current runtime with `node tools/native/export-save-fixtures.mjs`, then run from the repository root:

```sh
g++ -std=c++17 -Inative/src -Inative/third_party native/src/storage.cpp native/src/world.cpp native/src/gameplay.cpp native/src/simulation.cpp native/tests/migration_integration_test.cpp -o /tmp/feral-migration-integration-test
/tmp/feral-migration-integration-test
```
