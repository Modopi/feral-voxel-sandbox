#!/usr/bin/env python3
"""V_ 브랜치의 게임 빌드 식별자 생성. 네이티브 버전은 유지."""
import json, os, re
from pathlib import Path

def prepare(root, branch, run):
    if not branch.startswith('V_'): return
    match = re.fullmatch(r'V_(\d+\.\d+\.\d+)(?:[-_][A-Za-z0-9_-]+)?', branch)
    if not run.isdigit() or not 1 <= int(run) <= 1000000000: raise ValueError('Invalid Actions run number')
    path = root / 'version.json'
    v = json.loads(path.read_text())
    v.update(version=match[1] if match else v["version"], versionCode=1000000+int(run))
    v.setdefault('nativeVersion','0.3.1'); v.setdefault('nativeCode',301)
    path.write_text(json.dumps(v, indent=2)+'\n')
    return v

if __name__ == '__main__':
    prepare(Path(__file__).resolve().parents[1], os.environ.get('GITHUB_REF_NAME','main'), os.environ.get('GITHUB_RUN_NUMBER',''))
