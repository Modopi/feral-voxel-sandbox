# FERAL 버전 관리와 배포

2026-10-16 사용자 결정: **0.2.5부터 버전별 배포와 게임 코드 자동 업데이트 사용.** 소스와 배포는 개인 계정 Modopi의 비공개 저장소에서 관리한다.

## 첫 설치와 GitHub 연결

0.2.5 APK를 기존 앱 위에 업데이트 설치한다. 패키지명과 시험 서명이 같고 versionCode는 205이다. 앱을 제거하거나 데이터를 지우지 않는다.

메뉴 → 업데이트 → GitHub 연결에서 fine-grained personal access token을 한 번 등록한다. Resource owner는 Modopi, Repository access는 **Only select repositories → feral-voxel-sandbox**, Repository permissions는 **Contents: Read-only**로 제한한다. Metadata 읽기는 GitHub가 함께 부여한다. 만료일을 설정하고 만료 후에는 새 토큰을 앱에 등록한다. 토큰을 대화나 이슈에 적지 않는다.

토큰은 네이티브 입력 창에서 받고 Android Keystore의 AES-GCM 키로 암호화해 기기 내부에 저장한다. JavaScript·localStorage·업데이트 패키지에는 전달하지 않는다. GitHub 연결 관리에서 빈 값으로 연결하면 토큰을 삭제한다. 연결하지 않아도 동봉한 게임은 오프라인에서 실행된다.

자동 확인이 켜져 있으면 실행할 때 확인한다(15분 이내 반복 요청 제한). 수동 **지금 확인**은 즉시 요청한다. 다운로드가 완료되면 다음 실행 때 적용하며, 메뉴의 **저장 후 적용**으로 바로 재시작할 수도 있다. 저장 실패 시 재시작하지 않는다. 네트워크 단절·토큰 만료·업데이트 실패는 현재 버전의 오프라인 플레이를 막지 않는다.

## 버전의 기준

| 항목 | 0.2.5 값 | 의미 |
| --- | --- | --- |
| version | 0.2.5 | 사용자가 보는 게임 버전 / Release v0.2.5 |
| versionCode | 205 | APK와 게임 패키지의 단조 증가 정수 |
| minNativeCode | 205 | 이 게임 코드를 실행할 수 있는 최소 APK |
| saveSchema | 2 | 월드 저장 형식. 앱 버전과 별개 |
| channel | stable | 사용자가 받는 배포 채널 |

`version.json`만 수정한 뒤 `node tools/version.mjs`를 실행하면 AndroidManifest, Gradle, package.json과 게임 version.js를 함께 맞춘다. UI는 실제 실행 중인 게임 버전과 Android APK 버전을 각각 표시한다.

일반적인 게임 패치는 0.2.6 / 206, 기능 추가는 0.3.0 / 300 등으로 올린다. 코드 숫자는 항상 이전 배포보다 커야 한다. 게임 코드만 변경했다면 minNativeCode 205를 유지할 수 있다. 네이티브 Java·권한·검증 키가 바뀌면 새 APK를 배포하고 minNativeCode를 새 versionCode와 같게 올린다. 지원하지 않는 앱에는 APK 설치가 필요하다고 표시한다. APK 자동 무인 설치는 구현하지 않는다.

## 다음 버전 배포 순서

1. 코드 변경 후 `version.json`의 버전과 versionCode 증가. `node tools/version.mjs` 실행.
2. CHANGELOG 맨 위에 해당 버전의 변경 사항 추가. 저장 형식 변경은 읽기 호환·변환과 복구 시험 추가.
3. `node --test tests/*.test.js` 실행. UI·플레이 변경에는 관련 `tests/*-check.cjs` 실행.
4. `bash build-apk.sh`와 `python3 tools/build-update.py`로 로컬 결과 확인.
5. 검증된 변경을 main에 반영. **FERAL versioned release** Actions가 테스트·APK 빌드·서명 패키지 생성을 수행하고 GitHub Release에 결과를 올림.
6. Release 게시가 완료되면 별도 `updates` 브랜치의 `versions/<버전>.feral`과 `stable.feral` 갱신. 앱은 인증된 GitHub Contents API로 stable.feral을 읽음.
7. Release의 APK를 내려받아 실제 기기에서 업데이트 설치·이어하기 확인. 이미 배포한 번호는 재사용하지 않으며 수정 시 새 버전 배포.

워크플로는 main push와 수동 실행을 지원한다. 이미 배포한 동일 버전·동일 패키지는 중복 배포하지 않는다. 동일 번호의 내용 변경이나 낮은 번호는 실패한다. 네이티브 파일의 fingerprint가 달라졌는데 minNativeCode를 올리지 않은 경우도 배포하지 않는다.

배포 자동화는 저장소 범위 GITHUB_TOKEN(contents: write)을 사용한다. 개인 토큰을 GitHub Actions에 보관할 필요가 없다. 공유 시험 keystore는 초기 비공개 프로토타입의 연속 업데이트를 위한 것으로 production 비밀 키가 아니다. 외부 사용자에게 배포하기 전 별도 키·교체 정책을 설계해야 한다.

## 패키지와 시작 실패 복구

`.feral`은 Base64 ZIP과 서명된 메타데이터를 담은 JSON 파일이다. 네이티브 APK에 고정된 RSA 공개 키로 SHA256withRSA 서명을 확인한 뒤 버전, 최소 APK, 채널, ZIP 해시·크기, 각 파일 해시·누락·경로·풀린 크기를 검증한다. 전체 검증이 끝나야 pending 상태가 된다. 부분 다운로드는 활성 버전을 바꾸지 않는다.

다음 시작 시 APK에 고정된 bootstrap 페이지가 기존 HTTPS 출처의 `feral.*` localStorage를 백업하고 버전 포인터를 원자적으로 전환한다. 저장 출처와 키는 0.1/0.2와 동일하다. 전체 게임 파일을 한 버전에서만 읽으며 APK 파일과 혼합하지 않는다.

지형 준비 후 최소 12 렌더 프레임과 3초가 지나면 게임이 성공을 알린다. 성공 전 실행 오류, 45초 시작 시간 초과, 프로세스 종료가 있으면 이전 정상 코드와 시작 전 저장을 복원한다. 복원 중 종료도 다음 실행에 재시도한다. 실패한 버전 번호는 재적용하지 않고 다음 번호를 기다린다. 성공 판정 후 모든 플레이 버그를 자동 감지하거나 모든 저장 손상을 복구하는 기능은 아니다.

한 개 이전 정상 버전을 유지한다. 활성·이전·준비 버전 외 파일은 시작 성공 후 정리한다. 테스트는 패키지 변조·경로 탈출·다운그레이드·네이티브 호환·시작 중 종료·저장 복구를 포함한다. 휴대폰 Keystore·네트워크·WebView 생명주기의 실기기 검증은 별도 필요하다.

## 릴리스 기록

| 버전 | 구분 | 주요 내용 |
| --- | --- | --- |
| 0.1.0 | 초기 APK | 복셀 탐험·생태·파괴·유체 반응 |
| 0.2.0 | APK | 접지 안정화·1.5m 캐릭터·반 칸 채굴·가방·제작·드롭 |
| 0.2.5 | 최초 업데이트 대응 APK | 비공개 GitHub 자동 업데이트·서명 검증·시작 실패 복구·버전 배포 자동화 |
