# 콘텐츠 런타임 통합 계약

상태: 구현 중. 전체 목표 완료 또는 배포 완료를 뜻하지 않는다.

- 기존 월드/저장/플레이를 보존하며 신규 생성 규칙은 별도 `expedition` 월드 유형으로 연결한다. 구 월드를 새 지형으로 덮어쓰지 않는다.
- 런타임 위치: `app/src/main/assets/content-runtime/`. 카탈로그는 제작 데이터에서 빌드한 `catalog.generated.js`의 `CONTENT` export이다. `CONTENT.environments`, `.blocks`, `.creatures`, `.structures`, `.bosses`, `.progression`은 각 원본 JSON 문서의 구조를 유지한다. lookup은 각 문서의 `entries` 배열에서 id로 한다.
- 모든 게임 모델은 DOM/Three 의존 없이 테스트 가능해야 한다. 표현·입력은 총괄의 통합 계층이 맡는다. 기존 Three/Rapier/재료 거래/형상 도구를 재사용한다.
- 좌표는 미터, 복셀은 0.5m, 시간은 초, 칼로리는 CP, 채널별 에너지는 EU. 저장 데이터는 JSON 안전한 값으로 구성한다. 실행 중 객체 ID는 에셋 ID와 분리한다.
- 초기 스폰 절대 좌표는 (0,0), 거리 난도도 동일 기준. 프로시저 생성과 보상 표본은 시드·영속 ID로 결정한다. Date.now/Math.random을 생성 규칙으로 사용하지 않는다.
- 각 분야는 constructor에 카탈로그와 선택 초기 state를 받고 serialize()로 상태를 내보낸다. 시간 진행은 dt 인수만 사용하며 렌더/메뉴/저장 시 진행하지 않는다.
- 연구/제작/보상/사망 회수는 원자적 거래와 영속 원장으로 중복 및 손실을 방지한다. 저장 실패 시 기존 정상 저장을 남긴다.
- 파손·비활성 상태·스폰 원장·보스 전이·에너지 지출은 재로딩으로 초기화하지 않는다.
- 같은 owner ID에 속하는 관절 몸체는 자기 충돌을 하지 않으며 외부 owner와 지형에는 충돌한다.
- 최신 전투 계약은 [COMBAT-HP-RULES.md](COMBAT-HP-RULES.md)를 따른다. 전체 HP는 사망 기준, 골격 파손은 행동 변화이며 외피 유효타도 전체 HP에 누적한다. 관통·충격의 부위별 피해는 같은 공격 예산에서 분배한다.

## 파일 소유권

- 총괄: expedition 진입/화면/조작/렌더, runtime.js, save.js, 공통 인터페이스, 기존 파일과의 연결, 버전/배포.
- 환경: content-runtime/atlas.js 및 관련 tests/content-atlas.test.js.
- 생명체: content-runtime/creatures.js 및 관련 tests/content-creatures.test.js.
- 건축물: content-runtime/dungeons.js 및 관련 tests/content-dungeons.test.js.
- 보스: content-runtime/bosses.js 및 관련 tests/content-bosses.test.js.
- 성장: content-runtime/progression.js 및 관련 tests/content-progression.test.js.
- 독립 검증: tools/build-runtime-content.mjs, catalog.generated.js, assets.generated.js 및 통합 감사/테스트. 데이터와 원본을 검증 없이 변경하지 않는다.

분야별 공개 API는 작성 즉시 총괄에게 전달한다. 변경이 필요하면 소유자와 먼저 맞추며 다른 담당 파일을 동시에 수정하지 않는다. 이 문서는 구현 결과에 맞추어 계속 갱신한다.

## 분리된 사물과 재질 반응

월드에서 떨어진 복셀은 원래 셀의 재질·질량·부피·남은 HP를 유지한다. 사용으로 4m 이내 물체를 잡고, 사용으로 놓거나 공격으로 던진다. 잡기는 최대 1,800N 스프링 힘이며 고정 위치로 순간 이동시키지 않는다. 던지기는 속도 증가 최대 8m/s 및 추가 운동에너지 300J 중 작은 값을 쓴다. 이 수치는 최초 조작 밸런스 제안이다. 외부 지형·물체와의 충돌을 유지하고 메뉴·초점 상실에서 잡기를 해제한다.

분리된 월드 사물의 셀을 파괴하면 연결 성분을 새 소유자로 나누고, 회전 중인 각 성분의 질량 중심 속도를 보존한다. 제거한 셀만 정상 원료 수율로 한 번 회수한다. 생명체에서 떨어진 기관은 원래 개체의 전리품 원장을 공유하며 사물 절단으로 추가 전리품을 생성하지 않는다.

건물·고정 설비·분리 사물의 화학 피해는 실제 구성 재료의 산 저항을 적용한다. 순간 열 피해의 제안 응답은 `min(1, 180 / heatLimitC)`이며, 고정 설비는 제작 입력 질량으로 가중한 응답을 쓴다. 표시용 색깔은 재질 스탯이 아니다. 지형의 열 공격은 별도의 열량·온도 모델에 열을 전달하며 같은 공격으로 직접 HP 피해를 중복 적용하지 않는다.

기계의 물 접촉은 실제 복셀 콜라이더에서 검사한다. 재료 부피와 유체 밀도에 비례하는 부력, 잠긴 비율에 비례하는 속도 저항을 Rapier 힘으로 적용하며 화물·컴포넌트를 포함한 실제 질량이 흘수에 영향을 준다. 회전한 셀의 잠긴 비율은 수직 투영 폭으로 근사한다(정밀 유체 해석을 뜻하지 않음). 던전 횡풍은 같은 위험 구역의 힘 값을 기계에도 적용한다.
