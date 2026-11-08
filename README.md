# FERAL

Android에서 오프라인으로 탐험·채굴·제작·생태·전투를 하는 1인칭 복셀 샌드박스 RPG.

현재 작업 버전은 **게임 0.19.0 / 앱 0.4.0**이다. 게임 계산은 C++17, 렌더·입력·화면은 Godot 4.6.3, 물리는 하나의 Jolt 공간에서 실행한다. 네 가지 월드는 같은 세션의 설정과 모듈로 구성한다. 실제 타격 궤적과 화면의 도구 애니메이션은 독립된 두 트랙이며 같은 60Hz 시간축을 사용한다.

[검증 기록](verification/0.19.0.md) · [현황](docs/STATUS.md) · [구조](docs/ARCHITECTURE.md) · [로드맵](docs/ROADMAP.md) · [공개 배포](https://github.com/Modopi/feral-voxel-sandbox/releases) · [문서 안내](docs/README.md)

## 설치와 업데이트

Android 8.0 이상 arm64 기기용 `Feral-0.4.0-android.apk`를 **기존 앱 위에 업데이트 설치**한다. 같은 패키지와 서명을 유지하며, 기존 WebView 월드와 저장 보관함은 원본을 남기고 변환한다. 앱 삭제나 데이터 초기화는 필요하지 않다. Android 실기기 검증 범위는 검증 기록에 별도로 표시한다.

새 앱에서는 런처의 업데이트 화면에서 서명된 메타데이터를 확인하고 APK를 내려받는다. 코드 변경에는 새 APK가 필요하며, 이전 JS 게임의 버전 선택기로 C++ 코드를 교체하지 않는다. 저장·설치·복구 범위와 이전 버전 안내는 [배포 문서](docs/RELEASING.md)를 따른다.

## 개발

Node.js, Python 3, C++17 컴파일러, 전체 JDK 21(`javac`·`jlink` 포함), Android SDK Platform 35 / Build Tools 35.0.0을 사용한다. 고정된 Godot·godot-cpp·NDK·SCons·Gradle 도구는 `tools/native/bootstrap.sh`가 준비한다.

```bash
node tools/native/export-content.mjs --check
npm test                                  # 기존 규칙·데이터 필수 회귀
npm run check:assets                       # 정식 복셀 에셋 검사
bash tools/native/test.sh                  # C++ 규칙 + 실제 Godot/Jolt 통합 검사
export ANDROID_HOME=/absolute/path/to/Android/sdk
export JAVA_HOME=/absolute/path/to/jdk-21
bash build-apk.sh                          # build/Feral-0.4.0-android.apk
python3 tools/build-update.py              # 서명 메타데이터와 콘텐츠 스냅샷
```

Linux에서 빌드 후 `godot --path native`로 네이티브 앱을 실행한다. 게임 코드는 `native/src`, 데이터는 `native/data`에 있다. `app/src/main/assets`의 이전 JS 코드는 기준 데이터와 이전 저장·회귀 비교에 남겨 두며 새 APK의 게임 루프에서 실행하지 않는다.

- 버전의 기준은 `version.json`이다. 변경 후 `node tools/version.mjs`로 메타데이터를 맞춘다.
- 콘텐츠의 기준은 `design/content/*.json`이다. `npm run build:runtime`과 `node tools/native/export-content.mjs`로 런타임 데이터를 내보낸다.
- 복셀 에셋은 제작 SDK와 편집기를 사용한다. [복셀 에셋 규칙](docs/VOXEL-ASSET-RULES.md)을 따른다.
- 영향받은 장기 검사와 이전 UI 검사는 [AGENTS.md](AGENTS.md)의 기준으로 실행한다. 기존 JS 측정과 네이티브 측정은 구분한다.
- main 병합·배포 절차는 [배포 문서](docs/RELEASING.md)를 따른다. `signing/prototype.keystore`는 공유 시험 키이며 정식 운영 키가 아니다.

네이티브 실행의 라이선스는 [제3자 고지](native/THIRD_PARTY_NOTICES.md)에 있다. 이전 브라우저 런타임에 포함된 Three.js r170의 MIT 라이선스는 `app/src/main/assets/vendor/THREE-LICENSE.txt`에 있다.
