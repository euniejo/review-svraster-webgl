# PLY Viewer 품질 점검 보고서

> 작성일: 2026-07-25
> 대상 모델: `iter020000_model.pt` / `iter020000_model.ply`
> 대상 장면: bonsai

## 1. 데이터 구조 확인

### voxel 개수

PT의 voxel 수와 변환된 PLY의 `element vertex` 수를 비교한 결과는 모두 `4,754,506`개였다.
변환 스크립트도 `octpath`와 `octlevel`에서 계산한 `vox_center`마다 PLY vertex 하나를 생성한다.

근거:

- [scripts/convert_to_ply.py](/Users/euniejo/Documents/Project/svraster-webgl-viewer/scripts/convert_to_ply.py:216)
- [scripts/convert_to_ply.py](/Users/euniejo/Documents/Project/svraster-webgl-viewer/scripts/convert_to_ply.py:235)
- [src/lib/LoadPLY.ts](/Users/euniejo/Documents/Project/svraster-webgl-viewer/src/lib/LoadPLY.ts:166)

이 결과로 확인되는 범위는 `PT -> PLY 변환 과정에서 voxel 개수 손실이 관찰되지 않았다`는 것이다.
voxel 개수가 같다는 사실만으로 octpath, density, SH coefficient의 값과 배열 순서까지 동일하다고 판단할 수는 없다.

## 2. SH3 적용 확인

SH degree `d`에 필요한 rest coefficient 수는 다음과 같다.

```text
((d + 1)^2 - 1) * RGB 3채널
```

따라서 SH3는 `(16 - 1) * 3 = 45`개의 rest coefficient가 필요하다.

현재 구현은 다음 순서로 SH3를 구조적으로 검증한다.

1. 변환 스크립트가 PLY comment에 `active_sh_degree`를 기록한다.
2. `LoadPLY`가 해당 metadata와 `f_rest_*` property 수를 읽는다.
3. `sh=3` 요청 시 voxel당 rest coefficient가 45개 미만이면 로드를 중단한다.
4. 상태 배지에 `SH3 | coefficients 45/45 | ray samples 3` 형식으로 활성 SH 차수, coefficient 사용량과 ray sample 수를 표시한다.

근거:

- [scripts/convert_to_ply.py](/Users/euniejo/Documents/Project/svraster-webgl-viewer/scripts/convert_to_ply.py:273)
- [src/lib/LoadPLY.ts](/Users/euniejo/Documents/Project/svraster-webgl-viewer/src/lib/LoadPLY.ts:144)
- [src/main.ts](/Users/euniejo/Documents/Project/svraster-webgl-viewer/src/main.ts)
- [src/lib/SphericalHarmonics.ts](/Users/euniejo/Documents/Project/svraster-webgl-viewer/src/lib/SphericalHarmonics.ts:22)

따라서 현재 확인된 결론은 `SH3 metadata, coefficient 개수, shader 활성화 경로가 정상적으로 연결되어 있다`는 것이다.
계수의 수치와 배열 순서가 PT 기준 렌더러와 완전히 동일한지는 별도의 샘플 값 비교 또는 기준 이미지 비교가 필요하다.

## 3. 이번 점검에서 테스트한 항목

왼쪽 `Viewer Baseline (SH1)`은 뷰어 기본 렌더링 설정을 의미한다. PT 학습 코드의 기준 렌더러 출력이나 ground truth 이미지를 의미하지 않는다.

### 핵심 품질 실험

| 가설 | 조정값 / 방법 | 확인용 프리셋 UI | 관찰 결과 | 판정 |
| --- | --- | --- | --- | --- |
| 낮은 SH 차수가 색상 품질 저하의 원인이다 | `sh=1`, `sh=2`, `sh=3` 비교 | `SH3 Only` | SH2/SH3에서 의미 있는 품질 개선이 확인되지 않았고, 일부 시점에서는 백색 포화가 증가함 | SH3 적용은 정상이나 핵심 개선안은 아님 |
| trilinear density 보간이 블록 또는 점상 아티팩트를 만든다 | `densityMode=trilinear`, `flat` 비교 | `Flat Density` | flat에서도 모델 식별성과 노이즈가 개선되지 않음 | 보간 방식만의 문제라는 가설은 지지되지 않음 |
| density transfer가 불투명도를 과도하게 증폭한다 | `explin`, `linear`, `exp` 비교 | `Linear Only` | linear가 상대적으로 블록 경계를 줄인 경우가 있었으나 단독 개선 폭은 작았고, exp는 sparse speckle이 증가함 | linear만 후속 비교 대상으로 유지 |
| voxel 내부 적분 샘플이 부족하다 | `samples=3`, `samples=8` 비교 | `Samples x8` | 일부 시점에서 미세한 안정화만 관찰되었으며 큰 개선은 없음 | 보조 조정값으로만 유지 |
| linear와 samples 증가를 함께 적용하면 개선된다 | SH1에서 `densityTransfer=linear`, `samples=8` 적용 | `Linear + Samples x8` | 장면에 따라 baseline보다 백색 포화와 모델 소실이 증가함 | 현재 조합은 채택하지 않음 |

### 렌더링 진단

| 진단 목적 | 조정값 / 방법 | 확인용 프리셋 UI | 관찰 결과 | 해석 범위 |
| --- | --- | --- | --- | --- |
| 최종 opacity 분포 확인 | `renderDebug=alpha` | `Alpha Debug` | 복셀 경계가 강하게 드러나고 모델 형태보다 불규칙한 alpha 분포가 우세함 | density/alpha 누적 경로의 이상 징후 확인용 |
| ray가 통과하는 복셀 두께 확인 | `renderDebug=thickness` | `Thickness Debug` | 화면 대부분이 높은 두께값으로 덮여 모델 실루엣 분리가 어려움 | proxy geometry의 화면 점유와 ray 교차 진단용 |
| density와 무관한 proxy coverage 확인 | `renderDebug=solid`, `blend=off`, `depth=on` | `Solid Debug` | 화면이 거의 백색으로 채워짐 | 다수의 복셀 proxy가 화면을 덮고 있음을 보여 주지만 단독으로 root cause를 확정하지는 못함 |
| SH 색상 경로 분리 | `renderDebug=albedo`, `blend=off`, `depth=on`, SH1 | `Albedo Debug` | 기존 실험은 여러 필터가 섞여 있었으므로 결과를 분리해 해석할 수 없었음 | alpha discard를 통과한 fragment의 SH 색상을 확인하며, 현재 구성으로 동일 시점 재확인이 필요함 |

### 수행했지만 상시 프리셋에서 제외한 실험

| 항목 | 수행 내용 | 결과 | 드롭다운 제외 이유 |
| --- | --- | --- | --- |
| SH2 | SH1과 SH3 사이 차수 확인 | 의미 있는 중간 개선 없음 | SH3 비교와 중복 |
| exponential transfer | `densityTransfer=exp` | 모델 윤곽 감소와 sparse speckle 증가 | 명확한 악화 설정 |
| raw density 표시 | `rawDensityBias`, `rawDensityScale` 조정 | 임의의 표시 범위에 따라 영상이 크게 변함 | 정량 범위 없이 육안 판정하기 어려움 |
| octlevel 제한 | `minOct/maxOct=12~16`, `14~15` | 일부 중심 신호만 남고 전체 품질 저하 | 최종 품질 옵션이 아닌 일회성 공간 분포 진단 |
| grid mean 제한 | `minGridMean` 및 octlevel 제한 조합 | 중심부 소수 voxel만 남고 배경 speckle 지속 | 저평균 density 제거가 유효한 빈 voxel 판별 기준으로 확인되지 않음 |
| SH 방향 반전 | camera-to-voxel과 voxel-to-camera 비교 | 방향 반전에 따른 차이는 크지만 어느 방향이 기준과 일치하는지는 판정 불가 | 기준 렌더 또는 카메라 규약이 필요함 |
| 카메라 거리 | 초기 카메라 거리를 일시 변경 | 멀어질수록 모델 판독만 어려워짐 | 렌더링 원인 분석에 추가 정보가 없었음 |

## 4. 비교 UI

기본 화면은 항상 다음 구조를 사용한다.

- 왼쪽: `Viewer Baseline (SH1)` 고정
- 오른쪽: 드롭다운에서 선택한 프리셋
- 프리셋 변경 시 오른쪽만 다시 로드하며 마지막 동기화 카메라 위치를 유지
- 각 프리셋은 기존 URL의 렌더링 파라미터를 상속하지 않고 동일한 baseline에서 시작

드롭다운은 다음 두 그룹으로 구성한다.

| 그룹 | 프리셋 |
| --- | --- |
| `Quality Tests` | `Linear Only`, `Samples x8`, `SH3 Only`, `Flat Density`, `Linear + Samples x8` |
| `Render Diagnostics` | `Alpha Debug`, `Albedo Debug`, `Thickness Debug`, `Solid Debug` |

## 5. 결론

현재까지 확인된 내용은 다음과 같다.

- PT와 PLY의 voxel 개수는 같으며 개수 손실은 관찰되지 않았다.
- SH3에 필요한 45개 rest coefficient의 로드와 shader 활성화 경로는 정상이다.
- SH 차수 증가, density 보간 변경, 적분 샘플 증가만으로는 의미 있는 품질 향상이 확인되지 않았다.
- solid, thickness, alpha 진단 결과를 종합하면 voxel proxy coverage와 density/alpha compositing 경로가 우선 점검 대상이다.

마지막 항목은 현재 증거에 기반한 우선순위이며 확정된 root cause는 아니다. 확정하려면 동일 카메라의 PT 기준 렌더 이미지와 WebGL 결과를 비교하고, density 변환식과 compositing 순서를 기준 구현과 대조해야 한다.

## 6. 보고용 요약

```text
PT와 변환된 PLY의 voxel 수는 4,754,506개로 일치했으며,
SH3 metadata와 voxel당 45개 rest coefficient의 로드 경로도 정상적으로 확인됐다.
다만 SH 차수, density 보간, 적분 샘플 수를 조정해도 의미 있는 품질 개선은 나타나지 않았다.
현재는 voxel proxy coverage와 density/alpha compositing 경로를 우선 점검 대상으로 보고 있다.
```

## 7. 참고 URL

- 기본 baseline 대 프리셋 비교: `?compare=preset`
- SH1 대 SH3 직접 비교: `?compare=sh13`
- linear 대 samples 직접 비교: `?compare=tuning`
- SH 방향 진단: `?compare=viewdir`

## 8. 관련 파일

- [scripts/convert_to_ply.py](/Users/euniejo/Documents/Project/svraster-webgl-viewer/scripts/convert_to_ply.py)
- [src/lib/LoadPLY.ts](/Users/euniejo/Documents/Project/svraster-webgl-viewer/src/lib/LoadPLY.ts)
- [src/lib/SphericalHarmonics.ts](/Users/euniejo/Documents/Project/svraster-webgl-viewer/src/lib/SphericalHarmonics.ts)
- [src/lib/Viewer.ts](/Users/euniejo/Documents/Project/svraster-webgl-viewer/src/lib/Viewer.ts)
- [src/main.ts](/Users/euniejo/Documents/Project/svraster-webgl-viewer/src/main.ts)
