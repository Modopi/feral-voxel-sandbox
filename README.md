# FERAL

Android에서 오프라인으로 탐험·채굴·제작·생태·전투를 하는 1인칭 복셀 샌드박스 RPG.

- **현재 공개 버전:** 게임 0.14.1 / 1401 · Android 앱 0.3.3 / 303 · [릴리스](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.14.1)
- **지금 되는 것과 한계:** [현황](docs/STATUS.md)
- **구조와 앞으로의 단계:** [소프트웨어 구조](docs/ARCHITECTURE.md) · [로드맵](docs/ROADMAP.md). 다음 단계는 게임 밖 런처와 게임 세션의 분리(0.15.0)다.
- **모든 문서와 신뢰 등급:** [문서 안내](docs/README.md)

## 설치와 업데이트

- **앱 0.3.3 사용 중:** **메뉴 → 업데이트 → 지금 확인 → 저장 후 적용**으로 최신 게임을 받는다. 게임 업데이트는 서명·파일 해시를 검증한 뒤 다음 실행에 전체 버전으로 적용한다. 시작에 실패하면 이전 게임과 저장으로 되돌린다.
- **특정 게임 버전 실행:** 앱 상단 **게임 버전**에서 고른다. 직접 고른 버전은 빌드마다 저장을 따로 보관하며, 처음 고른 빌드는 새 저장으로 시작한다.
- **처음 설치하거나 앱 0.3.2 이하:** 최신 Release의 `Feral-0.3.3-android.apk`를 기존 앱 위에 설치한다. 앱을 지우거나 데이터를 지울 필요가 없다. Android 8.0 이상, WebGL 2를 지원하는 최신 Android System WebView가 필요하다.
- 공개 업데이트는 같은 저장소의 `updates` 브랜치에서 로그인·토큰 없이 읽는다. 이미 게시한 버전은 바꾸지 않는다. 절차와 복구 범위는 [배포](docs/RELEASING.md).

## 개발

필요한 것: Node.js, Python 3, Java 17 JDK, Android SDK Platform 35와 Build Tools 35.0.0. 브라우저 검증에는 Playwright와 Chromium.

```bash
npm test                                   # 전체 회귀 (node --test tests/*.test.js)
node tools/verify-ui-reachability.mjs      # 앱과 같은 MIME·CSP 서버에서 실제 터치 경로 검증 (FERAL_CHROME=크롬 경로)
export ANDROID_HOME=/absolute/path/to/Android/sdk
bash build-apk.sh                          # build/Feral-<앱 버전>-android.apk
python3 tools/build-update.py              # build/release/Feral-<게임 버전>-update.feral
```

- 버전은 `version.json`만 고친 뒤 `node tools/version.mjs`를 실행한다. 게임 버전과 앱(네이티브) 버전은 따로 관리한다.
- 브라우저 검증은 일반 개발 서버(`npm run serve`) 대신 `tools/android-asset-server.mjs`를 쓴다. 일반 서버는 Android에서만 생기는 모듈 형식 오류를 숨긴다.
- 콘텐츠 데이터는 `design/content/*.json`이다. 바꾸면 `npm run build:runtime`으로 런타임 카탈로그를 만들고 `npm run check:runtime`·`npm run audit:design`으로 확인한다.
- 복셀 에셋은 제작 SDK와 편집기(`npm run author:assets` → `http://localhost:8081/design/assets/author.html`)로만 만든다. `npm run build:assets` → `npm run render:assets` → `npm run check:assets`. 규칙은 [복셀 에셋 규칙](docs/VOXEL-ASSET-RULES.md).
- main 반영과 배포 규칙은 [AGENTS.md](AGENTS.md)와 [배포](docs/RELEASING.md). main의 버전 증가를 GitHub Actions가 Release와 공개 업데이트로 게시한다.
- `signing/prototype.keystore`는 재빌드용 공유 시험 키이며 정식 운영 키가 아니다.

Three.js r170을 포함한다. MIT 라이선스는 `app/src/main/assets/vendor/THREE-LICENSE.txt`.
