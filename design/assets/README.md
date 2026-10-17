# FERAL 시각 에셋

[복셀 제작 도구](author.html) · [필수 제작 규칙](../../docs/VOXEL-ASSET-RULES.md)

**이미지는 `previews/`, 다른 3D 도구에서 여는 모델은 `exports/`입니다.**

- `authored/`: 제작 도구에서 저장한 수동 원본. 같은 ID의 생성기보다 우선.
- `generators/`: 모델을 편집하는 원본 코드.
- `models/`: 부위·재질·앵커·인스턴스를 가진 복셀 JSON.
- `exports/`: Blender 등에서 가져올 수 있는 GLB.
- `previews/`: 위 원본을 직접 렌더한 PNG. 건물은 `-cutaway` 내부 이미지도 포함.
- `references/`: 별도의 AI 콘셉트 참고 이미지. 실제 모델 렌더와 구분.
- `manifest.json`: 62개 모델의 이름·콘텐츠 연결·치수·파일·해시.

[자세한 저장·재사용 설명](../../docs/content/VISUAL-ASSETS.md) · [파일 형식](FORMAT.md)

저장소 루트에서 `npm run build:assets` → `npm run render:assets`. `npm run serve:assets` 뒤 `http://localhost:8081/design/assets/index.html`에서 회전·확대·지붕 숨김으로 확인합니다. HTML을 직접 더블클릭하면 브라우저의 JSON/모듈 읽기 제한에 걸릴 수 있습니다.

시각 프로토타입입니다. 게임 런타임, 물리 충돌, 파괴, AI, 애니메이션 적용 완료를 뜻하지 않습니다. GLB는 메시·부모관계·재질·부착점이 포함된 교환 파일이며 개별 게임 행동은 콘텐츠 데이터를 별도로 연결해야 합니다.
