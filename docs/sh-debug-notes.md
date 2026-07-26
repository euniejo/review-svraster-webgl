# SVRaster Viewer 실험 기록

이 문서는 문제 분석 과정에서 수행한 실험을 시간 순서와 가설 중심으로 남기는 작업 기록이다.
검증 범위와 최종 판단은 [PLY Viewer 품질 점검 보고서](./ply-viewer-final-summary.md)를 기준으로 한다.

## 문제 정의

로컬에서 PLY로 변환한 SVRaster 모델에 다음 현상이 관찰됐다.

- 모델 표면의 점상 노이즈와 사선 형태의 아티팩트
- 카메라 이동 시 불안정한 화면 변화
- 모델 실루엣과 색상 정보의 소실
- debug view에서 복셀 proxy가 화면 대부분을 차지하는 현상

점검 목적은 SH 차수, density 해석, ray integration, proxy coverage 중 어떤 경로를 우선 조사해야 하는지 좁히는 것이었다.

## 실험 기록

| 단계 | 가설 | 조정 항목 | 관찰 | 현재 해석 |
| --- | --- | --- | --- | --- |
| 1 | SH 차수가 낮다 | `sh=1`, `2`, `3` | 고차 SH에서도 의미 있는 개선이 없고 일부 시점에서 백색 포화 증가 | SH 적용 여부와 현재 품질 문제는 별개 |
| 2 | SH 방향 규약이 반대다 | `shDebug=dirDiff`, `shViewDir` | 방향 반전에 따른 색 차이가 크게 나타남 | 기준 렌더가 없어 올바른 방향은 판정 불가 |
| 3 | trilinear 보간이 노이즈를 만든다 | `densityMode=trilinear`, `flat` | flat에서도 모델 식별성과 노이즈가 개선되지 않음 | 보간 방식만의 문제라는 가설은 지지되지 않음 |
| 4 | density transfer가 과도하다 | `explin`, `linear`, `exp` | linear는 일부 시점에서 블록 경계 감소, exp는 sparse speckle 증가 | linear만 후속 비교 후보로 유지 |
| 5 | 적분 샘플이 부족하다 | `samples=3`, `8` | 미세한 안정화 외에 큰 개선 없음 | 보조 변수로만 유지 |
| 6 | alpha 또는 proxy coverage가 과도하다 | `alpha`, `thickness`, `solid` debug | 모델 형태보다 복셀 경계와 화면 점유가 우세함 | coverage와 density/alpha compositing을 우선 점검 |
| 7 | coarse octlevel이 문제다 | `minOct`, `maxOct` | 높은 octlevel만 남겨도 전체 품질이 개선되지 않음 | 특정 octlevel만의 문제는 아님 |
| 8 | 저평균 density voxel을 제거하면 개선된다 | `minGridMean` | 중심부 일부만 남고 모델 소실과 배경 speckle 지속 | 유효한 occupancy 판별 기준으로 확인되지 않음 |
| 9 | 카메라 초기 위치가 문제다 | 카메라 거리 변경 | 거리가 멀어질수록 판독만 어려워짐 | 렌더링 문제에 대한 추가 근거 없음 |

## Debug view 해석

### Alpha Debug

최종 alpha를 흑백으로 표시한다. 복셀 경계가 강하게 드러났지만 이 화면만으로 density 원본값, transfer 함수, compositing 순서 중 어느 단계가 원인인지는 구분할 수 없다.

### Thickness Debug

ray와 복셀 박스의 교차 길이를 표시한다. 화면 대부분이 높은 값으로 덮이는 현상은 proxy coverage 진단에 유용하지만 최종 opacity를 직접 나타내지는 않는다.

### Solid Debug

density를 제외하고 ray와 교차한 proxy를 불투명하게 표시한다. 거의 백색인 결과는 많은 proxy가 화면을 점유한다는 뜻이지만, 해당 proxy가 학습 데이터상 잘못된 voxel이라고 단정할 수는 없다.

### Albedo Debug

alpha discard를 통과한 fragment의 SH 색상을 불투명하게 표시한다. 이전 실험은 SH3, octlevel, grid mean, threshold가 함께 적용돼 변수별 영향을 해석할 수 없었다. 현재 프리셋은 SH1과 최소한의 depth/blend 설정만 사용하도록 수정됐다.

## UI에 유지한 프리셋

상시 비교 가치가 있는 실험만 드롭다운에 유지한다.

| 그룹 | 프리셋 |
| --- | --- |
| `Quality Tests` | `Linear Only`, `Samples x8`, `SH3 Only`, `Flat Density`, `Linear + Samples x8` |
| `Render Diagnostics` | `Alpha Debug`, `Albedo Debug`, `Thickness Debug`, `Solid Debug` |

`SH2`, `exp`, `RawDensity`, octlevel 제한, `minGridMean`은 실험 기록에는 남기되 상시 프리셋에서는 제외했다.

## 다음 검증 우선순위

1. 동일한 카메라에서 PT 기준 렌더와 WebGL 결과를 캡처한다.
2. 기준 구현과 WebGL의 density transfer, ray step length, alpha 식을 수식 단위로 대조한다.
3. 동일 시점의 silhouette coverage, 배경 오염 픽셀 비율, 색상 오차를 측정한다.
4. 필요하면 PT와 PLY에서 동일 voxel의 octpath, 8개 grid 값, SH coefficient를 샘플링해 직접 비교한다.

## 관련 파일

- [최종 점검 보고서](./ply-viewer-final-summary.md)
- [src/main.ts](../src/main.ts)
- [src/lib/Viewer.ts](../src/lib/Viewer.ts)
- [scripts/convert_to_ply.py](../scripts/convert_to_ply.py)
