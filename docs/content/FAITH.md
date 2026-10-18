# 선택 신앙·의뢰·제단 시련

신도 활동과 시련으로 신성을 얻는 경로는 사용자 확정 사항이다. 신의 고유명, 의뢰 세부 내용, 시간·비용·보상은 이번 연결을 위한 **제안 수치**다. 유일한 신 ID는 `unnamed_forgotten_deity`, 인게임 표시는 `잊힌 신`이다. 문서에서는 아직 이름이 확정되지 않았음을 제안 상태로 기록한다. 연구 분야·제작 해금에 가입을 요구하지 않는다. 생명 제작은 추가하지 않는다.

## 개념·분류·구성 관계

`FaithSystem`은 선택적 가입 상태, 세 의뢰, 제단별 시련 원장을 관리한다. `DungeonSystem`의 기존 유적/성역 앵커를 공간의 기준으로 사용하고 `Progression`이 물품 차감과 신성 지급을 담당한다. 전투 처치 자체는 보스 시스템의 책임이다.

- 유적 제단: `communal_archive`의 archive 보상 앵커. 작은 유적 변형에도 같은 위치를 사용한다.
- 성역 제단: `forgotten_monastery`의 puzzle 앵커. 던전 통행 퍼즐과 별개 활동이며 한쪽의 완료가 다른 쪽을 완료하지 않는다.
- 의뢰: 가입 후 수락하는 납품·발견·보스 처치의 세 유형. 각 의뢰의 보상은 월드의 플레이어당 한 번이다.
- 시련: 가입 없이도 수행 가능한 제단별 활동. 완료 신성은 제단 인스턴스마다 한 번만 수령한다. 같은 제단 재생성/재접속/가입 변경으로 초기화하지 않는다.

기존 건축 모델을 재사용한다. 이 모듈은 새로운 모델·충돌체·보스·무료 아이템을 생성하지 않는다. 추가 인게임 표시와 입력은 `content-runtime/game.js`(0.12.1까지 `entry.js`)의 장부 창 신앙 페이지, 상태 저장은 `runtime.js` 연결 책임이다.

## 동작 규칙과 제안 데이터

| 활동 | 실제 조건·비용 | 보상 |
| --- | --- | --- |
| 가입/탈퇴 | 제단 3m 이내, 살아 있고 시야가 통함 | 없음; 연구·기존 의뢰 원장 유지 |
| 유적 보급 | 수락 후 식량 4개와 목재 2L 납품 | 신성 10 EU |
| 새로운 기록 | **수락 이후** 서로 다른 유적/성역 2곳에 실제 진입하여 발견 | 신성 15 EU |
| 수호자 위협 | **수락 이후** 새 보스 인스턴스 1개체의 실제 처치 상태 | 신성 25 EU |
| 제단 시련 | 매 시도 식량 1개와 목재 1L 소비; 12초 유지와 수동 조율 3회 | 신성 15 EU, 제단마다 1회 |

발견/처치 의뢰는 수락 시 이미 완료한 ID 목록을 저장하고 제외한다. 단순히 월드에 생성된 건물은 발견이 아니다. 새 증거 ID는 중복 없이 목표 수까지만 보존한다. 조건 충족만으로 지급하지 않으며 가까운 제단에서 별도로 수령한다. 탈퇴 후 재가입해도 기존 완료·수령 상태는 유지된다. 납품은 원자적 거래이며 실패하면 일부 재료만 가져가지 않는다.

시련 시간대는 **2~4초, 6~8초, 10~12초**다. 각 구간에서 조율 버튼을 한 번 눌러야 한다. 마지막 조율 후에도 총 12초까지 유지해야 완료된다. 시간대 전에 누르거나 같은 구간을 연타해도 다음 조율을 채우지 못한다. 범위 이탈·시야 차단·피격·사망·시간대 누락·수동 중단은 실패다. UI는 경과 시간, 다음 조율 시간대, 남은 횟수와 실패 이유를 표시한다. 한 번에 진행 중인 시련은 하나만 허용한다.

시간은 실제 활성 게임 시뮬레이션 시간이다. `tick(dt)`는 0~1초만 허용한다. 메뉴 일시정지나 앱 중단 시간을 성공으로 누적하지 않는다. 중간 저장은 경과 시간과 완료 조율 수를 보존하고, 재개 때 위치·시야·HP·마지막 피격 시점을 다시 검사한다. 실패 비용은 반환하지 않으며 재시도는 새 비용을 지불한다.

## 런타임 계약

소스: `app/src/main/assets/content-runtime/faith.js`. 원본 제안 규칙은 같은 파일의 `FAITH_RULES`다. 기존 콘텐츠 JSON을 복제하거나 그 권위 데이터를 수정하지 않는다.

```js
runtime.faith = new FaithSystem(runtime, saved.faith ?? {});
runtime.faith.tick(dt);                       // 활성 시뮬레이션만
runtime.faith.nearbyShrines(3);               // {instanceId, position, name, anchorId}[]
runtime.faith.optionsFor(instanceId);         // {id, label, detail, disabled, reason}[]
runtime.faith.interact(option.id, {instanceId});
runtime.faith.status(instanceId);             // 의뢰 진행·시련 시간대/횟수/실패 이유
saved.faith = runtime.faith.serialize();
```

`interact` 자체가 위치·시야·비용·업적을 다시 검사한다. UI 버튼의 비활성 상태만 신뢰하지 않는다. 신성은 `Progression.grantReward`의 기존 저장·초과분 보존 규칙을 따른다. 지급 영수증이 성공한 뒤 활동 상태를 수령 완료로 바꿔 재호출이 중복 지급하지 않게 한다. 납품 키는 의뢰 ID, 시련 비용 키는 제단 ID+시도 번호, 시련 보상 키는 제단 ID다. 전체 게임 저장은 Progression과 Faith 원장을 같은 스냅샷으로 저장해야 한다.

## 변수 사전·이전·검증

| 실제 코드/저장 경로 | 구분·타입·단위 | 기본·유효 범위 / 개별값 | 논리·이전·검증 |
| --- | --- | --- | --- |
| `FAITH_RULES.id/name/status` | 신규 string | `unnamed_forgotten_deity` / `잊힌 신` / `proposed` | 문서는 서사 확정 전의 제안 상태를 표시 |
| `FAITH_RULES.rangeM` | 신규 number·m | 3; 현재 고정 | 기존 근거리 서비스와 일치; 거리·시야 검사 |
| `FAITH_RULES.quests[]` | 신규 array | 위 3개; goal 1/2/1 | 회원 제한은 활동에만 적용; 모든 연구와 독립 |
| `FAITH_RULES.trialDurationS/trialWindowsS` | 신규 number·s / array | 12 / [2,4],[6,8],[10,12] | 시간·행동 조건 모두 필요; 수치는 제안 |
| `FAITH_RULES.trialCost/trialRewardEU` | 신규 물품 수량 / EU | 식량1·목재1L / 15 | 공짜 반복 보상을 막음; 세계의 서로 다른 제단 탐험은 허용 |
| `serialize().schemaVersion/clock` | 신규 integer / s | 1 / 0 이상 유한수 | faith 없는 옛 저장은 빈 선택 활동으로 시작 |
| `membership` | 신규 null 또는 object | 기본 null; deityId/joinedAt/shrineId | 가입시간은 clock 이하; 탈퇴해도 업적 초기화 금지 |
| `quests[id]` | 신규 object | active/ready/claimed; acceptedAt/baselineIds/evidenceIds/delivered | ID 중복·수락 전 증거·목표 초과 금지; 준비 상태는 조건 충족 필수 |
| `trials[instanceId]` | 신규 object | active/failed/ready/claimed; attempt>=1, elapsed0~12s, attunements0~3 | 동시에 active1개; 조율 수는 경과 시간과 일치해야 함 |
| `trials[].lastHp/damageAt/failReason` | 신규 HP / 시각 / enum | lastHp>=0; damageAt 유한수 또는 null | HP 감소나 피격 시각 변경은 실패; 실패 이유 저장 |
| Progression 기존 `claims/energyOverflow` | 기존 API 사용 | 비용·보상 키별 1회 | 기존 재화 보존/멱등 동작 재사용 |

`tests/content-faith.test.js`는 실제 Progression/DungeonSystem과 연결해 가입 독립성, 유료 납품, 수락 후 신규 발견/처치, 시련 시간대·연타·실패·재시도, 중간 저장, 지급 실패 후 재수령, 훼손된 저장 상태를 검사한다. 이 자동 검사는 실제 입력 브라우저 완주나 신앙 콘텐츠 장기 밸런스 검증을 대신하지 않는다.
