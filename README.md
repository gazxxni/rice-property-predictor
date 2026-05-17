# 냉동 및 재수화 온도에 따른 동결건조밥의 물성 및 재수화율 예측 모델

쌀 15g + 물 24g, 재수화 온도(20–90℃) × 냉동 온도(-20/-40/-80℃) 조건에서 측정한 동결건조밥의 TPA + 재수화율 데이터로 학습된 OLS 회귀 모델의 정적 웹 예측기.

**🔗 실시간 사용:** https://gazxxni.github.io/rice-property-predictor

## 모델

물성별 회귀:

```
y ~ RT + RT² + FT + FT² + RT:FT + RT:FT²
```

(RT = Rehydration Temp., FT = Freeze Temp.)

- **예측 물성:** Hardness, Cohesiveness, Rehydration rate
- **로그 변환 적용:** Hardness만 (양수·산포 큼)
- **예측구간(95% PI):** `statsmodels` 기준 새 관측치 분포 — 같은 조건 새 실험 시 값이 들어갈 범위

## 검증 (Leave-One-Temperature-Out)

평균 nRMSE 기준:

| 물성 | nRMSE | 판단 |
|---|---:|---|
| Rehydration rate | 0.08 | 우수 |
| Cohesiveness | 0.52 | 50℃ 피크 일부 미반영 |
| Hardness | 0.71 | 반복 변동 큼 — 평균 추세만 신뢰 |

→ Rehydration rate 외 물성은 반드시 예측구간과 함께 봐야 함.

## 데이터셋

- 재수화 온도 3수준 × 냉동 온도 3수준 = 9개 조건
- 조건당 약 12–16 반복 측정
- 총 130 측정 (MAD 기준 이상치 정제)
- 쌀 15g + 물 24g 고정

## 추가 기능

- 햇반(상용 동결건조밥) 평균 물성과의 유사도 시각화
- 역예측: 목표 물성값 → 최적의 RT/FT 조건 검색 (그리드 서치 4,331점)
- "Match Hetbahn" 버튼으로 햇반 물성 자동 입력

## 파일

- `index.html` — UI
- `app.js` — 브라우저 사이드 예측 로직
- `model.json` — 추출된 회귀 계수 / 공분산 / t-분위수 / LOTO 결과
