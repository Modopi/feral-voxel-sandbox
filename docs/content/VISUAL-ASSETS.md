# 시각 에셋의 원본·저장·재사용

상태: **시각 프로토타입(art_prototype)**. 콘텐츠의 형태를 검토하고 실제 3D 자산으로 재사용하기 위한 자료다. 최종 디자인 승인, 게임 통합, 충돌체·생태·AI·전투·애니메이션 구현 완료를 뜻하지 않는다. [에셋 형식 계약](../../design/assets/FORMAT.md)과 아래 실제 생성·검사·내보내기 코드를 기준으로 작성했다.

## 1. 개념: 그림과 모델, 게임 규칙의 역할

하나의 생명체에 대해 세 가지 질문을 분리한다. ‘어떤 생물이며 어떻게 행동하는가’는 콘텐츠 데이터, ‘어떤 형태와 재질로 보이는가’는 시각 생성기와 복셀 모델, ‘게임에서 실제로 어떻게 움직이고 맞고 부서지는가’는 런타임 구현이 담당한다.

가령 생명체 데이터의 `body.lengthWidthHeightM`는 생물의 설계 치수이고, 생성기는 이를 시각 모델의 폭·높이·길이에 대응시킨다. 반면 시각 모델에 뿔·턱·발광 무늬가 그려졌다는 사실만으로 공격 판정이나 마법 에너지가 생기지 않는다. 건물의 보상 앵커 역시 상자의 위치를 기록할 뿐 아이템을 지급하지 않는다. **형태가 기능을 임의로 만들어내지 않는다는 게임의 제작 원칙을 시각 자산에도 적용**한다.

현재 연결 대상은 환경8개, 일반 생명체34종, 보스8종, 건축물12개로 총62개다. 이는 `design/content/`의 해당 네 파일에 존재하는 항목 수다. 각 항목과 일치하는 시각 모델을 생성하는 것이 빌드의 완전성 조건이며, 생성·렌더가 성공했는지는 실제 빌드 결과와 manifest로 따로 확인한다.

## 2. 분류: 무엇을 편집하고 무엇을 재사용하는가

| 자료 | 실제 위치 | 담당하는 내용 | 편집·재사용 원칙 |
|---|---|---|---|
| 콘텐츠 수치·행동 설계 | `design/content/{environments,creatures,bosses,structures,blocks}.json` | 기후·블록·치수·생물 스탯·행동·보스 페이즈·방 좌표 | 시각 수정이 스탯을 덮어쓰지 않는다. 치수·방 배치 변경 시 모델도 재생성한다. |
| 편집 가능한 절차적 원본 | `design/assets/generators/{environments,creatures,bosses,structures}.mjs` | 실루엣, 부위, 색상, 장식, 원본 인스턴스 배치 | 지속할 수정은 여기 또는 참조하는 콘텐츠 데이터에 반영한다. |
| 공통 생성 도우미 | `design/assets/generators/shared.mjs` | 헤더, 재질, 부모 부위, 격자 정렬, 앵커, 결정적 난수 | 전체 카테고리에 영향을 주므로 개별 디자인을 바꾸려면 해당 생성기를 우선 수정한다. |
| 생성된 복셀 교환 원본 | `design/assets/models/<id>.voxel.json` | 재질·직육면체·부위 계층·앵커·다른 에셋 참조 | 다른 도구에서 읽거나 자체 엔진의 수입 원본으로 쓴다. 다음 빌드에 덮어써진다. |
| 표준 3D 내보내기 | `design/assets/exports/<id>.glb` | glTF 2.0 메시·재질·부모관계·로컬 좌표·앵커 노드 | Blender 등에서 열어 검토·가공한다. 외부 편집 결과를 생성기로 자동 역수입하는 기능은 없다. |
| 원본 직접 렌더 | `design/assets/previews/<id>.png` | 복셀 모델의 카메라·조명 렌더 | 형태 검토와 위키 삽입용. 게임 플레이 화면도, 이미지 생성 모델이 추측한 형상도 아니다. |
| 콘셉트 참고 이미지 | `design/assets/references/art-direction.png` | 이미지 생성 도구로 만든 미술 방향 참고 | 분위기·색·구성 참고이며 원본 모델의 구조·치수·실제 구현을 입증하지 않는다. |
| 자산 목록 | `design/assets/manifest.json` | 이름·카테고리·파일경로·해시·형상 통계 | 도감이 읽는 빌드 결과다. 손으로 항목을 추가하지 않는다. |

[콘셉트 참고 이미지](../../design/assets/references/art-direction.png)와 [직접 모델 도감](../../design/assets/index.html)은 서로 다른 목적의 자료다. 도감은 저장소 루트를 HTTP로 서비스해서 연다. 파일을 직접 더블클릭하는 방식은 모듈·JSON 읽기 제한 때문에 지원 기준이 아니다.

## 3. 구성과 관계

### 콘텐츠 ID가 연결점이다

시각 모델의 `id`는 콘텐츠 항목 ID와 같고, `contentRef`는 저장소 기준 파일과 그 ID를 함께 가진다. 예를 들어 생명체 모델은 `design/content/creatures.json`의 항목을 참조한다. 검사기는 ID의 존재뿐 아니라 카테고리도 확인한다. 시각 소품 이름만 추가하고 새로운 생물 스탯이 생겼다고 취급하지 않는다.

건축물 생성기는 `rooms`, `connections`, `entrances`의 좌표를 읽어 방·복도·출입구를 만든다. `rewardAnchors`, `bossArena`, 공동체 서비스 위치는 이름 있는 앵커로 남긴다. 지붕과 지붕 장식은 `role: roof` 부위로 구분해 내부를 확인할 수 있게 한다. 건물의 형태는 방 설계와 연결되지만 통로가 플레이어 충돌체·카메라·대형 기계에 적합한지는 별도 검증 대상이다.

환경 모델은 `instances[].assetId`로 다른 모델을 재사용할 수 있다. 건물을 환경마다 복사해 다른 형태로 수정하는 대신, 같은 건축 원본을 지정 위치에 배치한다. 현재 인스턴스는 이동만 지원하며 회전0·크기1이다. 자식 에셋은 다시 다른 에셋을 참조할 수 있으나 순환은 금지한다.

### 부위·상자·앵커의 좌표

모든 길이는 m, 위쪽은 Y, 전방은 +Z다. X/Y/Z는 각각 폭/높이/길이다. 생명체 데이터의 길이·폭·높이 순서와 다르므로 배열 순서를 그대로 복사하지 않는다.

- `parts[].translation`은 부모 부위에서 자기 부위 피벗까지의 이동이다. 부모가 없는 root는 정확히 하나다.
- `parts[].boxes[].center`는 자기 부위 기준 중심, `size`는 양의 세 축 크기다.
- `anchors[].position`은 앵커가 붙은 `partId` 기준 위치다. 약점·장착점·이동 지점이라는 의미는 `purpose`에 기록한다.
- `instances[].translation`은 참조 에셋의 전체 root를 이동한다. 참조한 자산의 내부 부위 계층은 유지한다.

`flattenAsset`은 부모 이동을 누적하여 검토용 최종 상자 위치를 계산한다. 미리보기는 이 결과를 사용하지만, GLB는 부위별 부모관계와 로컬 좌표를 유지한다. 즉 화면을 한 덩어리로 렌더한다고 원본의 편집 가능한 계층을 없애지 않는다.

## 4. 동작 규칙

### 4.1 격자와 치수

생명체·보스의 기본 표현 격자는1/32m(0.03125m), 건축·환경은0.5m다. 이는 표현 해상도이며 피해 복셀·충돌 격자·채굴 블록 크기를 선언하는 값이 아니다.

공통 `part` 도우미는 부위 이동을 격자의 가장 가까운 배수로 반올림한다. `box`는 입력 중심에서 하단 경계를 계산해 정렬하고 크기를 최소 한 격자 이상으로 맞춘 뒤 중심을 다시 구한다. 따라서 **상자의 경계와 크기는 격자 배수이고 중심은 반 격자 위치일 수 있다.** 중심까지 무조건 격자 배수로 강제하면 홀수 셀 폭의 형태가 틀어진다.

생명체 생성기는 설계된 전체 길이·폭·높이에 실루엣을 맞추고 격자에 정렬한다. 뿔·날개·시각 소품까지 포함한 전체 크기이므로, 몸통만의 크기나 충돌 캡슐 크기로 곧바로 사용하지 않는다. 최종 치수는 manifest의 `bounds.size`로 확인한다.

### 4.2 재질과 발광

재질은 sRGB 색상, 거칠기, 금속성, 발광 표현, 불투명도를 가진다. `blockId`를 지정하면 `blocks.json`의 실제 블록 ID여야 한다. `material.id`는 에셋 내부에서만 고유하며 내보내기는 `assetId:materialId`로 다른 모델의 재질과 구분한다.

`mat`의 기본값은 roughness0.88, metallic0, emission0, opacity1이다. 같은 재질 ID를 다시 요청하면 첫 정의를 재사용하므로 색상을 바꾸려면 최초 정의를 수정해야 한다. `emission`은0~5의 시각 계수다. 뷰어는 전체 값을 사용하고, GLB는1초과 강도를 표준 `KHR_materials_emissive_strength` 확장으로 보존한다. 원래 값은 GLB 재질 `extras`에도 남는다. 이 값은 마나·열·신성 에너지량이 아니다.

### 4.3 검사·빌드·출력

`tools/build-visual-assets.mjs`는 네 생성기의 `generate(content)` 결과를 모은다. 생성기는 외부 파일을 쓰지 않고 모델 배열을 반환한다. 빌드 도구가 다음을 확인하고 결과물을 저장한다.

1. 전체 에셋 ID가 중복되지 않고 참조한 콘텐츠 ID가 실제로 존재한다.
2. 재질·부위·앵커·인스턴스 참조가 유효하고, 부모·에셋 참조에 순환이 없다.
3. 좌표는 유한한 세 숫자이고 상자 크기는 양수이며 경계·크기·부위 이동이 격자에 맞는다.
4. 헤더 버전·축·단위·상태가 계약과 맞고 root가 하나다.
5. 콘텐츠의 환경·생명체·보스·건축물 모든 항목에 같은 카테고리 모델이 있다.

검사를 거친 모델을 JSON과 GLB로 기록하고 마지막에 manifest를 쓴다. 현재 이 과정은 전체 디렉터리를 원자적으로 교체하는 방식이 아니다. 도중 실패하면 일부 출력이 갱신되고 이전 manifest나 이전 PNG가 남을 수 있다. 실패 후에는 해당 결과를 완성된 묶음으로 공유하지 말고 원인을 수정한 뒤 빌드와 렌더를 모두 다시 완료한다. 항목 삭제 시 예전 파일을 자동 정리하는 동작도 현재 빌드 도구에서 보장하지 않는다; manifest가 현재 목록의 기준이다.

manifest의 `sha256`은 생성된 모델 JSON 파일, `glbSha256`은 GLB 바이트의 해시다. PNG의 `preview` 경로가 manifest에 기록됐다는 사실은 PNG 렌더가 끝났다는 뜻이 아니다. 렌더는 별도 단계다.

### 4.4 GLB에 보존되는 것

내보내기는 glTF2.0의 직육면체 표면 메시와 비텍스처 PBR 재질을 만든다. 색은 sRGB에서 선형 값으로 변환해 `baseColorFactor`에 넣는다. 반투명 재질은 `alphaMode: BLEND`와 양면 렌더를 사용한다.

모델 그룹의 `extras`에는 assetId·category·status·contentRef·visualGridM이, 부위 노드에는 partId·role이 보존된다. 앵커는 해당 부위 아래 이름 있는 빈 노드로 생성되며 anchorId·purpose를 가진다. 인스턴스는 이름 있는 하위 그룹으로 배치한다. 동일 에셋의 부위 메시·재질은 캐시하여 재사용한다.

이 GLB에는 스키닝, 본 가중치, 애니메이션 클립, 충돌체, 파괴용 셀 소유권, 게임 AI 스크립트가 없다. 부모 부위가 보존됐다는 것과 게임 애니메이션이 작동한다는 것은 다른 완료 조건이다. 같은 부위의 불투명 접촉면과 동일 투명 재질의 내부 면은 내보내기에서 제거한다. 독립 관절의 연결 면은 보존하며 LOD는 아직 생성하지 않는다.

### 4.5 도감과 직접 렌더

도감 `index.html`은 manifest의 카테고리별 필터, 전체 크기, 부위 수, 미리보기, 모델·GLB 다운로드를 제공한다. 검사 화면 `viewer.html?asset=<id>`는 실제 모델 JSON을 읽고 참조 에셋도 재귀적으로 불러온다. 상자는 재질별 `InstancedMesh`로 묶어 렌더한다. 카메라는 원근 왜곡이 없는 직교 카메라이고 드래그 회전·휠 확대·시점 초기화를 지원한다.

`roof=hide`는 지붕 role과 그 자식 부위를 숨기는 검토 모드다. 벽을 자동으로 절개하거나 충돌을 제거하는 기능은 아니다. `capture`는 UI를 숨겨 원본 PNG 렌더를 준비하는 모드이며 `window.assetReady`는 모델 구성과 첫 렌더가 끝났음을 알린다. 이 신호는 게임의 로딩 완료 이벤트가 아니다.

## 5. 공통 변수 사전과 기존 구현 대응

기존 캐릭터 코드를 새 모델로 자동 이전하지 않는다. 아래 ‘신규’는 미통합 에셋 계약이고 ‘유사 기존 표현’은 구조적 비교다. 실제 값은 생성 JSON과 manifest가 기준이며 보이지 않는 기본값으로 보간하지 않는다.

| 개념/분류 | 현재 변수·위치 | 새 데이터 경로 | 상태 | 타입·단위 | 허용 범위·열거형 | 기본·개별값 | 결정 근거·연관 규칙 | 검증·이전 방식 |
|---|---|---|---|---|---|---|---|---|
| 에셋 정체성 | character-model.js의 role, animal-art.js의 type 숫자 | id/category/contentRef | 신규 | string/object | creature,boss,structure,environment | 콘텐츠 ID와 동일 | 기존 숫자 종ID와 신규 문자열을 혼동하지 않음 | 콘텐츠 존재·카테고리·전체 항목 대응 검사; 별도 이전표 필요 |
| 형식·개발상태 | 기존 모델 반환값에는 없음 | schemaVersion/status | 신규 | integer/enum | 1/art_prototype | 모든 모델 동일 | 배포 게임 자산과 검토 원형 구분 | validateAsset 헤더 검사 |
| 표현 격자 | character-model.js PIXEL=1/32; animal-art.js P=1/32 | visualGridM | 기존 원칙 재사용 | number/m | 양수; 기본.03125 또는.5 | 생명체/보스.03125,건축/환경.5 | 미술과 물리 해상도 분리 | 상자 하단·크기·이동의 격자 배수 오차≤1e-5 검사 |
| 좌표 단위·축 | characterModel의 pivot/at×PIXEL; 기존 동물 표면 장식은 앞쪽 -Z 위치 사용 | units/upAxis/forwardAxis | 새 계약 | enum | m/Y/+Z | 전 모델 동일 | 기존 동물 전면과 새 전면을 무변환 복사하지 않음 | 축 변환과 앞·뒤 검토; 자동 이전 없음 |
| 설계 치수 | characterModel 반환 height=1.625; 동물 parts.dims/cell | content.body.lengthWidthHeightM → bounds.size | 신규 연결 | number[3]/m | 양수; 항목별 실치수 | 순서L/W/H→X/Y/Z=W/H/L | 뿔·날개 포함 시각 경계 | 콘텐츠 치수·격자 반올림 확인; 충돌체로 자동사용 금지 |
| 부위 계층 | character-model.js bones[].id/parent/pivot | parts[].id/parent/translation | 유사 구조·신규 저장 | string/null/number[3]m | 고유ID,root1,부모존재 | root 이동[0,0,0] | 관절 편집 기준점 보존 | 순환검사·상대좌표누적; 기존 pose는 별도 어댑터 필요 |
| 상자 형태 | character-model.js boxes[].at/size; animal-art.js pieces.at/size | parts[].boxes[].center/size | 신규 교환 계약 | number[3]/m | 유한좌표,세크기>0 | generator 개별값 | 정축 직육면체; 회전·스케일 필드 없음 | box 도우미 양끝 정렬·최소1격자; 중심 반격자 허용 |
| 부위 역할 | 기존 bones ID 및 animal feature | parts[].role | 신규 의미필드 | string | root,visual,roof 등 | part 기본visual | roof 및 자식만 숨기기 | hideRoofs 시 검사; 공격/파괴기능 자동연결 없음 |
| 색상 | character palettes/box.color, animalColor의0xRRGGBB | materials[].color | 표현 변환 | string/sRGB | #RRGGBB | 개별팔레트 | 디자이너 색값과 PBR 입력 구분 | 색형식검사, GLB 선형변환 |
| 표면 재질 | character boxes.texture=cloth/metal 등; animal feature | materials[].roughness/metallic/opacity | 신규 PBR 표현 | number | 각각[0,1] | .88/0/1,항목오버라이드 | 기존 texture 이름을 PBR수치로 자동 동일시하지 않음 | 범위검사; 실제 셰이더 질감은 후속 |
| 발광 | 기존 장식색, 대응 에너지 수치 없음 | materials[].emission | 신규 | number/시각계수 | [0,5] | 0 | 빛나는 장식과 게임 에너지 분리 | 원본값extras 및 표준강도확장 보존 |
| 블록 연결 | 기존 동물 parts.damage 셀과 별개 | materials[].blockId | 신규 선택 참조 | string/생략 | blocks.json 실제ID | 지정재질만 | 시각 팔레트와 블록 이름 연결 | ID검사; 물성·HP자동상속 안함 |
| 의미 앵커 | 캐릭터 prop 본, 기존 동물은 cell 소유권 | anchors[].id/partId/position/purpose | 신규 | string/number[3]m | 고유ID,부위존재,유한좌표 | 항목별 위치 | 약점·장착·보상·서비스 위치 보존 | GLB 빈노드로 유지; 판정/지급 코드는 별도 |
| 에셋 재사용 | 기존 모델 cache가 type별 장식 저장 | instances[].id/assetId/translation | 신규 | string/number[3]m | 고유ID,참조존재,순환금지 | 이동만;회전0·크기1 | 환경에서 같은 건물·종 모델 재사용 | flattenAsset 순환검사·부모계층 내보내기 |
| 손상에 따른 시각 제거 | animal-art.js pieces.part/voxel; visibleAnimalDetails의 e.lost/e.damage | 새 필드 없음 | 미이전 | 기존bitmask/셀인덱스 | 기존 원형별 계약 | 신규 모델은정적 | 기존은 표면을 물리셀 경계로 쪼개 파손셀에 귀속 | 신규자산의 해부학셀·장식귀속 매핑 필요; 현재 파괴재사용 불가 |
| 동작·애니메이션 | characterPose의rotation,scale,y 및 walk/run/crouch/crawl/wave/talk/work | 새 animations 필드 없음 | 미이전 | 기존rad·배수·m | 기존 pose 계약 | 신규정적부위 | 부모피벗 보존은 애니메이션 준비 | 클립/리깅/기존pose 어댑터 별도구현 |
| 난수 재현 | characterPose time/phase/seed는 움직임 입력 | shared.rng(seed) | 신규 생성전용 | seed→[0,1) | 고정문자열seed | 생성기의 콘텐츠ID 등 | 프레임마다 외형이 달라지지 않음 | 같은 입력 반복빌드 JSON·GLB해시 비교; 동작seed와 분리 |
| 통계·경계 | 기존 반환 height/parts와 별도 | manifest.entries[].boxes/parts/anchors/bounds | 신규 계산값 | integer/number[3]m | 개수≥0,형상비어있지않음 | 인스턴스확장 상자수/현재원본부위수 | boxes는flatten 결과,parts/anchors는원본배열 길이 | 크기계산·미리보기 일치검사; 서로 집계범위 다름 |
| 파일 무결성 | 기존에 대응 없음 | sha256/glbSha256/model/glb/preview | 신규 | hash/path | 실제생성 JSON/GLB 기준 | 빌드마다계산 | PNG경로가 렌더성공을 증명하지 않음 | 파일존재·해시·렌더검사를 분리 |

기존 `animal-art.js`는 큰 표면 장식을 물리 셀 경계로 분할하고 `part`와 `voxel` 소유권을 부여한다. 따라서 손상된 몸통 위에 장식 외피가 떠 남는 것을 방지한다. 새 모델을 그 코드 대신 바로 넣으면 이 연결이 없어지는 만큼, 신규 정적 모델의 시각적 완성도와 기존 손상 표현의 기능적 완성도를 따로 평가해야 한다.

## 6. 재사용·편집·빌드 안내

저장소 루트에서 실행한다. Node.js는 생성·GLB 내보내기에, Python3는 간단한 로컬 도감 서버에 사용한다. 렌더에는 Playwright와 Chromium이 필요하다. 이 작업 환경에서는 두 의존성이 준비되어 있으며 실제 실행했다. 다른 환경에서는 `npm install --no-save playwright` 후 Chromium을 설치하고, 기본 경로 `/usr/bin/chromium`과 다르면 `CHROMIUM_PATH`를 지정한다. 렌더 도구는 임시 로컬 서버를 직접 열고 종료한다.

```bash
npm run build:assets
npm run render:assets
npm run serve:assets
```

도감 주소는 [로컬 에셋 도감](http://localhost:8081/design/assets/index.html)이다. 기존 게임의 `npm run serve`는 게임 자산 디렉터리를8080포트로 서비스하므로, 저장소 바깥 상대경로를 쓰는 에셋 도감에는 위의 별도 서버를 사용한다.

일반적인 수정 순서:

1. 스탯·행동 변경은 콘텐츠 JSON, 형상·색·부위 변경은 해당 생성기를 편집한다. 건물 방 좌표처럼 시각과 공간 설계가 함께 바뀌는 항목은 콘텐츠 정본을 먼저 바꾼다.
2. `build:assets`로 유효성검사와 JSON·GLB를 다시 만든다. 에러가 나면 해당ID·좌표·참조를 수정하고 다시 실행한다.
3. `render:assets`로 PNG를 재생성한다. 모델만 갱신하고 이전 PNG를 최종 결과로 공유하지 않는다.
4. 도감에서 전체 실루엣, 정면 방향, 바닥 접지, 부위 피벗, 재질 대비를 확인한다. 건축물은 지붕 숨김으로 방·복도·출입구도 확인한다.
5. 필요한 `<id>.voxel.json` 또는 `<id>.glb`를 가져간다. 환경 모델 JSON을 단독복사할 때에는 `instances`가 참조하는 다른 모델도 함께 전달한다. GLB는 인스턴스의 기하와 계층을 파일 안에 포함한다.

예를 들어 `models/<id>.voxel.json`을 직접 고친 후 빌드를 실행하면 수정은 사라진다. 빠른 외부 시제품을 위해 생성 JSON이나 GLB를 수정할 수 있지만, 유지하려는 변경은 생성기 또는 별도 보존 원본에 다시 반영해야 한다. 현재 GLB→생성기 자동 역변환 도구는 없다.

공유 파일에 콘텐츠 JSON의 스탯·행동 전체가 들어있지는 않다. GLB는 `contentRef`로 연결 위치를 남길 뿐이므로, 게임 구현자가 사용할 때는 해당 콘텐츠 JSON과 변수사전도 함께 전달한다.

## 7. 검토 범위와 한계

현재 계약에서 검사할 수 있는 것은 구조적 유효성, 참조 누락, 부위·재질 보존, 좌표·격자 정합성, 저장·재생성 가능성이다. ‘62개 항목이 존재한다’, ‘62개가 빌드됐다’, ‘62개 PNG가 렌더됐다’, ‘62개가 게임에서 작동한다’는 각각 별도 확인 결과다. 이 문서는 뒤의 결과를 앞의 결과만으로 주장하지 않는다.

게임에 넣기 전 남는 작업은 다음과 같다.

- 신규 종·보스와 실제 AI, 페이즈, 공격 예고·피격, 생태 상태의 연결.
- 해부학 셀·장식 소유권·부위 손상·절단과 시각 모델의 연결.
- 관절 회전과 이동·공격·피격 애니메이션, 기존 캐릭터 포즈와의 호환 처리.
- 충돌체, 건물 내비게이션, 카메라·기계 통과·구조 파괴 검증.
- 메시 내부면 제거, LOD, 플랫폼별 메모리·GPU 성능과 투명 정렬·발광 셰이더 검증.
- 버전별 에셋/저장 호환, 배포 패키지 반영과 게임 실행 검증.

발광·약점 앵커·시각 기계 소품은 위 작업의 준비 정보다. 플레이어가 만든 구조물이 생명 엔티티가 되거나, 외형만으로 신규 컴포넌트 기능이 활성화된다고 해석하지 않는다. 콘셉트 참고 이미지와 직접 렌더를 혼동하지 않고, 실제 원본과 변수를 보고 다음 디자인 수정을 결정한다.


## 8. 이번 생성 결과와 실제 검증

- 환경8·일반종34·보스8·건축물12, 총62개 복셀 JSON과62개 GLB 저장.
- 원본 직접 렌더62장과 건축물 내부12장, 총74장 PNG. 별도 콘셉트 이미지1장은 이 숫자에서 제외.
- 전체177개 Node 테스트 통과. 시각 계약 전용6개는 치수/접지, 결정성, 입구 좌표, 잘못된 참조와 순환, GLB 부위/앵커, 발광 보존을 검사.
- Khronos glTF Validator: 저장된62GLB의 오류0·경고0, manifest와 파일해시 일치.
- Blender4.3.2에서62GLB 실제 가져오기 성공, 원본과 전체 경계차이0.0001m이하.
- 브라우저에서62개 도감 항목,12개 건축물 필터, 지붕 숨김, 회전·확대를 확인.
- 각 위키 항목에 직접 렌더·복셀 원본·GLB 링크 연결, 건축물은 내부 이미지 추가.

[형식 검사](../../verification/visual-assets/gltf-validation.json) · [Blender 가져오기](../../verification/visual-assets/blender-import.json) · [렌더 기록](../../verification/visual-assets/render.json) · [브라우저 확인](../../verification/visual-assets/browser.json) · [테스트 기록](../../verification/visual-assets/node-tests.txt)

게임에 연결한 최종 미술이 아닌 첫 시각 원형이다. 특히 환경은 전체 무한월드 생성 결과가 아닌 고정된 장면 샘플이며, 계절·기후·생태가 동작하는 화면이 아니다. 원형을 기준으로 개체 비율과 건축물의 외관을 함께 수정할 수 있다.


## 9. 필수 제작 도구와 GitHub 하네스

모델 제작은 [복셀 편집기](../../design/assets/author.html) 또는 `VoxelAssetBuilder`/`generators/shared.mjs` API를 사용한다. 기본 추가는 중복 점유를 즉시 거부하며, 명시적 교체·빈 공간 채우기·삭제 명령은 작업 순간부터 유효한 점유 상태를 유지한다. 빌드는 잘못된 형상을 후보정하지 않는다.

[공통 규칙](../VOXEL-ASSET-RULES.md)과 저장소 AGENTS.md가 후속 작업에도 이 경로를 요구한다. `npm run check:assets` 및 GitHub의 `FERAL voxel authoring harness`는 도구 생성 여부, 부위별 중복 금지, 충돌 계약, 콘텐츠 참조, 저장된 JSON/GLB/manifest의 정확한 재현을 검사한다.

직접 편집한 원본은 `design/assets/authored/<id>.voxel.json`에 둔다. 빌드는 이를 생성기보다 우선해 읽고 검증한다. 도감에서는 실제 Rapier 충돌체에 외부 물체를 떨어뜨려 접촉을 검토할 수 있다. 같은 엔티티의 자식/관절 몸체는 서로 충돌하지 않으며 다른 개체와 외부 지형에는 충돌한다. 테스트는 설정값뿐 아니라 실제 운동 결과를 확인한다. 게임 전체의 신규 AI·관절 애니메이션·콘텐츠 통합은 별도 단계다.
