# FERAL 개발·배포 규칙

- 자동 업데이트 도입 기준 버전은 **0.2.5**이며 현재 버전은 `version.json` 확인. 사용자 결정에 따라 개인 GitHub `Modopi/feral-voxel-sandbox`는 공개 저장소로 운영.
- 배포 정보의 기준은 `version.json`. 게임 변경을 배포할 때 SemVer와 단조 증가하는 `versionCode`를 함께 올리고 `node tools/version.mjs` 실행. 배포한 버전의 파일 교체 금지.
- 게임 HTML/JS/CSS/자산 변경은 호환되는 `minNativeCode`를 유지할 수 있음. Java·권한·업데이트 검증 키 변경은 새 APK가 필요하며 `minNativeCode = nativeCode`로 지정(분리 전 버전은 versionCode 사용).
- `CHANGELOG.md`와 `docs/RELEASING.md`의 릴리스 기록·설치 안내 갱신. 저장 스키마 번호는 앱 버전과 별도 관리.
- `node --test tests/*.test.js`, 관련 브라우저 검증, `bash build-apk.sh` 통과 후 main 반영. main의 버전 증가를 GitHub Actions가 GitHub Release와 updates/stable 채널로 배포.
- 사용자 결정: PR을 만든 뒤 필요한 테스트·빌드와 변경 사항을 확인하고, 실패한 필수 검사·미해결 리뷰 문제·병합 충돌이 없으면 추가 확인 없이 바로 병합한다. 병합 후 릴리스 워크플로와 공개 업데이트 게시 결과까지 확인한다. 문제가 발견되면 먼저 해결하며 필수 검사를 우회하지 않는다.
- 앱·저장소·배포 파일에 개인 GitHub 토큰을 넣지 않음. 0.3.2부터 공개 업데이트는 인증 없이 조회·다운로드하고 기존 암호화 토큰 설정은 제거.
- 초기 APK와 OTA는 기존 공유 시험 키를 사용. 이를 production 키라고 표현하지 않음. 키 교체는 별도 네이티브 마이그레이션 필요.
- 업데이트는 전체 버전으로 검증·준비하고 다음 실행에 적용. 시작 성공 판정 전에는 게임 파일과 `feral.*` 저장의 백업 유지. 부분 파일 교체와 플레이 중 자동 재시작 금지.

## 0.3.1 이후 버전 선택 배포

- 사용자 결정: `main`뿐 아니라 `V_`로 시작하는 브랜치 push도 게임 버전을 게시. 네이티브 앱은 `nativeVersion` / `nativeCode`로 별도 관리하며 현재 값은 version.json 참조(0.3.3 / 303).
- `V_0.3.2`, `V_vehicle` 모두 지원. Actions가 `1000000 + run_number`를 불변 게임 빌드 번호로 생성. `V_<SemVer>`는 표시 버전도 해당 값으로 지정.
- V_ 빌드는 APK를 배포하거나 stable을 전진시키지 않고 `updates/catalog.json`과 `builds/<빌드번호>.feral`에 추가. main은 stable과 카탈로그 갱신.
- 이미 게시한 빌드의 교체 금지. 같은 브랜치의 다음 push도 새 빌드로 보존. 작업 브랜치는 최신 main의 배포 도구·워크플로에서 분기.
- 구버전은 앱에서 명시 선택할 때만 허용. 최소 네이티브·서명 검증·시작 실패 자동 재적용 차단 유지. 명시적 재시도는 전체 검증 후 1회 시작만 허용하며 다시 실패하면 코드와 저장을 복구. 선택한 게임은 고정하며 자동 stable 업데이트로 바꾸지 않음.
- 수동 게임 전환은 빌드별 저장 스냅샷 격리. 첫 선택은 빈 저장, 재선택은 해당 빌드의 저장 복원. 앱 설치 자체는 기존 저장 유지.
- 이후 네이티브 Java를 바꾸면 nativeVersion/nativeCode와 minNativeCode를 올린 새 APK 필요. 게임 전용 배포에서 앱 버전을 올리지 않음.

## 0.3.2 공개 앱

- 공개 저장소는 raw.githubusercontent.com의 updates 브랜치에서 토큰 없이 조회. 서명·파일 해시·네이티브 호환성 검증은 유지.
- 앱 버전과 동봉 게임 버전은 별개. `tools/version.mjs`가 생성하는 `assets/game-version.json`으로 동봉 게임 코드/표시 버전을 읽으며 APK versionCode를 게임 코드로 사용하지 않음.

## 복셀 에셋·엔티티 충돌 규칙

- 형상/모델/충돌 변경 시 `docs/VOXEL-ASSET-RULES.md`를 따른다(사용자 확정).
- 새 복셀 에셋은 반드시 `VoxelAssetBuilder` 또는 이를 공유하는 `generators/shared.mjs` 제작 API로 만든다. 화면 편집은 `design/assets/author.html`을 사용한다. 최종 `parts[].boxes`를 직접 쓰거나 빌드 후보정으로 중복을 숨기지 않는다.
- 기본 추가는 같은 부위의 중복 점유를 즉시 거부한다. 의도적인 변경은 명시적인 교체/빈 공간 채우기/삭제 명령으로 수행한다. 관절 부위의 움직임 여유·피벗은 보존한다.
- 같은 엔티티 인스턴스의 모든 자식 복셀/관절 몸체는 자기 충돌 제외. 다른 엔티티와 외부 고체 지형에는 충돌한다. 종/에셋 ID를 owner ID로 쓰지 않는다.
- 외곽 AABB로 빈 공간을 막는 충돌 대체 금지. 물 등 비고체는 투명도와 별도로 충돌 제외를 명시한다.
- 관련 변경은 `npm run check:assets`와 실제 물리 회귀검사를 통과해야 한다. GitHub의 Voxel asset harness 검사를 유지하고 우회하지 않는다. 원본·GLB·렌더를 함께 갱신하고, 도감 물리 검증을 게임 런타임 전체 통합으로 표현하지 않는다.
