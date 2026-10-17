import {initializeAuthoring,placeBox} from '../../../tools/asset-pipeline/authoring.mjs';
export function asset(e,category,grid=0.03125){const file={creature:'creatures',boss:'bosses',structure:'structures',environment:'environments'}[category];return initializeAuthoring({schemaVersion:1,id:e.id,name:e.name,category,contentRef:{file:`design/content/${file}.json`,id:e.id},status:'art_prototype',units:'m',upAxis:'Y',forwardAxis:'+Z',visualGridM:grid,materials:[],parts:[{id:'root',parent:null,translation:[0,0,0],role:'root',boxes:[]}],anchors:[],instances:[],notes:[]});}
export function mat(a,id,color,extra={}){if(!a.materials.some(m=>m.id===id))a.materials.push({id,color,roughness:.88,metallic:0,emission:0,opacity:1,collision:!['water','acid_water','visual_water'].includes(id),...extra});return id;}
export function part(a,id,translation=[0,0,0],parent='root',role='visual'){const p={id,parent,translation:translation.map(v=>Math.round(v/a.visualGridM)*a.visualGridM),role,boxes:[]};a.parts.push(p);return p;}
function put(a,partId,center,size,material,mode){const g=a.visualGridM;const low=center.map((v,i)=>Math.round((v-size[i]/2)/g)*g);const s=size.map(v=>Math.max(g,Math.round(v/g)*g));const b={center:low.map((v,i)=>v+s[i]/2),size:s,material};return placeBox(a,partId,b,{mode});}
export function anchor(a,id,partId,position,purpose){a.anchors.push({id,partId,position,purpose});}
export function rng(seed){let s=2166136261;for(const c of String(seed))s=Math.imul(s^c.charCodeAt(0),16777619);return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}

export function box(a,partId,center,size,material){return put(a,partId,center,size,material,'reject');}
export function paint(a,partId,center,size,material){return put(a,partId,center,size,material,'replace');}
export function fill(a,partId,center,size,material){return put(a,partId,center,size,material,'fill');}
