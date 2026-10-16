import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("release publication happens before stable advances and failed uploads do not advance it", () => {
  const result = execFileSync("python3", ["-c", String.raw`
import importlib.util, json, os, pathlib, tempfile, base64
spec=importlib.util.spec_from_file_location('publish', 'tools/publish-release.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as temp:
    m.ROOT=pathlib.Path(temp)
    (m.ROOT/'build/release').mkdir(parents=True)
    v={'version':'0.2.5','versionCode':205,'minNativeCode':205}
    (m.ROOT/'version.json').write_text(json.dumps(v))
    (m.ROOT/'CHANGELOG.md').write_text('# 0.2.5\nTest release\n')
    for name in ['Feral-0.2.5-update.feral','manifest.json','manifest.sig','SHA256SUMS.txt']:
        (m.ROOT/'build/release'/name).write_bytes(b'package')
    envelope={'manifest':base64.b64encode(json.dumps({**v,'archiveSha256':'f'*64}).encode()).decode()}
    (m.ROOT/'build/release/Feral-0.2.5-update.feral').write_text(json.dumps(envelope))
    (m.ROOT/'build/Feral-0.2.5-android.apk').write_bytes(b'apk')
    os.environ['GITHUB_REF_NAME']='main'
    os.environ['GITHUB_REPOSITORY']='Modopi/feral-voxel-sandbox'
    os.environ['GITHUB_SHA']='a'*40
    calls=[]
    fail=False
    def request(path,data=None,method=None,binary=False):
        calls.append((path, data, method))
        if path.endswith('/releases'):
            return {'id':1,'draft':True}
        if path.endswith('/releases/1/assets'): return []
        if 'uploads.github.com' in path:
            if fail: raise OSError('upload failed')
            return {'id':2}
        if path.endswith('/git/blobs'): return {'sha':'b'*40}
        if path.endswith('/git/trees'): return {'sha':'c'*40}
        if path.endswith('/git/commits'): return {'sha':'d'*40}
        return {}
    m.request=request
    m.optional=lambda path: None
    m.publish()
    publish_index=next(i for i,c in enumerate(calls) if c[0].endswith('/releases/1') and c[2]=='PATCH')
    channel_index=next(i for i,c in enumerate(calls) if c[0].endswith('/git/refs'))
    assert publish_index < channel_index
    assert sum('uploads.github.com' in c[0] for c in calls)==5
    calls.clear(); fail=True
    try: m.publish()
    except OSError: pass
    else: raise AssertionError('failed upload must fail release')
    assert not any('/git/refs' in c[0] for c in calls)
    calls.clear(); fail=False
    os.environ['GITHUB_REF_NAME']='V_0.2.5_test'
    m.publish()
    trees=[c[1]['tree'] for c in calls if c[0].endswith('/git/trees')]
    assert all(e['path']!='stable.feral' for e in trees[0])
    assert any(e['path']=='catalog.json' for e in trees[0])
    assert any(e['path']=='builds/205.feral' for e in trees[0])
    assert sum('uploads.github.com' in c[0] for c in calls)==4
    os.environ.pop('GITHUB_REF_NAME')
print('publication-order-and-failure-checks-passed')
`], { encoding: "utf8" });
  assert.match(result, /publication-order-and-failure-checks-passed/);
});
