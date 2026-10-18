# FERAL 문서 안내

문서마다 역할과 신뢰 등급이 다르다. 서로 다르면 위 등급이 우선한다. 등급이 같으면 사용자의 최신 결정이 우선한다.

## 1. 기준 문서: 코드와 함께 고칠 의무가 있음

| 문서 | 다루는 것 |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 소프트웨어 구조의 유일한 기준. 런처·게임 세션·월드 설정·데이터 범위·시작 약속·규칙. [현재]와 [목표]를 구분 |
| [ROADMAP.md](ROADMAP.md) | 구조 단계와 완료 기준, 세션 통합 때 옮길 기능 |
| [STATUS.md](STATUS.md) | 지금 공개된 버전, 되는 것, 알려진 한계, 최근 검증 |
| [GAME-RULES.md](GAME-RULES.md) | 통합 세션의 플레이 규칙과 수치(채집·채굴·건축·전투·생존) |
| [RELEASING.md](RELEASING.md) | 버전 규칙, 배포 절차, 패키지·복구, 릴리스 게시 기록 |
| [VOXEL-ASSET-RULES.md](VOXEL-ASSET-RULES.md) | 복셀 에셋 제작 경로·소유권·충돌(사용자 확정) |
| [../AGENTS.md](../AGENTS.md) | 개발·배포 작업 규칙 |
| [../CHANGELOG.md](../CHANGELOG.md) | 버전별 변경 사실 |

구조나 규칙을 바꾸는 코드 변경은 같은 PR에서 해당 기준 문서를 고친다. 버전 이름을 단 설계 문서는 새로 만들지 않는다.

## 2. 게임 설계와 목표: 방향과 제안

| 문서 | 다루는 것 | 주의 |
| --- | --- | --- |
| [GAME-VISION.md](GAME-VISION.md) | 장기 비전과 큰 순환 | 구현 기준이 아니다 |
| [IMPLEMENTATION-GOAL.md](IMPLEMENTATION-GOAL.md) | 설계 콘텐츠 전체를 플레이로 연결하는 목표와 완료 조건(사용자 지시) | 구조 단계는 로드맵이 우선한다 |
| [CONTENT-PROGRESSION.md](CONTENT-PROGRESSION.md) | 콘텐츠·성장 원칙(확정)과 제안 | 확정과 제안을 문서 안에서 구분 |
| [content/](content/README.md) | 환경·생명체·건축물·보스·성장 위키, [구현 추적표](content/IMPLEMENTATION-STATUS.md) | 설계 제안이다. 데이터의 기준은 `design/content/*.json`. 일부 문장이 현재 구현과 맞지 않아 구조 단계 뒤 검토한다 |

## 3. 기록: 현재 기준으로 인용하지 않음

| 위치 | 다루는 것 |
| --- | --- |
| [archive/](archive/README.md) | 버전별 옛 문서(0.4~0.14). 옛 엔진 동작 참고용 |
| [../verification/](../verification) | 버전별 검증 증거(테스트 로그·브라우저 보고서·빌드 측정) |
