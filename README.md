# FERAL

Android에서 오프라인으로 탐험·채굴·제작·생태·전투를 하는 1인칭 복셀 샌드박스 RPG.

- **현재 공개 버전:** 게임 0.17.0 / 1700 · Android 앱 0.3.3 / 303 · [릴리스](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.17.0)
- **지금 되는 것과 한계:** [현황](docs/STATUS.md)
- **구조와 앞으로의 단계:** [소프트웨어 구조](docs/ARCHITECTURE.md) · [로드맵](docs/ROADMAP.md). 0.15.0부터 앱의 첫 화면은 게임 밖 런처이고, 월드 선택·월드 설정·환경 설정·업데이트를 여기서 한다. 0.17.0부터 모든 월드(섬·개척 원정·기계 시험장·콘텐츠 탐험)가 하나의 통합 런타임에서 돈다(엔진 통합 완료). 0.18.0에서 지형 생성을 웹 워커로 옮기고 생물 AI를 거리별로 갱신했다(성능 P2a). 남은 성능 작업은 실기기 수치가 필요한 P2b다.
- **모든 문서와 신뢰 등급:** [문서 안내](docs/README.md)

## 설치와 업데이트

- **앱 0.3.3 사용 중:** 런처의 **업데이트**(0.14.1 이하는 게임 안 **메뉴 → 업데이트**)에서 **지금 확인 → 저장 후 적용**으로 최신 게임을 받는다. 게임 업데이트는 서명·파일 해시를 검증한 뒤 다음 실행에 전체 버전으로 적용한다. 시작에 실패하면 이전 게임과 저장으로 되돌린다.
- **특정 게임 버전 실행:** 앱 상단 **게임 버전**에서 고른다. 0.15.0부터는 어느 버전으로 바꿔도 저장 보관함이 최신 월드와 저장을 되살린다. 단, 0.14.1 이하에서 0.15.0으로 올 때는 목록에서 고르면 빈 저장으로 시작하므로 **지금 확인 → 저장 후 적용**으로 받는다(이미 빈 저장이 됐다면 목록에서 이전 버전을 다시 골라 저장을 되찾은 뒤 지금 확인으로 올린다).
- **처음 설치하거나 앱 0.3.2 이하:** 최신 Release의 `Feral-0.3.3-android.apk`를 기존 앱 위에 설치한다. 앱을 지우거나 데이터를 지울 필요가 없다. Android 8.0 이상, WebGL 2를 지원하는 최신 Android System WebView가 필요하다.
- 공개 업데이트는 같은 저장소의 `updates` 브랜치에서 로그인·토큰 없이 읽는다. 이미 게시한 버전은 바꾸지 않는다. 절차와 복구 범위는 [배포](docs/RELEASING.md).

## 개발

필요한 것: Node.js, Python 3, Java 17 JDK, Android SDK Platform 35와 Build Tools 35.0.0. 브라우저 검증에는 Playwright와 Chromium.

```bash
npm test                                   # 필수 회귀, 약 20초 (tests/*.test.js)
npm run test:long                          # 장기 검사: 10티어 경로 약 7분, 에셋 재생성 (바꾼 영역만)
node tools/verify-ui-reachability.mjs      # 앱과 같은 MIME·CSP 서버에서 실제 터치 경로 검증 (FERAL_CHROME=크롬 경로)
node tools/profile-runtime.mjs             # 장면별 프레임 비용(FERAL.perf). FERAL_ASSETS로 이전 빌드도 같은 기준으로 잰다
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
