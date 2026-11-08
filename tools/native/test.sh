#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NATIVE_DIR="$REPO_ROOT/native"
TOOLCHAIN_DIR="${FERAL_TOOLCHAIN_DIR:-$REPO_ROOT/../toolchain}"
TEST_BUILD_DIR="${FERAL_NATIVE_TEST_BUILD_DIR:-$TOOLCHAIN_DIR/native/test-build}"
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$TOOLCHAIN_DIR/sdk}}"
LOCK_FILE="$REPO_ROOT/tools/native/toolchain.lock"
GODOT_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["godotVersion"])' "$LOCK_FILE")"
GODOT_EXECUTABLE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["godotExecutable"])' "$LOCK_FILE")"
GODOT_LOCAL="$TOOLCHAIN_DIR/native/godot-$GODOT_VERSION/$GODOT_EXECUTABLE"
GODOT_BIN="${GODOT_BIN:-$(command -v godot || printf '%s' "$GODOT_LOCAL")}"
CXX="${CXX:-g++}"

mkdir -p "$TEST_BUILD_DIR"
cd "$REPO_ROOT"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# Keep the API and platform builds in sync with every source/header as owners add coverage.
FERAL_BUILD_JOBS="${FERAL_BUILD_JOBS:-4}" "$REPO_ROOT/tools/native/build.sh"

if [[ ! -x "$GODOT_BIN" ]]; then
  "$REPO_ROOT/tools/native/bootstrap.sh" --skip-ndk --skip-templates
fi
if [[ ! -x "$GODOT_BIN" ]]; then
  echo "Godot $GODOT_VERSION is unavailable at $GODOT_BIN." >&2
  exit 1
fi

# A V_ release branch can skip APK export, so import resources here before runtime checks.
run_godot_check() {
  local check_name="$1"
  shift
  local check_data_home="$TEST_BUILD_DIR/xdg-data-$check_name"
  local check_config_home="$TEST_BUILD_DIR/xdg-config-$check_name"
  rm -rf "$check_data_home" "$check_config_home"
  mkdir -p "$check_data_home" "$check_config_home"
  timeout "${FERAL_GODOT_TEST_TIMEOUT:-300}" env \
    XDG_DATA_HOME="$check_data_home" \
    XDG_CONFIG_HOME="$check_config_home" \
    "$GODOT_BIN" "$@"
}

echo '[native-test] importing Godot project resources'
run_godot_check import --headless --editor --path "$NATIVE_DIR" --import --quit

echo '[native-test] checking the exact Android WebView migration script'
node --test native/tests/legacy_webview_exporter_test.mjs

run_test() {
  local name="$1"
  local source="$2"
  shift 2
  local binary="$TEST_BUILD_DIR/${name}-test"
  echo "[native-test] compiling $source"
  "$CXX" -std=c++17 -O1 -Inative/src -Inative/third_party "$@" "$source" -o "$binary"
  echo "[native-test] running $name"
  timeout "${FERAL_NATIVE_TEST_TIMEOUT:-300}" "$binary"
}

# Unknown test names fail closed so a newly added focused test cannot silently be skipped.
shopt -s nullglob
test_sources=(native/tests/*_test.cpp native/tests/*_tests.cpp)
if [[ ${#test_sources[@]} -eq 0 ]]; then
  echo 'No native focused tests found under native/tests.' >&2
  exit 1
fi
for test_source in "${test_sources[@]}"; do
  name="$(basename "$test_source")"
  name="${name%_tests.cpp}"
  name="${name%_test.cpp}"
  case "$name" in
    actions) run_test "$name" "$test_source" native/src/actions.cpp ;;
    contact_geometry) run_test "$name" "$test_source" ;;
    gameplay) run_test "$name" "$test_source" native/src/gameplay.cpp ;;
    simulation) run_test "$name" "$test_source" native/src/simulation.cpp native/src/world.cpp native/src/gameplay.cpp ;;
    migration_integration) run_test "$name" "$test_source" native/src/storage.cpp native/src/world.cpp native/src/gameplay.cpp native/src/simulation.cpp ;;
    migration|storage_migration|storage) run_test "$name" "$test_source" native/src/storage.cpp ;;
    world) run_test "$name" "$test_source" native/src/world.cpp ;;
    world_tools) run_test "$name" "$test_source" native/src/world_tools.cpp native/src/world.cpp native/src/gameplay.cpp native/src/simulation.cpp ;;
    *) echo "No source mapping configured for native test '$name'." >&2; exit 1 ;;
  esac
done

echo '[native-test] checking machine command reachability across the panel and Simulation'
python3 native/tests/machine_panel_coverage_test.py

# Integration checks write user:// reports and smoke snapshots under the build cache, never into
# a developer's real FERAL save directory.
echo '[native-test] running 1,000-tick Godot/Jolt physics integration check'
run_godot_check physics --headless --path "$NATIVE_DIR" -- --feral-physics-check
echo '[native-test] running native startup/world smoke check'
run_godot_check smoke --headless --path "$NATIVE_DIR" -- --feral-smoke
echo '[native-test] running native UI reachability check'
run_godot_check ui --headless --path "$NATIVE_DIR" -- --feral-ui-check
echo '[native-test] running real launcher -> touch gameplay -> save -> cold continue'
LAUNCHER_DATA="$TEST_BUILD_DIR/xdg-data-launcher-check"
LAUNCHER_CONFIG="$TEST_BUILD_DIR/xdg-config-launcher-check"
rm -rf "$LAUNCHER_DATA" "$LAUNCHER_CONFIG"
mkdir -p "$LAUNCHER_DATA" "$LAUNCHER_CONFIG"
for mode in create reopen; do
  timeout "${FERAL_GODOT_TEST_TIMEOUT:-300}" env XDG_DATA_HOME="$LAUNCHER_DATA" XDG_CONFIG_HOME="$LAUNCHER_CONFIG" \
    "$GODOT_BIN" --headless --path "$NATIVE_DIR" --script "$REPO_ROOT/tools/native/checks/launcher-play.gd" -- "--$mode"
done
echo '[native-test] running full native runtime/Jolt check (600 ticks, three compound trees)'
run_godot_check runtime --headless --path "$NATIVE_DIR" -- --feral-runtime-check
RUNTIME_REPORT="$(find "$TEST_BUILD_DIR/xdg-data-runtime" -type f -name native-runtime-check.json -print -quit)"
if [[ -z "$RUNTIME_REPORT" ]]; then
  echo 'Native runtime check did not write user://native-runtime-check.json.' >&2
  exit 1
fi
GAME_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$REPO_ROOT/version.json")"
mkdir -p "$REPO_ROOT/verification" "$REPO_ROOT/build/release"
cp "$RUNTIME_REPORT" "$REPO_ROOT/verification/${GAME_VERSION}-native-runtime.json"
cp "$RUNTIME_REPORT" "$REPO_ROOT/build/release/native-runtime-check.json"
for report in launcher-play.json launcher-play-reopen.json; do
  source="$(find "$LAUNCHER_DATA" -type f -name "$report" -print -quit)"
  if [[ -z "$source" ]]; then echo "Missing launcher check report: $report" >&2; exit 1; fi
  cp "$source" "$REPO_ROOT/verification/${GAME_VERSION}-native-$report"
  cp "$source" "$REPO_ROOT/build/release/native-$report"
done
echo 'Native focused tests and Godot integration checks passed.'
