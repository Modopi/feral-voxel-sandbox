// The shared 36-slot bag (9 hotbar + 27 storage) over the count-based expedition inventory.
// Progression stays the only owner of item amounts; this keeps only the player's arrangement.
import {designItemArt} from '../item-art.js';
import {reasonText} from './reasons.js';
export const STACK = 64, SLOT_COUNT = 36;
const EPS = 1e-8;
const round = n => Number.isInteger(n) ? n : Number(n.toFixed(2));
export class ItemSlots {
 constructor(progression,state={}){
  this.p=progression;
  this.order=Array.from({length:SLOT_COUNT},(_,i)=>typeof state.order?.[i]==='string'?state.order[i]:null);
  this.selectedSlot=Number.isInteger(state.selected)&&state.selected>=0&&state.selected<9?state.selected:0;
  this.revision=0;
 }
 /** Every stack of an item keeps a slot the player chose; new stacks take the first free slot. */
 layout(){
  const need=new Map();
  for(const[id,n]of Object.entries(this.p.inventory))if(n>EPS)need.set(id,Math.ceil((n-EPS)/STACK));
  const order=this.order,used=new Map();
  for(let i=0;i<SLOT_COUNT;i++){const id=order[i];if(!id)continue;const u=used.get(id)??0;if(u<(need.get(id)??0))used.set(id,u+1);else order[i]=null;}
  for(const[id,k]of need)for(let u=used.get(id)??0;u<k;u++){const free=order.indexOf(null);if(free<0)break;order[free]=id;}
  return order;
 }
 get slots(){
  const seen=new Map();
  return this.layout().map(id=>{if(!id)return null;const i=seen.get(id)??0;seen.set(id,i+1);return {id,count:round(Math.min(STACK,this.p.count(id)-i*STACK))};});
 }
 /** Amounts are pooled per item, so a move swaps slot assignments; splitting is not needed. */
 move(from,to){
  const order=this.layout();if(from===to||from<0||to<0||from>=SLOT_COUNT||to>=SLOT_COUNT)return false;
  [order[from],order[to]]=[order[to],order[from]];this.revision++;return true;
 }
 select(n){if(Number.isInteger(n)&&n>=0&&n<9){this.selectedSlot=n;this.revision++;}}
 get held(){return this.layout()[this.selectedSlot]??null;}
 count(id){return this.p.count(id);}
 get overflow(){return Object.entries(this.p.overflow).map(([id,count])=>({id,count}));}
 reclaim(){const result=this.p.reclaim();this.revision++;return result;}
 serialize(){return {order:[...this.layout()],selected:this.selectedSlot};}
}
// Names, art, wear, uses and recipes of design catalog items for the shared bag UI.
export function designCatalog(runtime,{name,actions=()=>[],queue=()=>{}}={}){
 const p=()=>runtime.progression,entry=id=>p().catalog.get(id);
 const originText=id=>{
  const o=entry(id)?.origin;if(!o)return [];
  if(o.type==='wild_resource')return [`채집: ${name(o.source)}`];
  if(o.type==='craft'||o.type==='parameterized_craft'){const r=entry(o.recipe);return [`제작: ${name(o.recipe)}${r?.station?` · ${name(r.station)}`:''}`,...(o.creatureDropOptional?['생명체 전리품']:[])];}
  if(o.type==='self_research')return ['자체 연구 기록'];
  if(o.type==='community_contribution')return ['공동체 기여 보상'];
  return ['탐험 보상'];
 };
 return {
  name,
  art:id=>designItemArt(entry(id)),
  durability:id=>{const max=entry(id)?.durabilityActions;return max?{value:p().toolWear[id]??max,max}:null;},
  attackMode:()=>null,
  sources:id=>originText(id).length?originText(id):['얻는 곳 정보 없음'],
  repair:()=>null,
  actions,
  queue,
  armored:()=>(p().evaluateLoadout().damageReduction??0)>0,
  recipes:()=>p().list('recipe').map(r=>{
   const output=Object.keys(r.outputs)[0]??r.id,status=p().recipeStatus(r.id),kind=entry(output)?.kind;
   return {id:r.id,name:r.name,output,amount:r.outputs[output]??1,names:[r.name,name(output)],cost:Object.entries(r.inputs),
    gear:['tool','gear_baseline','component','station'].includes(kind),craftable:status.ok,
    description:`${name(r.station)} · ${r.seconds}초${r.research?` · 연구: ${name(r.research)}`:''}`,blocked:reasonText(status.reason)};
  }),
 };
}
