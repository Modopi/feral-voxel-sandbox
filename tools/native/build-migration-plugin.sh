#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NATIVE_DIR="$REPO_ROOT/native"
PLUGIN_SOURCE="$NATIVE_DIR/android/feral-migration"
TOOLCHAIN_DIR="${FERAL_TOOLCHAIN_DIR:-$REPO_ROOT/../toolchain}"
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$TOOLCHAIN_DIR/sdk}}"
LOCK_FILE="$REPO_ROOT/tools/native/toolchain.lock"
GRADLE_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["gradleVersion"])' "$LOCK_FILE")"
GRADLE="$TOOLCHAIN_DIR/native/gradle-$GRADLE_VERSION/bin/gradle"

if [[ ! -x "$GRADLE" ]]; then
  "$REPO_ROOT/tools/native/bootstrap.sh" --skip-ndk --skip-templates
fi
if [[ ! -x "$GRADLE" ]]; then
  echo "Pinned Gradle $GRADLE_VERSION was not installed." >&2
  exit 1
fi

if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -d /usr/lib/jvm/java-17-openjdk-amd64 ]]; then
    export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
  elif [[ -d /usr/lib/jvm/java-21-openjdk-amd64 ]]; then
    export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
  fi
fi
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="${FERAL_GRADLE_USER_HOME:-$TOOLCHAIN_DIR/native/gradle-user-home}"
mkdir -p "$GRADLE_USER_HOME"
FERAL_GRADLE_PROXY_OPTS="$(python3 "$REPO_ROOT/tools/native/gradle-proxy.py")"
if [[ -n "$FERAL_GRADLE_PROXY_OPTS" ]]; then
  export GRADLE_OPTS="${GRADLE_OPTS:-} $FERAL_GRADLE_PROXY_OPTS"
fi

"$GRADLE" --no-daemon -p "$PLUGIN_SOURCE" assembleRelease

FERAL_AAR_SOURCE="$PLUGIN_SOURCE/build/outputs/aar/FeralMigration-release.aar"
FERAL_AAR_TARGET="$NATIVE_DIR/addons/FeralMigration/bin/release/feral-migration-release.aar"
if [[ ! -f "$FERAL_AAR_SOURCE" ]]; then
  echo "Android plugin build did not produce $FERAL_AAR_SOURCE" >&2
  exit 1
fi
mkdir -p "$(dirname "$FERAL_AAR_TARGET")"
cp "$FERAL_AAR_SOURCE" "$FERAL_AAR_TARGET"
printf 'Android migration plugin staged: %s\n' "$FERAL_AAR_TARGET"
