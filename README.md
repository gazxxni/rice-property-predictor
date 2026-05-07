# 쌀 침지 온도 × 냉동조건 → 물성 예측

쌀 20g을 다양한 침지 온도(20–90℃) × 냉동 전처리(-20/-40/-80℃) 조건에서 측정한 TPA + 재수화율 데이터로 학습된 OLS 회귀 모델의 정적 웹 예측기.

**🔗 실시간 사용:** https://gazxxni.github.io/rice-property-predictor

> 위 링크는 GitHub Pages 활성화 후 약 1–2분 뒤 접근 가능.

## 모델

물성별 회귀:

```
y ~ T + T² + freeze + T:freeze
```

- **로그 변환 적용:** Hardness, Gumminess, Chewiness (양수·산포 큼)
- **원값:** 나머지 (Adhesiveness는 음수라 변환 안 함)
- 예측구간(95% PI): `statsmodels` 기준 새 관측치 분포 — 같은 조건 새 실험 시 값이 들어갈 범위

## 검증 (Leave-One-Temperature-Out)

평균 nRMSE 기준:

| 물성 | nRMSE | 판단 |
|---|---:|---|
| Rehydration | 0.08 | 우수 |
| Springiness | 0.28 | — |
| Cohesiveness | 0.53 | 50℃ 피크 미반영 |
| Gumminess | 0.58 | 변동 큼 |
| Resilience | 0.71 | 50℃ 피크 |
| Chewiness | 0.72 | 변동 큼 |
| Hardness | 0.74 | 변동 큼 |
| Adhesiveness | 1.28 | 음수값 |

→ Rehydration 외 물성은 반드시 예측구간과 함께 봐야 함.

## 파일

- `index.html` — UI
- `app.js` — 브라우저 사이드 예측 로직
- `model.json` — 추출된 회귀 계수 / 공분산 / t-분위수
