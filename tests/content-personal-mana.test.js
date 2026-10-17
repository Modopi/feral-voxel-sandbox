import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Progression} from '../app/src/main/assets/content-runtime/progression.js';
const CONTENT={progression:JSON.parse(fs.readFileSync(new URL('../design/content/progression.json',import.meta.url)))};
let next=0;const receipt=()=>({claimId:'mana-test:'+next++});
function fixture(){const p=new Progression(CONTENT);p.research.add('mana');p.grant({mana_steel:20,world_heartwood:10,liquid_mana:20,bark_cup:1,gear_baseline_t5:1,gear_baseline_t10:1},receipt());p.syncWorldFixtures([{ownerId:'workshop',assetId:'field_bench',kind:'station',position:{x:0,y:0,z:0},health:100,maxHealth:100,active:true}],{accessibleOwnerIds:['workshop']});return p;}
test('mana investments spend existing authored materials, increase avatar capacity and never grant energy',()=>{
 const p=fixture(),claim=receipt();assert.equal(p.energyCapacity('magic'),0);assert.equal(p.investMana('wood',1,receipt()).ok,false);
 const result=p.investMana('mana_steel',1,claim);assert.equal(result.capacityGain,65);assert.equal(p.count('mana_steel'),19);assert.equal(p.energyCapacity('magic'),65);assert.equal(p.energy.magic,0);
 assert.equal(p.investMana('mana_steel',1,claim).duplicate,true);assert.equal(p.count('mana_steel'),19);assert.equal(p.energyCapacity('magic'),65);
 assert.equal(p.fillPersonalMana(.5,receipt()).ok,true);assert.equal(p.energy.magic,50);assert.equal(p.count('liquid_mana'),19.5);
 const restored=new Progression(CONTENT,p.serialize());assert.equal(restored.energyCapacity('magic'),65);assert.equal(restored.energy.magic,50);
});
test('one owned focus changes capacity; unequip reserves excess without reusable free mana or reserve refill while unequipped',()=>{
 const p=fixture();p.investMana('mana_steel',1,receipt());p.equipManaFocus('gear_baseline_t5');assert.equal(p.energyCapacity('magic'),115);p.fillPersonalMana(1,receipt());
 p.unequipManaFocus();assert.equal(p.energy.magic,65);assert.equal(p.personalMana.reserveEU,35);p.consumeEnergy('magic',40,receipt());assert.equal(p.energy.magic,25);assert.equal(p.personalMana.reserveEU,35);
 p.equipManaFocus('gear_baseline_t5');assert.equal(p.energy.magic,60);assert.equal(p.personalMana.reserveEU,0);
 for(let i=0;i<5;i++){p.unequipManaFocus();p.equipManaFocus('gear_baseline_t5');}assert.equal(p.energy.magic,60);
 p.equipManaFocus('gear_baseline_t10');assert.equal(p.energyCapacity('magic'),365);assert.equal(p.energy.magic,60);
});
test('death-style inventory removal, save and recovery preserve the exact existing mana budget',()=>{
 const p=fixture();p.equipManaFocus('gear_baseline_t5');p.fillPersonalMana(.5,receipt());const dropped={...p.inventory};p.inventory={};
 const dead=p.serialize();assert.equal(p.energy.magic,0);assert.equal(p.personalMana.reserveEU,50);
 const q=new Progression(CONTENT,dead);assert.equal(q.energyAvailable('magic'),0);q.grant(dropped,receipt());assert.equal(q.energyAvailable('magic'),50);assert.equal(q.personalMana.reserveEU,0);
 q.consumeEnergy('magic',20,receipt());q.inventory={};const after=new Progression(CONTENT,q.serialize());after.grant(dropped,receipt());assert.equal(after.energyAvailable('magic'),30);
});
test('cup storage stays separate from avatar mana and cannot bypass its capacity',()=>{
 const p=fixture();p.useManaCup();p.fillManaCup(1,receipt());assert.equal(p.personalMana.cupEU,100);assert.equal(p.energyCapacity('magic'),0);assert.equal(p.energyAvailable('magic'),0);assert.equal(p.absorbManaCup(10,receipt()).ok,false);
 p.investMana('mana_steel',1,receipt());const claim=receipt();assert.equal(p.absorbManaCup(50,claim).ok,true);assert.equal(p.absorbManaCup(50,claim).duplicate,true);assert.equal(p.personalMana.cupEU,50);assert.equal(p.energy.magic,50);
 assert.equal(p.absorbManaCup(20,receipt()).ok,false);assert.equal(p.personalMana.cupEU,50);
});
test('investment and focus maxima are bounded and a full capacity investment never charges materials twice',()=>{
 const p=fixture();p.investMana('world_heartwood',2,receipt());assert.equal(p.personalMana.investedCapacity,700);const material=p.count('world_heartwood');assert.equal(p.investMana('world_heartwood',1,receipt()).reason,'mana_capacity_cap');assert.equal(p.count('world_heartwood'),material);
 p.equipManaFocus('gear_baseline_t10');assert.equal(p.energyCapacity('magic'),1000);assert.equal(p.energy.magic,0);
 const state=p.serialize();state.personalMana.investedCapacity=701;assert.throws(()=>new Progression(CONTENT,state));
});
