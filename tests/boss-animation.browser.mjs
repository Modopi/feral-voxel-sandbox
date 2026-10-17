// Explicit render verification, separate from the pure Node test suite.
// node tests/boss-animation.browser.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url))), out = path.join(root, 'verification/boss-animation');
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#18201e}canvas{display:block}#title{position:absolute;color:#fff;font:20px sans-serif;left:24px;top:15px}</style><div id="title"></div><script type="module">
import * as T from '/app/src/main/assets/vendor/three.module.js';
import {CONTENT} from '/app/src/main/assets/content-runtime/catalog.generated.js';
import {loadAsset} from '/app/src/main/assets/content-runtime/assets.generated.js';
import {surfaceGroups} from '/app/src/main/assets/content-runtime/voxel/solid.mjs';
import {BossSystem} from '/app/src/main/assets/content-runtime/bosses.js';
import {animateBossModel} from '/app/src/main/assets/content-runtime/boss-animation.js';
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1600,1000);renderer.setPixelRatio(1);document.body.append(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#1e2926');scene.add(new T.HemisphereLight(0xe4f1e7,0x56644b,2.2));const sun=new T.DirectionalLight(0xffe6c4,2.5);sun.position.set(-20,40,20);scene.add(sun);
const camera=new T.OrthographicCamera(-29,29,18.125,-18.125,.1,200);camera.position.set(24,32,45);camera.lookAt(0,2,0);
const system=new BossSystem(CONTENT),records=[];
for(const [i,d]of CONTENT.bosses.entries.entries()){
 const asset=await loadAsset(d.id),group=new T.Group(),parts=new Map();group.position.set((i%4-1.5)*12,0,(Math.floor(i/4)-.5)*17);scene.add(group);
 for(const p of asset.parts){const node=new T.Group();node.position.set(...p.translation);parts.set(p.id,node);}
 for(const p of asset.parts){const node=parts.get(p.id);(p.parent?parts.get(p.parent):group).add(node);for(const mat of asset.materials){const boxes=p.boxes.filter(b=>b.material===mat.id);if(!boxes.length)continue;const mesh=new T.InstancedMesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color:mat.color,roughness:.85,metalness:mat.metallic??0,emissive:mat.color,emissiveIntensity:Math.min(.1,mat.emission??0)}),boxes.length);boxes.forEach((b,i)=>mesh.setMatrixAt(i,new T.Matrix4().compose(new T.Vector3(...b.center),new T.Quaternion(),new T.Vector3(...b.size))));mesh.instanceMatrix.needsUpdate=true;node.add(mesh);}}
 const e=system.spawn(d.id,[group.position.x,0,group.position.z]);records.push({record:{asset,parts,group,desc:{}},e,def:d});
 const ground=new T.Mesh(new T.BoxGeometry(10,.12,11),new T.MeshStandardMaterial({color:i%2?0x465347:0x3b493e}));ground.position.set(group.position.x,-.1,group.position.z);scene.add(ground);
}
window.capturePose=(mode)=>{for(const {record,e,def}of records){e.phaseIndex=mode==='idle'?0:mode==='windup'?1:2;e.parts.core.broken=mode==='death';e.parts.locomotion.broken=mode==='death';e.defeated=mode==='death';e.flightState=mode==='active'?'airborne':'grounded';const skill=def.skills[mode==='active'?1:0];e.cast=['windup','active'].includes(mode)?{skillId:skill.id,stage:mode,windupS:skill.windupS,remaining:(mode==='windup'?skill.windupS:skill.activeS)*.5}:null;animateBossModel(record,e,system,3,.016);if(mode==='death')animateBossModel(record,e,system,5,.016);}renderer.render(scene,camera);document.querySelector('#title').textContent='FERAL / eight original boss rigs / '+mode;return{mode,bosses:records.length,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,finite:records.every(({record})=>[...record.parts.values()].every(n=>n.matrixWorld.elements.every(Number.isFinite)))};};window.ready=true;
</script>`;
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  try { const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname); if (!file.startsWith(root + path.sep)) throw Error('outside'); res.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream'); res.end(await fs.readFile(file)); } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [], reports = [];
page.on('pageerror', (e) => { errors.push(String(e)); console.error(String(e)); });
try {
  await fs.mkdir(out, { recursive: true }); await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => window.ready);
  for (const mode of ['idle', 'windup', 'active', 'death']) {
    const report = await page.evaluate((mode) => window.capturePose(mode), mode);
    if (!report.finite || report.bosses !== 8 || report.triangles < 1000) throw Error('Invalid render');
    await page.screenshot({ path: path.join(out, mode + '.png') }); reports.push(report);
  }
  if (errors.length) throw Error(errors.join('\n'));
  await fs.writeFile(path.join(out, 'render.json'), JSON.stringify({ ok: true, renderer: 'Chromium / Three / SwiftShader', reports, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, reports }));
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
