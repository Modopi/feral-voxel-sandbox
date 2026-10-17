# 장비·도구·설비 복셀 원본

`design/assets/generators/equipment.mjs`는 `progression.json`의 기존 제작 결과 53개를 재사용 가능한 시각 원본으로 만든다. 도구 3개, 설비 27개, 기능 컴포넌트 13개, 장구 기준 세트 10개다. 모든 원본의 콘텐츠 ID와 제작법을 그대로 참조하며, 외형이 새로운 기능·생명 엔티티·전용 입수 조건을 추가하지 않는다. 게임 기능의 기준은 제작/연구 데이터와 각 런타임 시스템이다.

## 개념과 분류

| 분류 | 형태 기준 | 구성 관계 |
| --- | --- | --- |
| 도구 | 나무껍질 컵, 돌 곡괭이, 손칼 | 손잡이와 채집/절삭 접촉 앵커를 가진 하나의 도구 부위 |
| 기본 설비 | 작업대, 가마, 대장간, 유체 작업대, 마법 작업대, 축성대, 정밀 작업대 | 지면 설치 프레임과 작업 면, 별도 뚜껑/챔버 |
| 마도공학 설비 T6–10 | 연결된 쌍탱크, 배관, 상부 프레임, 응집 코일 | 프레임→작업 면, 탱크 뚜껑은 독립 부위 |
| 마도학 설비 T6–10 | 유리 캐노피, 목재 지지대, 가지형 성장실 | 작업 면과 성장실 구분 |
| 성자 설비 T6–10 | 단차 있는 석조 제단과 성물함, 후광형 고리 | 제단과 성물함 구분 |
| 물리학 설비 T6–10 | 서로 다른 축의 중첩 고리와 관성 코어 | 작업 면과 장치 케이지 구분 |
| 기능 컴포넌트 | 관절·기어·전동기·발전기·열기관·전지·관성전지·탱크·펌프·응집기·물성부여기·성물·제어기 | 하우징과 축/회전체, 기능에 맞는 연결 앵커 |
| 장구 기준 세트 T1–10 | 곤봉/검, 방패, 흉갑, 어깨, 경갑, 투구, 보조 곡괭이 | 무기·방어구·도구를 장착 슬롯별로 분리 |

장구 세트는 기존 `gear_baseline_tN` 제작 결과를 시각적으로 나눈 것이다. 각 하위 부위가 독립 인벤토리 아이템이나 새 제작법이라는 뜻은 아니다. 검의 외형만으로 검술·속성 공격·콤보가 생기지 않으며, 현재 공격은 기존 `hitDamage`와 `attackPeriodS` 계약을 따른다. 네 연구 분야의 자유 혼합은 원본 제작 데이터가 결정한다.

## 제작과 동작 규칙

모델은 `shared.asset()`에서 `initializeAuthoring()`을 거쳐 생성한다. 추가 작업마다 `fill`로 합집합을 만들고, 명시적인 재질 교체만 `paint`로 수행한다. 같은 부위의 중복 점유는 제작 단계에서 제거/거부하며, 완성 후 임의의 중복 제거에 의존하지 않는다. 마지막 `VoxelAssetBuilder.toJSON()`은 부위 ID, 부모 관계, 격자, 재질, 중복 점유와 충돌 계약을 다시 확인한다.

모든 길이는 m, 위쪽은 +Y, 정면은 +Z다. 시각 격자는 0.03125 m다. 이 격자는 월드의 0.5 m 파손 셀과 다르며, 모델의 부피가 자동으로 용량·무게·제작 비용을 바꾸지 않는다. 동일 소유자의 조립 부위는 자기 충돌하지 않고, 다른 소유자와 외부 고체에 충돌한다. 별도 축과 뚜껑은 조립 부위이며, 각 작은 상자를 독립 소유자로 만들지 않는다.

`equipmentSlots[].partIds`로 장착할 부위를 고르고, 해당 `anchorId`의 부모 변환을 합산한 위치를 아바타 슬롯 위치에 정렬한다. `main_hand`는 무기, `off_hand`는 방패, `torso`는 투구를 제외한 보호구, `head`는 투구, `tool_hand`는 보조 도구다. 원본 전체를 손에 붙이면 전시용 세트 전체가 따라오므로 슬롯별 부분 선택이 필수다. 현재 torso 묶음은 경갑도 포함한다. 다리 관절 애니메이션을 구현할 때는 경갑을 별도 다리 슬롯으로 분리하고 기존 저장 슬롯을 이전해야 한다.

설비의 `mount`는 바닥 설치 기준점, `work`는 작업 위치, `material_input/output`은 입출력 연결 위치, `power_input`은 동력 연결 위치, `interaction`은 플레이어 조작 위치다. 컴포넌트는 해당하는 에너지 입출력·유체 입출구·동력축·제어 위치를 추가한다. 앵커는 연결 기준이며, 배관망이나 회전 애니메이션 자체를 구현하지 않는다. 실제 처리량, 에너지량, 작동 시간은 데이터와 런타임이 검사한다.

## 변수 사전

| 상태 | 경로/현재 코드 | 타입·단위 | 범위·기본값 | 근거·검증·이전 |
| --- | --- | --- | --- | --- |
| 재사용 | `progression.entries[].id/kind/origin.recipe` | 문자열 | 기존 53개 결과 ID, 4종 kind | 신규 아이템을 발명하지 않음; 원본 ID 일치 검사 |
| 재사용 | `gear_baseline.referenceMaterial`, `tier` | ID, 정수 | T1–10 | 기준 재료별 색상·금속성, 추가 전투 효과 없음 |
| 신규 | 모델 `category/contentRef` | 문자열/객체 | equipment, progression.json의 동일 ID | 파이프라인 원본 참조 검사 |
| 신규 | 모델 `equipmentKind/sourceRecipeId/referenceMaterialId` | 문자열/nullable | 원본 분류·제작법·재료 | 참조용 메타데이터, 저장 인벤토리 ID 불변 |
| 신규 | 모델 `visualGridM` | 양수 m | 0.03125 고정 | 손잡이와 작은 축 표현; 모든 박스 경계/부위 이동 검증 |
| 신규 | 모델 `parts[].translation/boxes[].center/size` | vec3 m | 유한값, 크기 각 축 >0 | 부모 기준 좌표; SDK 격자 및 점유 검증 |
| 신규 | 모델 `equipmentSlots[]` | slot, partIds, anchorId | 장구 5슬롯/도구 1슬롯 | 실제 존재하는 부위·앵커 참조, 로더에서 슬롯 선택 |
| 신규 | 모델 `anchors[].position` | vec3 m | 각 부위 기준 유한 좌표 | 설치·장착·입출력 기준, 로더 부모 변환 합산 |
| 신규 | 재질 `sourceMaterialId` | 문자열 | 해당 원본 재료 ID | 광물/합금은 존재하지 않는 blockId로 위조하지 않음 |
| 재사용 | 재질 `blockId` | 실제 블록 ID | log, stone, glass | blocks.json 참조 검사; 없는 블록 추가 없음 |
| 신규 | 재질 `emission` | 시각 계수 | 마나 강조 0.12, 기타 0 | 에너지 생산량으로 해석 금지 |
| 신규 | 상급 설비 폭·깊이 | m | 폭 2.25+0.25×(T−6), 깊이 1.5+0.125×(T−6) | 단계별 작업 공간/실루엣 확대, 처리량 자동 변경 없음 |

새 시각 원본은 기존 인벤토리 ID를 사용하므로 아이템 저장 이전이 필요 없다. 모델 부위/앵커 ID를 변경할 때 장착 참조를 함께 갱신해야 한다. 재료 색과 형상은 시각 제안이며 수치 밸런스의 확정 근거가 아니다.

## 모델별 실제 크기

크기는 부모 변환을 합산한 모든 복셀의 AABB, X폭 × Y높이 × Z깊이다. 장구 세트의 폭은 분리 전시된 무기/방패/도구를 포함하므로 플레이어 충돌 크기로 쓰지 않는다. 상자 수는 제작 시점의 겹침 없는 부위별 원본 개수다.

| ID | 분류 | AABB 크기 (m) | 부위 수 | 상자 수 |
| --- | --- | --- | --- | --- |
| bark_cup | tool | 0.3125 × 0.21875 × 0.28125 | 2 | 12 |
| stone_pick | tool | 0.84375 × 0.84375 × 0.125 | 2 | 22 |
| hand_knife | tool | 0.15625 × 0.625 × 0.125 | 2 | 7 |
| field_bench | station | 1.75 × 1.1875 × 1 | 3 | 18 |
| kiln | station | 1.75 × 1.46875 × 1.25 | 4 | 277 |
| forge | station | 1.75 × 1.4375 × 1 | 4 | 154 |
| fluid_bench | station | 1.75 × 1.90625 × 1 | 5 | 231 |
| arcane_bench | station | 1.75 × 1.6875 × 1.0625 | 3 | 69 |
| consecration_table | station | 1.75 × 1.5625 × 1 | 3 | 16 |
| precision_bench | station | 1.75 × 1.5625 × 1 | 3 | 25 |
| arcane_engineering_station_t6 | station | 2.25 × 2.375 × 1.625 | 5 | 336 |
| arcane_engineering_station_t7 | station | 2.5 × 2.375 × 1.75 | 5 | 461 |
| arcane_engineering_station_t8 | station | 2.75 × 2.375 × 1.875 | 5 | 830 |
| arcane_engineering_station_t9 | station | 3 × 2.375 × 2 | 5 | 1079 |
| arcane_engineering_station_t10 | station | 3.25 × 2.375 × 2.125 | 5 | 1352 |
| arcane_studies_station_t6 | station | 2.25 × 2.3125 × 1.625 | 4 | 107 |
| arcane_studies_station_t7 | station | 2.5 × 2.3125 × 1.75 | 4 | 113 |
| arcane_studies_station_t8 | station | 2.75 × 2.3125 × 1.875 | 4 | 119 |
| arcane_studies_station_t9 | station | 3 × 2.3125 × 2 | 4 | 126 |
| arcane_studies_station_t10 | station | 3.25 × 2.3125 × 2.125 | 4 | 132 |
| sanctity_station_t6 | station | 2.25 × 2.3125 × 1.625 | 4 | 82 |
| sanctity_station_t7 | station | 2.5 × 2.375 × 1.75 | 4 | 92 |
| sanctity_station_t8 | station | 2.75 × 2.4375 × 1.875 | 4 | 101 |
| sanctity_station_t9 | station | 3 × 2.5 × 2 | 4 | 109 |
| sanctity_station_t10 | station | 3.25 × 2.5625 × 2.125 | 4 | 118 |
| physics_station_t6 | station | 2.25 × 2.25 × 1.625 | 4 | 186 |
| physics_station_t7 | station | 2.5 × 2.3125 × 1.75 | 4 | 208 |
| physics_station_t8 | station | 2.75 × 2.375 × 1.875 | 4 | 230 |
| physics_station_t9 | station | 3 × 2.4375 × 2 | 4 | 252 |
| physics_station_t10 | station | 3.25 × 2.5 × 2.125 | 4 | 274 |
| joint | component | 0.5 × 0.375 × 0.25 | 3 | 19 |
| transmission | component | 0.78125 × 0.5625 × 0.375 | 3 | 98 |
| motor | component | 0.5625 × 0.65625 × 0.78125 | 3 | 301 |
| heat_engine | component | 0.9375 × 0.9375 × 0.5625 | 4 | 122 |
| generator | component | 0.5625 × 0.65625 × 0.78125 | 3 | 301 |
| battery | component | 0.5 × 0.625 × 0.5 | 3 | 9 |
| inertial_cell | component | 0.6875 × 0.59375 × 0.5 | 3 | 52 |
| fluid_container | component | 0.6875 × 0.90625 × 0.5625 | 4 | 127 |
| pump | component | 0.625 × 0.71875 × 0.59375 | 3 | 18 |
| mana_condenser | component | 0.625 × 0.75 × 0.625 | 3 | 66 |
| property_imprinter | component | 0.6875 × 0.65625 × 0.5 | 3 | 8 |
| relic | component | 0.5 × 0.71875 × 0.5 | 3 | 34 |
| controller | component | 0.5 × 0.625 × 0.40625 | 3 | 7 |
| gear_baseline_t1 | gear_baseline | 2.5 × 1.78125 × 0.5 | 11 | 84 |
| gear_baseline_t2 | gear_baseline | 2.5 × 1.78125 × 0.5 | 11 | 88 |
| gear_baseline_t3 | gear_baseline | 2.5 × 1.78125 × 0.5 | 11 | 74 |
| gear_baseline_t4 | gear_baseline | 2.5 × 1.78125 × 0.5 | 11 | 76 |
| gear_baseline_t5 | gear_baseline | 2.5 × 1.9375 × 0.5 | 11 | 78 |
| gear_baseline_t6 | gear_baseline | 2.5 × 1.9375 × 0.53125 | 11 | 79 |
| gear_baseline_t7 | gear_baseline | 2.5 × 1.9375 × 0.53125 | 11 | 80 |
| gear_baseline_t8 | gear_baseline | 2.5 × 1.9375 × 0.53125 | 11 | 81 |
| gear_baseline_t9 | gear_baseline | 2.5 × 1.9375 × 0.53125 | 11 | 81 |
| gear_baseline_t10 | gear_baseline | 2.5 × 1.9375 × 0.53125 | 11 | 81 |

## 실제 채집 노드 표시

`app/src/main/assets/content-runtime/props.js`는 16개 기존 `source`를 SDK로 생성한다. `buildResourceAsset(sourceIdOrNodeType)`은 나뭇가지·돌무더기·섬유풀·열매관목·약초·점토·물·모래·수액나무·씨앗이삭·산성갈대와 광물 5종의 모델을 반환한다. 도형은 0.0625 m 격자이며, 모든 추가는 `VoxelAssetBuilder.addBox(...,{mode:'fill'})`를 거친다. 광물은 모암 위 노출맥/결정 형태로 구분한다. 식물을 공통 보석이나 표식으로 대신하지 않는다.

`getResourceDescriptors(runtime,{limit=48,radius=48})`는 현재 활성 `runtime.nodes`에서 가장 가까운 채집물을 정렬해 반환한다. limit은 0–96개, radius는 유한한 0 이상 m다. 위치/원천/자원 ID는 atlas가 소유하고 표시 모듈은 새 보상이나 노드를 만들지 않는다. 따라서 atlas에 노드로 정의된 11종이 우선 표시되며, 광물 5종 모델의 존재만으로 광물 위치가 추가되지 않는다.

`progression.harvestClaims[environmentId + ':' + node.id]`와 `clock`을 읽어 채집 완료 노드를 숨긴다. `regrowS > 0`이고 마지막 획득 시간 이후 그 시간이 경과하면 다시 표시한다. `regrowS = 0`은 채집 원장의 기존 의미대로 해당 노드가 계속 소진된 상태다. 시각 모듈은 소진·재생 시간을 별도로 저장하지 않으므로 저장/재로드 이후에도 progression 원장이 정본이다.

반환값은 `{id,assetId,asset,kind:'resource',position:{x,y,z},sourceId,resourceId,interactable:true,node}`다. renderer는 `asset`을 표시하고 실제 레이 조준 결과를 `node`와 연결한다. 시각 메시 자체가 채집 권한·요구 도구·작업 시간·개수 검증을 대체하지 않는다.

## 월드 설치·파손·수리 원장

`content-runtime/placements.js`의 `WorldPlacements`는 27개 station과 13개 component만 고정 설치 대상으로 받는다. 도구/장구 13개는 손에 들거나 착용하는 물품이며 고정 설비로 설치하지 않는다. 모든 설치 결과는 `entityType: machine`이다. 독립 조립 기계는 `machines.js`가 소유하며, 고정 설비는 이 원장을 사용한다.

`new WorldPlacements(CONTENT,progression,{atlas,dungeons,assets?,state?,externalBoxes?})` 후 `.ready`를 기다린다. `place(assetId,position,{actorPosition})`은 실제 에셋을 로드하고 SDK 불변식을 확인한 다음, 부모 변환을 합산한 각 고체 상자로 지형 셀·건물·기존 설비와 교차하는지 검사한다. 전체 AABB는 검색 범위에만 사용하고 빈 내부 공간을 막지 않는다. 하부 접점은 지지면이 필요하다. 모든 비동기 로딩과 공간 검증이 끝난 뒤에만 아이템 1개를 소비하고 원장에 추가한다. 같은 위치의 동시 설치도 첫 성공 후 다음 검사가 점유를 발견한다.

`descriptors()`는 canonical `assetId`, `kind:fixture`, `ownerId`, `position`, `fixed:true`, `revision`, `hp`, `maxHp`를 반환한다. `collisionBoxes(bounds?)`는 비충돌 재질을 제외한 실제 월드 상자를 반환한다. 같은 owner 안의 부위는 자기 충돌하지 않으며 다른 owner 및 외부 고체에는 충돌한다. 손상돼 기능이 꺼져도 실물은 철거 전까지 남는다. 다른 설비를 지탱하는 설비는 위의 설비를 먼저 철거해야 한다.

`syncAccess(playerPosition,{communityStations:[]})`가 접근 가능한 설치 소유자 목록을 `progression.syncWorldFixtures()`에 전달한다. 설비 사용 반경은 실제 모델 외곽에서 4 m이며, 공동체 설비는 root runtime이 실제 공동체 상호작용 범위를 확인한 ID만 전달해야 한다. 전체 설치 수와 가까운 사용 가능 목록은 구분된다. 컴포넌트는 원장 health/maxHealth를 progression assembly의 상태에 반영한다. 지역 간 에너지 배관망은 이 원장이 구현하지 않는다.

| 변수 | 타입·단위·범위 | 현재 값과 근거 |
| --- | --- | --- |
| 원장 `schemaVersion` | 정수 | 1; 위치·HP·종류·고유 ID·카운터 검증 후 복원 |
| `fixtures[].id` | 문자열 | fixture:N; 재로딩/철거 후 번호를 재사용하지 않음 |
| `fixtures[].position` | vec3 m | 0.03125 m 격자; 좌표 절대값 ≤10⁹ |
| `fixtures[].hp/maxHp` | HP | 0≤hp≤maxHp; 0에서 기능 비활성, 수리 가능 |
| `maxHp` 임시 산정 | HP | 제작 입력별 수량×재료 cellHp/4 합, 비재료는 계수25, 올림 후 25–5000 제한 |
| 수리비 임시 산정 | 원본 제작 입력 | 손실 HP 비율×입력량×0.25; 재료는 0.001 단위 올림, 개수형 아이템은 정수 올림 |
| 온전한 철거 | 완제품 | 해당 아이템 1개 반환; 파손 후 포장으로 무료 수리하는 경로 없음 |
| 손상된 철거 | 원본 제작 입력 | 남은 HP 비율×입력량×0.5 회수, 재료 0.001/개수형 정수 내림; 파괴 상태는 회수 0 |
| 접근 반경 | m | 4, 모델 AABB 바깥까지 거리 기준; 설치·수리·철거 UI는 actorPosition 필수 전달 |
| 원장 상한 | 개체 수 | 256, 실제 충돌/저장 예산; 초과 설치는 소비 전 거부 |
| 모델 상한 | m / 상자 수 | 축 크기32 m 이하, 고체 상자10000개 이하 |

HP와 수리/철거 수율은 기존 콘텐츠에 고정 설비 전용 수치가 없어서 추가한 **임시 밸런스 규칙**이다. 에셋의 시각 부피가 실제 재료 질량이나 기능 용량을 덮어쓰지 않는다. 정식 설비 내구 테이블을 도입할 때 `maxHp` 저장 이전 규칙을 함께 추가해야 한다.

설치 실패는 아이템을 소비하지 않는다. 수리 실패는 HP를 바꾸지 않는다. 철거 환급은 progression의 영속 claim과 overflow 보관을 사용한다. 원장+progression을 함께 저장해야 위치·소지품·집계가 일치한다. 현재 정적 고정 설비는 지형 지지면이 이후 파괴될 때 자동 낙하하는 구현을 포함하지 않는다.

## 1인칭 손 장착

`content-runtime/equipment-view.js`의 `EquipmentView`는 카메라 아래에 순수 시각 부위를 붙인다. `new EquipmentView(expeditionScene)` 이후 프레임마다 `sync(runtime,dt)`를 호출하고 화면 종료 시 `dispose()`한다. `.ready`는 현재 비동기 로드 완료 promise, `.lastError`는 해당 로드/슬롯 오류다.

실제 보유한 `progression.equipped` 장구의 `main_hand`와 `off_hand`만 표시하며 흉갑/투구/보조 도구를 통째로 손에 붙이지 않는다. 채집 중에는 해당 source의 `requiredTool`을 실제 보유했을 때 그 도구의 `tool_hand`로 바꾼다. 명시적 `runtime.heldToolId`가 있으면 유효한 보유 도구를 선택한다. 장구 미장착 시 손칼→돌 곡괭이→나무껍질 컵 순으로 보유 도구를 표시한다. 없는 도구나 잘못된 슬롯은 임의 대체하지 않는다.

부위 부모 관계와 로컬 피벗을 유지하고, 선언된 앵커의 모든 부모 translation을 합산해 손 원점에 정렬한다. 원본 형상 크기는 바꾸지 않는다. 공격은 `lastStrike` 변화에 따른 0.38초 흔들기, 채집은 작업 elapsed에 따른 반복 동작, 휴식은 손 위치를 0.2 m 낮추는 시각 동작이다. 공식 피해·채집 시간·도구 내구·아이템 수량은 변경하지 않는다.

장착 메시에는 world owner나 물리 body를 만들지 않는다. `visualOnly/firstPersonEquipment`로 표시하며 레이 조준 대상에서도 제외한다. 교체 시 자체 geometry/material을 해제하고, 늦게 끝난 이전 로드가 새 장비를 덮어쓰지 않도록 세대 번호를 검사한다. 사망/소지품 소실 시 표시도 사라진다. 10개 장구와 3개 도구 전체에서 선언 슬롯의 앵커 정렬을 테스트했고, Chromium에서 T1/T10 장구·돌 곡괭이·컵의 실제 1인칭 렌더를 확인했다.
