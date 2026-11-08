#!/usr/bin/env python3
"""Install the pinned, user-local Godot native build toolchain."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[2]
LOCK = json.loads((ROOT / "tools/native/toolchain.lock").read_text())
TOOLCHAIN = pathlib.Path(os.environ.get("FERAL_TOOLCHAIN_DIR", ROOT.parent / "toolchain")).resolve()
SDK = pathlib.Path(os.environ.get("ANDROID_HOME", os.environ.get("ANDROID_SDK_ROOT", TOOLCHAIN / "sdk"))).resolve()
GODOT_LOCAL = TOOLCHAIN / f"native/godot-{LOCK['godotVersion']}" / LOCK["godotExecutable"]
GODOT_OVERRIDE = os.environ.get("GODOT_BIN")
GODOT = pathlib.Path(GODOT_OVERRIDE or shutil.which("godot") or GODOT_LOCAL).resolve()


def run(args: list[str], *, cwd: pathlib.Path | None = None) -> str:
    print("+", " ".join(str(a) for a in args), flush=True)
    return subprocess.run(args, cwd=cwd, check=True, text=True, stdout=subprocess.PIPE).stdout.strip()


def install_scons() -> None:
    expected = LOCK["sconsVersion"]
    try:
        version = run([sys.executable, "-m", "SCons", "--version"])
    except (subprocess.CalledProcessError, FileNotFoundError):
        version = ""
    if f"SCons: v{expected}." not in version:
        run([sys.executable, "-m", "pip", "install", "--user", f"scons=={expected}"])
    version = run([sys.executable, "-m", "SCons", "--version"])
    if f"SCons: v{expected}." not in version:
        raise RuntimeError(f"Expected SCons {expected}; found:\n{version}")


def ensure_godot() -> None:
    version = run([str(GODOT), "--version"])
    if not version.startswith(LOCK["godotVersion"]):
        raise RuntimeError(f"Expected Godot {LOCK['godotVersion']}; found {version} at {GODOT}")


def install_godot_cpp() -> pathlib.Path:
    destination = TOOLCHAIN / "native/godot-cpp"
    revision = LOCK["godotCppRevision"]
    TOOLCHAIN.mkdir(parents=True, exist_ok=True)
    if not (destination / ".git").exists():
        if destination.exists():
            raise RuntimeError(f"Refusing to replace non-git dependency directory: {destination}")
        destination.mkdir(parents=True)
        run(["git", "init", str(destination)])
        run(["git", "-C", str(destination), "remote", "add", "origin", LOCK["godotCppUrl"]])
    try:
        current = run(["git", "-C", str(destination), "rev-parse", "HEAD"])
    except subprocess.CalledProcessError:
        current = ""
    if current != revision:
        run(["git", "-C", str(destination), "fetch", "--depth=1", "origin", revision])
        run(["git", "-C", str(destination), "checkout", "--detach", "FETCH_HEAD"])
    resolved = run(["git", "-C", str(destination), "rev-parse", "HEAD"])
    if resolved != revision:
        raise RuntimeError(f"godot-cpp revision mismatch: expected {revision}, got {resolved}")
    return destination


def hash_file(path: pathlib.Path, algorithm: str) -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, destination: pathlib.Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".partial")
    partial.unlink(missing_ok=True)
    print(f"Downloading {url} -> {destination}", flush=True)
    request = urllib.request.Request(url, headers={"User-Agent": "FERAL-native-bootstrap/1"})
    with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as output:
        shutil.copyfileobj(response, output, length=1024 * 1024)
    partial.replace(destination)


def safe_extract(archive: pathlib.Path, destination: pathlib.Path) -> list[pathlib.Path]:
    destination.mkdir(parents=True, exist_ok=True)
    roots: set[pathlib.Path] = set()
    resolved_destination = destination.resolve()
    with zipfile.ZipFile(archive) as zipped:
        for entry in zipped.infolist():
            name = pathlib.PurePosixPath(entry.filename)
            if name.is_absolute() or ".." in name.parts:
                raise RuntimeError(f"Unsafe path in toolchain archive: {entry.filename}")
            if name.parts:
                roots.add(destination / name.parts[0])
            mode = entry.external_attr >> 16
            extracted = destination.joinpath(*name.parts)
            if stat.S_ISLNK(mode):
                link_target = zipped.read(entry).decode("utf-8")
                if pathlib.PurePosixPath(link_target).is_absolute():
                    raise RuntimeError(f"Absolute symlink in toolchain archive: {entry.filename}")
                resolved_target = (extracted.parent / link_target).resolve()
                try:
                    resolved_target.relative_to(resolved_destination)
                except ValueError as error:
                    raise RuntimeError(f"Symlink escapes toolchain archive root: {entry.filename}") from error
                extracted.parent.mkdir(parents=True, exist_ok=True)
                extracted.symlink_to(link_target)
            else:
                zipped.extract(entry, destination)
                if mode and extracted.exists():
                    extracted.chmod(stat.S_IMODE(mode))
    return sorted(roots)


def install_ndk() -> None:
    version = LOCK["androidNdkVersion"]
    package = LOCK["androidNdkPackage"]
    target = SDK / "ndk" / version
    clang = target / "toolchains/llvm/prebuilt/linux-x86_64/bin/clang"
    clangxx = target / "toolchains/llvm/prebuilt/linux-x86_64/bin/clang++"
    if (target / "source.properties").is_file() and clang.is_symlink() and clangxx.is_symlink():
        print(f"Android NDK {version} already installed at {target}")
        return

    with urllib.request.urlopen("https://dl.google.com/android/repository/repository2-3.xml", timeout=60) as response:
        repository = ET.fromstring(response.read())
    package_node = next((node for node in repository.findall("remotePackage") if node.attrib.get("path") == package), None)
    if package_node is None:
        raise RuntimeError(f"Android package metadata not found: {package}")
    archive_node = next((node for node in package_node.findall("archives/archive") if node.findtext("host-os") == "linux"), None)
    complete = archive_node.find("complete") if archive_node is not None else None
    if complete is None:
        raise RuntimeError(f"No Linux archive in Android package metadata: {package}")
    url = "https://dl.google.com/android/repository/" + complete.findtext("url")
    expected_size = int(complete.findtext("size"))
    checksum = complete.find("checksum")
    expected_hash = checksum.text.strip().lower()
    algorithm = checksum.attrib["type"]

    download_dir = TOOLCHAIN / "downloads"
    archive = download_dir / pathlib.Path(url).name
    if not archive.exists() or archive.stat().st_size != expected_size:
        download(url, archive)
    if archive.stat().st_size != expected_size or hash_file(archive, algorithm) != expected_hash:
        archive.unlink(missing_ok=True)
        raise RuntimeError(f"Android NDK archive failed {algorithm}/{expected_size} verification")

    temporary = SDK / "ndk" / f".{version}.installing"
    shutil.rmtree(temporary, ignore_errors=True)
    roots = safe_extract(archive, temporary)
    if len(roots) != 1 or not (roots[0] / "source.properties").is_file():
        raise RuntimeError(f"Unexpected Android NDK archive layout: {roots}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(target, ignore_errors=True)
    roots[0].replace(target)
    shutil.rmtree(temporary, ignore_errors=True)
    print(f"Installed verified Android NDK {version} at {target}")


def install_platform_tools() -> None:
    version = LOCK["androidPlatformToolsVersion"]
    target = SDK / "platform-tools"
    adb = target / "adb"
    source_properties = target / "source.properties"
    expected_revision = f"Pkg.Revision={version}"
    if adb.is_file() and source_properties.is_file() and expected_revision in source_properties.read_text():
        print(f"Android Platform-Tools {version} already installed at {target}")
        return

    archive = TOOLCHAIN / "downloads" / pathlib.Path(LOCK["androidPlatformToolsUrl"]).name
    expected_bytes = LOCK["androidPlatformToolsBytes"]
    expected_hash = LOCK["androidPlatformToolsSha256"]
    if not archive.exists() or archive.stat().st_size != expected_bytes or hash_file(archive, "sha256") != expected_hash:
        archive.unlink(missing_ok=True)
        download(LOCK["androidPlatformToolsUrl"], archive)
    if archive.stat().st_size != expected_bytes or hash_file(archive, "sha256") != expected_hash:
        archive.unlink(missing_ok=True)
        raise RuntimeError("Android Platform-Tools archive failed SHA-256/size verification")

    temporary = SDK / ".platform-tools.installing"
    shutil.rmtree(temporary, ignore_errors=True)
    roots = safe_extract(archive, temporary)
    platform_tools = next((root for root in roots if root.name == "platform-tools"), None)
    if platform_tools is None or not (platform_tools / "adb").is_file():
        raise RuntimeError(f"Unexpected Android Platform-Tools archive layout: {roots}")
    installed_revision = (platform_tools / "source.properties").read_text()
    if expected_revision not in installed_revision:
        raise RuntimeError(f"Android Platform-Tools version mismatch: expected {version}")
    shutil.rmtree(target, ignore_errors=True)
    platform_tools.replace(target)
    shutil.rmtree(temporary, ignore_errors=True)
    (target / "adb").chmod((target / "adb").stat().st_mode | 0o111)
    print(f"Installed verified Android Platform-Tools {version} at {target}")


def install_templates() -> None:
    version = LOCK["godotVersion"]
    data_home = pathlib.Path(os.environ.get("XDG_DATA_HOME", pathlib.Path.home() / ".local/share"))
    target = data_home / "godot/export_templates" / version
    expected_files = [target / "android_debug.apk", target / "android_release.apk"]
    if all(path.is_file() for path in expected_files):
        print(f"Godot export templates {version} already installed at {target}")
        return

    archive = TOOLCHAIN / "downloads" / pathlib.Path(LOCK["exportTemplatesUrl"]).name
    if not archive.exists() or hash_file(archive, "sha256") != LOCK["exportTemplatesSha256"]:
        archive.unlink(missing_ok=True)
        download(LOCK["exportTemplatesUrl"], archive)
    if hash_file(archive, "sha256") != LOCK["exportTemplatesSha256"]:
        archive.unlink(missing_ok=True)
        raise RuntimeError("Godot export template archive failed SHA-256 verification")

    temporary = target.with_name(target.name + ".installing")
    shutil.rmtree(temporary, ignore_errors=True)
    roots = safe_extract(archive, temporary)
    # Official TPZ files contain one top-level `templates` directory.
    template_root = next((root for root in roots if root.name == "templates"), None)
    if template_root is None:
        raise RuntimeError(f"Unexpected Godot export template layout: {roots}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(target, ignore_errors=True)
    template_root.replace(target)
    shutil.rmtree(temporary, ignore_errors=True)
    for path in expected_files:
        if not path.is_file():
            raise RuntimeError(f"Godot Android export template missing: {path}")
    print(f"Installed verified Godot export templates {version} at {target}")


def install_godot() -> pathlib.Path:
    if GODOT.is_file():
        return GODOT
    if GODOT_OVERRIDE:
        raise RuntimeError(f"GODOT_BIN points to a missing file: {GODOT}")
    destination = GODOT_LOCAL.parent
    archive = TOOLCHAIN / "downloads" / pathlib.Path(LOCK["godotUrl"]).name
    if not archive.exists() or hash_file(archive, "sha256") != LOCK["godotSha256"]:
        archive.unlink(missing_ok=True)
        download(LOCK["godotUrl"], archive)
    if hash_file(archive, "sha256") != LOCK["godotSha256"]:
        archive.unlink(missing_ok=True)
        raise RuntimeError("Godot Linux editor archive failed SHA-256 verification")

    temporary = destination.with_name(destination.name + ".installing")
    shutil.rmtree(temporary, ignore_errors=True)
    safe_extract(archive, temporary)
    extracted = temporary / LOCK["godotExecutable"]
    if not extracted.is_file():
        raise RuntimeError(f"Godot executable missing from official archive: {extracted}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(destination, ignore_errors=True)
    temporary.replace(destination)
    GODOT_LOCAL.chmod(GODOT_LOCAL.stat().st_mode | 0o111)
    print(f"Installed verified Godot {LOCK['godotVersion']} at {GODOT_LOCAL}")
    return GODOT_LOCAL


def install_gradle() -> pathlib.Path:
    version = LOCK["gradleVersion"]
    target = TOOLCHAIN / f"native/gradle-{version}"
    executable = target / "bin/gradle"
    if executable.is_file():
        return executable

    archive = TOOLCHAIN / "downloads" / pathlib.Path(LOCK["gradleUrl"]).name
    if not archive.exists() or hash_file(archive, "sha256") != LOCK["gradleSha256"]:
        archive.unlink(missing_ok=True)
        download(LOCK["gradleUrl"], archive)
    if hash_file(archive, "sha256") != LOCK["gradleSha256"]:
        archive.unlink(missing_ok=True)
        raise RuntimeError("Gradle distribution failed SHA-256 verification")

    temporary = target.with_name(target.name + ".installing")
    shutil.rmtree(temporary, ignore_errors=True)
    roots = safe_extract(archive, temporary)
    distribution = next((root for root in roots if root.name == f"gradle-{version}"), None)
    if distribution is None or not (distribution / "bin/gradle").is_file():
        raise RuntimeError(f"Unexpected Gradle distribution layout: {roots}")
    shutil.rmtree(target, ignore_errors=True)
    distribution.replace(target)
    shutil.rmtree(temporary, ignore_errors=True)
    executable.chmod(executable.stat().st_mode | 0o111)
    print(f"Installed verified Gradle {version} at {target}")
    return executable


def write_godot_api() -> pathlib.Path:
    ensure_godot()
    target = TOOLCHAIN / "native/godot-api" / LOCK["godotVersion"]
    target.mkdir(parents=True, exist_ok=True)
    api = target / "extension_api.json"
    interface = target / "gdextension_interface.h"
    if not api.is_file() or not interface.is_file():
        run([str(GODOT), "--headless", "--dump-extension-api"], cwd=target)
        run([str(GODOT), "--headless", "--dump-gdextension-interface"], cwd=target)
    if not api.is_file() or not interface.is_file():
        raise RuntimeError(f"Godot did not generate extension API files in {target}")
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-ndk", action="store_true", help="Do not install the Android NDK")
    parser.add_argument("--skip-templates", action="store_true", help="Do not install Godot export templates")
    args = parser.parse_args()

    install_scons()
    install_godot_cpp()
    install_godot()
    write_godot_api()
    install_gradle()
    if not args.skip_ndk:
        install_ndk()
    install_platform_tools()
    if not args.skip_templates:
        install_templates()
    print(f"Native toolchain ready: {TOOLCHAIN}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError, urllib.error.URLError) as error:
        print(f"native bootstrap failed: {error}", file=sys.stderr)
        raise SystemExit(1)
