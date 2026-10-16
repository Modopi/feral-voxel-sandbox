# FERAL 개발·배포 규칙

- 자동 업데이트 도입 기준 버전은 **0.2.5**이며 현재 버전은 `version.json` 확인. 개인 GitHub `Modopi/feral-voxel-sandbox`의 비공개 상태 유지.
- 배포 정보의 기준은 `version.json`. 게임 변경을 배포할 때 SemVer와 단조 증가하는 `versionCode`를 함께 올리고 `node tools/version.mjs` 실행. 배포한 버전의 파일 교체 금지.
- 게임 HTML/JS/CSS/자산 변경은 호환되는 `minNativeCode`를 유지할 수 있음. Java·권한·업데이트 검증 키 변경은 새 APK가 필요하며 `minNativeCode = versionCode`로 지정.
- `CHANGELOG.md`와 `docs/RELEASING.md`의 릴리스 기록·설치 안내 갱신. 저장 스키마 번호는 앱 버전과 별도 관리.
- `node --test tests/*.test.js`, 관련 브라우저 검증, `bash build-apk.sh` 통과 후 main 반영. main의 버전 증가를 GitHub Actions가 비공개 Release와 updates/stable 채널로 배포.
- 앱·저장소·배포 파일에 개인 GitHub 토큰을 넣지 않음. 앱에서 사용자가 입력한 저장소 한정 읽기 토큰은 Android Keystore로 암호화하여 보관.
- 초기 APK와 OTA는 기존 공유 시험 키를 사용. 이를 production 키라고 표현하지 않음. 키 교체는 별도 네이티브 마이그레이션 필요.
- 업데이트는 전체 버전으로 검증·준비하고 다음 실행에 적용. 시작 성공 판정 전에는 게임 파일과 `feral.*` 저장의 백업 유지. 부분 파일 교체와 플레이 중 자동 재시작 금지.
