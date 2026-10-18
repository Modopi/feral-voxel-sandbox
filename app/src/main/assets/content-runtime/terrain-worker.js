// Terrain generation off the main thread (docs/ARCHITECTURE.md §7). The worker keeps a copy of the world's atlas
// (same generator, seed, generator options and reservations, no edits) and builds the base cells of the chunks
// the main atlas asks for. The main atlas replays its own edits when a chunk arrives (WorldAtlas._finishChunk),
// so a chunk is the same as one built on the main thread.
import {CONTENT} from './catalog.generated.js';
import {GENERATORS} from './maps.js';

/** A copy of the atlas made by the generator whose saves carry `generatorId`. */
export function createTerrainGenerator({generatorId,seed,options={},reservations=[]}){
  const entry=Object.values(GENERATORS).find(g=>g.atlas.prototype.generatorId===generatorId);
  if(!entry)throw Error(`알 수 없는 지형 생성기입니다: ${generatorId}`);
  const atlas=new entry.atlas(CONTENT,{...options,seed,maxActiveChunks:1});
  atlas.setReservations(reservations);return atlas;
}
/** The base cells of one chunk, as the main atlas's _newChunkJob/_advanceChunk would build them without edits. */
export function generateChunk(atlas,{key,cx,cy,cz,generation}){
  const job=atlas._newChunkJob(cx,cy,cz);atlas._advanceChunk(job,32768);
  return {type:'chunk',key,cx,cy,cz,generation,blocks:job.blocks};
}
/** Message handler of the worker: init (atlas copy), reserve (reservations changed), chunk (one chunk back,
 * its buffer transferred). `post(message, transfer)` sends a reply. */
export function terrainWorker(post){
  let atlas=null;
  return msg=>{
    try{
      if(msg?.type==='init'){atlas=createTerrainGenerator(msg);post({type:'ready'});}
      else if(msg?.type==='reserve')atlas.setReservations(msg.reservations);
      else if(msg?.type==='chunk'){const reply=generateChunk(atlas,msg);post(reply,[reply.blocks.buffer]);}
    }catch(error){post({type:'error',error:error?.message??String(error)});}
  };
}

// Importable by Node tests without installing a global worker handler there.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const handle=terrainWorker((message,transfer)=>self.postMessage(message,transfer??[]));
  self.onmessage=event=>handle(event.data);
}
