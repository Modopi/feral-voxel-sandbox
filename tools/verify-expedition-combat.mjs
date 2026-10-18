// Evidence tool for the 0.11–0.12 separate expedition screen (expedition.html, entry.js panels).
// Since 0.13.0 every map uses the one game screen; check it with tools/verify-ui-reachability.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { RuntimePhysics } from '../app/src/main/assets/content-runtime/physics.js';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { MachineSystem } from '../app/src/main/assets/content-runtime/machines.js';
import { BossSystem } from '../app/src/main/assets/content-runtime/bosses.js';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url))), web = path.join(root, 'app/src/main/assets'), out = path.join(root, 'verification/expedition-combat');
await fs.mkdir(out, { recursive: true });
const seed = 63026, worldId = 'combat-verification';
// This isolated, explicitly prepared save is NOT evidence of normal progression.
const prepared = await ExpeditionRuntime.create(seed);
const manor = prepared.nearbyStructures.find((s) => s.templateId === 'root_manor');
prepared.progression.grant({ gear_baseline_t8: 1, food: 12, wood: 24 }, { claimId: 'verification:prepared-supplies' });
prepared.progression.equip('gear_baseline_t8');
Object.assign(prepared.player, { x: manor.origin[0] + 82, y: manor.origin[1] + .05, z: -5, yaw: Math.PI, pitch: 0, hp: 275, maxHp: 275 });
prepared.refreshWorld();
const fixture = prepared.serialize(), bossId = manor.boss.instanceId;
await fs.writeFile(path.join(out, 'prepared-save.json'), JSON.stringify(fixture));
const report = { scope: 'Prepared-save browser combat and separate machine integration; not initial progression or mobile performance evidence', seed,
  preparation: { loadout: 'gear_baseline_t8', items: { food: 12, wood: 24 }, player: fixture.player, bossId }, actions: [], observations: [], checks: {}, errors: [] };
async function verifyMachineFixture(){
 const progression=new Progression(CONTENT);progression.grant({wood:1000,heat_engine:1,transmission:1,raw_timber:1},{claimId:'combat-machine-fixture'});
 for(const component of ['heat_engine','transmission']){const research=progression.catalog.get(progression.catalog.get(component).research);progression.discover(research.blueprint,{origin:'discovery',claimId:'verify:'+component});}
 const machines=new MachineSystem(CONTENT,progression),id=machines.create({position:[3,0,0],gridM:.5}).machineId;
 for(const cell of [[0,0,0],[1,0,0]])assert(machines.attachVoxel(id,{cell,materialId:'wood'}).ok);
 const m=machines.machines.get(id),engine=machines.installComponent(id,m.voxels[0].id,'heat_engine').componentInstanceId;
 const wheel=machines.installComponent(id,m.voxels[1].id,'transmission',{legacyType:'propeller'}).componentInstanceId;
 assert(machines.connect(id,engine,wheel,'mechanical').ok);assert(machines.refuel(id,engine,1).ok);machines.control(id,{throttle:1});
 const rt={machines,progression,player:{x:0,y:0,z:3},atlas:{revision:0,isSolidCell:(_x,y)=>y<0,heightAt:()=>0},nearbyStructures:[]};
 const physics=await RuntimePhysics.create(rt,null,{terrainRadius:6});let restoredPhysics;
 try{
  physics.synchronize(new Map(),rt.player);for(let i=0;i<12;i++)physics.step(1/60);
  assert(m.metrics.generated>0);assert.equal(progression.count('raw_timber'),0);
  const bosses=new BossSystem(CONTENT),boss=bosses.spawn('rootback_beast',[0,0,0]);
  const skill=bosses.definitions.get(boss.bossId).skills.find(s=>s.geometry.kind==='cylinder');let hits=0;
  const ctx={targets:physics.machineTargets(),terrain:{groundHeight:()=>0,hasAttackLineOfSight:(...args)=>physics.hasAttackLineOfSight(...args)},damage:e=>{hits++;assert(physics.damageMachineTarget(e).ok);}};
  const health=()=>[...machines.machines.values()].flatMap(m=>m.voxels).reduce((n,v)=>n+v.hp,0);
  const cast=()=>{boss.cast=null;boss.staggerS=0;ctx.targets=physics.machineTargets();bosses.startCast(boss,{s:skill,shape:bosses.makeShape(boss,skill,ctx.targets[0],ctx),windupS:skill.windupS},ctx.targets[0]);};
  const run=()=>{for(let t=0;t<skill.windupS+skill.activeS+.05;t+=.05){physics.step(.05);ctx.targets=physics.machineTargets();bosses.tick(.05,ctx);}};
  const initialHp=health();cast();run();assert.equal(hits,1);assert(health()<initialHp);const damagedHp=health();
  physics.adapter.addBody({ownerId:'verification:cover',type:'fixed',boxes:[{center:[1.5,1,0],size:[.5,3,12]}]});physics.step(1e-6);
  cast();run();assert.equal(hits,1);assert.equal(health(),damagedHp);
  const woodBefore=progression.count('wood');for(const machine of machines.machines.values())for(const v of machine.voxels)if(v.hp<v.maxHp)assert(machines.repair(machine.id,v.id).ok);
  assert.equal(health(),initialHp);assert(progression.count('wood')<woodBefore);
  const saved={machines:machines.serialize(),progression:progression.serialize()},againP=new Progression(CONTENT,saved.progression),again=new MachineSystem(CONTENT,againP,saved.machines);
  restoredPhysics=await RuntimePhysics.create({...rt,machines:again,progression:againP},null,{terrainRadius:6});restoredPhysics.synchronize(new Map(),rt.player);
  assert.deepEqual(again.machines.get(id).metrics,m.metrics);assert.deepEqual(again.machines.get(id).damageClaims,m.damageClaims);
  assert(Math.abs(restoredPhysics.machinePhysics.bodies.get(id).entry.body.mass()-again.evaluate(id).mass)<.01);
  const result={scope:'Separate prepared actual MachineSystem + Rapier integration, not browser controls or natural progression',initialHp,damagedHp,repairedHp:health(),bossHits:hits,coverBlocked:true,fuelUnitsConsumed:1,repairWood:woodBefore-progression.count('wood'),metrics:m.metrics,damageClaims:m.damageClaims,savedPose:m.position,checks:{fuel:true,bossDamage:true,cover:true,repair:true,saveLedger:true}};
  await fs.writeFile(path.join(out,'machine-report.json'),JSON.stringify(result,null,2));return result;
 }finally{restoredPhysics?.dispose();physics.dispose();}
}
if(process.argv.includes('--machine-only')){console.log(JSON.stringify(await verifyMachineFixture()));process.exit(0);}
const server = http.createServer(async (req, res) => {
  if (req.url === '/__prepare') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>isolated combat preparation</title>'); return; }
  try { const file = path.resolve(web, '.' + new URL(req.url, 'http://localhost').pathname); if (!file.startsWith(web + path.sep)) throw Error('outside');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm' })[path.extname(file)] ?? 'application/octet-stream'); res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(45000);
page.on('pageerror', (e) => { report.errors.push(String(e)); console.error(String(e)); });
const log = (type, values = {}) => { const item = { type, at: Date.now(), ...values }; report.actions.push(item); console.log(JSON.stringify(item)); };
async function snapshot(label) {
  const value = await page.evaluate((id) => { const f = window.FERAL, r = f.runtime, b = r.bosses.get(id), hit = f.view.aim(); return {
    time: r.time, player: { ...r.player }, boss: b ? { id: b.id, hp: b.hp, maxHp: b.maxHp, position: b.position, parts: b.parts, cast: b.cast, phaseId: b.phaseId, gimmicks: b.gimmicks, reward: b.reward, defeated: b.defeated } : null,
    aim: hit ? { kind: hit.kind, id: hit.id, partId: hit.partId, point: hit.point, distance: hit.distance } : null,
    models: f.view.models.size, pending: f.view.pending.size, triangles: f.view.renderer.info.render.triangles,
    claims: r.dungeons.get(b?.instanceId)?.claims, inventory: r.progression.inventory, deaths: r.deaths,
  }; }, bossId); report.observations.push({ label, ...value }); console.log(JSON.stringify({ label, time: value.time, hp: value.player.hp, bossHp: value.boss?.hp, phase: value.boss?.phaseId, aim: value.aim, player: value.player })); return value;
}
async function key(code, milliseconds) { log('key', { code, simulationMilliseconds: milliseconds });
 const until=await page.evaluate(ms=>window.FERAL.runtime.time+ms/1000,milliseconds); await page.keyboard.down(code);
 await page.waitForFunction(t=>window.FERAL.runtime.time>=t,until,{timeout:90000}); await page.keyboard.up(code); }
async function attackHold(seconds){log('attack-button-hold',{simulationSeconds:seconds});
 const until=await page.evaluate(s=>window.FERAL.runtime.time+s,seconds);await page.locator('#attack').hover();await page.mouse.down();
 await page.waitForFunction(t=>window.FERAL.runtime.time>=t,until,{timeout:90000});await page.mouse.up();}

async function lookAt(position) {
  const p = await page.evaluate(() => ({ ...window.FERAL.runtime.player, eye: window.FERAL.controller.eye }));
  const dx = position.x - p.x, dz = position.z - p.z, dy = position.y - (p.y + p.eye);
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
  let delta = ((yaw - p.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const steps = Math.max(1, Math.ceil(Math.abs(delta / .005) / 230));
  for (let i = 0; i < steps; i++) { await page.mouse.move(640, 430); await page.mouse.down(); await page.mouse.move(640 - delta / .005 / steps, 430 - (pitch - p.pitch) / .005 / steps, { steps: 4 }); await page.mouse.up(); }
  log('mouse-look', { target: position });
}
async function walkTo(position, stop=2.3){
 position=Array.isArray(position)?{x:position[0],y:position[1],z:position[2]}:position;
 for(let i=0;i<24;i++){
  const p=await page.evaluate(()=>({...window.FERAL.runtime.player,eye:window.FERAL.controller.eye}));
  const distance=Math.hypot(position.x-p.x,position.z-p.z);if(distance<=stop)return true;
  await lookAt({x:position.x,y:p.y+p.eye,z:position.z});
  await key('KeyW',Math.min(600,Math.max(120,(distance-stop)/3.2*1000)));
 }
 return false;
}
try {
  await page.goto(origin + '/__prepare');
  await page.evaluate(async ({ fixture, seed, worldId }) => { const { ExpeditionSave } = await import('/content-runtime/save.js');
    localStorage.setItem('feral.worlds.v1', JSON.stringify([{ id: worldId, name: 'Prepared combat verification', type: 'expedition', seed }]));
    new ExpeditionSave(localStorage, `feral.slot.${worldId}`).write(fixture);
  }, { fixture, seed, worldId });
  await page.goto(origin + `/expedition.html?world=${worldId}`);
  await page.waitForFunction(() => window.FERAL?.ready); await page.keyboard.press('Escape');
  await page.waitForFunction((id) => window.FERAL.view.models.has(id), bossId);
  const initial = await snapshot('loaded-prepared-save'); await page.screenshot({ path: path.join(out, 'prepared.png') });
  if (!process.argv.includes('--inspect')) {
    await page.keyboard.press('Escape');
    await page.waitForFunction((id) => window.FERAL.runtime.bosses.get(id)?.cast?.stage === 'windup', bossId);
    const warning = await snapshot('windup-before-dodge'); await page.screenshot({ path: path.join(out, 'warning.png') });
    await key('KeyD', 800); const dodged = await snapshot('after-keyboard-dodge');
    report.checks.warning = !!warning.boss.cast; report.checks.dodgeMoved = Math.hypot(dodged.player.x - warning.player.x, dodged.player.z - warning.player.z) > 1;
    report.checks.dodgeHpPreserved = dodged.player.hp >= warning.player.hp;
    const gimmick=await page.evaluate(id=>window.FERAL.runtime.dungeons.anchors(id.replace(/:boss$/,'')).find(a=>a.kind==='gimmick'),bossId);
    if(gimmick){
      report.checks.gimmickApproached=await walkTo(gimmick.position,2.5);
      const before=await snapshot('gimmick-before-use');await page.keyboard.press('KeyE');log('interact-key',{anchor:gimmick.id});
      const started=await page.evaluate(()=>window.FERAL.runtime.time);await page.waitForFunction(t=>window.FERAL.runtime.time>=t+1.2,started,{timeout:90000});
      const after=await snapshot('gimmick-after-real-wait');report.checks.gimmickUsed=after.boss.gimmicks[gimmick.gimmickId].uses<before.boss.gimmicks[gimmick.gimmickId].uses;
      await page.screenshot({path:path.join(out,'gimmick.png')});
    }
    for (let i = 0; i < 50; i++) {
      const s = await snapshot(`attack-cycle-${i}`); if (s.boss.defeated) break;
      const target = await page.evaluate((id) => { const f = window.FERAL, m = f.view.models.get(id), a = m?.asset.anchors.find((a) => a.purpose.includes('weak_point'));
        if (a) { const n = m.parts.get(a.partId), v = n.localToWorld(n.position.clone().set(...a.position)); return { x: v.x, y: v.y, z: v.z }; }
        const b = f.runtime.bosses.get(id); return { x: b.position.x, y: b.position.y + 1.5, z: b.position.z }; }, bossId);
      await lookAt(target);
      const aimed = await snapshot(`aim-${i}`);
      if (aimed.aim?.kind === 'boss' && aimed.aim.distance <= 4) { await attackHold(1.2); }
      else await key('KeyW', 500);
      if (i % 5 === 0) await page.screenshot({ path: path.join(out, `combat-${i}.png`) });
    }
    const end = await snapshot('combat-end'); report.checks.bossDefeated = !!end.boss.defeated; report.checks.caloriesConsumed = end.player.calories < initial.player.calories;
    if(end.boss.defeated){
      const reward=await page.evaluate(id=>window.FERAL.runtime.dungeons.anchors(id.replace(/:boss$/,'')).find(a=>a.kind==='reward'&&a.channel==='boss'),bossId);
      if(reward){report.checks.rewardApproached=await walkTo(reward.position,2);await lookAt({x:reward.position[0],y:reward.position[1]+3,z:reward.position[2]});await page.keyboard.press('KeyE');
        await page.waitForTimeout(300);const first=await snapshot('boss-reward-claimed');await page.keyboard.press('KeyE');const second=await snapshot('boss-reward-repeat');
        report.checks.rewardClaimed=!!first.claims?.boss;report.checks.rewardIdempotent=JSON.stringify(first.inventory)===JSON.stringify(second.inventory);}
    }
    await page.keyboard.press('Escape'); await page.locator('#save').click(); const beforeSave = await snapshot('saved-via-menu');
    await page.reload(); await page.waitForFunction(() => window.FERAL?.ready); await page.keyboard.press('Escape'); const restored = await snapshot('restored-page');
    report.checks.savedBossHp = Math.abs(restored.boss.hp - beforeSave.boss.hp) < .001;
    report.checks.savedParts = JSON.stringify(restored.boss.parts) === JSON.stringify(beforeSave.boss.parts);
    await page.screenshot({ path: path.join(out, 'restored.png') });
  }
} catch (e) { report.errors.push(String(e)); console.error(e); }
finally { try { report.machine=await verifyMachineFixture(); }catch(e){report.errors.push('machine fixture: '+String(e));} await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2)); await browser.close(); await new Promise((r) => server.close(r)); }
console.log(JSON.stringify({ checks: report.checks, errors: report.errors }));
if (report.errors.length) process.exitCode = 1;
