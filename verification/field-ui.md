# 탐험 HUD / 가방·제작 UI 초안

미배포 작업 브랜치: `ui/field-hud-inventory`. 네이티브·저장 형식·릴리스 번호 변경 없음.

- `node --test tests/*.test.js`: 43/43 통과.
- `FERAL_CHROME=/usr/bin/chromium node -r /workspace/toolchain/browser-http.cjs tests/progression-check.cjs`: 채굴, 수집, 제작, 건축, 저장 복원 통과. JS/리소스 오류 없음. 로컬 HTTP 서버 사용.
- Playwright 추가 확인: 900×412, 412×900, 360×640에서 가방 가로 넘침 없음. 제작 재료 선택 상세, 가방 전용 화면, 끝 퀵슬롯 선택, 일반 메뉴 복귀 확인.
- `bash build-apk.sh`: APK 빌드 및 서명 검증 통과. 로컬 검증용이며 기존 릴리스 교체에 사용하지 않음.
- 화면 검토: `build/field-hud-landscape.png`, `build/field-hud-portrait.png`, `build/field-bag-900.png`, `build/field-bag-412.png`, `build/field-bag-360.png`.

실제 Android 기기에서 터치감 검증은 별도 필요. 타이틀·월드 목록·기계 조립 UI는 후속 범위.
