import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const out=new URL('../verification/expedition-touch/',import.meta.url);
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const report={scope:'Actual Chromium touch input and viewport layout; desktop SwiftShader, not Android hardware or thermal/lifecycle qualification.',checks:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('feral.worlds.v1',JSON.stringify([{id:'touch-check',name:'터치 검사',type:'expedition',seed:63026}])));
 await page.goto('http://127.0.0.1:8081/app/src/main/assets/expedition.html?world=touch-check');
 await page.waitForFunction(()=>window.FERAL?.ready,null,{timeout:90000});
 const cdp=await context.newCDPSession(page);
 const state=()=>page.evaluate(()=>({...FERAL.runtime.player,time:FERAL.runtime.time}));
 async function swipe(x,y,dx,dy,hold=0){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+dy*i/8,id:1}]});await page.waitForTimeout(30);}if(hold)await page.waitForTimeout(hold);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 async function tap(selector){const b=await page.locator(selector).boundingBox();assert(b,selector);await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}
 for(const [width,height]of [[390,844],[844,390],[360,640]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(1000);
  const boxes=await page.evaluate(()=>Object.fromEntries(['openBag','openMenu','attackMode','attack','jump','use','movePad'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return[id,{x:r.x,y:r.y,w:r.width,h:r.height}];})));
  for(const[id,r]of Object.entries(boxes)){assert(r.x>=0&&r.y>=0&&r.x+r.w<=width+1&&r.y+r.h<=height+1,`${width}x${height} ${id} out of viewport: ${JSON.stringify(r)}`);assert(r.w>=40&&r.h>=40,`${id} touch target too small`);}
  const pad=boxes.movePad,actions=boxes.attackMode;assert(pad.x+pad.w<=actions.x||pad.y>=actions.y+actions.h,'move and attack controls overlap');
  await tap('#attackMode');assert.equal((await state()).attackStyle,['pierce','impact','strike'][report.checks.length]);
  await tap('#openBag');await tap('[data-tab=craft]');
  const list=await page.locator('#panelList').boundingBox();assert(list.height>=100,'craft list too short');
  await swipe(list.x+list.width*.45,list.y+list.height*.8,0,-list.height*.6);
  assert((await page.locator('#panelList').evaluate(e=>e.scrollTop))>10,'touch list scroll');
  const scrollTime=await page.evaluate(()=>FERAL.runtime.time);
  await page.waitForFunction(t=>FERAL.runtime.time>t+1.2,scrollTime,{timeout:20000});
  assert((await page.locator('#panelList').evaluate(e=>e.scrollTop))>10,'periodic panel refresh preserves touch scroll');
  await tap('#closePanel');await page.screenshot({path:new URL(`${width}x${height}.png`,out).pathname});
  report.checks.push({width,height,controlsInside:true,touchModeCycle:true,touchCraftScroll:true,boxes});
 }
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
 const before=await state();await swipe(200,420,75,-25);const look=await state();assert(Math.abs(look.yaw-before.yaw)>.1,'touch look');
 const pad=await page.locator('#movePad').boundingBox();await swipe(pad.x+pad.width/2,pad.y+pad.height/2,25,-25,1200);const moved=await state();assert(Math.hypot(moved.x-look.x,moved.z-look.z)>.1,'touch joystick movement');
 await tap('#openMenu');const paused=await state();await page.waitForTimeout(700);assert.equal((await state()).time,paused.time,'menu pauses simulation');
 await tap('#save');await tap('#closeMenu');const saved=await state();await page.reload();await page.waitForFunction(()=>window.FERAL?.ready,null,{timeout:90000});const loaded=await state();
 assert.equal(loaded.attackStyle,saved.attackStyle);assert(Math.hypot(loaded.x-saved.x,loaded.z-saved.z)<.1,'saved position after reload');
 report.look=true;report.joystick=true;report.menuPause=true;report.saveReload=true;assert.deepEqual(report.errors,[]);
}catch(e){report.failure=e.stack;process.exitCode=1;}finally{await fs.writeFile(new URL('report.json',out),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
