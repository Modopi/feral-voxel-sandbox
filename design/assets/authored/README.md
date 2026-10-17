# 직접 편집한 원본

복셀 제작 도구 `design/assets/author.html`에서 내려받은 `<id>.voxel.json`을 여기에 보관한다. 이 폴더에 같은 ID의 원본이 있으면 빌드가 해당 파일을 사용하며, 생성기가 이를 덮어쓰지 않는다. 제작 도구는 추가 시 중복을 거부하고 명시적 교체/빈 공간 채우기를 제공한다.

아직 직접 편집한 모델을 저장하지 않았다면 생성기 원본으로 빌드한다. 잘못된 원본을 후보정하지 않으며 검사에서 실패한다. 원본을 저장한 뒤 `npm run build:assets`, `npm run render:assets`, `npm run check:assets`를 실행한다.
