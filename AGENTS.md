# FERAL 개발·배포 규칙

- 자동 업데이트 도입 기준 버전은 **0.2.5**이며 현재 버전은 `version.json` 확인. 개인 GitHub `Modopi/feral-voxel-sandbox`의 비공개 상태 유지.
- 배포 정보의 기준은 `version.json`. 게임 변경을 배포할 때 SemVer와 단조 증가하는 `versionCode`를 함께 올리고 `node tools/version.mjs` 실행. 배포한 버전의 파일 교체 금지.
- 게임 HTML/JS/CSS/자산 변경은 호환되는 `minNativeCode`를 유지할 수 있음. Java·권한·업데이트 검증 키 변경은 새 APK가 필요하며 `minNativeCode = versionCode`로 지정.
- `CHANGELOG.md`와 `docs/RELEASING.md`의 릴리스 기록·설치 안내 갱신. 저장 스키마 번호는 앱 버전과 별도 관리.
- `node --test tests/*.test.js`, 관련 브라우저 검증, `bash build-apk.sh` 통과 후 main 반영. main의 버전 증가를 GitHub Actions가 비공개 Release와 updates/stable 채널로 배포.
- 앱·저장소·배포 파일에 개인 GitHub 토큰을 넣지 않음. 앱에서 사용자가 입력한 저장소 한정 읽기 토큰은 Android Keystore로 암호화하여 보관.
- 초기 APK와 OTA는 기존 공유 시험 키를 사용. 이를 production 키라고 표현하지 않음. 키 교체는 별도 네이티브 마이그레이션 필요.
- 업데이트는 전체 버전으로 검증·준비하고 다음 실행에 적용. 시작 성공 판정 전에는 게임 파일과 `feral.*` 저장의 백업 유지. 부분 파일 교체와 플레이 중 자동 재시작 금지.

## 0.3.1 이후 버전 선택 배포

- 사용자 결정: `main`뿐 아니라 `V_`로 시작하는 브랜치 push도 게임 버전을 게시. 네이티브 앱은 `nativeVersion` / `nativeCode`로 별도 관리하며 0.3.1 / 301에서 유지.
- `V_0.3.2`, `V_vehicle` 모두 지원. Actions가 `1000000 + run_number`를 불변 게임 빌드 번호로 생성. `V_<SemVer>`는 표시 버전도 해당 값으로 지정.
- V_ 빌드는 APK를 배포하거나 stable을 전진시키지 않고 `updates/catalog.json`과 `builds/<빌드번호>.feral`에 추가. main은 stable과 카탈로그 갱신.
- 이미 게시한 빌드의 교체 금지. 같은 브랜치의 다음 push도 새 빌드로 보존. 작업 브랜치는 최신 main의 배포 도구·워크플로에서 분기.
- 구버전은 앱에서 명시 선택할 때만 허용. 최소 네이티브·서명 검증·시작 실패 차단 유지. 선택한 게임은 고정하며 자동 stable 업데이트로 바꾸지 않음.
- 수동 게임 전환은 빌드별 저장 스냅샷 격리. 첫 선택은 빈 저장, 재선택은 해당 빌드의 저장 복원. 앱 설치 자체는 기존 저장 유지.
- 이후 네이티브 Java를 바꾸면 nativeVersion/nativeCode와 minNativeCode를 올린 새 APK 필요. 게임 전용 배포에서 앱 버전을 올리지 않음.
