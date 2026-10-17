import * as THREE from '../../app/src/main/assets/vendor/three.module.js';
import { surfaceGroups } from '../../tools/asset-pipeline/solid.mjs';
import { flattenAsset, boundsOf } from '../../tools/asset-pipeline/model.mjs';
import { VoxelAssetBuilder } from '../../tools/asset-pipeline/authoring.mjs';

const $=id=>document.getElementById(id),clone=value=>structuredClone(value);
const library=new Map(),drafts=new Map(),manifestEntries=new Map();
let current=null,builder=null,history=[],historyIndex=-1,revision=0,savedRevision=0,loadSequence=0;
let selectedPart='',hideRoofs=false,yaw=.74,pitch=.45,zoom=1,span=2;
let bounds={min:[-1,0,-1],max:[1,2,1],size:[2,2,2],center:[0,1,0]},target=new THREE.Vector3(0,1,0);
let guides=null,drag=null,pending=false,disposed=false;
const viewport=$('viewport'),canvas=$('scene');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
const scene=new THREE.Scene();scene.background=new THREE.Color('#e4e5d9');
const modelGroup=new THREE.Group();scene.add(modelGroup);scene.add(new THREE.HemisphereLight('#eff8ff','#73775c',2.2));
const light=new THREE.DirectionalLight('#fff1d7',3.8);scene.add(light);scene.add(light.target);
const fill=new THREE.DirectionalLight('#b9d0e6',.9);scene.add(fill);
const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,2000),raycaster=new THREE.Raycaster();
const ground=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshStandardMaterial({color:'#d9ddce',roughness:1}));ground.rotation.x=-Math.PI/2;scene.add(ground);

function status(message,tone='ok'){$('status').textContent=message;$('status').dataset.tone=tone;}
function errorMessage(error){return error instanceof Error?error.message:String(error);}
function option(value,label){const node=document.createElement('option');node.value=value;node.textContent=label;return node;}
function valueVector(ids){return ids.map(id=>{const text=$(id).value.trim(),v=Number(text);if(!text||!Number.isFinite(v))throw Error('위치와 크기에 유한한 숫자를 입력하세요.');return v;});}
function boxInput(){const center=valueVector(['cx','cy','cz']),size=valueVector(['sx','sy','sz']);if(size.some(v=>v<=0))throw Error('크기는 모든 축에서 0보다 커야 합니다.');return {center,size,material:$('material').value};}
function partOffset(id){let result=[0,0,0],seen=new Set();while(id!==null){if(seen.has(id))throw Error('부모 부위가 순환합니다.');seen.add(id);const p=current.parts.find(p=>p.id===id);if(!p)throw Error('선택한 부위가 없습니다.');result=result.map((v,i)=>v+p.translation[i]);id=p.parent;}return result;}
function clearGroup(group){for(const child of [...group.children]){child.geometry?.dispose();if(Array.isArray(child.material))child.material.forEach(m=>m.dispose());else child.material?.dispose();group.remove(child);}}
function draw(){if(!disposed)renderer.render(scene,camera);}
function updateCamera(){
  const w=Math.max(1,viewport.clientWidth),h=Math.max(1,viewport.clientHeight),aspect=w/h;
  renderer.setSize(w,h,false);camera.position.copy(target).add(new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(span*3));camera.lookAt(target);camera.updateMatrixWorld();
  const corners=[];for(const x of [bounds.min[0],bounds.max[0]])for(const y of [bounds.min[1],bounds.max[1]])for(const z of [bounds.min[2],bounds.max[2]])corners.push(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
  const ww=Math.max(...corners.map(p=>p.x))-Math.min(...corners.map(p=>p.x)),hh=Math.max(...corners.map(p=>p.y))-Math.min(...corners.map(p=>p.y));
  const half=Math.max(.1,Math.max(hh,ww/aspect)*.63)/zoom;camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;camera.near=Math.max(.001,span*.001);camera.far=Math.max(20,span*12);camera.updateProjectionMatrix();draw();
}
function updateGuide(){
  if(guides){scene.remove(guides);guides.geometry.dispose();guides.material.dispose();guides=null;}
  if(!current||!$('show-guide').checked)return draw();
  try{const b=boxInput(),offset=partOffset(selectedPart),sourceGeometry=new THREE.BoxGeometry(...b.size),edges=new THREE.EdgesGeometry(sourceGeometry);sourceGeometry.dispose();guides=new THREE.LineSegments(edges,new THREE.LineBasicMaterial({color:$('mode').value==='replace'?'#BC633A':'#426A86',depthTest:false,transparent:true,opacity:.85}));guides.position.set(...b.center.map((v,i)=>v+offset[i]));guides.renderOrder=10;scene.add(guides);}catch{/* Invalid form values are explained when applying. */}draw();
}
function rebuild({fit=false}={}){
  if(!current)return;library.set(current.id,current);clearGroup(modelGroup);
  const boxes=flattenAsset(current,library,{hideRoofs});
  const buckets=new Map();for(const b of boxes){const key=b.ownerId+':'+b.partId;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(b);}
  for(const bs of buckets.values()){
    const source=library.get(bs[0].assetId);
    for(const [mid,surface]of surfaceGroups(bs,source.materials)){
      if(!surface.positions.length)continue;const m=source.materials.find(m=>m.id===mid);
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(surface.positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(surface.normals,3));geometry.setIndex(surface.indices);
      const material=new THREE.MeshStandardMaterial({color:m.color,roughness:m.roughness,metalness:m.metallic,emissive:m.color,emissiveIntensity:m.emission,opacity:m.opacity,transparent:m.opacity<1,depthWrite:m.opacity>=1});
      const mesh=new THREE.Mesh(geometry,material);mesh.userData={partId:bs[0].partId,editable:bs[0].ownerId===current.id};modelGroup.add(mesh);
    }
  }
  if(fit){bounds=boxes.length?boundsOf(boxes):{min:[-1,0,-1],max:[1,2,1],size:[2,2,2],center:[0,1,0]};span=Math.max(.5,...bounds.size);target.set(...bounds.center);}
  ground.scale.set(span*8,span*8,1);ground.position.set(target.x,bounds.min[1]-.03*span,target.z);light.position.copy(target).add(new THREE.Vector3(-span,span*2,span));light.target.position.copy(target);fill.position.copy(target).add(new THREE.Vector3(span,span*.5,-span));
  $('stats').textContent=`${current.parts.length}개 부위 · 자체 박스 ${current.parts.reduce((n,p)=>n+p.boxes.length,0).toLocaleString()}개 · 참조 ${current.instances.length}개`;
  window.authorStats={id:current.id,parts:current.parts.length,ownBoxes:current.parts.reduce((n,p)=>n+p.boxes.length,0),historyIndex,revision};
  updateCamera();updateGuide();
}
function updateHistoryButtons(){$('undo').disabled=historyIndex<=0;$('redo').disabled=historyIndex>=history.length-1;}
function syncControls({initial=false}={}){
  const previousParent=$('parent').value,previousMaterial=$('material').value;
  $('part').replaceChildren(...current.parts.map(p=>option(p.id,`${p.id} · ${p.role}`)));
  selectedPart=current.parts.some(p=>p.id===selectedPart)?selectedPart:current.parts.find(p=>p.parent===null).id;$('part').value=selectedPart;
  $('parent').replaceChildren(...current.parts.map(p=>option(p.id,p.id)));$('parent').value=current.parts.some(p=>p.id===previousParent)?previousParent:selectedPart;
  $('material').replaceChildren(...current.materials.map(m=>option(m.id,`${m.id}${m.blockId?' · '+m.blockId:''}`)));if(current.materials.some(m=>m.id===previousMaterial))$('material').value=previousMaterial;
  const g=current.visualGridM;
  for(const id of ['cx','cy','cz'])$(id).step=String(g/2);
  for(const id of ['sx','sy','sz']){$(id).step=String(g);$(id).min=String(g);}
  for(const id of ['px','py','pz'])$(id).step=String(g);
  if(initial){for(const id of ['cx','cy','cz'])$(id).value=String(g/2);for(const id of ['sx','sy','sz'])$(id).value=String(g);$('mode').value='reject';$('mode').dispatchEvent(new Event('change'));}
  $('grid-info').textContent=`제작 격자 ${g}m. 박스의 양 끝이 격자에 맞아야 하며 자동 반올림하지 않습니다.`;
  $('selection-label').textContent=`선택: ${selectedPart} · 부위 클릭으로 변경`;
  $('asset-name').textContent=current.name;$('download-filename').textContent=current.id+'.voxel.json';
  $('instances').replaceChildren(...(current.instances.length?current.instances.map(i=>{const li=document.createElement('li');li.textContent=`${i.id} → ${i.assetId} · 읽기 전용`;return li;}):[Object.assign(document.createElement('li'),{textContent:'참조 인스턴스 없음'})]));
  $('editing').disabled=false;$('download').disabled=false;updateHistoryButtons();
}
function saveDraft(){if(current)drafts.set(current.id,{history:history.map(clone),historyIndex,selectedPart,revision,savedRevision});}
async function fetchAsset(id,trail=[]){
  if(trail.includes(id))throw Error('에셋 참조가 순환합니다.');
  if(library.has(id))return library.get(id);
  if(!/^[a-zA-Z0-9_-]+$/.test(id))throw Error('지원하지 않는 에셋 ID입니다.');
  const response=await fetch(`models/${encodeURIComponent(id)}.voxel.json`);if(!response.ok)throw Error(`참조 에셋을 열지 못했습니다: ${id}`);
  const data=await response.json();library.set(id,data);
  try{for(const i of data.instances)await fetchAsset(i.assetId,[...trail,id]);}catch(e){library.delete(id);throw e;}return data;
}
function validateDocument(data){
  if(!data||data.schemaVersion!==1||data.status!=='art_prototype'||data.units!=='m'||data.upAxis!=='Y'||data.forwardAxis!=='+Z')throw Error('FERAL 복셀 에셋 v1 JSON을 선택하세요.');
  if(typeof data.id!=='string'||!/^[A-Za-z0-9_-]+$/.test(data.id)||typeof data.name!=='string'||!data.name.trim()||!['creature','boss','structure','environment','equipment'].includes(data.category)||!Number.isFinite(data.visualGridM)||data.visualGridM<=0)throw Error('에셋 이름·ID·분류·격자 정보가 올바르지 않습니다.');
  for(const key of ['materials','parts','anchors','instances','notes'])if(!Array.isArray(data[key]))throw Error(`필수 목록이 없습니다: ${key}`);
  if(!data.contentRef||data.contentRef.id!==data.id||typeof data.contentRef.file!=='string')throw Error('콘텐츠 원본 참조가 올바르지 않습니다.');
  const ids=new Set();for(const m of data.materials){if(typeof m.id!=='string'||!m.id||ids.has(m.id)||!/^#[0-9a-fA-F]{6}$/.test(m.color))throw Error('재질 ID 또는 색상이 올바르지 않습니다.');ids.add(m.id);for(const key of ['roughness','metallic','opacity'])if(!Number.isFinite(m[key])||m[key]<0||m[key]>1)throw Error('재질 수치 범위가 올바르지 않습니다.');if(!Number.isFinite(m.emission)||m.emission<0||m.emission>5)throw Error('발광 표현 수치 범위가 올바르지 않습니다.');}
  if(!ids.size)throw Error('편집할 재질이 하나 이상 필요합니다.');
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite),parts=new Set(data.parts.map(p=>p.id)),anchors=new Set(),instances=new Set();
  for(const a of data.anchors){if(typeof a.id!=='string'||anchors.has(a.id)||!parts.has(a.partId)||!vector(a.position))throw Error('앵커 참조 또는 위치가 올바르지 않습니다.');anchors.add(a.id);}
  for(const i of data.instances){if(typeof i.id!=='string'||instances.has(i.id)||typeof i.assetId!=='string'||!vector(i.translation))throw Error('인스턴스 참조 또는 위치가 올바르지 않습니다.');instances.add(i.id);}
}
async function openAsset(data,{restore=false,token=++loadSequence}={}){
  validateDocument(data);
  const candidate=new VoxelAssetBuilder(data),canonical=candidate.toJSON();
  for(const i of canonical.instances)await fetchAsset(i.assetId,[canonical.id]);
  // Fail on missing/cyclic instances before replacing the editable document.
  const checkLibrary=new Map(library);checkLibrary.set(canonical.id,canonical);flattenAsset(canonical,checkLibrary);
  if(token!==loadSequence)return false;
  saveDraft();const prior=restore?drafts.get(canonical.id):null;
  if(prior){history=prior.history.map(clone);historyIndex=prior.historyIndex;builder=new VoxelAssetBuilder(history[historyIndex]);current=builder.toJSON();selectedPart=prior.selectedPart;revision=prior.revision;savedRevision=prior.savedRevision||0;}
  else{builder=candidate;current=canonical;history=[clone(current)];historyIndex=0;selectedPart=current.parts.find(p=>p.parent===null).id;revision=0;savedRevision=0;}
  const opt=[...$('asset').options].find(o=>o.value===current.id);if(!opt)$('asset').add(option(current.id,`${current.name} · 로컬 파일`));$('asset').value=current.id;
  hideRoofs=false;$('roof').textContent='지붕 숨기기';pitch=['structure','environment'].includes(current.category)?.78:.4;zoom=1;
  syncControls({initial:true});rebuild({fit:true});status(`${current.name}을 열었습니다. 기본 모드는 겹침 거부입니다. 드래그로 회전하고 부위를 클릭해 선택하세요.`);window.authorReady=true;return true;
}
function commit(operation,message){
  if(!current||pending)return;
  try{
    const candidate=new VoxelAssetBuilder(current);operation(candidate);const next=candidate.toJSON();
    if(JSON.stringify(next)===JSON.stringify(current)){status('변경된 복셀이 없습니다. 선택한 부위와 범위를 확인하세요.');return;}
    // Build canonical geometry before modifying undo history.
    const temp=new Map(library);temp.set(next.id,next);flattenAsset(next,temp);
    builder=candidate;current=next;history=history.slice(0,historyIndex+1);history.push(clone(current));if(history.length>31)history.shift();historyIndex=history.length-1;revision++;
    syncControls();rebuild();status(message);
  }catch(error){status(`변경하지 않았습니다. ${errorMessage(error)}`,'error');}
}
function restoreHistory(index){if(index<0||index>=history.length)return;try{const next=new VoxelAssetBuilder(history[index]);builder=next;current=next.toJSON();historyIndex=index;revision++;syncControls();rebuild();status(index===0?'처음 열었던 상태로 돌아왔습니다.':'편집 기록을 적용했습니다.');}catch(e){status(errorMessage(e),'error');}}
$('add').onclick=()=>{try{const b=boxInput();commit(bld=>bld.addBox(selectedPart,b,{mode:$('mode').value}),'선택한 부위에 복셀을 배치했습니다.');}catch(e){status(errorMessage(e),'error');}};
$('remove').onclick=()=>{try{const {center,size}=boxInput();commit(bld=>bld.removeBox(selectedPart,{center,size}),'선택한 부위에서 지정한 범위를 삭제했습니다.');}catch(e){status(errorMessage(e),'error');}};
$('part-new').onclick=()=>{const id=$('part-id').value.trim();if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)){status('부위 ID는 영문자로 시작하고 영문·숫자·밑줄·하이픈만 사용하세요.','error');return;}try{const p={id,parent:$('parent').value,translation:valueVector(['px','py','pz']),role:$('role').value};commit(bld=>bld.addPart(p),`새 부위 ${id}를 만들었습니다.`);if(current.parts.some(p=>p.id===id)){selectedPart=id;$('part').value=id;$('part').dispatchEvent(new Event('change'));$('part-id').value='';}}catch(e){status(errorMessage(e),'error');}};
$('undo').onclick=()=>restoreHistory(historyIndex-1);$('redo').onclick=()=>restoreHistory(historyIndex+1);
$('part').onchange=()=>{selectedPart=$('part').value;$('selection-label').textContent=`선택: ${selectedPart} · 부위 클릭으로 변경`;updateGuide();};
$('mode').onchange=()=>{$('mode-note').textContent={reject:'기존 복셀과 겹치면 배치하지 않습니다.',replace:'선택한 부위의 기존 복셀을 지정 범위에서 잘라내고 새 재질로 교체합니다.',fill:'선택한 부위의 기존 복셀은 남기고 빈 공간만 채웁니다.'}[$('mode').value];updateGuide();};
for(const id of ['cx','cy','cz','sx','sy','sz','material','show-guide'])$(id).addEventListener('input',updateGuide);
$('roof').onclick=()=>{hideRoofs=!hideRoofs;$('roof').textContent=hideRoofs?'지붕 보이기':'지붕 숨기기';rebuild();};
$('reset').onclick=()=>{yaw=.74;pitch=current&&['structure','environment'].includes(current.category)?.78:.4;zoom=1;rebuild({fit:true});};
$('download').onclick=()=>{if(!current)return;try{const canonical=new VoxelAssetBuilder(current).toJSON(),blob=new Blob([JSON.stringify(canonical,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=canonical.id+'.voxel.json';link.click();savedRevision=revision;setTimeout(()=>URL.revokeObjectURL(url),1000);status('JSON을 다운로드했습니다. 편집본을 유지하려면 안내된 authored 폴더에 저장하세요.');}catch(e){status(`다운로드하지 못했습니다. ${errorMessage(e)}`,'error');}};
$('open-file').onclick=()=>$('file').click();
$('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;const token=++loadSequence;pending=true;$('editing').disabled=true;try{if(file.size>64*1024*1024)throw Error('64MB 이하 JSON 파일을 선택하세요.');const data=JSON.parse(await file.text());await openAsset(data,{token});}catch(e){if(token===loadSequence)status(`파일을 열지 못했습니다. ${errorMessage(e)}`,'error');}finally{$('file').value='';if(token===loadSequence){pending=false;$('editing').disabled=!current;}}};
$('asset').onchange=async()=>{const token=++loadSequence,id=$('asset').value;pending=true;$('editing').disabled=true;status('에셋을 불러오는 중입니다.');try{const a=await fetchAsset(id);if(token!==loadSequence)return;await openAsset(a,{restore:true,token});}catch(e){status(errorMessage(e),'error');if(current){$('asset').value=current.id;$('editing').disabled=false;}}finally{if(token===loadSequence)pending=false;}};
canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw-=(e.clientX-drag.x)*.008;pitch=Math.max(-.15,Math.min(1.5,pitch+(e.clientY-drag.y)*.006));drag.x=e.clientX;drag.y=e.clientY;updateCamera();});
canvas.addEventListener('pointerup',e=>{if(!drag)return;const click=Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<5;drag=null;if(!click||!current)return;const r=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hit=raycaster.intersectObjects(modelGroup.children)[0];if(!hit)return;if(!hit.object.userData.editable){status('참조 인스턴스는 읽기 전용입니다. 해당 원본 에셋을 목록에서 열어 편집하세요.');return;}selectedPart=hit.object.userData.partId;$('part').value=selectedPart;$('part').dispatchEvent(new Event('change'));});
canvas.addEventListener('pointercancel',()=>drag=null);canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.15,Math.min(12,zoom*Math.exp(-e.deltaY*.001)));updateCamera();},{passive:false});
new ResizeObserver(updateCamera).observe(viewport);
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();restoreHistory(historyIndex+(e.shiftKey?1:-1));}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();restoreHistory(historyIndex+1);}});
window.addEventListener('beforeunload',e=>{if(revision>savedRevision||[...drafts.entries()].some(([id,d])=>id!==current?.id&&d.revision>(d.savedRevision||0))){e.preventDefault();e.returnValue='';}});
try{
  const response=await fetch('manifest.json');if(!response.ok)throw Error('에셋 목록을 불러오지 못했습니다. HTTP 서버로 이 페이지를 열어 주세요.');const data=await response.json();
  const labels={creature:'생명체',boss:'보스',structure:'건축물',environment:'환경',equipment:'도구·설비·장비'};
  for(const e of data.entries){manifestEntries.set(e.id,e);$('asset').add(option(e.id,`${labels[e.category]} · ${e.name}`));}
  $('asset').disabled=false;const q=new URLSearchParams(location.search).get('asset'),id=manifestEntries.has(q)?q:data.entries[0].id;await openAsset(await fetchAsset(id));
}catch(e){status(`제작 도구를 준비하지 못했습니다. ${errorMessage(e)}`,'error');}
