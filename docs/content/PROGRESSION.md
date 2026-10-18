# 재료·연구·제작·보상 상세 위키

상태: **개발 전 제안**. 사용자 확정은 31재료의 티어·계열, 자유 계열 혼합, 컴포넌트 기능/복셀 물성 분리, 발견 독점 금지, 최초 신성의 활동 획득, 사망 아이템 비소멸·10m 회수다. 아래 수치·공정·장구·음식·보상량은 테스트 가능한 초기 밸런스 가설이다. [실제 데이터](../../design/content/progression.json)는 런타임에 연결하지 않는다.

## 1. 개념

성장은 탐험 반경과 문제 해결 수단을 넓히는 제작 능력의 성장이다. 캐릭터 직업을 고르면 다른 가지가 잠기는 구조가 아니다. 같은 물질을 검, 방호 장구, 컴포넌트 외피, 공장 설비에 쓸 수 있고, 기술과 에너지가 갖춰져야 실제 기능을 얻는다. 재료 하나의 티어가 완성품의 모든 성능을 결정하지 않는다.

사냥·던전 공략은 빠른 물자와 연구 진행을 얻는 경로다. 원료 채집·자체 연구·반복 가능한 공정만으로도 모든 등록 제작품에 도달한다. 여기서 ‘발견 없이’는 유일 던전·유물·보스 드롭을 요구하지 않는다는 의미이며, 원료를 찾아다니거나 공동체 활동을 하는 탐험 자체를 없애지 않는다. 최초 신성에는 사용자가 정한 퀘스트·기여·보스·시련 중 활동이 필요하다.

## 2. 분류

- **원료(item/source):** 지형·식생에서 얻는 원산 자원. 광맥 위치는 환경 담당이 소유한다.
- **가공 재료(material):** 확정된 31종. 재료의 물성은 기능 컴포넌트의 수동적 성능을 바꾸며 기능 포트를 생성하지 않는다.
- **도구·설비(tool/station):** 채집·공정·실험의 조건. 첫 설비는 첫 설비의 산출물을 요구하지 않는다.
- **연구(research):** 관찰과 실험으로 얻는 지식. 샘플 비용과 작업량이 있고 발견 설계도는 이를 앞당긴다.
- **제작법(recipe):** 소모품, 에너지, 설비, 선행 지식, 공정 시간, 산출량을 묶은 원자적 계약.
- **컴포넌트(component):** 정의된 기능 단위. 모든 플레이어 구조물은 machine이며 자율 동작이 생명 유형을 부여하지 않는다.
- **보상(reward_pool):** 던전의 회수·자료실·보스 채널. 다른 생산 경로의 빠른 획득이며 독점 재료가 없다.

## 3. 구성과 관계

원료 → 도구/기초 설비 → 연구 → 가공 재료 → 장구/컴포넌트/다음 설비 → 더 다양한 탐험으로 연결된다. 연구가 제작법을 열어도 원료·설비·에너지 비용은 남는다. 네 계열 6~10티어 설비는 **같은 계열의 직전 재료**로 구축한다. 6티어 진입 설비는 공통 강철·니켈 기반으로 만들어 다른 고티어 계열 투자를 강제하지 않는다.

마도공학 8티어 ‘마정석 합금’은 자체 설비에서 마나·모래를 결정화해 복합화한다. 성자 7티어 정제 마정석을 필수로 쓰지 않으며, 교차 재료를 쓰는 효율 개선법은 후속으로 추가할 수 있다. 7티어 축성 재료는 공통 **기초 축성**만 요구한다. 모든 계열 제작에는 첫 신성을 주는 외부 활동과 저티어 성물을 사용할 수 있다.

‘알파입자·중성미자 응집체·초끈집합체·우주 거대 구조’는 게임 안에서 안정화한 구성 매질이다. 원자 입자 하나를 인벤토리에서 나무처럼 쥐거나 실제 우주 크기의 구조물을 0.5m로 압축한다는 물리 주장으로 취급하지 않는다. ‘성자의 인내’도 축성이 물질에 정착된 제작 매질로 정의하는 제안이다. 실제 과학 공정이나 현실 화학 제조법이 아니다.

## 4. 동작 규칙

### 4.1 단위·물성·성능

재료 1단위는 **1 L**의 재료 재고다. 0.5m 구조 셀을 꽉 채우면 125 L가 필요하다. 인벤토리 1개를 셀 1개로 간주하지 않는다. 1L의 질량은 밀도/1000 kg다. 작은 장구와 컴포넌트는 셀 내부의 부분 체적을 사용한다. 제작 배합은 입력 부피가 결과 부피보다 크고 부산물/가공 손실이 있다고 가정한다. 복원/재활용 때 원래 투입량보다 많이 되돌려주면 안 된다.

- 질량 = 밀도 × 실제 점유 체적(m³).
- 복셀 HP = 표의 꽉 찬 셀 HP × 점유 체적/0.125m³. 장구 HP와 물체 HP는 서로 다른 값이다.
- 하중 기준(kN) = 강도지수 × 0.05 × 최소 연결 단면적/0.25m². 이는 게임용 구조 강도 계수다. 완전한 재료역학 솔버를 구현했다는 뜻이 아니다.
- 열 한계는 손상 시작 온도 °C다. 그 이상에서는 전달 열량으로 손상을 계산해야 하며 온도 한 번으로 즉시 소멸시키지 않는다. 열용량·냉각계수·전달 함수는 후속 물리 모델에서 정해야 한다.
- 내산성 0~1은 재료에 전달된 산성 작용을 완화한다. 표의 최댓값은 0.99라 완전 무적을 만들지 않는다. 생명체 속성 저항과 중복 적용 여부를 명시해야 한다.
- 마나 결합도는 같은 기능 부여부의 처리량 배수 후보다. 마나 결합도만으로 비행·발전·공격 능력이 생기지 않는다.

### 4.2 연구·기록

연구 `work`의 1은 유효한 실험 행동 1초다. 작업대에서 실험을 계속하는 동안 1 work/s이며 오프라인·순수 대기는 진행하지 않는다. 샘플은 시작 때 한 번 소모하고 중단·사망·재접속에는 진행량을 보존한다. 장기 연구 중 UI 조작은 가능하되 동시에 다른 실험의 시간을 중복 적립하지 않는다.

가공 연구 작업량은 catalog와 같은 `20×티어²`(20~2000), 기초 연구는 10~100이다. 이는 연구 하나의 시간이며 광물 채집·설비 건설까지 포함한 티어 완료 시간은 아니다. 발견 설계도는 **해당 연구 지식을 즉시 해금**한다. 선행 연구와 실험 샘플은 자체 연구 경로의 조건이며 설계도 발견에는 적용하지 않는다. 제작에 필요한 설비·재료·에너지 비용은 그대로 남는다. 동일 연구가 끝났다면 **25%만큼 일반 연구 작업권**을 준다. 중복 작업권은 자체 연구의 작업을 대체하며 샘플·선행 조건은 유지한다. 설계도를 스스로 쓰려면 이미 그 연구를 마쳐야 한다. 자기 기록을 반복 소비해 무한 작업권을 만들지 않도록 **자체 제작 설계도는 중복 작업권을 주지 않고 발견 출처만 지급**한다. 출처와 보상 claim ID를 저장해야 한다.

### 4.3 공정·에너지

에너지는 채널별 EU(게임 에너지 단위), 출력은 EU/s. 현실 J와의 대응은 미정이다. 레시피 에너지는 **완료까지의 총량**이며 표의 공정시간에 걸쳐 공급한다. 필요한 출력이 부족하면 공정 진척이 느려지고, 입력·에너지·출력 중 어느 하나도 중복 결제하지 않는다. 전체 에너지를 한 번에 담는 전지를 강제하지 않으므로 작은 성물로 긴 작업을 수행할 수 있다. 여러 설비와 에너지 생산기를 병렬 확장할 수 있다.

물성 부여 공정과 응집기는 서로 다른 기능이다. 최초 응집기는 마나를 재료로 요구하지 않는다. 대기에서 2 EU/s를 얻어 100 EU를 물1L에 응집하여 마나 액체1L로 보관한다. 물은 일반 운반 매체이며 마나의 공급원은 응집기다. 일반 용기에 담을 수 있다. 산성액은 1L당 40 EU이며 모든 산성 물체는 산성 함량에 대응하는 추출 경로를 가져야 한다. 현재 표는 산성 수액의 대표 공정만 구체화했다.

열기관 0.35, 발전기 0.75, 모터 0.8의 효율을 갖는다. 열→역학→전기의 전체 효율은 0.2625, 역학→전기→역학 순환은 0.6이다. 손실이 공급을 만들어내지 않는다. 전지 0.9는 충전 효율이며 방전 시 다시 곱하지 않는다. 관성전지도 동일. 송전/배관 거리 손실은 아직 도입하지 않는다.

첫 성물: 기초 축성 연구 → 돌·목재 축성대 → 보급 기여 3회로 신성20 → 신성20과 돌2·목재1로 성물 조립. 저티어 성물은 0.1 EU/s 생성·100 EU 저장·최대5 EU/s 출력한다. 최초 활동 신성은 소비 전까지 개인의 비재생 정산 잔고(100 EU 한도)에 보관한다. 이 잔고는 별도의 자동 회복 에너지가 아니다. 축성 이후에는 성물의 생성·저장을 확장한다.

### 4.4 컴포넌트와 복셀

표의 정격은 기준 활성 체적1L의 기능 코어다. 허용 크기는 0.25~8배; 외피 재료·최소 하중 경로·냉각 조건을 함께 검사한다. 정격 출력·저장량에 크기를 적용한 뒤 남은 HP 비율과 연결 하중경로 비율 중 작은 값으로 제한한다. 외형이 닮았다는 이유로 새 에너지 입출력이나 비행 기능을 추론하지 않는다. 이 초안에는 접합·회전·유체·마나·축성·제어만 구체화했고, 비행/무장 컴포넌트의 상세 계약은 아직 없음이다.

### 4.5 보상·회수

모든 던전 채널은 고정 보상으로 시작한다. 희귀 확률 때문에 성장 경로가 막히지 않는다. 자료실은 보스 처치 전에 접근 가능한 경로를 건축 담당이 보장한다. 보스 시체와 아레나 상자는 같은 보스 claim을 공유하여 이중 지급을 방지한다. 월드·던전 인스턴스·채널·앵커 단위 수령 상태를 보존한다. 가방이 찼으면 미수령 수량을 보관하고 재접근 때 이어 받는다.

사망 인벤토리는 일반 드롭과 분리된 영속 사망 레코드에 둔다. 기존 일반 Pickups의 life=240초·160m 경계 처리를 재사용하면 사용자 원칙을 어기므로 재사용하지 않는다. 사망 위치에서 10m 접근 시 요정이 회수하고 가방 잔여공간만큼 원자적으로 옮긴다. 여러 사망 레코드를 각각 유지한다. 배치한 기계가 자동 복구되는지는 이번 확정 범위에 없다.

## 5. 실제 항목 데이터

### 5.1 전체 재료 물성

열은 °C, 밀도는 kg/m³, HP는 꽉 찬0.5m셀 기준, 강도는 위 공식의 지수, 산성은 감소율, 마나는 처리량 배수다. 이 표의 모든 항목은 JSON material.properties에 같은 값으로 존재한다.


| T | 재료 / ID | 계열 | 밀도 | 셀HP | 강도 | 열 | 내산 | 마나 |
|---|---|---|---|---|---|---|---|---|
| 1 | 목재 / `wood` | 공통 | 600 | 45 | 45 | 180 | 0.2 | 0.15 |
| 2 | 돌 / `stone` | 공통 | 2600 | 90 | 100 | 700 | 0.65 | 0.05 |
| 3 | 잡철 / `scrap_iron` | 공통 | 7400 | 130 | 150 | 550 | 0.3 | 0.1 |
| 4 | 강철 / `steel` | 공통 | 7800 | 210 | 260 | 700 | 0.4 | 0.1 |
| 4 | 티타늄 / `titanium` | 공통 | 4500 | 170 | 220 | 650 | 0.7 | 0.12 |
| 4 | 니켈 / `nickel` | 공통 | 8900 | 190 | 200 | 950 | 0.8 | 0.1 |
| 5 | 마나 강철 / `mana_steel` | 공통 | 7900 | 280 | 330 | 800 | 0.5 | 0.65 |
| 5 | 마나 티타늄 / `mana_titanium` | 공통 | 4550 | 240 | 280 | 750 | 0.75 | 0.75 |
| 5 | 마나 니켈 / `mana_nickel` | 공통 | 8950 | 260 | 265 | 1100 | 0.88 | 0.7 |
| 5 | 미스릴 / `mithril` | 공통 | 2900 | 220 | 260 | 650 | 0.65 | 0.95 |
| 5 | 스테인리스 합금 / `stainless_alloy` | 공통 | 7900 | 285 | 300 | 1000 | 0.95 | 0.2 |
| 6 | 마나 스테인리스 합금 / `mana_stainless_alloy` | arcane_engineering | 8000 | 390 | 400 | 1200 | 0.97 | 0.85 |
| 7 | 축성된 아다만티늄 / `consecrated_adamantium` | arcane_engineering | 9200 | 570 | 650 | 1500 | 0.97 | 1.0 |
| 8 | 마정석 합금 / `arcane_crystal_alloy` | arcane_engineering | 7500 | 760 | 850 | 1700 | 0.98 | 1.3 |
| 9 | 복합 마나 초합금 / `composite_mana_superalloy` | arcane_engineering | 7100 | 1050 | 1200 | 2100 | 0.98 | 1.6 |
| 10 | 마이스터 합성재 / `meister_composite` | arcane_engineering | 6400 | 1450 | 1700 | 2600 | 0.99 | 2.0 |
| 6 | 마나 목재 / `mana_wood` | arcane_studies | 620 | 260 | 240 | 400 | 0.55 | 1.1 |
| 7 | 축성된 마나 목재 / `consecrated_mana_wood` | arcane_studies | 640 | 380 | 340 | 650 | 0.7 | 1.4 |
| 8 | 세계수 목재 / `world_tree_wood` | arcane_studies | 680 | 550 | 500 | 900 | 0.82 | 1.8 |
| 9 | 대성한 세계수 목재 / `fulfilled_world_tree_wood` | arcane_studies | 720 | 780 | 700 | 1200 | 0.9 | 2.2 |
| 10 | 세계의 심재 / `world_heartwood` | arcane_studies | 760 | 1100 | 1000 | 1600 | 0.96 | 2.8 |
| 6 | 원시 마정석 / `raw_arcane_crystal` | sanctity | 3100 | 320 | 280 | 1000 | 0.8 | 1.0 |
| 7 | 정제 마정석 / `refined_arcane_crystal` | sanctity | 3200 | 460 | 400 | 1400 | 0.88 | 1.35 |
| 8 | 성철 / `holy_iron` | sanctity | 7900 | 820 | 750 | 1800 | 0.94 | 1.15 |
| 9 | 축복받은 성철 / `blessed_holy_iron` | sanctity | 8000 | 1150 | 1050 | 2200 | 0.98 | 1.5 |
| 10 | 성자의 인내 / `saints_endurance` | sanctity | 8200 | 1700 | 1500 | 2800 | 0.99 | 1.8 |
| 6 | 관성합금 / `inertial_alloy` | physics | 6000 | 350 | 460 | 1050 | 0.7 | 0.2 |
| 7 | 알파입자 / `alpha_particle` | physics | 5200 | 490 | 650 | 1350 | 0.78 | 0.3 |
| 8 | 중성미자 응집체 / `neutrino_condensate` | physics | 4400 | 680 | 950 | 1700 | 0.86 | 0.4 |
| 9 | 초끈집합체 / `superstring_aggregate` | physics | 3600 | 920 | 1350 | 2200 | 0.92 | 0.5 |
| 10 | 우주 거대 구조 / `cosmic_megastructure` | physics | 3000 | 1250 | 1900 | 3000 | 0.96 | 0.6 |


동티어 비교: 강철은 구조 강도, 티타늄은 낮은 질량, 니켈은 내열·내식 우위다. 마나 목재는 초합금보다 약하지만 매우 가벼우며 결합도가 높다. 물리 계열은 강도와 질량 효율이 강하고 마나 결합도가 낮다. 성자 계열은 HP가 가장 높다. 표는 역할 분화 가설이므로 같은 형태의 보·갑판·장구로 파손·이동·가공 시간을 비교해야 한다.

### 5.2 31재료 생산

모든 산출은 재료1L. 연구는 `material:재료ID`. 후반 설비의 숫자는 티어다. 같은 계열의 직전 재료를 쓰므로 신규 고티어 소재를 신규 설비 선행재료로 요구하지 않는다.


| 재료 | 투입 | 설비 | 시간s | 에너지 총량 |
|---|---|---|---|---|
| 목재 | 미가공 목재 2 | 야외 작업대 | 10 | 없음 |
| 돌 | 주운 돌 2 | 야외 작업대 | 15 | 없음 |
| 잡철 | 철 원광 2、목탄 1 | 원시 가마 | 40 | thermal 100 EU |
| 강철 | 잡철 2、목탄 1 | 금속 작업장 | 60 | thermal 180 EU / mechanical 20 EU |
| 티타늄 | 티타늄 원광 3、목탄 1、산성액 1 | 금속 작업장 | 70 | thermal 180 EU / chemical 20 EU |
| 니켈 | 니켈 원광 3、목탄 1 | 금속 작업장 | 60 | thermal 220 EU |
| 마나 강철 | 강철 2、마나 액체 1 | 마나 작업대 | 60 | magic 40 EU |
| 마나 티타늄 | 티타늄 2、마나 액체 1 | 마나 작업대 | 60 | magic 40 EU |
| 마나 니켈 | 니켈 2、마나 액체 1 | 마나 작업대 | 60 | magic 40 EU |
| 미스릴 | 티타늄 2、니켈 1、마나 액체 2 | 마나 작업대 | 80 | magic 80 EU / thermal 120 EU |
| 스테인리스 합금 | 강철 2、니켈 1 | 금속 작업장 | 80 | thermal 220 EU / mechanical 40 EU |
| 마나 스테인리스 합금 | 스테인리스 합금 2、마나 액체 2 | 6티어 복합제련 설비 | 100 | magic 120 EU / thermal 300 EU |
| 축성된 아다만티늄 | 마나 스테인리스 합금 2、티타늄 1 | 7티어 복합제련 설비 | 160 | thermal 600 EU / magic 200 EU / divine 60 EU |
| 마정석 합금 | 축성된 아다만티늄 2、마나 액체 4、모래 2 | 8티어 복합제련 설비 | 240 | magic 600 EU / thermal 1000 EU |
| 복합 마나 초합금 | 마정석 합금 2、마나 니켈 1、미스릴 1 | 9티어 복합제련 설비 | 360 | magic 1800 EU / thermal 2400 EU |
| 마이스터 합성재 | 복합 마나 초합금 2、미스릴 2、스테인리스 합금 2 | 10티어 복합제련 설비 | 540 | magic 6000 EU / electrical 4000 EU / thermal 5000 EU |
| 마나 목재 | 목재 3、마나 액체 2、수액 1 | 6티어 마나육성 설비 | 100 | magic 120 EU |
| 축성된 마나 목재 | 마나 목재 2、수액 1 | 7티어 마나육성 설비 | 160 | magic 200 EU / divine 60 EU |
| 세계수 목재 | 축성된 마나 목재 2、씨앗 2、수액 2 | 8티어 마나육성 설비 | 240 | magic 800 EU / divine 100 EU |
| 대성한 세계수 목재 | 세계수 목재 2、수액 3、마나 액체 4 | 9티어 마나육성 설비 | 360 | magic 2400 EU / divine 250 EU |
| 세계의 심재 | 대성한 세계수 목재 2、씨앗 4、마나 액체 8 | 10티어 마나육성 설비 | 540 | magic 8000 EU / divine 800 EU |
| 원시 마정석 | 모래 3、마나 액체 2 | 6티어 성물정련 설비 | 100 | magic 100 EU / divine 40 EU |
| 정제 마정석 | 원시 마정석 2、모래 1 | 7티어 성물정련 설비 | 160 | magic 180 EU / divine 100 EU |
| 성철 | 정제 마정석 2、강철 2 | 8티어 성물정련 설비 | 240 | divine 500 EU / thermal 800 EU |
| 축복받은 성철 | 성철 2、마나 액체 2 | 9티어 성물정련 설비 | 360 | divine 1800 EU / magic 600 EU |
| 성자의 인내 | 축복받은 성철 2、정제 마정석 1 | 10티어 성물정련 설비 | 540 | divine 6000 EU / magic 2000 EU |
| 관성합금 | 강철 2、니켈 1 | 6티어 관성가공 설비 | 100 | mechanical 500 EU / electrical 200 EU |
| 알파입자 | 관성합금 2、니켈 1 | 7티어 관성가공 설비 | 160 | electrical 1200 EU / mechanical 600 EU |
| 중성미자 응집체 | 알파입자 2、티타늄 1 | 8티어 관성가공 설비 | 240 | electrical 4000 EU / mechanical 1200 EU |
| 초끈집합체 | 중성미자 응집체 2、관성합금 1 | 9티어 관성가공 설비 | 360 | electrical 12000 EU / mechanical 4000 EU |
| 우주 거대 구조 | 초끈집합체 2、관성합금 2 | 10티어 관성가공 설비 | 540 | electrical 36000 EU / mechanical 12000 EU |


### 5.3 연구 목록

샘플은 각각 아래 수량만큼 소모한다. 연구 대상 그 자체가 샘플로 필요한 순환은 없다. 선행 ID는 기존 미통합 catalog 식별자를 보존한다.


| 연구 ID | 선행 | 샘플 | 설비 | 작업량 |
|---|---|---|---|---|
| `observation` | 없음 | 미가공 목재 1、주운 돌 1 | 손 | 10 |
| `joinery` | observation | 미가공 목재 2、식물 섬유 1 | 손 | 20 |
| `mechanisms` | joinery, material:scrap_iron | 잡철 1、목재 1 | 야외 작업대 | 60 |
| `power` | mechanisms | 잡철 2、목탄 1 | 금속 작업장 | 100 |
| `fluids` | joinery | 물 1、점토 1 | 야외 작업대 | 40 |
| `mana` | observation, fluids | 모래 1、물 1 | 유체 작업대 | 100 |
| `consecration` | observation | 돌 1、약초 1 | 야외 작업대 | 100 |
| `inertia` | power | 강철 1、니켈 1 | 정밀 작업대 | 100 |
| `material:wood` | joinery | 미가공 목재 1 | 야외 작업대 | 20 |
| `material:stone` | material:wood | 주운 돌 1 | 야외 작업대 | 80 |
| `material:scrap_iron` | material:stone | 철 원광 1、목탄 1 | 원시 가마 | 180 |
| `material:steel` | material:scrap_iron | 잡철 1、목탄 1 | 금속 작업장 | 320 |
| `material:titanium` | material:scrap_iron | 티타늄 원광 1、목탄 1、산성액 1 | 금속 작업장 | 320 |
| `material:nickel` | material:scrap_iron | 니켈 원광 1、목탄 1 | 금속 작업장 | 320 |
| `material:mana_steel` | material:steel, mana | 강철 1、마나 액체 1 | 마나 작업대 | 500 |
| `material:mana_titanium` | material:titanium, mana | 티타늄 1、마나 액체 1 | 마나 작업대 | 500 |
| `material:mana_nickel` | material:nickel, mana | 니켈 1、마나 액체 1 | 마나 작업대 | 500 |
| `material:mithril` | material:titanium, mana | 티타늄 1、니켈 1、마나 액체 1 | 마나 작업대 | 500 |
| `material:stainless_alloy` | material:steel, material:nickel | 강철 1、니켈 1 | 금속 작업장 | 500 |
| `material:mana_stainless_alloy` | material:stainless_alloy, mana | 스테인리스 합금 1、마나 액체 1 | 6티어 복합제련 설비 | 720 |
| `material:consecrated_adamantium` | material:mana_stainless_alloy, consecration | 마나 스테인리스 합금 1、티타늄 1 | 7티어 복합제련 설비 | 980 |
| `material:arcane_crystal_alloy` | material:consecrated_adamantium | 축성된 아다만티늄 1、마나 액체 1、모래 1 | 8티어 복합제련 설비 | 1280 |
| `material:composite_mana_superalloy` | material:arcane_crystal_alloy | 마정석 합금 1、마나 니켈 1、미스릴 1 | 9티어 복합제련 설비 | 1620 |
| `material:meister_composite` | material:composite_mana_superalloy | 복합 마나 초합금 1、미스릴 1、스테인리스 합금 1 | 10티어 복합제련 설비 | 2000 |
| `material:mana_wood` | material:wood, mana | 목재 1、마나 액체 1、수액 1 | 6티어 마나육성 설비 | 720 |
| `material:consecrated_mana_wood` | material:mana_wood, consecration | 마나 목재 1、수액 1 | 7티어 마나육성 설비 | 980 |
| `material:world_tree_wood` | material:consecrated_mana_wood | 축성된 마나 목재 1、씨앗 1、수액 1 | 8티어 마나육성 설비 | 1280 |
| `material:fulfilled_world_tree_wood` | material:world_tree_wood | 세계수 목재 1、수액 1、마나 액체 1 | 9티어 마나육성 설비 | 1620 |
| `material:world_heartwood` | material:fulfilled_world_tree_wood | 대성한 세계수 목재 1、씨앗 1、마나 액체 1 | 10티어 마나육성 설비 | 2000 |
| `material:raw_arcane_crystal` | mana, consecration | 모래 1、마나 액체 1 | 6티어 성물정련 설비 | 720 |
| `material:refined_arcane_crystal` | material:raw_arcane_crystal | 원시 마정석 1、모래 1 | 7티어 성물정련 설비 | 980 |
| `material:holy_iron` | material:refined_arcane_crystal | 정제 마정석 1、강철 1 | 8티어 성물정련 설비 | 1280 |
| `material:blessed_holy_iron` | material:holy_iron | 성철 1、마나 액체 1 | 9티어 성물정련 설비 | 1620 |
| `material:saints_endurance` | material:blessed_holy_iron | 축복받은 성철 1、정제 마정석 1 | 10티어 성물정련 설비 | 2000 |
| `material:inertial_alloy` | material:steel, inertia | 강철 1、니켈 1 | 6티어 관성가공 설비 | 720 |
| `material:alpha_particle` | material:inertial_alloy | 관성합금 1、니켈 1 | 7티어 관성가공 설비 | 980 |
| `material:neutrino_condensate` | material:alpha_particle | 알파입자 1、티타늄 1 | 8티어 관성가공 설비 | 1280 |
| `material:superstring_aggregate` | material:neutrino_condensate | 중성미자 응집체 1、관성합금 1 | 9티어 관성가공 설비 | 1620 |
| `material:cosmic_megastructure` | material:superstring_aggregate | 초끈집합체 1、관성합금 1 | 10티어 관성가공 설비 | 2000 |


### 5.4 원료·기초도구·식량·생물 드롭

원료 위치는 [환경 위키](ENVIRONMENTS.md)와 blocks/environments 데이터가 정본이다. 아래 환경은 획득 후보이며 계열 독점 지역이 아니다. 광맥은 초기 돌 곡괭이로 느리게 채굴할 수 있어 고티어 도구 선행 교착을 만들지 않는다. 수피 채집컵은 가지1·섬유1로 손제작하고 물·수액 채집에 사용한다. 돌 곡괭이는 가지1·주운돌2·섬유1, 절삭도구는 주운돌1·섬유1로 만들며 둘 다120회 사용 기준이다. 시작 보장 자원량은 환경 담당이 소유한다.


| 원료 | 환경 후보 | 한 번 산출 | 채집s | 도구 |
|---|---|---|---|---|
| 미가공 목재 | grove, mana_grove | 미가공 목재 1 | 4 | 맨손 |
| 주운 돌 | grove, ridge, coast | 주운 돌 1 | 4 | 맨손 |
| 식물 섬유 | grove, marsh | 식물 섬유 2 | 4 | 맨손 |
| 들열매 | grove, coast | 들열매 2 | 4 | 맨손 |
| 약초 | grove, marsh | 약초 1 | 4 | 맨손 |
| 점토 | marsh, grove | 점토 1 | 4 | 맨손 |
| 물 | grove, marsh, coast | 물 1 | 4 | bark_cup |
| 모래 | coast, ridge | 모래 1 | 4 | 맨손 |
| 수액 | grove, mana_grove | 수액 1 | 4 | bark_cup |
| 씨앗 | grove, marsh | 씨앗 1 | 4 | 맨손 |
| 산성 수액 | marsh, grove | 산성 수액 1 | 4 | bark_cup |
| 철 원광 | ridge, thermal | 철 원광 1 | 12 | stone_pick |
| 티타늄 원광 | coast, ridge | 티타늄 원광 1 | 12 | stone_pick |
| 니켈 원광 | thermal, ridge | 니켈 원광 1 | 12 | stone_pick |
| 황질 침전물 | thermal, marsh | 황질 침전물 1 | 12 | stone_pick |
| 마나 결정 원광 | mana_grove, ridge | 마나 결정 원광 1 | 12 | stone_pick |


생물 드롭의 종별 확률·개수는 [생명체 위키](CREATURES.md)가 소유한다. 이 문서는 결과 아이템의 생산 우회를 소유한다. 아래 ‘조직 합성’은 비생명 소재 생산이며 유기·무기생명 엔티티 제작이 아니다. 드롭 가죽과 합성 가죽은 같은 아이템 ID로 기능상 호환된다. 선택적으로 외형/원산지 메타데이터를 남길 수 있다.


| 산출 | 대체 제작 ID | 투입 | 시간s | 에너지 |
|---|---|---|---|---|
| 단백질 조직 | `synth_meat` | 씨앗 2、약초 1 | 30 | thermal 20 EU |
| 가죽형 소재 | `synth_hide` | 식물 섬유 3、수액 1 | 30 | thermal 20 EU |
| 키틴형 외피 | `synth_chitin` | 식물 섬유 2、주운 돌 1、수액 1 | 30 | thermal 30 EU |
| 골질 소재 | `synth_bone` | 주운 돌 2、수액 1 | 30 | thermal 30 EU |
| 산성 분비조직 | `synth_acid_gland` | 산성액 1、식물 섬유 2 | 30 | chemical 10 EU |
| 내열 분비조직 | `synth_heat_gland` | 점토 1、수액 1、황질 침전물 1 | 30 | thermal 40 EU |
| 마나 수액 | `synth_mana_sap` | 마나 액체 1、수액 1 | 30 | magic 10 EU |


무기생명 고철 드롭은 `scrap_iron`이며 철원광2+목탄1의 자체 제련으로 대체한다. 보급식은 열매2·섬유1로1개를 만들고400칼로리를 회복한다. 칼로리는 현재 hunger100 척도와 다른 제안 단위다. 기준 최대2400, 비활동 소모0.1/s·활동0.3/s, 마지막 피격10초 후1.5HP/s·HP당3칼로리로 회복한다. 휴식은 회복속도2배이며 피격 즉시 휴식 해제 후 판정한다. 부족한 칼로리에 맞춰 실제 회복량을 줄인다. 굶주림의 추가 HP 피해는 이 제안에 넣지 않았다.

### 5.5 기능 컴포넌트·에너지 정격

정격의 출력과 용량은 서로 다른 제한이다. 용량0은 저장하지 않음을 뜻한다. 모터/발전/열기관의 정격 출력 열은 **입력 수용 한도**이며 실제 출력은 효율을 곱한다. 응집기와 성물의 생성량은 별도 generation/energy_source 값을 따른다. 성물의5는 저장 신성의 방출 한도이고 생성량은0.1이다.


| 기능 ID | 입력→출력 | 입력/방출 한도 EU/s | 저장EU | 효율 | 제작 재료 |
|---|---|---|---|---|---|
| `joint` |  →  | 0 | 0 | 1 | 목재 1、식물 섬유 1 |
| `transmission` | mechanical → mechanical | 30 | 0 | 0.9 | 잡철 2、목재 1 |
| `motor` | electrical → mechanical | 40 | 0 | 0.8 | 잡철 3、식물 섬유 1 |
| `heat_engine` | thermal → mechanical | 80 | 0 | 0.35 | 잡철 4、점토 2 |
| `generator` | mechanical → electrical | 40 | 0 | 0.75 | 잡철 3、식물 섬유 2 |
| `battery` | electrical → electrical | 20 | 400 | 0.9 | 잡철 2、산성액 1、점토 1 |
| `inertial_cell` | mechanical → mechanical | 30 | 600 | 0.9 | 강철 3、돌 2 |
| `fluid_container` |  →  | 0 | 0 | 1 | 점토 2、목재 1 |
| `pump` | mechanical →  | 10 | 0 | 0.8 | 잡철 2、목재 1 |
| `mana_condenser` |  → magic | 2 | 0 | 1 | 잡철 2、돌 2、모래 1 |
| `property_imprinter` | magic →  | 10 | 0 | 0.8 | 잡철 2、돌 1 |
| `relic` | divine → divine | 5 | 100 | 1 | 돌 2、목재 1 |
| `controller` |  →  | 0 | 0 | 1 | 목재 1、잡철 1 |


유체용기는10L, 펌프는역학10EU/s에서1L/s. 맨손 수동 크랭크는10EU/s이지만 작동 중 공격할 수 없다. 연소는목재 원료1당20EU/s×20s=400EU. 마나 응집부는2EU/s, 산성액은40EU/L. 네트워크 계산 간격은최대0.1s로 제한하며 실제 공급량을 먼저 차감한 뒤 같은 틱 소비량을 지급한다. 유체 용기의 에너지 저장량은 액체량으로 계산하고 별도 마나 저장값과 이중 합산하지 않는다.

### 5.6 개인장비 비교 기준

아래는 보스 설계의 공통 측정 장구다. 기본HP100에 생존장구 보너스가 붙는 제안이며 티어 자동 체력 상승이 아니다. 각 세트 제작은 기준 재료6L+섬유2, 해당 재료 설비·연구, 시간30×티어s다. 각 계열의 같은 역할 장구는 이 유효DPS의±10%로 비교하되 무게·사거리·환경 적응·지속시간으로 차별화한다. 높은 티어 특정 계열을 의무화하는 규칙이 아니다.

정지 DPS는 1초 공격간격의 비교용 공격이다. 유효 지속DPS=정지DPS×0.65. 0.65에는 회피·이동·표준 적의 유효 저항이 이미 포함되어 있어 보스 HP 산정에서 다시 곱하지 않는다. 보스 HP≈유효DPS×목표120~160초로 시작하고 페이즈 면역 시간은 별도 측정한다. 플레이어 방어 감소율은 보스 공격을 받는 기준값이며 적 방어가 아니다.


| 티어 | 최대HP | 방어감소 | 받는배율 | 정지DPS | 유효DPS | 기준재료 |
|---|---|---|---|---|---|---|
| 1 | 100 | 0 | 1 | 12.308 | 8 | 목재 |
| 2 | 110 | 0.08 | 0.92 | 18.462 | 12 | 돌 |
| 3 | 125 | 0.15 | 0.85 | 27.692 | 18 | 잡철 |
| 4 | 145 | 0.22 | 0.78 | 41.538 | 27 | 강철 |
| 5 | 170 | 0.28 | 0.72 | 61.538 | 40 | 마나 강철 |
| 6 | 200 | 0.33 | 0.67 | 89.231 | 58 | 마나 스테인리스 합금 |
| 7 | 235 | 0.38 | 0.62 | 129.231 | 84 | 축성된 아다만티늄 |
| 8 | 275 | 0.42 | 0.58 | 184.615 | 120 | 마정석 합금 |
| 9 | 320 | 0.46 | 0.54 | 264.615 | 172 | 복합 마나 초합금 |
| 10 | 380 | 0.5 | 0.5 | 376.923 | 245 | 마이스터 합성재 |


### 5.7 던전 보상 풀

모든 보상은 고정 수량. 각 인스턴스의 salvage/archive/boss 채널 수령은 독립적이고 영속적이다. 보스 채널 신성은 대표티어×5EU. 재생·리셋 정책 확정 전 같은 인스턴스 재방문 보상은 다시 지급하지 않는다. 반복 수급은 다른 원정·자체 생산·반복 기여로 가능하다.


| 보상풀 ID | T | 회수품 | 자료실 | 보스품 | 신성EU |
|---|---|---|---|---|---|
| `reward_root_manor` | 2 | 목재 4、식물 섬유 4 | 구조와 접합 설계도 1 | 돌 4 | 10 |
| `reward_mining_fort` | 3 | 철 원광 4、목탄 2 | 기계 연결 설계도 1 | 잡철 4 | 15 |
| `reward_floodworks` | 4 | 산성 수액 4、점토 4 | 유체 취급 설계도 1 | 니켈 3 | 20 |
| `reward_geothermal_foundry` | 5 | 니켈 원광 4、황질 침전물 4 | 에너지 변환 설계도 1 | 스테인리스 합금 3 | 25 |
| `reward_cliff_observatory` | 5 | 티타늄 원광 4、식물 섬유 4 | 티타늄 가공 연구 설계도 1 | 미스릴 2 | 25 |
| `reward_sealed_arboretum` | 6 | 수액 4、마나 결정 원광 4 | 마나 취급 설계도 1 | 마나 목재 3 | 30 |
| `reward_forgotten_monastery` | 7 | 모래 4、약초 4 | 기초 축성 설계도 1 | 원시 마정석 3 | 35 |
| `reward_inertia_tower` | 8 | 니켈 원광 4、철 원광 4 | 관성 제어 설계도 1 | 관성합금 3 | 40 |


### 5.8 설비 부트스트랩



| 설비 | 투입 | 제작 장소 | 필요연구 | 시간s |
|---|---|---|---|---|
| 야외 작업대 | 미가공 목재 4、주운 돌 2、식물 섬유 2 | hand | joinery | 60 |
| 원시 가마 | 돌 4、점토 4 | field_bench | material:stone | 60 |
| 금속 작업장 | 잡철 6、돌 6、점토 2 | kiln | material:scrap_iron | 60 |
| 유체 작업대 | 목재 4、돌 2、점토 2 | field_bench | fluids | 60 |
| 마나 작업대 | 잡철 4、돌 4、목재 2 | forge | mana | 60 |
| 축성대 | 돌 4、목재 4、식물 섬유 2 | field_bench | consecration | 60 |
| 정밀 작업대 | 강철 6、니켈 2、목재 2 | forge | power | 60 |
| 6티어 복합제련 설비 | 강철 8、니켈 4、돌 4 | precision_bench | mana | 120 |
| 7티어 복합제련 설비 | 마나 스테인리스 합금 6、강철 4 | arcane_engineering_station_t6 | material:mana_stainless_alloy | 240 |
| 8티어 복합제련 설비 | 축성된 아다만티늄 6、강철 4 | arcane_engineering_station_t7 | material:consecrated_adamantium | 360 |
| 9티어 복합제련 설비 | 마정석 합금 6、강철 4 | arcane_engineering_station_t8 | material:arcane_crystal_alloy | 480 |
| 10티어 복합제련 설비 | 복합 마나 초합금 6、강철 4 | arcane_engineering_station_t9 | material:composite_mana_superalloy | 600 |
| 6티어 마나육성 설비 | 강철 8、니켈 4、돌 4 | precision_bench | mana | 120 |
| 7티어 마나육성 설비 | 마나 목재 6、강철 4 | arcane_studies_station_t6 | material:mana_wood | 240 |
| 8티어 마나육성 설비 | 축성된 마나 목재 6、강철 4 | arcane_studies_station_t7 | material:consecrated_mana_wood | 360 |
| 9티어 마나육성 설비 | 세계수 목재 6、강철 4 | arcane_studies_station_t8 | material:world_tree_wood | 480 |
| 10티어 마나육성 설비 | 대성한 세계수 목재 6、강철 4 | arcane_studies_station_t9 | material:fulfilled_world_tree_wood | 600 |
| 6티어 성물정련 설비 | 강철 8、니켈 4、돌 4 | precision_bench | consecration | 120 |
| 7티어 성물정련 설비 | 원시 마정석 6、강철 4 | sanctity_station_t6 | material:raw_arcane_crystal | 240 |
| 8티어 성물정련 설비 | 정제 마정석 6、강철 4 | sanctity_station_t7 | material:refined_arcane_crystal | 360 |
| 9티어 성물정련 설비 | 성철 6、강철 4 | sanctity_station_t8 | material:holy_iron | 480 |
| 10티어 성물정련 설비 | 축복받은 성철 6、강철 4 | sanctity_station_t9 | material:blessed_holy_iron | 600 |
| 6티어 관성가공 설비 | 강철 8、니켈 4、돌 4 | precision_bench | inertia | 120 |
| 7티어 관성가공 설비 | 관성합금 6、강철 4 | physics_station_t6 | material:inertial_alloy | 240 |
| 8티어 관성가공 설비 | 알파입자 6、강철 4 | physics_station_t7 | material:alpha_particle | 360 |
| 9티어 관성가공 설비 | 중성미자 응집체 6、강철 4 | physics_station_t8 | material:neutrino_condensate | 480 |
| 10티어 관성가공 설비 | 초끈집합체 6、강철 4 | physics_station_t9 | material:superstring_aggregate | 600 |


## 6. 변수 사전

데이터 경로의 `entries[kind=…]`는 해당 항목 필터다. 실제 항목에는 `variableDictionary`로 아래 그룹을 명시했다. `null`은 요구사항/용량이 없거나 미정이라는 필드별 뜻이며 숫자0으로 자동 변환하지 않는다. 목록의 값은 명시값이며 숨은 기본값은 없다. 모든 신규 수치는 유한값이어야 한다. item.massKgPerUnit은 kg/표시단위의 양수이고 해당 원료의 질량만 지정한다. recipe.massBalance의 inputKg/productKg/processWasteKg는 음수 아닌 kg이며 input=product+waste를 만족한다. 수치와 직접 대응되는 보조 원료 질량표는 아래에 둔다. 아래 수량/시간/비율 규칙은 같은 의미의 하위 필드에도 적용한다. 이 파일에는 난수 수치가 없다; 종 드롭 난수는 creature 소유로 참조한다.

| 개념/분류 | 현재 변수·위치 | 새 데이터 경로 | 상태 | 타입·단위 | 허용 범위/밸런스 | 기본·개별값 | 근거·연관 | 검증·이전 |
|---|---|---|---|---|---|---|---|---|
| P-ITEM 원료/중간품 | inventory.js ITEMS, resourceForBlock | entries[kind=item].unit/origin | 신규/일부 이름 중복 | string·unit/recipe/source 참조 | unit=L,bundle,serving,sheet,piece,packet,document | 원료16종·중간품11종·설계도39종 | 원산 경로 추적 | source/recipe 출력에 존재; legacy iron/scrap/relic 자동매핑 금지 |
| P-SOURCE 원산 획득 | acquisition.js acquisitionRules, frontier/content.js GATHERABLES | source.outputs/seconds/requiredTool | 신규 | 수량number·단위/item, seconds | 수량>0, 시간 0(0.14.0부터 개척 원정처럼 즉시 획득, 재생 시간은 노드가 소유) | 원료표 | 손수집→도구→광물 경로 | 블록/노드 산출 ID와 대조; 생성 데이터 버전별 적용 |
| P-MATERIAL 등급·계열 | content/catalog.js MATERIALS(미통합) | material.tier/field | 유지 계약 | integer/string/null | T1~10; 네계열 또는null | 31종 원본 유지 | 사용자 확정 재료표 | catalog ID/tier/field 완전 일치 검사 |
| P-MATERIAL 질량·체적 | machine/model.js TYPES.mass 고정값 | material.properties.densityKgM3; quantity_contract | 신규 | kg/m³,m,L | 양수; 밀도600~9200 | 재료표·셀0.5m/125L | 실재질 밀도와 가상 고티어 균형 | 질량=밀도×체적; 기존 part mass 자동환산 금지 |
| P-MATERIAL 내구·강도 | machine/model.js TYPES.hp 고정값 | properties.cellHp/strengthIndex | 신규 | HP/게임지수 | >0; HP45~1700,강도45~1900 | 재료표; 하중환산0.05 | 개체HP와 분리; 하중단면 의존 | 동일형태 파손 비교, 구부품 보존 |
| P-MATERIAL 열·산·마나 | 기존 동일 계약 없음 | properties.heatLimitC/acidResistance/manaCoupling | 신규 | °C/비율/배수 | 열>0,산[0,1],마나>=0; 표180~3000/.2~.99/.05~2.8 | 재료표 | 역할차·열/산 공격 반응 | 최소최대·비유한 검사; 기능 자동생성 금지 |
| P-RESEARCH 지식 | content/catalog.js RESEARCH.self.work | research.work/workRate/samples/prerequisites | 확장 | 작업초,work/s,수량 | work>0,rate>0,수량양수정수 | 기초10~100,재료20T²,rate1 | 1작업=실험1초; 비용 선행확보 | 유향 선행 무순환+설비/아이템 도달성 |
| P-RESEARCH 발견 진척 | catalog blueprint 문자열만 있음 | blueprintUnlockMode/duplicateWorkFraction/craftedBlueprintDuplicateWork | 신규 | enum/fraction | 즉시해금/[0,1]; 중복.25,자체제작0 | 전 항목 동일 | 탐험 즉시지식; 자체연구 별도 | 자체기록 중복권 제외; 출처·claim 저장 |
| P-RECIPE 비용·산출 | inventory.js RECIPES.cost/give/requires | recipe.inputs/outputs/research/station | 신규 | map ID→수량 | 재료 L는양수,개수는양수정수; 표1~8 | 31가공+전체생산표 | 입력·지식·설비 함께 필요 | 모든ID해결, 생산순환/증식 감시 |
| P-RECIPE 시간·에너지 | 기존 craft 즉시 처리 | recipe.seconds/energy | 신규 | s/EU 총량 | 시간>0,에너지>=0;10~600s/0~36000EU | 제작별 명시 | 시간당소비=총량/시간 | 전력 부족 진척정지/감속·입출력 중복 방지 |
| P-STATION 설비 | 기존 recipe.requires는 unlock 한 개 | station.researchRate; build_* | 신규 | work/s | >0; 기본1 | 27설비1 | 부트스트랩·직전단계 재료 | 자체설비 산출물 선행 금지 |
| P-TOOL 채집도구 | equipment.js GEAR.durability | tool.durabilityActions/capacityLiters | 신규 | 횟수/L | 양의정수/양수;120회/1L | 도구표 | 초기재료 손수집·유체그릇 | starter 없는 재제작 경로 |
| P-COMPONENT 기능 | catalog.COMPONENTS, machine/model.js TYPES | component.functions/inputEnergies/outputEnergies/stores | 확장 | enum/string[] | catalog 기능/6에너지 | 13종 | 복셀과 기능 분리 | 외형으로 포트 증가 금지 |
| P-COMPONENT 정격 | machine/model.js power+=health*600 등 | nominalPower/capacity/efficiency/designEnvelope | 신규 | EU/s,EU,비율,L | 출력·용량>=0,효율(0,1]; scale .25~8 | 표;reference1L | 크기·손상·구조에 성능제한 | 저장량≤실용량; 부서진 연결 출력0 |
| P-COMPONENT 유체/신성 | 기존 동일 계약 없음 | capacityLiters/flowLitersPerSecond/generationPower/consecrationEnergy | 신규 | L,L/s,EU/s,EU | >=0;10/1/.1/20 | 용기·펌프·성물 | 일반용기 마나저장·첫성물순환방지 | 액체에너지 중복계상 금지 |
| P-ENERGY 공급·변환 | 신규일반계약 없음 | energy_source.power/duration/totalEnergy/capacity; conversion.efficiency | 신규 | EU/s,s,EU,비율 | 모두>=0;효율(0,1] | 수동10,연소20×20=400,응집2,성물.1 | 외부공급 명시·순환손실 | 모든 변환 사이클 곱≤1; 소모 선차감 |
| P-ACTIVITY 최초신성 | frontier/campaign.js 의뢰 있으나 동일재화 아님 | activity.inputs/repetitions/outputEnergy/secondsPerRepetition | 신규 | 수량/횟수/EU/s | 양수;3회/20EU/30s | food4+wood2 매회 | 최초성물 전 활동 가능 | 취소/재접속중복금지; 공동체소유와 연계 |
| P-GEAR 비교장구 | frontier/model.js hp100; equipment.js damage/cooldown; inventory armor .35 | gear_baseline.* | 신규 | HP,DPS,s,비율,tier | HP>0,DPS>0,방어[0,1);T1~10 | HP100~380,DPS8~245,방어0~.5,교전.65 | 보스TTK·공격기회 공통측정 | 표일치·DPS재차감금지; 기존캐릭터자동덮어쓰기금지 |
| P-REWARD 보상 | acquisition.js 규칙; inventory.grant/overflow | reward_pool.referenceTier/channels.* | 신규 | T/수량/EU/rolls | T1~10,수량양수,rolls=0 | 8표,신성5T | 빠른확보/독점없음 | 모든보상 자체생산가능·중복claim검사 |
| P-RULE 칼로리 | frontier/model.js hunger100,.055/s,food+35 | calorie_baseline.* | 변경 제안 | game-calorie,HP,s,배수 | 모두>=0;회복효율>0 | 2400/.1/.3/1.5/3/10/2/400 | 기존hunger와 단위 다름 | actualHP 회복만 소비; 저장변환별도 |
| P-RULE 사망 | inventory.js Pickups.life240,경계160 | death_recovery.radiusMeters/expirySeconds | 신규 | m,null | 반경양수;expiry null=영구 | 10,null | 사용자 확정 | 재접속·여러사망·가방포화·부분회수 |
| P-RULE 공통 단위 | 기존 고정0.5m 셀 | energy_units/quantity_contract | 신규 계약 | 수치/단위 | 셀·L·스텝>0;J대응null=미정 | .5m,125L,100EU/L마나,40EU/L산,dt≤.1 | 저장·계산 구분 | 단위오류·이중합산 검사 |

## 7. 구현 전 검증 결과와 남은 일

이 문서 작성 시 수행한 설계 감사는 발견/던전/보스 보상을 제거한 뒤, 손수집→도구→연구→설비→에너지→제작의 고정점을 계산했다. 연구 선행뿐 아니라 **샘플, 설비, 채집도구, 에너지 공급**도 확인한다. 31재료·39연구·27설비·13컴포넌트·10비교장구는 모두 도달하고 모든 보상 아이템에 별도 획득 경로가 있다. 이 감사는 존재성 검사이며 생산시간·자원 총량·운송 부담이 즐겁다는 증명이 아니다.

검증할 시나리오:

1. 초기 지급품과 발견 설계도 없이 가지·돌·섬유로 연구와 첫 가마까지 진행한다.
2. 마나가 없는 상태에서 응집기를 만들고 첫 마나 액체를 생산한다.
3. 성물이 없는 상태에서 반복 보급 기여로 신성을 받아 첫 성물을 만든다.
4. 모든 고티어 설비가 직전 티어의 재료로 구축되고 모든 계열이 타 계열 고티어 독점 재료 없이 성장한다.
5. 에너지 생산기를 끊고 공정을 멈춘 뒤 재접속해도 소비·산출이 복제되지 않는다.
6. 설계도 작성/중복 보상에서 작업권이 무한 증식하지 않는다.
7. 같은 부피의 강철·티타늄·니켈 부품을 비교하여 무게·하중·열·산성의 선택이 남는다.
8. 대표 장구로 같은 티어 보스를 반복 측정해120~160초 목표·회피 가능성을 보스 담당과 확인한다.

아직 미구현: 일반 에너지망, 열용량·방열, 공격 에너지→실제 피해 함수, 재료 기반 장구의 세부 공격별 설계, 비행·무장 컴포넌트, 생산 UI, 신규 아이템 저장·단위 변환, 오프라인 생산 정책. 이 초안만으로 그것들이 완성됐다고 보지 않는다. 현재 inventory의 `iron`(합금), `scrap`(옛 기계 고철), `relic`(유적 핵)을 새 scrap_iron·성물로 이름만으로 변환하지 않는다. 기존 저장은 원본을 보존하고 별도 버전 및 명시적 이전표가 필요하다.


## 8. 원산 형태와 질량수지 보충 계약

분리된 원목·암석을 직접 조립하면 world-form 물성·손상·체적을 유지한다. 명시적인 가공을 거쳐야 MATERIALS의 가공 재료 물성으로 바뀐다. 광맥 원광은 블록 전체 질량이 아니라 채집 과정에서 선별한 원료 부분이다. 그 외 지형 질량은 잔석으로 남는다. 생산 데이터의 `massBalance`는 재사용 산출물과 비회수 가공 분진/증기/슬래그를 구분한다. 프로토타입에서는 잔재를 재사용 가능한 자원으로 지급하지 않으며 후속 잔재 물체도 같은 질량예산을 사용해야 한다. 재료·중간품을 만드는 모든 레시피는 투입 질량 이상을 산출하지 않는다. 도구·장비·컴포넌트·설비는 투입 재료의 합계 질량을 완성품에 기록한다.

| 원료/중간품 ID | kg/단위 |
|---|---|
| `raw_timber` | 0.6 |
| `loose_stone` | 2.6 |
| `plant_fiber` | 0.1 |
| `berry` | 0.1 |
| `herb` | 0.05 |
| `clay` | 1.8 |
| `water` | 1 |
| `sand` | 1.6 |
| `sap` | 1.05 |
| `seed` | 0.1 |
| `acid_sap` | 1.05 |
| `iron_ore` | 4 |
| `titanium_ore` | 3.3 |
| `nickel_ore` | 4.2 |
| `sulfur_deposit` | 2 |
| `mana_crystal_ore` | 2.8 |
| `charcoal` | 0.25 |
| `acid_fluid` | 1.05 |
| `liquid_mana` | 1 |
| `food` | 0.25 |
| `meat` | 0.2 |
| `hide` | 0.2 |
| `chitin` | 0.3 |
| `bone` | 0.4 |
| `acid_gland` | 0.15 |
| `heat_gland` | 0.3 |
| `mana_sap` | 1.05 |

### 드롭·광석의 대체 활용 공정

대체 합성만 있고 사용처가 없는 전리품이 되지 않도록 아래 우회 공정을 제공한다. 원래 공정은 그대로 존재한다. 장구 대체 배합은 동일 역할의 비교장구이고, 임의 복셀 구성에 그 스탯을 무조건 부여한다는 뜻은 아니다. 실제 열저항 등은 재료·형태 평가를 거친다.

| 제작 ID | 투입 | 산출 | 시간s | 에너지EU |
|---|---|---|---|---|
| `ore_mithril` | titanium 2, mana_crystal_ore 1, liquid_mana 1 | mithril 1 | 60 | magic 80, thermal 100 |
| `cook_meat_food` | meat 1, berry 1 | food 1 | 10 | thermal 20 |
| `hide_wood_gear` | wood 6, hide 1 | gear_baseline_t1 1 | 30 | 없음 |
| `chitin_stone_gear` | stone 4, chitin 2, plant_fiber 2 | gear_baseline_t2 1 | 60 | 없음 |
| `bone_stone` | bone 8, sand 1 | stone 1 | 20 | thermal 30 |
| `gland_acid` | acid_gland 8, water 1 | acid_fluid 1 | 15 | mechanical 10 |
| `heat_gland_gear` | steel 6, heat_gland 2 | gear_baseline_t4 1 | 120 | 없음 |
| `sap_mana_wood` | wood 3, mana_sap 2 | mana_wood 1 | 80 | magic 120 |
