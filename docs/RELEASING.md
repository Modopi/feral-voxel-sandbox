# FERAL 배포

공개 배포 저장소는 `Modopi/feral-voxel-sandbox`다. 0.19.0 공개본은 게임 1900 / 앱 0.4.0·400 / 최소 앱 400 / 저장 스키마 5다. 공개 게시 여부는 [검증 기록](../verification/0.19.0.md)을 확인한다. 기존 공개 0.18.2의 설치 정보는 아래 이력에 남긴다.

## 네이티브 앱 설치와 업데이트

0.19.0부터 게임 루프·물리 어댑터·화면은 C++ GDExtension이다. `Feral-0.4.0-android.apk`를 **기존 앱 위에 업데이트 설치**한다. 패키지는 `com.kgb.feral`, 서명은 기존 공유 시험 키다. 앱 삭제·데이터 초기화는 필요하지 않다. 첫 시작에서 기존 WebView 저장 및 IndexedDB 보관함을 읽고 검증한다. 실패한 저장을 초기화하지 않으며 가져오기를 다시 시도할 수 있다.

새 앱의 업데이트 화면은 서명된 공개 메타데이터를 확인하고 APK를 내려받는다. APK 크기·SHA256·패키지·versionCode·설치 앱 및 고정 인증서 서명을 검사한 뒤 사용자가 설치를 누르면 Android 설치 화면으로 넘긴다. 설치 권한은 그때 Android 설정을 통해 부여한다. 다운로드만으로 플레이 도중 앱을 재시작하지 않는다.

C++ 코드 변경에는 새 APK가 필요하다. `.feral`의 `runtime: godot-cpp` 아카이브는 `native-content-snapshot`이며 실행 라이브러리를 포함하지 않는다. 기존 JS 게임처럼 파일만 바꾸어 C++ 코드를 갱신할 수 없다. 네이티브 앱은 예전 WebView의 JS 버전 선택 실행기를 사용하지 않는다. `V_` 브랜치의 APK 미게시 규칙은 유지되며, 해당 네이티브 스냅샷은 자동 설치 가능한 C++ 시험 빌드라고 표시하지 않는다. 네이티브 코드의 동적 다운로드/버전 전환은 현재 기능이 아니다.

## 버전과 키

| 값 | 목적 |
| --- | --- |
| `version` / `versionCode` | 게임 표시 버전 / 단조 증가하는 게임 번호 |
| `nativeVersion` / `nativeCode` | APK 표시 버전 / Android 설치 번호 |
| `minNativeCode` | 이 게임을 실행할 수 있는 최소 앱 |
| `saveSchema` | 게임 저장 호환 경계. 네이티브 파일 봉투의 형식 번호 1과 별개 |

기준은 `version.json`이다. `node tools/version.mjs`로 레거시 호환 메타데이터도 맞춘다. **C++·플러그인·권한 변경은 nativeCode도 올린다.** 게시한 버전의 파일을 덮어쓰지 않는다. 서명 키는 공유 시험 키이며 production 키로 부르지 않는다. 개인 토큰은 APK/저장소/배포 파일에 포함하지 않는다.

## 빌드와 게시 순서

1. `node tools/native/export-content.mjs --check`, `node tools/version.mjs --check`로 원본 데이터와 버전을 확인한다.
2. `npm test`, `npm run check:assets`, 영향받는 장기 검사와 이전 화면 회귀를 수행한다. 이 검사는 네이티브 실행 검사를 대신하지 않는다.
3. `bash build-apk.sh`: 고정한 Godot 4.6.3·godot-cpp·NDK 28.2·Gradle 8.9·전체 JDK 21 환경을 준비하고 Linux x86_64/Android arm64 C++ 라이브러리 및 Android 플러그인을 컴파일한 뒤 APK를 만든다. `FERAL_BUILD_JOBS`는 1~8, 기본 4다.
4. `bash tools/native/test.sh`: C++ 기능 검사, 동적 심볼 노출 검사, 실제 Jolt·전체 게임 시작/타격/저장·화면 진입·나무 세 개 런타임 검사를 수행한다. 실패하면 게시하지 않는다.
5. `python3 tools/build-update.py`로 서명 메타데이터와 콘텐츠 스냅샷을 만든다. stable 메타데이터에는 실제 APK의 해시·크기·인증서가 포함되어야 한다.
6. PR 검사/리뷰/충돌 해결 후 main에 병합한다. Actions가 같은 필수 검사를 통과한 후 Release와 `updates/stable.feral`, 불변 버전 파일 및 카탈로그를 게시한다. 공개 바이트·해시와 Actions 결과까지 확인한다.

빌드 도구와 다운로드 SHA256은 `tools/native/toolchain.lock`, 라이선스는 `native/THIRD_PARTY_NOTICES.md`에 기록한다. 도구 체인은 저장소 밖 캐시에 준비한다. 생성된 `.so`, `.godot`, Android 빌드 디렉터리는 Git에 넣지 않는다.

네이티브 저장은 체크섬을 가진 두 세대로 보호한다. 과거 WebView의 JS 코드 시작 실패 롤백과 Android APK 설치는 서로 다른 메커니즘이다. Android 앱 자동 다운그레이드나 네이티브 저장의 JS 역변환을 제공한다고 표현하지 않는다. 실기기 설치·터치·프로세스 종료 복귀·발열/FPS 검증 여부는 배포마다 구분해 기록한다.

## 릴리스 기록

### 0.19.0 — C++ 네이티브 실행과 두 행동 트랙

2026-11-08 09:52 UTC [v0.19.0 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.19.0) 게시. [PR #54](https://github.com/Modopi/feral-voxel-sandbox/pull/54)의 전체 전환과 [PR #55](https://github.com/Modopi/feral-voxel-sandbox/pull/55)의 새 환경 다운로드 보완을 반영한 커밋 `2d711bc`의 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/42467427202)가 성공했다.

게임 1900 / 앱·최소 앱 400 / 저장 스키마 5. [Feral-0.4.0-android.apk](https://github.com/Modopi/feral-voxel-sandbox/releases/download/v0.19.0/Feral-0.4.0-android.apk)를 기존 앱 위에 설치한다. 공개 APK는 87,013,485바이트, SHA256 `22e7abfd8edfed25bb0ce7d29cfc97b108c96e14d6ffd3e8a5552452e2a7489a`이며 이전 공유 시험 키의 인증서와 일치한다. 공개 `.feral`·stable·버전별 패키지는 바이트 단위로 같고 메타데이터 서명·APK 해시·카탈로그를 확인했다. 실기기 설치·FPS·발열은 아직 확인하지 않았다. 상세 결과는 [검증 기록](../verification/0.19.0.md)에 있다.

### 0.18.2 — 콘텐츠 탐험의 낙하 파편 렉 수정

2026-11-07 18:43 UTC [v0.18.2 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.18.2) 게시. [PR #51](https://github.com/Modopi/feral-voxel-sandbox/pull/51), 병합 커밋 `4c1bb18`의 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/42402615473)와 복셀 제작 검사가 성공했다.

게임 1820 / 앱·최소 앱 303 / 저장 스키마 4. 비충돌 잎 파편을 따라 지하 충돌체를 계속 생성하던 경로를 막고, 비고체 파편의 물리 활성 범위를 3차원 64 m로 정했다. 고체 물체의 활성 범위는 기존대로다. 물체와 저장은 유지한다. 앱 0.3.3에서는 런처의 **업데이트 → 지금 확인 → 저장 후 적용**으로 받는다. 네이티브 코드 변경이 없는 게임 전용 패치다. 게시 결과와 검증은 [0.18.2 검증](../verification/0.18.2.md).

### 0.18.1 — 쓰러진 나무를 깎을 때의 렉 수정 (P2a 보충)

게임 1810 / 앱·최소 앱 303 / 저장 스키마 4(그대로). Java·권한·키 변경이 없는 게임 전용 릴리스다. 0.18.0 신고(나무 세 그루를 베어 부수면 플레이 불가)에 대해 칸을 깬 뒤의 받침 탐색, 덩어리 충돌체, 덩어리 화면 갱신, 공용 SDK의 표면 계산을 칸이 바뀐 곳에만 비용이 들도록 고쳤다. 표면 계산 결과는 바이트 단위로 같다(모든 모델 GLB 재생성 확인). 업데이트 파일은 104개 그대로다.

2026-10-18 16:42 UTC [PR #49](https://github.com/Modopi/feral-voxel-sandbox/pull/49) 병합 커밋 `9ead705`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39146228328)가 성공해 16:43 UTC에 [v0.18.1 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.18.1)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.18.1.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `62dca024…56cf6b9db`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `f6a7b58a…`가 카탈로그와 일치한다. 카탈로그는 34개 항목이며 0.18.0(`7e7dc063…`) 항목은 그대로다. Release의 APK(`ec261759…9a569c5c02`)는 CI가 다시 빌드한 것이다. Android 실기기 확인은 아직 하지 않았다.

### 0.18.0 — 성능 다음 단계: 지형 워커와 생물 AI 거리별 갱신 (P2a)

게임 1800 / 앱·최소 앱 303 / 저장 스키마 4(그대로). Java·권한·키 변경이 없는 게임 전용 릴리스다. 지형 생성이 웹 워커 `content-runtime/terrain-worker.js`로 옮겨 가 첫 채움(원하는 청크 96개를 만들고 메시까지 그림)이 콘텐츠 탐험 36~48초에서 약 4초, 섬 약 18초에서 4~5초, 개척 원정 15~23초에서 3.5~4초가 됐다(SwiftShader). 생물 AI는 거리별로 갱신한다(사용자 결정). 워커는 같은 출처의 모듈 워커라 앱 0.3.3의 CSP(`script-src 'self'`)에서 그대로 돈다. 업데이트 파일은 104개다.

2026-10-18 15:36 UTC [PR #47](https://github.com/Modopi/feral-voxel-sandbox/pull/47) 병합 커밋 `6138341`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39141252963)가 성공해 15:37 UTC에 [v0.18.0 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.18.0)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.18.0.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `c1fcf535…c1182c5`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `7e7dc063…`가 카탈로그와 일치한다. 카탈로그는 33개 항목이며 0.17.0(`412755b6…`) 항목은 그대로다. Release의 APK(`38d1866b…e5be4a5c`)는 CI가 다시 빌드한 것이다. Android 실기기 확인은 아직 하지 않았다.

### 0.17.0 — 기계 시험장을 통합 런타임으로, 엔진 통합 완료 (통합 S3)

게임 1700 / 앱·최소 앱 303 / 저장 스키마 4. Java·권한·키 변경이 없는 게임 전용 릴리스다. 기계 시험장 프리셋이 통합 런타임에서 돌아 게임 세션의 엔진이 하나가 됐다(세션 라우터의 엔진 분기 제거). 바퀴 기계가 서스펜션·견인·조향 힘으로 실제로 달린다. 기존 기계 시험장 저장(`feral.machine.v1`)은 처음 열 때 한 번 옮긴다(원본 키는 그대로). 기계 시험장 월드의 저장이 통합 런타임 형식(`.a`/`.b`)이 되어 이전 빌드가 그 진행을 읽지 못하므로 저장 스키마를 4로 올렸다. 옛 기계 시험장 페이지와 옛 가방·생태 코드를 지워 업데이트 파일이 112개에서 103개가 됐다. 검증은 [검증 기록](../verification/0.17.0.md).

2026-10-18 14:23 UTC [PR #45](https://github.com/Modopi/feral-voxel-sandbox/pull/45) 병합 커밋 `08bda0f`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39135745032)가 성공해 14:24 UTC에 [v0.17.0 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.17.0)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.17.0.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `7efd2a84…3efa7230`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `412755b6…`가 카탈로그와 일치한다. 카탈로그는 32개 항목이며 0.16.0(`3e39cdd0…`) 항목은 그대로다. Release의 APK(`1c2f57d5…b12362fe`)는 CI가 다시 빌드한 것이다. Android 실기기 확인은 아직 하지 않았다.

### 0.16.0 — 개척 원정을 통합 런타임으로 (통합 S2d)

게임 1600 / 앱·최소 앱 303 / 저장 스키마 3. Java·권한·키 변경이 없는 게임 전용 릴리스다. 개척 원정(첫 신호) 프리셋이 통합 런타임에서 돌고, 기존 개척 원정 저장은 처음 열 때 한 번 옮긴다(원본 키는 그대로). 개척 원정 월드의 저장이 통합 런타임 형식(`.a`/`.b`)이 되어 이전 빌드가 그 진행을 읽지 못하므로 저장 스키마를 3으로 올렸다: 더 낮은 스키마의 빌드는 저장 보관함 사본을 가져오지도 덮지도 않는다. 이전 빌드로 돌아가 개척 원정을 열면 변환 전 원본에서 이어진다. 옛 개척 원정 엔진 파일을 지워 업데이트 파일이 124개에서 112개가 됐다. `main.js`는 앱 0.3.3의 업데이트 검사 때문에 빈 모듈로 남는다. 검증은 [검증 기록](../verification/0.16.0.md).

2026-10-18 13:07 UTC [PR #43](https://github.com/Modopi/feral-voxel-sandbox/pull/43) 병합 커밋 `e5751b5`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39130158761)가 성공해 13:08 UTC에 [v0.16.0 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.16.0)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.16.0.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `aac042d6…7644fecb`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `3e39cdd0…`가 카탈로그와 일치한다. 카탈로그는 31개 항목이며 0.15.8(`c2794c13…`) 항목은 그대로다. Release의 APK(`204fa38c…ab829f7`)는 CI가 다시 빌드한 것이다. Android 실기기 확인은 아직 하지 않았다.

### 0.15.8 — 충돌 파손 (통합 S2c4)

게임 1508 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키·저장 형식 변경이 없는 게임 전용 릴리스다. 빠르게 움직이는 지형 물체·기계가 지형 칸·다른 물체·기계 복셀을 개척 원정 규칙으로 부순다(부서진 지형 칸은 한 칸짜리 물체가 된다). 판정은 몸무게 5배를 넘는 접촉 힘 이벤트만 본다. 복셀 제작 SDK의 겹침 검사를 칸 수의 제곱에서 정렬 기반으로 바꿔, 큰 덩어리가 나뉠 때의 멈춤을 줄였다(548칸 모델 짓기 약 100 ms → 약 4 ms, 4096칸 2.9초 → 약 50 ms). 검증은 [검증 기록](../verification/0.15.8.md).

2026-10-18 11:58 UTC [PR #41](https://github.com/Modopi/feral-voxel-sandbox/pull/41) 병합 커밋 `27bd8bf`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39125372680)가 성공해 11:59 UTC에 [v0.15.8 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.15.8)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.15.8.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `f993b640…9c4d09`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `c2794c13…`가 카탈로그와 일치한다. 카탈로그는 30개 항목이며 0.15.7(`b6c2e916…`) 항목은 그대로다. 같은 커밋의 에셋 재생성·복셀 제작 검사도 성공했다. Release의 APK(`152681e0…ceb42`)는 CI가 다시 빌드한 것이다. Android 실기기 확인은 아직 하지 않았다.

### 0.15.7 — 개척 원정 도구: 조립 렌치·운반 집게·블록 붙이기 (통합 S2c3)

게임 1507 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키 변경이 없는 게임 전용 릴리스다. 제작 데이터에 도구 2개(조립 렌치·운반 집게)와 그 모델을 더하고, 물체·기계 고정, 강한 잡기, 물체에 블록 붙이기를 통합 런타임에 옮겼다. 고정 여부와 붙인 칸은 저장에 남고, 이전 빌드는 고정 여부를 읽지 않는다. 검증은 [검증 기록](../verification/0.15.7.md).

2026-10-18 11:19 UTC [PR #39](https://github.com/Modopi/feral-voxel-sandbox/pull/39) 병합 커밋 `13f63c9`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39122753329)가 성공해 11:20 UTC에 [v0.15.7 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.15.7)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.15.7.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `0c901133…b38c97`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `b6c2e916…`가 카탈로그와 일치한다. 카탈로그는 29개 항목이며 0.15.6(`62ad704d…`) 항목은 그대로다. 같은 커밋의 에셋 재생성·10티어 경로 검사도 성공했다. Release의 APK(`5135fb32…59d8`)는 CI가 다시 빌드한 것이다. Android 실기기 확인은 아직 하지 않았다.

### 0.15.6 — 로터 비행과 개척 원정식 물체 잡기 (통합 S2c2)

게임 1506 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키·저장 형식 변경이 없는 게임 전용 릴리스다. 로터가 조종 중 상승·고도 유지·하강·전진을 하도록 바꿔 기계가 날 수 있게 했고, 기계에서 내릴 때 옆 땅에 내린다. 물체 잡기·던지기·운반 무게는 개척 원정 규칙이다(잡는 힘 최대 3500 N, 던지기 min(5, 1100÷질량) m/s). 검증은 [검증 기록](../verification/0.15.6.md).

2026-10-18 10:46 UTC [PR #37](https://github.com/Modopi/feral-voxel-sandbox/pull/37) 병합 커밋 `23230b7`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39120554408)가 성공해 10:47 UTC에 [v0.15.6 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.15.6)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.15.6.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `1bc47408…206df2`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `62ad704d…`가 카탈로그와 일치한다. 카탈로그는 28개 항목이며 0.15.5(`134a4081…`) 항목은 그대로다. Release의 APK(`57f41a3a…8e1f`)는 CI가 다시 빌드한 것이다. Android 실기기 확인은 아직 하지 않았다.

### 0.15.5 — 충격·낙하 피해 (통합 S2c1)

게임 1505 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키·저장 형식 변경이 없는 게임 전용 릴리스다. 개척 원정의 충격 규칙을 통합 런타임에 옮겨, 생존이 켜진 월드에서 낙하(8 m/s 초과)와 4 m/s보다 빠르게 닿은 지형 물체·기계에 피해를 받고, 던진 물체가 생명체에 피해를 준다. 생존을 끈 월드는 그대로다. 검증은 [검증 기록](../verification/0.15.5.md).

2026-10-18 10:27 UTC [PR #35](https://github.com/Modopi/feral-voxel-sandbox/pull/35) 병합 커밋 `32c8ca4`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39119303278)가 성공해 10:28 UTC에 [v0.15.5 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.15.5)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.15.5.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `10801486…3a643a`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `134a4081…`가 카탈로그와 일치한다. 카탈로그는 27개 항목이며 0.15.4(`5c29f550…`) 항목은 그대로다. Release의 APK(`fb8a833c…db31`)는 CI가 다시 빌드한 것이다. Android 실기기 확인은 아직 하지 않았다.

### 0.15.4 — 첫 신호 캠페인을 통합 런타임 모듈로 (통합 S2b)

게임 1504 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키·플레이 규칙 변경이 없는 게임 전용 릴리스다. 통합 런타임에 월드 설정 `modules`로 켜는 모듈 구조와 첫 신호 캠페인 모듈(`first-signal`)을 더했다. 개척 원정 프리셋은 아직 옛 엔진이라 사용자가 플레이하는 월드는 그대로다. 런타임 저장에 `modules` 항목이 생기며 이전 빌드는 이 항목을 읽지 않는다. 옛 개척 원정의 `frontier/encounters.js`를 `content.js`에 합쳐 업데이트 파일은 124개 그대로다. 검증은 [검증 기록](../verification/0.15.4.md).

2026-10-18 10:10 UTC [PR #33](https://github.com/Modopi/feral-voxel-sandbox/pull/33) 병합 커밋 `d889a5d`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39118188420)가 성공해 10:11 UTC에 [v0.15.4 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.15.4)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.15.4.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `b41c8d48…e2e933`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `5c29f550…`가 카탈로그와 일치한다. 카탈로그는 26개 항목이며 0.15.3(`c39b9054…`) 항목은 그대로다. Release의 APK(`e6625a60…140e`)는 CI가 다시 빌드한 것이다. Android 실기기 확인은 아직 하지 않았다.

### 0.15.3 — 개척 지역 지형과 사망 규칙 설정 (통합 S2a)

게임 1503 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키 변경이 없는 게임 전용 릴리스다. 월드 설정 "사망 시 소지품 남김"(콘텐츠 탐험·기본 섬 기본 켬, 지금과 같음)을 더했다. 이 항목이 없는 0.15.2 이하 월드는 기본값으로 읽고, 이전 빌드는 이 항목을 읽지 않아 설정 형식은 1 그대로다. 통합 런타임에 개척 원정 지역 섬들의 지형 생성기(`frontier`)를 등록했으나 개척 원정 프리셋은 아직 옛 엔진이다. 검증은 [검증 기록](../verification/0.15.3.md).

2026-10-18 09:38 UTC [PR #31](https://github.com/Modopi/feral-voxel-sandbox/pull/31) 병합 커밋 `68c0ac5`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39116105296)가 성공해 09:39 UTC에 [v0.15.3 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.15.3)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.15.3.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `1f7e5b3a…623620`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `c39b9054…`가 카탈로그와 일치한다. 카탈로그는 25개 항목이며 0.15.2(`290e0461…`) 항목은 그대로다. Release의 APK(`1f28b782…5ac7`)는 CI가 다시 빌드한 것이다. Android 실기기 확인은 아직 하지 않았다.

### 0.15.2 — 세션 입구 정리: 월드 설정으로 시작 (통합 S1)

게임 1502 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키·게임 규칙 변경이 없는 게임 전용 릴리스다. 통합 런타임이 맵 이름 대신 월드 설정(지형 생성기 이름과 규칙)으로 시작하고, 세션 코드의 맵 이름 비교를 없앴다(`tests/launcher.test.js`가 확인). 콘텐츠 탐험 월드의 프리셋에 샌드박스 설정(기본 끔)이 더해졌다. 새 저장은 지형 생성기 이름(`terrain`)을 남기고 이전 저장의 `map`도 읽는다. 0.15.1 이하 빌드는 월드 목록의 프리셋으로 지형을 고르므로 새 저장을 그대로 연다. 검증은 [검증 기록](../verification/0.15.2.md).

2026-10-18 08:51 UTC [PR #29](https://github.com/Modopi/feral-voxel-sandbox/pull/29) 병합 커밋 `a2a573d`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39113058052)가 성공해 08:52 UTC에 [v0.15.2 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.15.2)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.15.2.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `9eb54f1e…68d182`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `290e0461…`가 카탈로그와 일치한다. 카탈로그는 24개 항목이며 0.15.1(`7346f69b…`) 항목은 그대로다. Release의 APK(`e9fdd3b1…d202`)는 CI가 다시 빌드한 것이다. Android 실기기 확인은 아직 하지 않았다.

### 0.15.1 — 성능 구조: 바뀐 곳만 다시 만들기

게임 1501 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키·규칙·저장 형식 변경이 없는 게임 전용 릴리스다. 사용자가 신고한 "나무 한 그루를 캐다 플레이할 수 없을 만큼 느려짐"을 구조로 고쳤다(`docs/ARCHITECTURE.md` 7장). 지형 세계가 바뀐 4m 구역을 기록해 지형 충돌체·물 메시가 그 구역만 다시 만들고, 고정 단계는 프레임당 최대 3번, 배경 작업은 남은 시간 안에서만, 생물 AI는 5개 조로 나눠 처리한다. 0.15.0과 같은 측정 도구(`tools/profile-runtime.mjs`)로 비교한 수치는 `verification/0.15.1-perf.json`과 [검증 기록](../verification/0.15.1.md)에 있다. 업데이트 파일은 124개로 앱 상한 128개까지 여유가 4개뿐이라, 다음에 파일을 더하는 버전은 은퇴 파일을 함께 정리해야 한다.

2026-10-18 08:23 UTC [PR #27](https://github.com/Modopi/feral-voxel-sandbox/pull/27) 병합 커밋 `705b1b1`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39111266268)가 성공해 08:24 UTC에 [v0.15.1 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.15.1)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.15.1.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `8edc56ed…b5afb6`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `7346f69b…88fe2`가 카탈로그와 일치한다. 카탈로그는 23개 항목이며 0.15.0(`808e09b9…`)·0.14.1(`25648ce6…`) 항목의 아카이브 SHA256은 그대로다. Release의 APK(`7ea5d09c…cc9e`)는 CI가 다시 빌드한 것이다. Android 실기기 확인은 아직 하지 않았다. 
### 0.15.0 — 런처와 게임 세션 분리

게임 1500 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키 변경이 없는 게임 전용 릴리스다. 앱의 첫 화면이 게임 밖 런처(`index.html`)가 되고 게임 세션은 `play.html?world=<id>`로 시작한다. 월드 목록 항목에 월드 설정(`config`, `configVersion` 1)과 마지막 플레이 시각(`lastPlayedAt`)을 선택 필드로 더했다. `id·name·type·seed`는 그대로라 이전 게임 빌드도 같은 목록을 읽는다. 월드 저장 키와 형식은 바뀌지 않는다. 앱에 보내는 시작 성공 신호는 런처가 보낸다. 게임 세션 파일을 실행하지 않고 불러 본 뒤에 보내므로 세션 파일이 깨진 버전은 시작 실패로 되돌려진다. 버전이 바뀌어도 저장이 유지되도록 저장 보관함(IndexedDB `feral-vault`)을 더했다. 저장할 때마다 모든 `feral.*` 키의 최신 사본을 보관하고, 런처가 시작할 때 이 빌드의 저장이 비었거나 오래됐으면 사본 전체로 되살린다. 더 높은 `saveSchema`의 사본은 낮은 스키마 빌드가 가져오거나 덮지 않는다. 0.14.1 이하에서 버전 목록으로 0.15.0을 고르면 그때는 보관함이 비어 빈 저장으로 시작하므로, 이번 업데이트는 "지금 확인 → 저장 후 적용"으로 받는다. 구조는 `docs/ARCHITECTURE.md`, 검증은 `verification/0.15.0.md`. 업데이트 파일은 123개(앱 상한 128개)다.

2026-10-18 06:57 UTC [PR #25](https://github.com/Modopi/feral-voxel-sandbox/pull/25) 병합 커밋 `50da8fc`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39105861039)가 성공해 07:03 UTC에 [v0.15.0 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.15.0)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.15.0.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `c45e5e4d…fad8`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `808e09b9…9a14`가 카탈로그와 일치한다. 0.14.1 이하의 카탈로그 항목과 패키지 파일은 바뀌지 않았다. Android 실기기 확인은 아직 하지 않았다.

### 0.14.1 — 도구·무기별 자동 타격 방식

게임 1401 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키 변경이 없는 게임 전용 릴리스다. 사용자 결정에 따라 공격 방식을 손으로 고르지 않고, 든 도구·장착한 무기가 타격 모양을 정한다. 맨손·도구는 시선이 닿은 곳을 파내는 점타격(외피 공작), 검은 맞은 면을 가로지르는 선·면 절단, 창은 공격 방향과 나란한 30~60 cm 관통선(외피와 선이 지나는 뼈), 둔기는 외피를 열지 않고 한 칸(0.5 m) 안쪽의 뼈만 친다. 저장 형식은 바뀌지 않으며 이전 저장의 수동 공격 방식 값은 무시한다. 상태 페이지의 방식 바꾸기 버튼을 없애고 능력치에 지금의 타격 방식을 표시한다. 검증은 `verification/0.14.1.md`. 업데이트 파일은 123개(앱 상한 128개)다.

2026-10-18 05:19 UTC [PR #23](https://github.com/Modopi/feral-voxel-sandbox/pull/23) 병합 커밋 `3a7f871`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39100161914)가 성공해 05:27 UTC에 [v0.14.1 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.14.1)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.14.1.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `24ace31f…e990`)이며 로컬 빌드와 바이트 단위로 같고, 내부 아카이브 SHA256 `25648ce6…f24d`가 카탈로그와 일치한다. 0.14.0 이하의 카탈로그 항목과 패키지 파일은 바뀌지 않았다. Android 실기기 확인은 아직 하지 않았다.

### 0.14.0 — 개척 원정 감각과 기본 섬 이식 (통합 2단계)

게임 1400 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키 변경이 없는 게임 전용 릴리스다. 통합 런타임이 개척 원정의 감각(즉시 채집·개척 원정 채굴 공식·분리된 덩어리 깎기·생명체 외피와 골격)과 화면(공용 상태·지도 페이지, 1인칭 손)을 따르고, 기본 섬이 같은 런타임에서 돈다. 콘텐츠 탐험 저장의 지형 상처는 남은 HP 대신 캔 비율로 저장하며 이전 저장은 읽을 때 바꾼다. 생명체 상처(`wounds`)는 선택 필드로 추가했다. 기존 섬 저장(`feral.world.v1`, `feral.slot.<id>`)은 처음 열 때 콘텐츠 런타임 형식(`<키>.a/.b`)으로 한 번 변환하고, 원본 키는 그대로 둔다. 이전 게임 버전을 직접 선택하면 앱의 빌드별 저장 분리에 따라 그 빌드에서 마지막으로 쓰던 저장(업데이트 직전 상태)이 복원되고, 한 번도 실행하지 않은 빌드는 새 저장으로 시작한다. 0.14.0에서 진행한 내용은 0.14.0의 새 형식에만 남는다. 변환 규칙과 대응표는 `docs/archive/UNIFIED-GAME.md`의 저장 변환 규칙, 검증은 `verification/0.14.0.md`. 업데이트 파일은 123개(앱 상한 128개)다.

2026-10-18 04:54 UTC [PR #22](https://github.com/Modopi/feral-voxel-sandbox/pull/22) 병합 커밋 `1c5b759`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39098717171)가 성공해 04:58 UTC에 [v0.14.0 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.14.0)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.14.0.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `f7ee4d77…e8b3`)이며 로컬 빌드와 일치하고, 내부 아카이브 SHA256 `85db75d6…3faa`가 카탈로그와 일치한다. 0.13.0 이하의 카탈로그 항목과 패키지 파일은 바뀌지 않았다. Android 실기기에서의 섬 저장 변환 확인은 아직 하지 않았다.

### 0.13.0 — 하나의 게임 화면 (통합 1단계)

게임 1300 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키 변경이 없는 게임 전용 릴리스다. 모든 월드(기계 시험장 제외)가 `index.html` 한 화면과 공용 `shell.js`를 쓰고, 콘텐츠 탐험은 기존 HUD·핫바·36칸 가방·장부 창·메뉴·설정·UI 편집기로 옮겼다. 콘텐츠 탐험 저장에는 가방 칸 배치(`itemSlots`)를 선택 필드로 추가하며 이전 저장도 그대로 읽는다. 예전 `expedition.html` 주소와 월드 목록은 `index.html`로 연결한다. 기준과 남은 단계는 `docs/archive/UNIFIED-GAME.md`, 검증은 `verification/0.13.0.md`.

2026-10-18 02:35 UTC [PR #21](https://github.com/Modopi/feral-voxel-sandbox/pull/21) 병합 커밋 `984c586`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39090651659)가 성공해 02:44 UTC에 [v0.13.0 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.13.0)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.13.0.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `11aba7f2…1546`)이며 로컬 빌드와 일치하고, 내부 아카이브 SHA256 `3869ee54…fcf8`이 카탈로그와 일치한다. 0.12.1 이하의 카탈로그 항목과 패키지 파일은 바뀌지 않았다.

### 0.12.1 — Android 콘텐츠 탐험 로딩 수정

게임 1201 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키 변경이 없는 게임 전용 핫픽스다. 앱의 자산 응답(`MainActivity.shouldInterceptRequest`)은 `.js`·`.css`·`.html`·`.json`만 해당 형식으로, 나머지를 `application/octet-stream`으로 보낸다. 0.11.0부터 콘텐츠 탐험이 `.mjs` 모듈을 불러와 브라우저가 모듈 전체를 거부했고, 오류 표시 없이 로딩 화면에 멈췄다. 해당 모듈을 `.js`로 바꿔 앱 재설치 없이 고쳤다. 로딩 화면은 단계별 진행도를 보여 주고, 모듈을 불러오지 못하면 실패를 안내하며 앱에 시작 실패를 알린다.

2026-10-18 00:53 UTC [PR #20](https://github.com/Modopi/feral-voxel-sandbox/pull/20) 병합 커밋 `6c0824b`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39084468288)가 성공해 01:02 UTC에 [v0.12.1 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.12.1)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.12.1.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `2df63eda…5e72`)이고 내부 아카이브 SHA256 `9af9f739…ac85`가 카탈로그와 로컬 빌드에 일치한다. 0.12.0 이하의 카탈로그 항목과 패키지 파일은 바뀌지 않았다. 검증은 `verification/0.12.1.md`. Android 실기기에서의 시작 확인은 아직 하지 않았다.

### 0.12.0 — 구현된 기능의 화면 연결

게임 1200 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키 변경이 없는 게임 전용 릴리스다. 이미 구현된 기능을 화면·터치 입력·알림에 연결했다. 콘텐츠 탐험 저장에는 연구 일시정지와 제작 취소가 기존 필드만으로 기록된다. 던전 구조 부품 복구 횟수(`restorations`)는 선택 필드로 추가하며 이전 저장도 그대로 읽는다. 기본 섬의 미니맵·사건 알림 설정은 기존 `feral.settings`의 선택 필드다.

2026-10-17 18:51 UTC [PR #18](https://github.com/Modopi/feral-voxel-sandbox/pull/18) 병합 커밋 `dd7b800`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39059274447)가 성공해 [v0.12.0 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.12.0)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.12.0.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `8c9a94e3…5981`)이고 내부 아카이브 SHA256 `f7e55691…3e34`가 카탈로그와 일치한다. 0.11.0 이하의 카탈로그 항목과 패키지 파일은 바뀌지 않았다. 변경 목록은 `docs/archive/UI-REACHABILITY.md`, 검증은 `verification/0.12.0.md`. Android 실기기 성능·생명주기 검증은 아직 미완료다.

### 0.11.0 — 콘텐츠 탐험 통합

게임 1100 / 앱·최소 앱 303 / 저장 스키마 2. Java·권한·키 변경이 없는 게임 전용 릴리스다. 새 콘텐츠는 새 `expedition` 월드 유형으로 실행하며 기존 월드·저장 키를 재작성하지 않는다. 콘텐츠 저장은 자체 schema 1이며 무압축 저장을 읽고 압축된 두 세대로 보존한다. 게임 자동 저장은 별도 작업 스레드에서 압축하며 수동 저장·버전 전환 요청은 완료 확인 후 진행한다.

2026-10-17 17:13 UTC [PR #16](https://github.com/Modopi/feral-voxel-sandbox/pull/16) 병합 커밋 `9740e38`에서 [배포 Actions](https://github.com/Modopi/feral-voxel-sandbox/actions/runs/39052235767)가 성공해 [v0.11.0 Release](https://github.com/Modopi/feral-voxel-sandbox/releases/tag/v0.11.0)와 기존 공식 `updates/catalog.json`, `updates/stable.feral`, 불변 `updates/versions/0.11.0.feral`로 게시됐다. stable과 버전 패키지는 같은 파일(SHA256 `c8606cca…3abd`)이고 내부 아카이브 SHA256 `f285230b…7c3a`가 카탈로그와 일치한다. 0.10.1 이하의 카탈로그 항목과 패키지 파일은 바뀌지 않았다. 새 네이티브 버전 설치는 필요 없다. 휴대폰에서의 업데이트 적용과 Android 실기기 성능·생명주기 검증은 아직 미완료다.

| 버전 | 구분 | 주요 내용 |
| --- | --- | --- |
| 0.1.0 | 초기 APK | 복셀 탐험·생태·파괴·유체 반응 |
| 0.2.0 | APK | 접지 안정화·1.5m 캐릭터·반 칸 채굴·가방·제작·드롭 |
| 0.2.5 | 최초 업데이트 대응 APK | 비공개 GitHub 자동 업데이트·서명 검증·시작 실패 복구·버전 배포 자동화 |

## 0.3.0 기계 베타 빌드

게임 버전 0.3.0 / versionCode 300 / minNativeCode 205 / saveSchema 2. 기존 서명과 네이티브 코드를 유지한다. 0.2.5 APK에서 게임 업데이트로 실행 가능하다. 신규 설치는 Feral-0.3.0-android.apk 사용. 기계 베타는 맵 유형이며 배포 채널은 stable이다.

타이틀 → 내 월드에서 기본 탐험 맵·기계 베타 맵 선택. 기존 `feral.world.v1`은 기본 맵에 직접 연결하며 일괄 저장 변환 없음. 추가 월드의 `feral.slot.*`, 목록 `feral.worlds.v1`, 기계 기본 저장 `feral.machine.v1`도 업데이트 시작 전 `feral.*` 백업 대상이다. 기계 상태는 별도 schema 1을 사용한다.

로컬 빌드와 검증은 GitHub 게시와 별개다. 원격 게시 성공이 확인되기 전에는 stable 채널이 갱신되었다고 간주하지 않는다.

## 0.3.1 — 앱 고정과 V_ 게임 빌드 선택

0.3.1 APK(versionCode/nativeCode 301)를 한 번 업데이트 설치한다. 게임 코드만으로는 네이티브 버전 선택 기능을 추가할 수 없으므로 이 최초 설치가 필요하다. 그다음 게임 테스트에는 APK 재설치가 필요 없다.

- 앱 상단 **게임 버전** 버튼은 네이티브 실행기에 있으며 0.2.5 게임으로 전환해도 계속 사용할 수 있다. 게임 메뉴 → 업데이트에도 선택 버튼이 있다.
- GitHub 읽기 연결 후 버전 목록에서 선택하고 **저장 후 전환**. 게임은 재시작하고 앱 자체는 0.3.1 유지. 최소 앱 버전이 더 높은 항목은 선택할 수 없다.
- 동봉 0.3.1은 오프라인에서도 선택 가능. 다른 버전 목록은 마지막 조회를 캐시하지만 패키지 다운로드에는 연결이 필요할 수 있다.
- 수동 선택한 게임은 고정된다. 자동 확인 토글을 다시 켜면 stable 추종으로 돌아간다. stable 자동 확인은 계속 버전 증가만 허용한다.
- 각 게임 빌드의 저장을 따로 유지한다. 처음 선택한 빌드는 새 월드로 시작하며, 다시 선택하면 마지막 진행을 복원한다. 시작 검증 실패 시 직전 게임과 직전 저장으로 복구한다.

배포는 최신 main에서 `V_0.3.2` 또는 `V_vehicle` 같은 브랜치를 만들어 push한다. `.github/workflows/release.yml`이 서명·검증 후 새 Release와 카탈로그 항목을 추가한다. V_ 브랜치에는 APK 빌드가 없고 stable 포인터는 바뀌지 않는다. SemVer 접두사가 있으면 표시 버전으로 사용하고 그 외에는 version.json의 표시 버전을 유지한다. 불변 빌드 ID는 `1000000 + GITHUB_RUN_NUMBER`, 태그는 `game-<빌드ID>`, 파일은 `updates/builds/<빌드ID>.feral`이다. 같은 브랜치를 반복 push해도 과거 빌드가 남는다. run 재실행은 같은 ID·같은 내용일 때만 허용한다.

`nativeVersion` / `nativeCode`는 APK 기준, `version` / `versionCode`는 게임 기준, `minNativeCode`는 호환성 기준이다. V_ 브랜치에서 Java를 수정해도 네이티브 앱에는 적용되지 않는다. 네이티브 변경은 main에서 새 APK 버전으로 배포한 뒤 해당 버전을 최소 기준으로 삼는다. 이미 발표한 main 버전은 다시 덮어쓰지 않는다.

이전 게임은 서명된 .feral 패키지가 있는 버전부터 선택 가능하다. 단순히 옛 Git 브랜치가 존재하는 것만으로 앱에 나타나지 않는다. 카탈로그의 배포 성공 항목만 표시한다.

## 0.4.0 개척 원정 — 미배포

`feature/frontier-prototype`는 UI 초안과 개척 원정의 통합 프로토타입이다. 게임 표시 버전 0.4.0 / 게임 코드 400이며 nativeVersion/nativeCode와 minNativeCode는 0.3.1 / 301로 유지한다. 기존 릴리스 파일을 교체하지 않는다. 실제 게임 게시 시 V_ 브랜치 절차를 따르면 새로운 불변 빌드 번호를 부여받는다.

로컬 테스트 APK의 기본 출력 이름은 네이티브 버전에 따라 `build/Feral-0.3.1-android.apk`다. 혼동 방지를 위해 검증본은 `build/Feral-0.4.0-prototype-native-0.3.1.apk`로도 복사한다. 이는 새 네이티브 릴리스가 아니라 개척 게임을 동봉한 테스트용 APK다. 정식 기존 v0.3.1 Release 자산을 교체하지 않는다. 게임 업데이트는 `build/release/Feral-0.4.0-update.feral`이며 아직 게시하지 않았다.

저장소 공개 상태를 확인했다. 기존 앱의 토큰 필수 업데이트 흐름과 공유 시험 서명키는 유지된다. 공개 배포용 인증·서명 정책 정리는 별도 작업이다.

## 0.4.1 전투·도구 — 미배포

게임 0.4.1 / 401, 네이티브 0.3.1 / 301과 최소 네이티브 301은 유지한다. 저장 스키마 2에 체력·장비·내구도 선택 필드를 추가하며 구 저장을 읽을 수 있다. APK 출력은 `build/Feral-0.3.1-android.apk`, 게임 패키지는 `build/release/Feral-0.4.1-update.feral`이다. 기존 Release 자산을 교체하지 않는다. `verification/0.4.1.md`에 검증 결과를 기록한다.

## 0.5.0 아이템 인벤토리·모바일 생존 UI — 미배포

게임 0.5.0 / 500, 네이티브 0.3.1 / 301 및 최소 네이티브 301 유지. 저장 스키마 2에서 인벤토리 슬롯·선택 칸·보관품 필드를 추가했다. 구 저장의 재료와 해금 장비는 슬롯으로 이전하고 용량 초과분은 삭제하지 않는다. APK 출력은 `build/Feral-0.3.1-android.apk`이며 테스트용 사본은 `build/Feral-0.5.0-prototype-native-0.3.1.apk`다. 업데이트 패키지는 `build/release/Feral-0.5.0-update.feral`. 검증과 화면은 `verification/0.5.0.md` 참조. 기존 Release 파일 교체 없음.

## 앱 0.3.2 / 게임 0.5.1 — 공개 업데이트 대응

네이티브 0.3.1→0.3.2, 동봉 게임 0.5.0→0.5.1로 패치 번호를 증가했다. 게임 501 / 앱 302 / 최소 앱 302 / 저장 스키마 2. 인증 없는 자동 확인·카탈로그·버전 다운로드와 앱/동봉 게임 식별 분리를 포함한다. 배포 검사와 APK 체크섬 생성도 분리된 앱 번호를 사용한다. 출력은 `build/Feral-0.3.2-android.apk`와 `build/release/Feral-0.5.1-update.feral`. 기존 Release 파일은 교체하지 않는다. 검증은 `verification/public-app-0.3.2.md` 참조. 2026-10-17(KST) PR #2를 main에 병합했고 Actions 38980246886이 성공하여 v0.5.1 Release와 stable 채널에 게시했다.

## 게임 0.5.2 — 월드 공간 UI (미배포)

게임 502 / 앱 302 / 최소 앱 302 / 저장 스키마 2. 월드 대상 정보창, 생존 HUD와 고정 게임 창 변경이다. Java 변경은 없으며 기존 공개 앱 0.3.2에서 게임 업데이트로 실행할 수 있다. 로컬 테스트 APK는 `build/Feral-0.5.2-game-native-0.3.2.apk`로 복사해 기존 공개 APK와 구분한다. 패키지는 `build/release/Feral-0.5.2-update.feral`. 기존 v0.5.1 자산을 교체하지 않는다. 구조는 `docs/archive/WORLD-SPACE-UI.md`, 검증은 `verification/0.5.2.md` 참조.

## 게임 0.5.3 — 게임 창·HUD 편집·반 칸 기본값 (미배포)

게임 503 / 앱 302 / 최소 앱 302 / 저장 스키마 2. 타이틀·일시정지·인벤토리·원정·월드 목록·기계 창을 공통 게임 테마로 정리하고 HUD 배치 편집을 추가했다. `feral.ui.layout.v1`에 화면 방향·왼손 설정별 배치를 저장하며 기존 네이티브의 feral.* 백업·빌드별 저장 격리에 포함된다. 구 월드의 1m 기본 편집값은 한 번 반 칸(0.5m)으로 이전한다. 이후 명시적으로 선택한 크기는 `editGridVersion: 1`과 함께 보존한다.

Java 변경 없음. 기존 공개 앱 0.3.2에서 게임 업데이트 가능. 테스트 APK는 `build/Feral-0.5.3-game-native-0.3.2.apk`, 게임 패키지는 `build/release/Feral-0.5.3-update.feral`. 기존 공개 v0.5.1 자산은 교체하지 않는다. 조작은 `docs/archive/UI-EDITOR.md`, 검증은 `verification/0.5.3.md` 참조.


## 게임 0.6.0 — 구조 손상과 월드 조립

게임 600 / 앱 302 / 최소 앱 302 / 저장 스키마 2. 로컬 APK `build/Feral-0.6.0-game-native-0.3.2.apk`는 기존 시험 서명으로 앱 0.3.2 위에 설치 가능하며 게임 0.6.0을 동봉한다. 기존 앱은 main 반영과 공개 게시가 끝난 후 게임 업데이트로 받을 수 있다. PR 단계의 로컬 빌드는 stable 게시를 의미하지 않는다.

기존 동물 손상 마스크와 다리 분리 비트에서 지지 상태를 다시 계산한다. 기존 원정 차량에는 최초 실행 때 야영지의 고정된 위치를 부여한다. 이후 위치·회전·속도·지역·분리된 부품을 저장한다. 개척 원정에서는 기계 탭의 격자를 사용하지 않고 실제 부품 아이템으로 월드에서 조립한다. 별도 기계 베타 맵의 2D 실험은 이전 저장/조작을 유지한다.

Rapier의 WASM이 포함된 ES 모듈과 Apache-2.0 라이선스를 패키지에 동봉하므로 네트워크 다운로드 없이 동작한다. Android 네이티브 코드·권한·검증 키 변경은 없다. 패키지 크기는 기존 8MiB 압축/32MiB 확장 제한 내에서 검증한다.

## 앱 0.3.3 / 게임 0.7.0 — 공기역학·자세·재시도

게임 700 / 앱 303 / 최소 앱 303 / 저장 스키마 2. 네이티브 CSP의 WASM 실행 허용과 실패 버전 재시도 때문에 새 APK가 필요하다. 출력은 `build/Feral-0.3.3-android.apk`와 `build/release/Feral-0.7.0-update.feral`이다. 0.6.0 패키지 자체는 교체하지 않으며 새 앱에서 명시적으로 재시도할 수 있다. 항공 부품·비행 조종·이동 자세와 모바일 UI를 포함한다. 검증은 `verification/0.7.0.md` 참조.


## 0.7.1 — 월드 정보창·점프·버튼 드래그

게임 0.7.1 / 701, 앱 0.3.3 / 303, 최소 앱 303, 저장 스키마 2. 월드 정보창은 원근을 유지하며 지형 위에 우선 표시하고, 점프를 약 1.30m로 높였다. 공격·사용·점프·하강 버튼을 누른 채 끌면 동작을 유지하며 시점을 회전한다. 터치 취소와 메뉴 전환 시 입력을 해제한다.

앱 0.3.3에서는 OTA로 적용 가능하다. 출력은 `build/Feral-0.3.3-android.apk`와 `build/release/Feral-0.7.1-update.feral`이며 기존 Release 파일은 교체하지 않는다. 검증 결과는 `verification/0.7.1.md`에 기록한다.


## 0.7.2 — 제작·메뉴 터치 스크롤

게임 0.7.2 / 702, 앱 0.3.3 / 303, 최소 앱 303, 저장 스키마 2. 제작 목록·인벤토리·세로 메뉴 탭의 실제 터치 스크롤과 작은 화면의 대화창 접근성을 수정한다. 5개 화면 크기에서 자동 스크롤 없이 손가락 제스처로 대상 노출 후 좌표 탭을 검증한다.

앱 0.3.3에서 게임 업데이트로 적용한다. 출력은 `build/Feral-0.3.3-android.apk`와 `build/release/Feral-0.7.2-update.feral`. 기존 배포 파일은 교체하지 않는다. 상세 검증은 `verification/0.7.2.md`.

## 0.8.0 — 손상 보존·현장 상호작용·획득 순환

게임 0.8.0 / 800, 앱 0.3.3 / 303, 최소 앱 303, 저장 스키마 2. 복셀 손상 영속화, 주민·유적 조준 사용, 채집·의뢰·생태·제작과 자원 재생 경로를 확장한다. 초기 지급품 없는 모든 제작법의 모델 실행과 실제 터치 상호작용을 검증한다.

앱 0.3.3에서 게임 업데이트로 적용한다. 출력은 `build/Feral-0.3.3-android.apk`와 `build/release/Feral-0.8.0-update.feral`. 기존 저장에도 채집 지점과 중계기 기록을 추가하고 이전 유적 진행을 유지한다. 상세 규칙은 `docs/archive/PERSISTENT-WORLD-AND-LOOPS.md`, 검증은 `verification/0.8.0.md`.


## 0.9.0 — 첫 신호·시각 표현 개편

게임 0.9.0 / 900, 앱 0.3.3 / 303, 최소 앱 303, 저장 스키마 2. 캠페인·시설·농업·지역 신호·반복 원정·전투 패턴과 재질·조명·공통 UI를 포함한다. 기존 앱에서는 게임 업데이트로 적용한다. Java·권한·검증 키 변경 없음.

출력은 `build/Feral-0.3.3-android.apk`와 `build/release/Feral-0.9.0-update.feral`. 기존 배포 파일은 교체하지 않는다. 이전 저장에 여정·야영지 기본값을 추가하며 기존 지역의 지형 생성 버전을 유지한다. 새로 방문하는 지역에만 새 유적 구조를 생성한다. 첫 신호 완료 여부와 원정·작물·강화 효과는 게임 저장에 포함되며 메뉴/오프라인 시간으로 성장하지 않는다.

설계·참고 자료와 베타 후보의 범위는 `docs/archive/FIRST-SIGNAL.md`, 자동 검증과 실제 기기 검증의 구분은 `verification/0.9.0.md` 참조.

## 0.9.1 — 캐릭터 아트

게임 0.9.1 / 901, 앱·최소 앱 0.3.3 / 303, saveSchema 2. 정밀 복셀 인물, 관절 동작, 3D 캐릭터 미리보기, 종별 동물 실루엣과 손상에 연동한 표면을 포함한다. 앱 0.3.3에서 게임 업데이트로 적용하며 신규 설치는 v0.9.1 Release의 Feral-0.3.3-android.apk를 사용한다. 상세 설계는 `docs/archive/VOXEL-CHARACTERS.md`, 재현 검증은 `verification/0.9.1.md`.


## 0.10.0 — 구조·동적 복셀 샌드박스

게임 0.10.0 / 1000, 앱·최소 앱 0.3.3 / 303, saveSchema 2. 외피와 골격을 분리한 동물·인물형 훈련체, 지형의 독립 물체 전환, 질량을 반영한 잡기·끌기·밀기·던지기, 물체 재조립과 공통 충격 피해를 포함한다.

기존 앱은 게임 업데이트로 적용한다. 신규 설치는 v0.10.0 Release의 `Feral-0.3.3-android.apk`, 게임 번들은 `Feral-0.10.0-update.feral`이다. Java·권한·검증 키는 변경하지 않는다. 기존 지역의 지형 생성 버전을 유지하고 새 지역부터 작업장을 생성한다. 월드의 선택 필드 `loose`와 신체의 선택 필드 `structure`/`trainingBody`를 이전하며 기존 손상은 유지한다. 일반 주민과 플레이어 전신을 관절 물리로 전환한 릴리스는 아니다.

설계·조작: `docs/archive/STRUCTURAL-SANDBOX.md`. 검증: `verification/0.10.0.md`.


## 0.10.1 — 콘텐츠 설계·복셀 제작 도구 기준 릴리스

게임 0.10.1 / 1001, 앱·최소 앱 0.3.3 / 303, 저장 스키마 2. 콘텐츠 설계·복셀 원본·렌더·제작 SDK와 편집기·필수 검사 하네스를 보존하는 릴리스다. 게임 플레이는 0.10.0과 동일하며 신규 콘텐츠와 제작 편집기는 게임 런타임에 아직 통합하지 않았다. 원본과 도구는 저장소 `design/assets/`, 사용법은 `docs/VOXEL-ASSET-RULES.md`에서 확인한다.

기존 앱 0.3.3에서는 게임 업데이트로 적용한다. 신규 설치는 v0.10.1 Release의 `Feral-0.3.3-android.apk`를 사용하며 동봉 게임은 0.10.1이다. 새 게임 패키지는 `Feral-0.10.1-update.feral`, 불변 저장 위치는 `updates/versions/0.10.1.feral`이다. 이전 릴리스와 버전별 패키지는 교체하지 않는다. 검증 기록은 `verification/0.10.1.md` 참조.
