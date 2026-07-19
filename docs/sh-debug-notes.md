# SVRaster WebGL Viewer - SH / Rendering Debug Notes

## 현재 상태

로컬 bonsai PLY를 기준으로 뷰어를 디버깅했으며, 현재는 모델이 화면에 보이고 `sh=2` 모드도 동작합니다. 다만 SH2를 켠 상태에서 화질이 아직 충분하지 않아, 계수 매핑과 샘플링 쪽을 더 점검해야 합니다.

## 이미 해결한 문제

### 1. 로컬 PLY 로딩 경로 확인

- `models/SVRaster/bonsai_og/checkpoints/iter020000_model.ply`가 실제로 존재하고, Vite dev server에서도 `200 OK`로 서빙되는 것을 확인했습니다.
- 따라서 렌더 실패의 원인은 파일 경로가 아니라 뷰어 내부 렌더링 쪽이었습니다.

### 2. 화면이 완전히 검게 보이던 문제 수정

- 셰이더 링크 실패가 있었습니다.
- vertex shader는 `precision highp float`인데 fragment shader는 `precision mediump float`라서, `uCameraPosition` uniform 정밀도 불일치로 링크가 실패했습니다.
- fragment shader도 `highp`로 맞춰서 해결했습니다.

### 3. 카메라/변환 때문에 모델이 화면 밖으로 밀리던 문제 수정

- 이전에는 펌킨 씬 기준의 hardcoded transform/camera 값이 남아 있었습니다.
- bonsai 모델 기준으로는 이 값들이 시야를 크게 벗어나게 만들 수 있어서, 기본 카메라를 scene center 기준으로 다시 잡도록 바꿨습니다.

### 4. 텍스처 패킹 폭 계산 보정

- SH/그리드 데이터를 RGBA 텍스처로 업로드할 때, 요소 개수 기준으로 폭을 잡는 방식이 불안정했습니다.
- 현재는 RGBA texel 개수 기준으로 폭/높이를 계산하도록 수정했습니다.

### 5. SH2 디버그용 분리 스위치 추가

- `disableSh2` URL 파라미터를 추가했습니다.
- `?sh=2&disableSh2=true`는 SH2를 끈 비교용 모드입니다.
- `?sh=2&disableSh2=false`는 SH2를 실제로 계산하는 모드입니다.

## 현재 추가된 디버그 URL

- `?url=<PLY URL>`: PLY 파일 지정
- `?sh=2`: SH degree 2 모드
- `?disableSh2=true|false`: SH2 항만 디버그로 끄기/켜기
- `?sh1map=0,1,2`: SH1 basis permutation
- `?sh2map=0,1,2,3,4`: SH2 basis permutation

## 현재 남은 문제

### 1. SH2 화질이 아직 충분하지 않음

- `disableSh2=true`와 `disableSh2=false` 둘 다 모델은 보이지만, 색과 형태의 차이가 크지 않거나 자연스럽지 않습니다.
- 즉, 단순히 SH2를 켰다고 바로 품질이 좋아지는 상태는 아닙니다.

### 2. SH basis mapping 후보가 아직 결정되지 않음

- SH1/SH2 basis 순서를 URL로 바꿔가며 확인할 수 있게 만들었습니다.
- 하지만 현재 확인된 6개 후보는 서로 크게 다르게 보이지 않았고, 최적 조합을 아직 확정하지 못했습니다.

### 3. 다음에 점검할 후보

- SH 계수와 basis의 대응 순서 재검증
- SH 계산을 vertex가 아니라 fragment 쪽으로 옮기는 실험
- 샘플 수(`samples`)와 density 스케일 재조정
- scene extent에 따른 기본 카메라 거리/복셀 스케일 추가 보정

## 최근 기본값 조정

- `samples` 기본값을 `3`에서 `8`로 올렸습니다.
- 목적은 `sh=1`에서 복셀 내부 적분이 너무 거칠어서 생기던 줄무늬/지글거림을 먼저 줄이는 것입니다.
- 성능이 더 중요하면 `?samples=3` 또는 `?samples=1`로 다시 낮춰 비교할 수 있습니다.
- 추가로 샘플 위치에 지터를 넣어 얇은 구조물에서 생기던 규칙적인 줄무늬를 완화했습니다.
- `?quality=detail` 프리셋을 추가해 더 높은 기본 샘플 수와 sharper density preset을 바로 비교할 수 있게 했습니다.

## 검증 결과

- `npm run build` 통과
- dev server에서 로컬 bonsai PLY 로딩 가능
- 렌더가 검은 화면에서 벗어나 모델 표시 가능

## 관련 파일

- [src/main.ts](../src/main.ts)
- [src/lib/Viewer.ts](../src/lib/Viewer.ts)
- [scripts/convert_to_ply.py](../scripts/convert_to_ply.py)
