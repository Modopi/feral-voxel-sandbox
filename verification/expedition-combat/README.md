# 실제 전투 통합 검증 — 2026-10-17

실행: `node tools/verify-expedition-combat.mjs`.
기계만 재현: `node tools/verify-expedition-combat.mjs --machine-only`.

브라우저 검증은 실제 `expedition.html`과 vendored Rapier/Three를 Chromium SwiftShader로 실행했다. 준비 저장에서 T8 비교 장구·식량·목재를 지급하고 전투장 앞에 배치한 후, 전투 중에는 키보드/마우스 입력만 사용했다. 상태 조회는 읽기 전용이며 runtime.hit, HP 수정, 전투 중 좌표 변경을 사용하지 않았다. 준비 저장은 `prepared-save.json`, 동작·시각별 읽기 상태는 `browser-report.json`, 입력 로그는 `browser-run.log`에 있다. 이는 자연 성장 도달·T2 적정 장비 밸런스·모바일 성능 검증이 아니다.

최종 브라우저 검사 12개 통과, pageerror 0:

- root_seed 실제 windup 상태 관측 후 D 이동으로 위험 범위에서 벗어나 HP 유지.
- 보스방 서쪽 기믹까지 걸어서 이동, E 조작 후 실제 시뮬레이션 1.2초를 기다려 사용 횟수 감소 확인.
- 실제 모델 약점 위치를 향한 마우스 조준과 공격 버튼으로 HP 1440→0 및 세 페이즈 진행 확인. 일반 타격만으로도 처치 가능하다.
- 보스 공격 15.08 HP 피해, 이후 무피격 자연회복과 칼로리 소모를 관측. 최초 HP275, 피격 뒤259.92, 저장 시273.97; 칼로리2400→2353.585.
- 보상 위치로 걸어서 이동하여 E 수령. 반복 E 입력에서 인벤토리 변화 없음.
- 메뉴 저장 뒤 페이지 재로드에서 HP0 처치 상태, 부위 손상 동일.

별도 기계 통합 fixture는 실제 MachineSystem/Progression/RuntimePhysics/BossSystem을 연결한다. 제작용 재료/연구를 준비한 다음 연결된 열기관·전달장치의 연료 1단위 소모, 실제 Rapier 힘, 보스 cast 피해90→64, 외부 고체벽이 다음 cast를 차폐하는 것, 목재72.222...를 소모한 수리90복구, 저장·재생성 후 질량/pose/피해청구/에너지 원장 보존을 확인했다. `machine-report.json`의 5개 검사 통과. 이 사례는 브라우저 기계 제작 UI나 성장 과정의 증거로 사용하지 않는다.

시각 산출물: `warning.png`, `gimmick.png`, `combat-0.png`, `combat-5.png`, `restored.png`. root_seed의 목표 구체 안에 카메라가 위치하면 구체 경계가 시야 밖에 있고 옅은 황색막으로 보인다. 볼륨/피격과 회피는 검증했으나 이 상황의 예고 가독성 개선 여지가 있다. 사망·요정 회수와 모바일 터치 전투는 이 실행에서 검사하지 않았다.

최신 HP 규칙 회귀: `tests/content-bosses.test.js` 18개, `tests/combat-trace.test.js`와 `tests/expedition-physics.test.js` 합24개, 기존 모드 관련 `legacy-combat/layered-body/structural/simulation/physics-inventory/character-art` 합63개 통과. 기존 모드 수정은 단위·실제 모델 ray 검사이며 기존 모드 브라우저 전투까지 검증했다고 주장하지 않는다.
