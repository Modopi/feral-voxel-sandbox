import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
test('branch preparation preserves native version and creates unique game builds',()=>{
 const out=execFileSync('python3',['-c',String.raw`
import importlib.util, pathlib, tempfile, json
spec=importlib.util.spec_from_file_location('prep','tools/prepare-branch.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as t:
 root=pathlib.Path(t);p=root/'version.json'
 p.write_text(json.dumps({'version':'0.3.1','versionCode':301,'nativeCode':301,'nativeVersion':'0.3.1','minNativeCode':301}))
 a=m.prepare(root,'V_0.3.2','42');assert a['version']=='0.3.2' and a['versionCode']==1000042
 b=m.prepare(root,'V_vehicle','43');assert b['nativeCode']==301 and b['nativeVersion']=='0.3.1' and b['versionCode']>a['versionCode']
 assert m.prepare(root,'main','') is None
 print('branch-native-isolation-passed')
`],{encoding:'utf8'});assert.match(out,/branch-native-isolation-passed/);
});
