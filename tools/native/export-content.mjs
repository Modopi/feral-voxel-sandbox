// Build-time conversion only. The native executable never evaluates JavaScript.
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {CONTENT} from '../../app/src/main/assets/content-runtime/catalog.generated.js';
import {ASSETS, loadAsset} from '../../app/src/main/assets/content-runtime/assets.generated.js';
import {PRESETS, RULES, DEFAULTS} from '../../app/src/main/assets/world-slots.js';
import * as signal from '../../app/src/main/assets/content-runtime/signal-assets.js';
import * as campaign from '../../app/src/main/assets/frontier/campaign.js';
import * as frontier from '../../app/src/main/assets/frontier/content.js';
import {FRONTIER_ITEMS, RECORD_WORK} from '../../app/src/main/assets/content-runtime/maps.js';
import {START_SUPPLIES} from '../../app/src/main/assets/content-runtime/first-signal.js';
import {buildResourceAsset} from '../../app/src/main/assets/content-runtime/props.js';
const {BIOMES}=campaign,{GATHERABLES}=frontier;

const output = new URL('../../native/data/', import.meta.url);
await mkdir(output, {recursive: true});
const assets = Object.fromEntries(await Promise.all(Object.keys(ASSETS).sort().map(async id => [id, await loadAsset(id)])));
const put = model => { assets[model.id] = model; };
for (const on of [false,true]) { put(signal.relayAsset(on)); put(signal.ruinCoreAsset(on)); put(signal.surveyMarkerAsset(on)); }
for (let i=0;i<BIOMES.length;i++) { put(signal.guardianAsset(i)); put(signal.lampAsset(i,true)); put(signal.lampAsset(i,false)); }
for (let i=0;i<3;i++) { put(signal.villageSignAsset(i)); for(let j=0;j<3;j++) put(signal.villagerAsset(i,j)); put(signal.cropAsset(i)); }
for (const id of Object.keys(signal.FACILITY_OFFSETS)) put(signal.facilityAsset(id));
for (const kind of Object.keys(GATHERABLES)) put(signal.resourceAsset(kind));
for (const fn of ['campCrateAsset','mastAsset','beamAsset']) put(signal[fn]());
for (const row of CONTENT.progression.entries) if(row.kind==='source'&&row.id!=='source_soil') put(buildResourceAsset(row.id));
const staticTables = values => Object.fromEntries(Object.entries(values).filter(([,v])=>typeof v!=='function'));
const modules={campaign:staticTables(campaign),frontier:staticTables(frontier),firstSignal:{FRONTIER_ITEMS,RECORD_WORK,START_SUPPLIES,FACILITY_OFFSETS:signal.FACILITY_OFFSETS}};
const files = {'content.json': CONTENT, 'assets.json': assets, 'presets.json': {presets: PRESETS, rules: RULES, defaults: DEFAULTS},'modules.json':modules};
for (const [name, value] of Object.entries(files)) {
  const text = JSON.stringify(value) + '\n';
  const target = new URL(name, output);
  if (process.argv.includes('--check')) {
    if (await readFile(target, 'utf8') !== text) throw Error(`Stale native content: ${fileURLToPath(target)}`);
  } else await writeFile(target, text);
  console.log(`${name}: ${Buffer.byteLength(text)} bytes`);
}
console.log(`${Object.keys(assets).length} complete authored models; ${Object.values(CONTENT).reduce((n,c) => n + (c.entries?.length ?? 0), 0)} catalog entries`);
const icons=new URL('../../native/icons/',import.meta.url);await mkdir(icons,{recursive:true});
for(const [id,asset] of Object.entries(ASSETS)){
  const source=await readFile(new URL(`../../design/assets/${asset.preview}`,import.meta.url));const target=new URL(`${id}.png`,icons);
  if(process.argv.includes('--check')){if(!source.equals(await readFile(target)))throw Error(`Stale native icon: ${id}`);}else await writeFile(target,source);
}
