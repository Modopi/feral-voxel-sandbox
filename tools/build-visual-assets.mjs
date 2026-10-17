import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateAsset} from './asset-pipeline/model.mjs';
import {assertAuthoringInvariant,assertCreatedByTool,VoxelAssetBuilder} from './asset-pipeline/authoring.mjs';
import {exportGlb} from './asset-pipeline/glb.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));const out=path.join(root,'design/assets');const names=['creatures','bosses','structures','environments','blocks','progression'];const content=Object.fromEntries(await Promise.all(names.map(async n=>[n,JSON.parse(await fs.readFile(path.join(root,`design/content/${n}.json`),'utf8'))])));
const assets=[];for(const n of ['creatures','bosses','structures','environments','equipment']){const module=await import(new URL(`../design/assets/generators/${n}.mjs`,import.meta.url));const generated=module.generate(content);for(const a of generated)assertCreatedByTool(a);assets.push(...generated);}
// Hand-authored sources are preserved and preferred over procedural generators.
for(let i=0;i<assets.length;i++){try{const manual=JSON.parse(await fs.readFile(path.join(out,'authored',assets[i].id+'.voxel.json'),'utf8'));if(manual.id!==assets[i].id)throw Error('Authored ID mismatch');assertAuthoringInvariant(manual);assets[i]=new VoxelAssetBuilder(manual).toJSON();}catch(e){if(e.code!=='ENOENT')throw e;}}
for(const a of assets)assertAuthoringInvariant(a);
const library=new Map(assets.map(a=>[a.id,a]));if(library.size!==assets.length)throw Error('Duplicate asset ID');
const counts={};const entries=[];for(const folder of ['models','exports','previews'])await fs.mkdir(path.join(out,folder),{recursive:true});
for(const a of assets){const stats=validateAsset(a,library,content);const source=JSON.stringify(a,null,2)+'\n';const glb=exportGlb(a,library);await fs.writeFile(path.join(out,`models/${a.id}.voxel.json`),source);await fs.writeFile(path.join(out,`exports/${a.id}.glb`),glb);counts[a.category]=(counts[a.category]??0)+1;entries.push({id:a.id,name:a.name,category:a.category,contentRef:a.contentRef,model:`models/${a.id}.voxel.json`,glb:`exports/${a.id}.glb`,preview:`previews/${a.id}.png`,sha256:createHash('sha256').update(source).digest('hex'),glbSha256:createHash('sha256').update(glb).digest('hex'),...stats});}
for(const [file,category]of [['creatures','creature'],['bosses','boss'],['structures','structure'],['environments','environment']])for(const entry of content[file].entries)if(!library.has(entry.id)||library.get(entry.id).category!==category)throw Error('Missing asset '+entry.id);
for(const entry of content.progression.entries.filter(e=>['tool','station','component','gear_baseline','weapon_pattern'].includes(e.kind)))if(!library.has(entry.id)||library.get(entry.id).category!=='equipment')throw Error('Missing equipment '+entry.id);
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({schemaVersion:1,status:'art_prototype',units:'m',sourceOfTruth:'authored/*.voxel.json (if present), otherwise generators/*.mjs + design/content/*.json',counts,entries},null,2)+'\n');console.log(JSON.stringify({ok:true,counts,boxes:entries.reduce((s,e)=>s+e.boxes,0),glbBytes:(await Promise.all(entries.map(e=>fs.stat(path.join(out,e.glb))))).reduce((s,e)=>s+e.size,0)},null,2));
