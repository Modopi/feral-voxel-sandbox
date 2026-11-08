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
    echo 'A full Java 21 JDK is required for Android export; set JAVA_HOME or install one under the native toolchain directory.' >&2
    exit 1
  fi
fi
if ! "$JAVA_HOME/bin/java" -version 2>&1 | grep -Eq 'version "21([.]|")'; then
  echo "Android export requires Java 21; found an incompatible JDK at $JAVA_HOME" >&2
  exit 1
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

if [[ ! -x "$ANDROID_HOME/platform-tools/adb" ]]; then
  "$REPO_ROOT/tools/native/bootstrap.sh" --skip-ndk --skip-templates
fi

GRADLE_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["gradleVersion"])' "$LOCK_FILE")"
GRADLE_ARCHIVE="$TOOLCHAIN_DIR/downloads/gradle-$GRADLE_VERSION-bin.zip"
GRADLE_ARCHIVE_VALID="$(python3 - "$LOCK_FILE" "$GRADLE_ARCHIVE" <<'PY'
import hashlib, json, pathlib, sys
lock = json.loads(pathlib.Path(sys.argv[1]).read_text())
archive = pathlib.Path(sys.argv[2])
if not archive.is_file():
    print("false")
else:
    digest = hashlib.sha256()
    with archive.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    print("true" if digest.hexdigest() == lock["gradleSha256"] else "false")
PY
)"
if [[ "$GRADLE_ARCHIVE_VALID" != true ]]; then
  "$REPO_ROOT/tools/native/bootstrap.sh" --skip-ndk --skip-templates
fi

"$REPO_ROOT/tools/native/build.sh"
if [[ ! -f "$GODOT_DATA_HOME/godot/export_templates/$GODOT_VERSION/android_release.apk" || ! -f "$GODOT_DATA_HOME/godot/export_templates/$GODOT_VERSION/android_source.zip" ]]; then
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

python3 - "$LOCK_FILE" "$GODOT_DATA_HOME/godot/export_templates/$GODOT_VERSION/android_source.zip" "$NATIVE_DIR/android" "$GRADLE_ARCHIVE" <<'PY'
import hashlib, json, pathlib, re, shutil, stat, sys, zipfile
lock_path, template_archive, android_dir, gradle_archive = map(pathlib.Path, sys.argv[1:])
lock = json.loads(lock_path.read_text())
version = lock["godotVersion"]
build_dir = android_dir / "build"
marker = android_dir / ".build_version"
if not (build_dir / "build.gradle").is_file() or not marker.is_file() or marker.read_text().strip() != version:
    if not template_archive.is_file():
        raise SystemExit(f"Godot Android source template is missing: {template_archive}")
    staging = android_dir / "build.installing"
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    with zipfile.ZipFile(template_archive) as zipped:
        root = staging.resolve()
        for entry in zipped.infolist():
            name = pathlib.PurePosixPath(entry.filename)
            if name.is_absolute() or ".." in name.parts:
                raise SystemExit(f"Unsafe path in Android export template: {entry.filename}")
            target = staging.joinpath(*name.parts)
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise SystemExit(f"Unexpected symlink in Android export template: {entry.filename}")
            target.parent.mkdir(parents=True, exist_ok=True)
            with zipped.open(entry) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
            if mode:
                target.chmod(stat.S_IMODE(mode))
            target.resolve().relative_to(root)
    if not (staging / "build.gradle").is_file():
        raise SystemExit("Android export source template does not contain build.gradle at its root")
    shutil.rmtree(build_dir, ignore_errors=True)
    staging.replace(build_dir)
    marker.write_text(version + "\n")
    (build_dir / ".gdignore").touch()
    gradlew = build_dir / "gradlew"
    if gradlew.is_file():
        gradlew.chmod(gradlew.stat().st_mode | 0o111)

config = build_dir / "config.gradle"
text = config.read_text()
replacements = (
    (r"(?m)^(\s*compileSdk\s*:\s*)\d+(\s*,?)$", f"\\g<1>{lock['androidSdkPlatform']}\\g<2>"),
    (r"(?m)^(\s*targetSdk\s*:\s*)\d+(\s*,?)$", f"\\g<1>{lock['androidSdkPlatform']}\\g<2>"),
    (r"(?m)^(\s*buildTools\s*:\s*)'[^']+'(\s*,?)$", f"\\g<1>'{lock['androidBuildToolsVersion']}'\\g<2>"),
    (r"(?m)^(\s*ndkVersion\s*:\s*)'[^']+'(\s*,?)$", f"\\g<1>'{lock['androidNdkVersion']}'\\g<2>"),
)
for pattern, replacement in replacements:
    text, count = re.subn(pattern, replacement, text, count=1)
    if count != 1:
        raise SystemExit(f"Failed to set pinned Android toolchain version using {pattern}")
config.write_text(text)

archive = gradle_archive.resolve()
if not archive.is_file():
    raise SystemExit(f"Pinned Gradle archive is missing: {archive}")
digest = hashlib.sha256()
with archive.open("rb") as stream:
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
if digest.hexdigest() != lock["gradleSha256"]:
    raise SystemExit(f"Pinned Gradle archive checksum mismatch: {archive}")
url = archive.as_uri().replace(":", r"\:")
wrapper = build_dir / "gradle/wrapper/gradle-wrapper.properties"
text = wrapper.read_text()
text, url_count = re.subn(r"(?m)^distributionUrl=.*$", f"distributionUrl={url}", text, count=1)
sum_pattern = r"(?m)^distributionSha256Sum=.*$"
text, sum_count = re.subn(sum_pattern, f"distributionSha256Sum={lock['gradleSha256']}", text, count=1)
if url_count != 1:
    raise SystemExit(f"Godot Android Gradle wrapper URL was not found in {wrapper}")
if sum_count == 0:
    text = text.rstrip() + f"\ndistributionSha256Sum={lock['gradleSha256']}\n"
wrapper.write_text(text)
print(f"Pinned Godot Android template: SDK {lock['androidSdkPlatform']}, Build-Tools {lock['androidBuildToolsVersion']}, NDK {lock['androidNdkVersion']}, Gradle {lock['gradleVersion']}")
PY
"$GODOT_BIN" --headless --path "$NATIVE_DIR" --export-release Android "$FERAL_EXPORT"
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose "$FERAL_EXPORT"
"$ANDROID_HOME/build-tools/35.0.0/zipalign" -c -p 4 "$FERAL_EXPORT"
printf 'Signed Android APK ready: %s\n' "$FERAL_EXPORT"
