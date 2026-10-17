# FERAL 재사용 복셀 에셋 계약 v1

새 시각 에셋은 기존 콘텐츠 ID를 그대로 사용한다. 수치/행동 설계는 `design/content/`, 시각 원본은 이 폴더의 `models/`, 편집 가능한 절차적 원본은 `generators/`가 담당한다. 시각 원본은 게임에 아직 통합하지 않은 art prototype이다.

## 공통 형태

JSON: `{schemaVersion:1,id,name,category,contentRef,status:"art_prototype",units:"m",upAxis:"Y",forwardAxis:"+Z",visualGridM,materials,parts,anchors,instances,notes}`.
- category: creature | boss | structure | environment.
- contentRef: `{file:"design/content/creatures.json",id:"moss_deer"}`처럼 저장소 기준 기존 데이터 참조.
- materials: `{id,color:"#RRGGBB",roughness:0..1,metallic:0..1,emission:0..5,opacity:0..1,blockId?:string}[]`. color는 sRGB, emission은 시각 표현 계수로 에너지량이 아님. blockId는 blocks.json 실제 ID만.
- parts: `{id,parent:null|partId,translation:[x,y,z],role:string,boxes:[{center:[x,y,z],size:[x,y,z],material:materialId}]}[]`. translation은 부모 기준 m, box는 자기 part 기준 m. 회전/스케일 없는 정축 입방체 집합, size 각 축 >0. 부분 메시의 부모관계 및 피벗을 보존한다. part pivot 이동은 animation 준비이며 애니메이션은 별도 구현.
- 모든 box의 경계와 part translation은 visualGridM 정수배. grid는 시각 모델 해상도이며 물리/충돌/HP 그리드와 독립. 0.03125m 생물/보스, 0.5m 건축, 환경은 0.5m 기본. 생성기는 직접 모델 크기를 정하고 재현 가능한 고정 seed만 사용.
- anchors: `{id,partId,position:[x,y,z],purpose:string}[]`. attachment/weak point/movement locator는 의미 힌트이며 충돌체/기능 구현이 아님.
- instances: `{id,assetId,translation:[x,y,z]}[]` (환경에서 건축/생물 원본을 재사용, 스케일1/회전0). assetId는 실제 models 파일 ID. 순환참조 금지.
- notes: string[]. 치수 근사/아직 구현하지 않은 기능/범위 설명.
- root는 y=0 지면에 서며 X폭/Y높이/Z길이. 건축물은 데이터 방 좌표 그대로 유지.

## 생성 모듈 계약

각 담당 generators/creatures.mjs, bosses.mjs, structures.mjs, environments.mjs. 모듈은 `export function generate(content) { return [asset,...]; }`. content는 `{creatures,bosses,structures,environments,blocks}`이며 각 값은 JSON 루트. 외부 의존성/파일 쓰기 없이 반환. 공유 도우미는 `./shared.mjs`에서 import 가능:
- `asset(entry,category,grid)` 기본 헤더/root/배열 생성.
- `mat(a,id,color,extra={})` 재질 추가 후 id 반환.
- `part(a,id,translation=[0,0,0],parent="root",role="visual")` part 추가후 part 반환.
- `box(a,partId,center,size,material)` 격자 정렬 후 중복 점유를 즉시 거부하며 추가.
- `paint(a,partId,center,size,material)` 명시적 교체; 겹치는 기존 영역을 같은 작업에서 제거.
- `fill(a,partId,center,size,material)` 기존 복셀을 유지하고 빈 공간만 채움.
- `anchor(a,id,partId,position,purpose)` 추가.
- `rng(seed)` [0,1) 결정적 함수 반환.

도형마다 식별 가능한 실루엣, 재질 대비, 실제 설계의 장기/환경 특징을 갖는다. 예고 효과와 장식으로 마법 기능/신성 생산을 암시하지 않는다. 원본 generator가 편집 기준이며 models JSON은 빌드된 교환 원본. glTF/GLB는 재질 및 부위 부모관계와 로컬 좌표를 보존하는 타 도구용 결과물. PNG는 검토용 렌더이고 게임 스크린샷이 아니다.


## 사용자 확정 충돌 규칙

[형상·소유권·충돌 공통 규칙](../../docs/VOXEL-ASSET-RULES.md)을 따른다. 빌드 결과에 `collision`과 `geometry` 계약을 기록하며, 재질마다 `collision`을 명시한다. 같은 부위 중복은 제작 시점부터 없어야 하고, 독립 관절 부위의 여유는 보존한다. 같은 owner 내부 충돌을 제외하고 다른 owner/외부 고체에는 충돌한다.
