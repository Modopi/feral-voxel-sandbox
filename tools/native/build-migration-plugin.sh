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

if [[ -n "${JAVA_HOME:-}" ]]; then
  if [[ ! -x "$JAVA_HOME/bin/java" || ! -x "$JAVA_HOME/bin/javac" || ! -x "$JAVA_HOME/bin/jlink" ]]; then
    echo "JAVA_HOME must point to a full JDK containing bin/java, bin/javac, and bin/jlink: $JAVA_HOME" >&2
    exit 1
  fi
else
  for FERAL_JAVA_CANDIDATE in "$TOOLCHAIN_DIR"/native/jdk* "$TOOLCHAIN_DIR"/native/temurin* /usr/lib/jvm/*; do
    if [[ -x "$FERAL_JAVA_CANDIDATE/bin/java" && -x "$FERAL_JAVA_CANDIDATE/bin/javac" && -x "$FERAL_JAVA_CANDIDATE/bin/jlink" ]]; then
      JAVA_HOME="$FERAL_JAVA_CANDIDATE"
      break
    fi
  done
  if [[ -z "${JAVA_HOME:-}" ]]; then
    echo 'A full Java 21 JDK is required to build the Android plugin; set JAVA_HOME or install one under the native toolchain directory.' >&2
    exit 1
  fi
fi
if ! "$JAVA_HOME/bin/java" -version 2>&1 | grep -Eq 'version "21([.]|")'; then
  echo "Android plugin build requires Java 21; found an incompatible JDK at $JAVA_HOME" >&2
  exit 1
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

if [[ ! -x "$GRADLE" ]]; then
  "$REPO_ROOT/tools/native/bootstrap.sh" --skip-ndk --skip-templates
fi
if [[ ! -x "$GRADLE" ]]; then
  echo "Pinned Gradle $GRADLE_VERSION was not installed." >&2
  exit 1
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
