#!/usr/bin/env python3
"""버전 번호가 증가했을 때 비공개 Release와 updates 채널 게시."""
import base64
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def request(path, data=None, method=None, binary=False):
    url = path if path.startswith("https://") else "https://api.github.com" + path
    headers = {"Authorization": "Bearer " + os.environ["GH_TOKEN"], "User-Agent": "FERAL-Release",
               "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if data is not None:
        headers["Content-Type"] = "application/octet-stream" if binary else "application/json"
    body = data if binary else json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def optional(path):
    try:
        return request(path)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def publish():
    repo = os.environ.get("GITHUB_REPOSITORY", "Modopi/feral-voxel-sandbox")
    if repo != "Modopi/feral-voxel-sandbox":
        raise RuntimeError("Publishing is restricted to the configured repository")
    prefix = f"/repos/{repo}"
    version = json.loads((ROOT / "version.json").read_text())
    build = ROOT / "build/release"
    bundle = build / f"Feral-{version['version']}-update.feral"
    packed = bundle.read_bytes()
    current = optional(prefix + "/contents/stable.feral?ref=updates")
    if current:
        content = current if current.get("encoding") == "base64" else request(prefix + "/git/blobs/" + current["sha"])
        previous = json.loads(base64.b64decode(content["content"]))
        old = json.loads(base64.b64decode(previous["manifest"]))
        new = json.loads(base64.b64decode(json.loads(packed)["manifest"]))
        if old["versionCode"] > version["versionCode"]:
            raise RuntimeError("versionCode must increase")
        if old["versionCode"] == version["versionCode"]:
            if old != new:
                raise RuntimeError("Released versions are immutable. Bump version.json before changing shipped code.")
            print("Already published; no new release")
            return
        if old.get("nativeSha256") != new.get("nativeSha256") and version["minNativeCode"] != version["versionCode"]:
            raise RuntimeError("Native changes require minNativeCode = versionCode and a new APK")
    tag = "v" + version["version"]
    release = optional(prefix + "/releases/tags/" + tag)
    notes = (ROOT / "CHANGELOG.md").read_text().split("\n# ")[0].strip()
    notes += "\n\n비공개 배포 · 기존 앱에 APK 업데이트 설치 후 메뉴 → 업데이트에서 GitHub 연결.\n운영 절차: docs/RELEASING.md"
    if not release:
        release = request(prefix + "/releases", {"tag_name": tag, "target_commitish": os.environ["GITHUB_SHA"],
            "name": "FERAL " + version["version"], "body": notes, "draft": True, "prerelease": False})
    assets = [ROOT / "build" / f"Feral-{version['version']}-android.apk", bundle,
              build / "manifest.json", build / "manifest.sig", build / "SHA256SUMS.txt"]
    if release["draft"]:
        existing = {a["name"]: a for a in request(prefix + f"/releases/{release['id']}/assets")}
        for path in assets:
            # 실패한 draft 재시도 시 같은 이름의 미완성 자산 교체
            if path.name in existing:
                request(prefix + f"/releases/assets/{existing[path.name]['id']}", method="DELETE")
            request(f"https://uploads.github.com/repos/{repo}/releases/{release['id']}/assets?name={path.name}", path.read_bytes(), binary=True)
        request(prefix + f"/releases/{release['id']}", {"draft": False, "make_latest": "true"}, method="PATCH")
    else:
        existing = {a["name"]: a for a in request(prefix + f"/releases/{release['id']}/assets")}
        if not all(path.name in existing for path in assets):
            raise RuntimeError("Published release is incomplete; use a new version")
        digest = existing[bundle.name].get("digest")
        if digest and digest != "sha256:" + hashlib.sha256(packed).hexdigest():
            raise RuntimeError("Released versions are immutable; use a new version")
    # 완성된 Release를 먼저 게시한 뒤 앱이 읽는 stable 포인터 갱신
    ref = optional(prefix + "/git/ref/heads/updates")
    parents = [ref["object"]["sha"]] if ref else []
    base_tree = request(prefix + "/git/commits/" + parents[0])["tree"]["sha"] if parents else None
    blob = request(prefix + "/git/blobs", {"content": packed.decode(), "encoding": "utf-8"})["sha"]
    entries = [{"path": path, "mode": "100644", "type": "blob", "sha": blob}
               for path in ["stable.feral", f"versions/{version['version']}.feral"]]
    data = {"tree": entries}
    if base_tree:
        data["base_tree"] = base_tree
    tree = request(prefix + "/git/trees", data)["sha"]
    commit = request(prefix + "/git/commits", {"message": "Publish " + tag + " to stable", "tree": tree, "parents": parents})["sha"]
    if ref:
        request(prefix + "/git/refs/heads/updates", {"sha": commit, "force": False}, method="PATCH")
    else:
        request(prefix + "/git/refs", {"ref": "refs/heads/updates", "sha": commit})
    print("Published " + tag + " and advanced stable")


if __name__ == "__main__":
    publish()
