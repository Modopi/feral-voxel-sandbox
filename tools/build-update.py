#!/usr/bin/env python3
"""재현 가능한 ZIP, 서명된 메타데이터, 단일 다운로드 패키지 생성."""
import base64
import hashlib
import io
import json
import re
import os
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def build():
    subprocess.run(["node", "tools/version.mjs", "--check"], cwd=ROOT, check=True)
    v = json.loads((ROOT / "version.json").read_text())
    native_runtime = v.get("nativeCode", 0) >= 400
    assets = ROOT / ("native/data" if native_runtime else "app/src/main/assets")
    output = ROOT / "build/release"
    output.mkdir(parents=True, exist_ok=True)
    files = {}
    expanded = 0
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in sorted(p for p in assets.rglob("*") if p.is_file()):
            name = path.relative_to(assets).as_posix()
            contents = path.read_bytes()
            expanded += len(contents)
            files[name] = hashlib.sha256(contents).hexdigest()
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, contents)
    data = archive.getvalue()
    native_hash = hashlib.sha256()
    if native_runtime:
        native_roots = ["native/src", "native/third_party", "native/data", "native/fonts", "native/icons",
                        "native/addons", "native/android/feral-migration/src"]
        native_suffixes = {".cpp", ".h", ".hpp", ".json", ".otf", ".ttf", ".png",
                           ".gd", ".cfg", ".import", ".uid", ".java", ".xml", ".der"}
        native_files = sorted(p for base in native_roots for p in (ROOT / base).rglob("*")
                              if p.is_file() and p.suffix in native_suffixes)
        native_files += [ROOT / path for path in (
            "native/project.godot", "native/feral.gdextension", "native/main.tscn",
            "native/SConstruct", "native/feral.exports", "native/export_presets.cfg",
            "native/android/feral-migration/build.gradle",
            "native/android/feral-migration/settings.gradle",
            "native/android/feral-migration/gradle.properties",
            "build-apk.sh", "tools/native/toolchain.lock", "tools/native/build.sh",
            "tools/native/bootstrap.py", "tools/native/build-profile.py",
            "tools/native/snapshot-sources.py",
            "tools/native/build-migration-plugin.sh", "tools/native/export-apk.sh")]
    else:
        native_files = sorted((ROOT / "app/src/main/java").rglob("*.java")) + [ROOT / "app/src/main/AndroidManifest.xml", assets / "update-public.der"]
    for path in native_files:
        contents = path.read_bytes()
        if path.suffix == ".xml":
            contents = re.sub(rb'android:version(?:Code|Name)="[^"]*"', b'android:version="_"', contents)
        native_hash.update(path.relative_to(ROOT).as_posix().encode() + b"\0" + contents)
    manifest = {"format": 1, **v, "nativeSha256": native_hash.hexdigest(), "archiveBytes": len(data), "expandedBytes": expanded,
                "archiveSha256": hashlib.sha256(data).hexdigest(), "files": files}
    apk = ROOT / "build" / f"Feral-{v.get('nativeVersion', v['version'])}-android.apk"
    if native_runtime:
        manifest["runtime"] = "godot-cpp"
        manifest["archivePurpose"] = "native-content-snapshot"
        if apk.is_file() and not os.environ.get("GITHUB_REF_NAME", "").startswith("V_"):
            manifest["nativeApk"] = {
                "url": f"https://github.com/Modopi/feral-voxel-sandbox/releases/download/v{v['version']}/{apk.name}",
                "sha256": hashlib.sha256(apk.read_bytes()).hexdigest(), "bytes": apk.stat().st_size,
                "packageName": "com.kgb.feral",
                "signerSha256": "80ec9e5082918a64397ecea43ed75fc2fd48c63ac26401dc7d946259b9ee35ed"
            }
    if os.environ.get("GITHUB_REF_NAME", "").startswith("V_"):
        manifest["sourceBranch"] = os.environ["GITHUB_REF_NAME"]
        manifest["sourceCommit"] = os.environ["GITHUB_SHA"]
    raw = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    (output / "manifest.json").write_bytes(raw)
    subprocess.run(["java", "tools/BundleSigner.java", "signing/prototype.keystore", "android", "sign",
                    str(output / "manifest.json"), str(output / "manifest.sig")], cwd=ROOT, check=True)
    signature = (output / "manifest.sig").read_bytes()
    envelope = {"manifest": base64.b64encode(raw).decode(), "signature": base64.b64encode(signature).decode(),
                "archive": base64.b64encode(data).decode()}
    packed = json.dumps(envelope, separators=(",", ":")).encode()
    filename = f"Feral-{v['version']}-update.feral"
    (output / filename).write_bytes(packed)
    (output / "stable.feral").write_bytes(packed)
    sums = f"{hashlib.sha256(packed).hexdigest()}  {filename}\n"
    if not os.environ.get("GITHUB_REF_NAME", "").startswith("V_") and apk.is_file():
        sums += f"{hashlib.sha256(apk.read_bytes()).hexdigest()}  {apk.name}\n"
    (output / "SHA256SUMS.txt").write_text(sums)
    print(f"Update ready: {filename}, {len(packed)} bytes, {len(files)} verified files")
    return output / filename


if __name__ == "__main__":
    build()
