#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NATIVE_DIR="$REPO_ROOT/native"
TOOLCHAIN_DIR="${FERAL_TOOLCHAIN_DIR:-$REPO_ROOT/../toolchain}"
VERSION_JSON="$REPO_ROOT/version.json"
LOCK_FILE="$REPO_ROOT/tools/native/toolchain.lock"
GODOT_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["godotVersion"])' "$LOCK_FILE")"
GODOT_EXECUTABLE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["godotExecutable"])' "$LOCK_FILE")"
GODOT_LOCAL="$TOOLCHAIN_DIR/native/godot-$GODOT_VERSION/$GODOT_EXECUTABLE"
GODOT_BIN="${GODOT_BIN:-$(command -v godot || printf '%s' "$GODOT_LOCAL")}"
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$TOOLCHAIN_DIR/sdk}}"
GODOT_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

if [[ ! -x "$ANDROID_HOME/platform-tools/adb" ]]; then
  "$REPO_ROOT/tools/native/bootstrap.sh" --skip-ndk --skip-templates
fi

"$REPO_ROOT/tools/native/build.sh"
if [[ ! -f "$GODOT_DATA_HOME/godot/export_templates/$GODOT_VERSION/android_release.apk" ]]; then
  "$REPO_ROOT/tools/native/bootstrap.sh"
fi
if [[ ! -x "$GODOT_BIN" ]]; then
  "$REPO_ROOT/tools/native/bootstrap.sh" --skip-ndk --skip-templates
fi
if [[ ! -f "$NATIVE_DIR/export_presets.cfg" ]]; then
  echo 'Android export preset is missing.' >&2
  exit 1
fi

FERAL_NATIVE_VERSION="$(node -p 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); v.nativeVersion || v.version' "$VERSION_JSON")"
FERAL_NATIVE_CODE="$(node -p 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); v.nativeCode || v.versionCode' "$VERSION_JSON")"
if (( FERAL_NATIVE_CODE <= 303 )); then
  echo "version.json nativeCode is still the shipped baseline 303; root must select a new native version before APK export." >&2
  exit 1
fi
"$REPO_ROOT/tools/native/build-migration-plugin.sh"
FERAL_EXPORT="$REPO_ROOT/build/Feral-$FERAL_NATIVE_VERSION-android.apk"
mkdir -p "$REPO_ROOT/build"

export GRADLE_USER_HOME="${FERAL_GRADLE_USER_HOME:-$TOOLCHAIN_DIR/native/gradle-user-home}"
mkdir -p "$GRADLE_USER_HOME"
FERAL_GRADLE_PROXY_OPTS="$(python3 "$REPO_ROOT/tools/native/gradle-proxy.py")"
if [[ -n "$FERAL_GRADLE_PROXY_OPTS" ]]; then
  export GRADLE_OPTS="${GRADLE_OPTS:-} $FERAL_GRADLE_PROXY_OPTS"
fi
if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -d /usr/lib/jvm/java-17-openjdk-amd64 ]]; then
    export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
  elif [[ -d /usr/lib/jvm/java-21-openjdk-amd64 ]]; then
    export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
  fi
fi
export FERAL_NATIVE_VERSION FERAL_NATIVE_CODE FERAL_EXPORT
SOURCE_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
GODOT_CONFIG_TEMP="$(mktemp -d "$REPO_ROOT/build/godot-config.XXXXXX")"
mkdir -p "$GODOT_CONFIG_TEMP/godot"
SOURCE_EDITOR_SETTINGS="$SOURCE_CONFIG_HOME/godot/editor_settings-4.6.tres"
TEMP_EDITOR_SETTINGS="$GODOT_CONFIG_TEMP/godot/editor_settings-4.6.tres"
if [[ -f "$SOURCE_EDITOR_SETTINGS" ]]; then
  cp "$SOURCE_EDITOR_SETTINGS" "$TEMP_EDITOR_SETTINGS"
else
  cat > "$TEMP_EDITOR_SETTINGS" <<'SETTINGS'
[gd_resource type="EditorSettings" format=3]

[resource]
SETTINGS
fi
export XDG_CONFIG_HOME="$GODOT_CONFIG_TEMP"
PRESET_BACKUP="$(mktemp "$REPO_ROOT/build/export_presets.XXXXXX")"
cp "$NATIVE_DIR/export_presets.cfg" "$PRESET_BACKUP"
restore_preset() {
  python3 - "$PRESET_BACKUP" "$NATIVE_DIR/export_presets.cfg" "$GODOT_CONFIG_TEMP" <<'PY'
import pathlib, shutil, sys
backup, preset, config = map(pathlib.Path, sys.argv[1:])
shutil.copyfile(backup, preset)
backup.unlink(missing_ok=True)
shutil.rmtree(config, ignore_errors=True)
PY
}
trap restore_preset EXIT INT TERM

python3 - "$NATIVE_DIR/export_presets.cfg" <<'PY'
import os, pathlib, re, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
text, code_count = re.subn(r'(?m)^version/code=\d+\s*$', f"version/code={os.environ['FERAL_NATIVE_CODE']}", text, count=1)
text, name_count = re.subn(r'(?m)^version/name="[^"]*"\s*$', f"version/name=\"{os.environ['FERAL_NATIVE_VERSION']}\"", text, count=1)
if code_count != 1 or name_count != 1:
    raise SystemExit('export_presets.cfg must contain one version/code and version/name option')
path.write_text(text)
PY
python3 - "$TEMP_EDITOR_SETTINGS" "$ANDROID_HOME" "${JAVA_HOME:-}" <<'PY'
import json, pathlib, re, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
for key, value in (("export/android/android_sdk_path", sys.argv[2]), ("export/android/java_sdk_path", sys.argv[3])):
    setting = f"{key} = {json.dumps(value)}"
    pattern = rf"(?m)^{re.escape(key)}\s*=.*$"
    text, count = re.subn(pattern, setting, text, count=1)
    if count == 0:
        text += "\n" + setting
path.write_text(text)
PY

FERAL_ANDROID_TEMPLATE_ARGS=()
if [[ ! -f "$NATIVE_DIR/android/build/build.gradle" ]]; then
  FERAL_ANDROID_TEMPLATE_ARGS+=(--install-android-build-template)
fi
"$GODOT_BIN" --headless --path "$NATIVE_DIR" "${FERAL_ANDROID_TEMPLATE_ARGS[@]}" --export-release Android "$FERAL_EXPORT"
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose "$FERAL_EXPORT"
"$ANDROID_HOME/build-tools/35.0.0/zipalign" -c -p 4 "$FERAL_EXPORT"
printf 'Signed Android APK ready: %s\n' "$FERAL_EXPORT"
