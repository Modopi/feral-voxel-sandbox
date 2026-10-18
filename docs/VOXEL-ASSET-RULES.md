# 복셀 형상·소유권·충돌 공통 규칙

사용자 확정 규칙. 새로운 환경·기계·사물·유기생명·무기생명 에셋과 향후 런타임 통합에 동일하게 적용한다. 현재 구현 위치는 에셋 빌드/도감과 재사용 Rapier 어댑터이며, 기존 게임의 모든 엔티티가 이 어댑터로 이행된 상태는 아니다.

## 1. 소유권

- `ownerId`는 **실제 엔티티 인스턴스**의 고유 식별자다. 종 ID, 에셋 ID, 재질 ID, 부위 ID를 대신 쓰지 않는다. 같은 종 두 마리와 같은 설계로 만든 두 기계는 서로 다른 owner다.
- 자식 복셀·부위·관절 몸체는 최상위 엔티티의 owner를 공유한다. 각자 다른 `partId`를 유지한다.
- 장면의 인스턴스는 부모 장면의 owner를 상속하지 않는다. 도감에서는 `장면/인스턴스 경로`로 구분하며, 실제 게임에서는 저장되는 개체 ID를 사용한다.
- 파손되어 독립 객체가 된 조각은 새 owner를 부여한다. 재부착 때에는 소유권과 충돌 등록을 함께 갱신한다. 아직 구현하지 않은 파손·재부착 기능을 이 규칙만으로 완료했다고 표현하지 않는다.

## 2. 형상

- **같은 부위 안**의 큐보이드는 같은 부피를 중복 점유하지 않는다. 제작 API의 기본 추가가 중첩을 즉시 거부한다. 원본의 `parts[].boxes`에 직접 쓰는 방식과 빌드 후보정은 허용하지 않는다.
- 의도적으로 기존 영역을 바꾸려면 도구의 명시적 `replace` 작업을 사용한다. 해당 명령이 실행되는 즉시 기존 영역을 잘라내고 새 재질로 바꾼다. `fill`은 빈 공간만 채우고 `removeBox`는 지정 영역만 비운다. 명령 전후로 중복 점유가 없는 상태를 유지하며 부모 연결·피벗·앵커를 보존한다.
- 서로 다른 관절 부위를 합치거나 깎아 움직임 여유를 없애지 않는다. 관절 연결부의 중첩은 허용한다. 이 예외를 같은 부위의 중복 허용으로 확대하지 않는다.
- 같은 부위의 붙어 있는 불투명 면, 동일한 투명 재질 사이의 내부 면은 출력하지 않는다. 서로 다른 투명 매질의 경계와 독립 관절의 연결 면은 보존한다.
- 투명도와 충돌 여부는 별개다. 물·산성 물의 시각 표현은 `materials[].collision=false`; 유리 등 실제 고체는 투명해도 충돌한다.

## 3. 충돌 판정표

| 두 대상 | 충돌 반응 |
|---|---|
| 같은 강체에 붙은 복셀 | 없음 |
| 같은 owner의 서로 다른 부위/관절 강체 | 없음 |
| 다른 owner의 생명체·기계·사물 | 켬 |
| 엔티티와 외부 고체 지형/건축물 | 켬 |
| 물 등 비고체 시각 표현 | 고체 충돌체 생성 안 함 |

- 충돌 형상은 실제 큐보이드 집합으로 구성한다. 건물 전체의 외곽 상자나 볼록 껍질로 문·창·수로·관절 사이의 빈 공간을 막지 않는다.
- 물리 엔진에 동일 owner 제외 필터를 연결한다. 이 저장소의 Rapier는 EventQueue와 hooks를 함께 전달하는 `AssetCollisionWorld.step()`을 사용해야 필터가 실제 적용된다.
- owner를 충돌 비트 마스크 번호로 단순 축약하지 않는다. 개체가 많아져도 서로 다른 owner가 같은 그룹으로 취급되면 안 된다.
- 동적 몸체는 CCD를 켠다. 강제로 좌표를 이동시키는 기구학 몸체는 충돌 반응만으로 이동이 제한되지 않으므로, 실제 이동 제어에는 shape cast 또는 충돌 제어기를 사용한다.
- 관절 운동은 별도 제약/애니메이션 문제다. 내부 충돌 제외는 관절 제약을 없애거나 관절 범위를 무제한으로 하라는 뜻이 아니다.

## 4. 공통 데이터 계약

| 필드 | 규칙 |
|---|---|
| `collision.enabled` | true |
| `collision.ownerScope` | entity_instance |
| `collision.selfCollision` | false |
| `collision.externalCollision` | true |
| `collision.shape` | part_cuboid_compound |
| `collision.jointOverlapAllowed` | true |
| `materials[].collision` | 고체 true / 유체 시각 재질 false |
| `geometry.authoringTool` | feral_voxel_builder_v1 |
| `geometry.occupancy` | exclusive_within_part |

원본 JSON과 GLB의 extras에 계약을 보존한다. GLB의 계약 정보만으로 외부 프로그램의 물리가 자동 활성화되지는 않는다. 가져오는 도구가 어댑터 또는 동등한 구현으로 이 규칙을 적용해야 한다.

## 5. 변경 시 필수 확인

1. `npm run build:assets`: 생성기를 제작 API로 실행한다. 도구를 거치지 않은 반환 객체, 중복 점유, 충돌 계약 위반은 후보정 없이 실패한다. 직접 편집 원본은 `authored/`에서 불러온다.
2. `npm run check:assets`: GitHub와 같은 하네스로 제작 경로와 체크인된 JSON/GLB/manifest의 정확한 재현을 확인한다.
3. `node --test tests/asset-authoring.test.js tests/asset-solid.test.js tests/asset-collision.test.js tests/long/visual-assets.test.js`: 부피/재질/피벗 보존, 내부 면, 소유권, 실제 물리 충돌을 확인한다.
4. `npm run render:assets`: 변경한 원본에서 이미지도 다시 만든다. 이전 이미지를 새 원본의 결과로 재사용하지 않는다.
5. 신규 물리 로더·런타임 통합은 동일 owner 관절 통과, 다른 owner 충돌, 지형 지지, 빈 공간 통과를 실제 시뮬레이션으로 검증한다. 설정값만 검사해서 완료로 판정하지 않는다.

구현: `tools/asset-pipeline/solid.mjs`, `model.mjs`, `physics.mjs`, `glb.mjs`. 도감의 `viewer-physics.mjs`는 모델을 고정하고 외부 물체를 떨어뜨려 접촉을 확인하는 검토 화면이다. 캐릭터 이동·관절 애니메이션·파손 시스템 전체를 구현한 화면은 아니다.


## 6. 제작 도구를 쓰는 방법

저장소 루트에서 `npm run author:assets` 후 `http://localhost:8081/design/assets/author.html`을 연다. 에셋·부위·재질을 선택하고 위치/크기를 입력해 추가한다. 겹침 거부가 기본이며 교체는 사용자가 명시적으로 선택한다. 실행 취소/다시 실행, 새 관절 부위, JSON 가져오기/내려받기를 지원한다.

내려받은 `<id>.voxel.json`은 `design/assets/authored/`에 저장한다. 이 원본이 있으면 빌드가 생성기보다 우선해 사용하며 편집 내용을 덮어쓰지 않는다. 원본 저장 후 빌드·렌더·하네스를 실행한다. 생성기를 수정할 때에도 `shared.mjs`의 `box`(거부), `paint`(명시적 교체), `fill`(빈 공간) API만 사용한다.
