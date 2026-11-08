#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NATIVE_DIR="$REPO_ROOT/native"
TOOLCHAIN_DIR="${FERAL_TOOLCHAIN_DIR:-$REPO_ROOT/../toolchain}"
GODOT_CPP_DIR="${FERAL_GODOT_CPP_DIR:-$TOOLCHAIN_DIR/native/godot-cpp}"
LOCK_FILE="$REPO_ROOT/tools/native/toolchain.lock"
GODOT_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["godotVersion"])' "$LOCK_FILE")"
GODOT_API_DIR="$TOOLCHAIN_DIR/native/godot-api/$GODOT_VERSION"
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$TOOLCHAIN_DIR/sdk}}"
ANDROID_NDK_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["androidNdkVersion"])' "$LOCK_FILE")"
ANDROID_API_LEVEL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["androidApiLevel"])' "$LOCK_FILE")"
BUILD_JOBS="${FERAL_BUILD_JOBS:-4}"
BUILD_PROFILE="$TOOLCHAIN_DIR/native/feral-godot-cpp-profile.json"
if [[ ! "$BUILD_JOBS" =~ ^[1-8]$ ]]; then
  echo 'FERAL_BUILD_JOBS must be a number from 1 to 8.' >&2
  exit 1
fi

if [[ ! -f "$GODOT_API_DIR/extension_api.json" || ! -f "$GODOT_API_DIR/gdextension_interface.h" ]]; then
  "$REPO_ROOT/tools/native/bootstrap.sh" --skip-ndk --skip-templates
fi
if [[ ! -d "$GODOT_CPP_DIR/.git" ]]; then
  "$REPO_ROOT/tools/native/bootstrap.sh" --skip-ndk --skip-templates
fi
if [[ ! -f "$ANDROID_HOME/ndk/$ANDROID_NDK_VERSION/source.properties" ]]; then
  "$REPO_ROOT/tools/native/bootstrap.sh" --skip-templates
fi
SOURCE_SNAPSHOT="$(python3 "$REPO_ROOT/tools/native/snapshot-sources.py" "$NATIVE_DIR" "$TOOLCHAIN_DIR")"
python3 "$REPO_ROOT/tools/native/build-profile.py" \
  "$GODOT_API_DIR/extension_api.json" "$SOURCE_SNAPSHOT/src" "$BUILD_PROFILE"

export FERAL_TOOLCHAIN_DIR="$TOOLCHAIN_DIR"
export FERAL_GODOT_CPP_DIR="$GODOT_CPP_DIR"
export FERAL_NATIVE_SOURCE_DIR="$SOURCE_SNAPSHOT"
export ANDROID_HOME
mkdir -p "$NATIVE_DIR/bin"

build_one() {
  local platform="$1"
  local target="$2"
  local arch="$3"
  (cd "$NATIVE_DIR" && python3 -m SCons \
    -j "$BUILD_JOBS" \
    "platform=$platform" \
    "target=$target" \
    "arch=$arch" \
    "custom_api_file=$GODOT_API_DIR/extension_api.json" \
    "gdextension_dir=$GODOT_API_DIR" \
    "build_profile=$BUILD_PROFILE" \
    "disable_exceptions=false" \
    "ndk_version=$ANDROID_NDK_VERSION" \
    "android_api_level=$ANDROID_API_LEVEL")
}

for target in template_debug template_release; do
  build_one linux "$target" x86_64
  build_one android "$target" arm64
done

python3 "$REPO_ROOT/tools/native/check-exports.py" "$NATIVE_DIR"/bin/libferal.*.so
printf 'Native extension builds are ready in %s/bin (source snapshot %s)\n' "$NATIVE_DIR" "$(basename "$SOURCE_SNAPSHOT")"
