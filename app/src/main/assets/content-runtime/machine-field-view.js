// The machine field's view hooks (docs/ARCHITECTURE.md §6): the place name and goal on the shared HUD and its own
// card in the shared machine panel. Nothing here is a page or HUD of its own; content-runtime/game.js calls these.
export class MachineFieldView {
  constructor(field,host){this.field=field;this.host=host;}
  place(){return '기계 시험장';}
  objective(){return '예제 기계에 다가가 조종하고, 기둥·벽에 부딪혀 본 뒤 기계 창의 격자에서 수리하세요.';}
  /** The field card above the selected machine: the two examples and the return to the start pad. */
  machineCards(parent,machine){
    const card=document.createElement('article');card.className='machine-card';
    const title=document.createElement('b');title.textContent='시험장';
    const text=document.createElement('p');text.textContent='예제 기계는 출발 패드에 놓이고 앞의 예제를 대신합니다. 고철 더미에서 잡철을 캐 수리 재료로 씁니다.';
    card.append(title,text);
    const button=(label,run,disabled=false)=>{const b=document.createElement('button');b.textContent=label;b.disabled=disabled;b.onclick=()=>{const r=run();this.host.notify(r.ok?label:`할 수 없습니다 · ${r.reason}`);this.host.refresh();};card.append(b);};
    button('경량 예제 불러오기',()=>this.field.example(false));
    button('중량 예제 불러오기',()=>this.field.example(true));
    button('선택한 기계를 출발 패드로',()=>machine?this.field.recover(machine.id):{ok:false,reason:'machine_required'},!machine||this.host.runtime.drivingMachineId===machine.id);
    parent.append(card);
  }
}
