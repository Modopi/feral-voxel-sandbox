# 공개 앱 0.3.2 / 게임 0.5.1 검증 — 2026-10-16

앱 0.3.2 / 302, 동봉 게임 0.5.1 / 501, 최소 앱 302, 저장 스키마 2. 기존 0.5.0의 인벤토리·모바일 조작·생태 및 개척 게임을 포함한다.

- `node --test tests/*.test.js`: **70/70 통과**. 공개 전송과 앱/게임 코드 분리, 배포 순서와 실패 시 채널 보존 포함.
- JVM 네이티브 검사 **44개**: 게임 501 실행 확인, 앱 302를 게임 확인 코드로 잘못 사용하면 거부, 구 게임 선택 유지, 오프라인 동봉 게임 복귀와 저장 복원, 최소 앱 호환, 다음 APK 설치. 기존 서명·해시·시작 실패 복구 검사 유지.
- 공개 전송 검사 **15개**: Authorization 없는 다운로드, 공개 카탈로그·불변 빌드 경로, HTTPS·허용 호스트·경로·리다이렉트·크기 제한, 미게시 버전과 요청 제한 오류.
- 배포 검사: 게임 501 / 앱 302를 기존 게임·앱 301 이후 게시하는 흐름, 앱 번호 미증가·최소 앱 불일치 거부, 공개 설치 안내, APK 이름·체크섬, 실험 빌드는 stable을 바꾸지 않는 기존 규칙.
- `FERAL_CHROME=/usr/bin/chromium node -r /workspace/toolchain/browser-http.cjs tests/updates-ui-check.cjs`: 공개 모드에서 토큰 설정 없이 확인·버전 선택·자동 확인 조작, 게임 501 시작 확인, 적용 전 저장, 저장 실패 시 재시작 차단, 웹 미리보기 비활성화. 브라우저 오류 0. Android 브리지는 테스트 대역을 사용했다.
- 실제 공개 저장소 `private: false` 확인. 인증 없이 `updates/catalog.json`과 `stable.feral` 다운로드 성공. 현재 게시된 stable 0.3.1 / 301의 RSA 서명과 ZIP 해시를 앱의 고정 공개 키로 검증했다. 새 게임 0.5.1은 아직 게시하지 않았다.
- `bash build-apk.sh`: APK 생성, v2/v3 서명 및 zipalign 검증 통과. 패키지 `com.kgb.feral`, versionName `0.3.2`, versionCode `302`, 동봉 `assets/game-version.json`은 `0.5.1 / 501`. 기존 0.3.1 테스트 APK와 서명 인증서 일치.
- `python3 tools/build-update.py`: 31개 게임 파일의 서명 패키지 생성. 반복 빌드 바이트 동일성·서명·해시 검사 통과. SHA256SUMS에 네이티브 버전의 APK 포함.

결과 파일:

- `build/Feral-0.3.2-android.apk`
- `build/release/Feral-0.5.1-update.feral`
- `verification/public-update-ui-results-0.3.2.json`
- `verification/public-update-menu-0.3.2.png` (저장 실패 시 적용을 막은 상태)

APK SHA-256: `0068affc18ecd265922f9d054e9463a5bea6211135ed0b0eda7dad9b9d9c5078`

실물 Android 기기에서 설치·WebView 생명주기는 확인하지 못했다. 기존 PR #2에 반영하며 main 병합과 공개 Release 게시는 수행하지 않았다. APK는 기존 앱을 삭제하지 않고 업데이트 설치한다.
