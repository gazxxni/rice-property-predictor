// 쌀 물성 예측 — 브라우저 사이드 OLS 추론
// 모델: y ~ T + T² + freeze + freeze² + T:freeze + T:freeze²
// 모든 변수 연속. 측정점(20/50/90℃ × -20/-40/-80℃)에서는 카테고리 모델과 정확히 동일.

let MODEL = null;
let chart = null;
const els = {};

async function init() {
  try {
    const res = await fetch('model.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    MODEL = await res.json();
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<p style="color:#b91c1c">모델 로드 실패: ${e.message}</p>`;
    return;
  }
  setupUI();
  document.getElementById('app').style.display = 'none';
  document.getElementById('main').style.display = 'block';
  update();
}

function setupUI() {
  els.temp = document.getElementById('temp');
  els.tempVal = document.getElementById('tempVal');
  els.freeze = document.getElementById('freeze');
  els.freezeVal = document.getElementById('freezeVal');
  els.alpha = document.getElementById('alpha');
  els.rangeWarn = document.getElementById('rangeWarn');
  els.rehyVal = document.getElementById('rehyVal');
  els.rehyPI = document.getElementById('rehyPI');
  els.hardVal = document.getElementById('hardVal');
  els.hardPI = document.getElementById('hardPI');
  els.cohVal = document.getElementById('cohVal');
  els.cohPI = document.getElementById('cohPI');
  els.rehyBadge = document.getElementById('rehyBadge');
  els.hardBadge = document.getElementById('hardBadge');
  els.cohBadge = document.getElementById('cohBadge');
  els.targetGrid = document.getElementById('targetGrid');
  els.revRun = document.getElementById('revRun');
  els.revResults = document.getElementById('revResults');
  els.chartProp = document.getElementById('chartProp');
  els.bProp = document.getElementById('bProp');
  els.bRun = document.getElementById('bRun');
  els.bulkPreview = document.getElementById('bulkPreview');

  const tr = MODEL.training_range;
  els.temp.min = tr.temp_min; els.temp.max = tr.temp_max;
  els.freeze.min = tr.freeze_min; els.freeze.max = tr.freeze_max;

  MODEL.props.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    if (p === 'Rehydration') opt.selected = true;
    els.chartProp.appendChild(opt);
    els.bProp.appendChild(opt.cloneNode(true));
  });

  els.temp.addEventListener('input', () => { els.tempVal.textContent = els.temp.value; update(); });
  els.freeze.addEventListener('input', () => { els.freezeVal.textContent = els.freeze.value; update(); });
  els.alpha.addEventListener('change', update);
  els.chartProp.addEventListener('change', drawChart);
  els.bRun.addEventListener('click', runBulk);

  // 신뢰도 배지 한 번 설정
  const badgeText = { high: '🟢 우수', medium: '🟡 보통', low: '🔴 변동 큼' };
  const setBadge = (el, prop) => {
    const g = MODEL.loto[prop].grade;
    el.className = `badge ${g}`;
    el.textContent = badgeText[g];
    el.title = `LOTO nRMSE ${MODEL.loto[prop].avg_nRMSE.toFixed(3)}`;
  };
  setBadge(els.rehyBadge, 'Rehydration');
  setBadge(els.hardBadge, 'Hardness');
  setBadge(els.cohBadge, 'Cohesiveness');

  // 역방향 예측 입력 행 만들기
  MODEL.props.forEach(p => {
    const def = MODEL.cell_means[p][`50:-40`] ?? MODEL.prop_stats.mean[p];
    const step = Math.abs(def) < 1 ? 0.01 : (Math.abs(def) < 50 ? 0.5 : 5);
    const row = document.createElement('div');
    row.className = 'target-row';
    row.innerHTML = `
      <input type="checkbox" id="use_${p}" ${p === 'Rehydration' ? 'checked' : ''}>
      <label for="use_${p}">${p}</label>
      <input type="number" id="tgt_${p}" value="${def.toFixed(Math.abs(def) < 1 ? 3 : (Math.abs(def) < 50 ? 2 : 0))}" step="${step}">
    `;
    els.targetGrid.appendChild(row);
  });
  els.revRun.addEventListener('click', runReverse);
}

// ===== 디자인 행렬 행 빌더 =====
function buildDesignRow(paramNames, T, F) {
  return paramNames.map(n => {
    if (n === 'Intercept') return 1.0;
    if (n === 'temp') return T;
    if (n === 'I(temp ** 2)') return T * T;
    if (n === 'freeze') return F;
    if (n === 'I(freeze ** 2)') return F * F;
    if (n === 'temp:freeze') return T * F;
    if (n === 'temp:I(freeze ** 2)') return T * F * F;
    throw new Error(`Unknown term: ${n}`);
  });
}
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
function quadForm(x, A) {
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    let row = 0;
    for (let j = 0; j < x.length; j++) row += A[i][j] * x[j];
    s += x[i] * row;
  }
  return s;
}

function predict(prop, T, F, alpha) {
  const m = MODEL.models[prop];
  const x = buildDesignRow(m.param_names, T, F);
  const yhat = dot(x, m.params);
  const varPred = m.mse_resid * (1.0 + quadForm(x, m.ncp));
  const se = Math.sqrt(varPred);
  const t = m.t_quantiles[(1 - alpha).toFixed(2)];
  let lo = yhat - t * se, hi = yhat + t * se, mean = yhat;
  if (MODEL.log_targets.includes(prop)) {
    mean = Math.exp(yhat); lo = Math.exp(lo); hi = Math.exp(hi);
  }
  return { mean, lo, hi };
}

// ===== UI 갱신 =====
function fmt(v) {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

const TEMP_MEASURED = [20, 50, 90];

function update() {
  const T = +els.temp.value;
  const F = +els.freeze.value;
  const alpha = +els.alpha.value;
  const tr = MODEL.training_range;

  // 외삽 경고
  const outOfRange = (T < tr.temp_min || T > tr.temp_max || F < tr.freeze_min || F > tr.freeze_max);
  if (outOfRange) {
    els.rangeWarn.style.display = 'block';
    els.rangeWarn.textContent = `⚠ 학습 범위(T ${tr.temp_min}~${tr.temp_max}℃, freeze ${tr.freeze_min}~${tr.freeze_max}℃) 밖 — 외삽`;
  } else {
    els.rangeWarn.style.display = 'none';
  }

  const rehy = predict('Rehydration', T, F, alpha);
  els.rehyVal.textContent = rehy.mean.toFixed(2);
  els.rehyPI.textContent = `PI ${rehy.lo.toFixed(1)} – ${rehy.hi.toFixed(1)}`;
  const hard = predict('Hardness', T, F, alpha);
  els.hardVal.textContent = hard.mean.toFixed(0);
  els.hardPI.textContent = `PI ${hard.lo.toFixed(0)} – ${hard.hi.toFixed(0)}`;
  const coh = predict('Cohesiveness', T, F, alpha);
  els.cohVal.textContent = coh.mean.toFixed(3);
  els.cohPI.textContent = `PI ${coh.lo.toFixed(2)} – ${coh.hi.toFixed(2)}`;

  drawChart();
}

function drawChart() {
  const prop = els.chartProp.value;
  const F = +els.freeze.value;
  const alpha = +els.alpha.value;
  const tr = MODEL.training_range;

  const Ts = [], means = [], los = [], his = [];
  for (let t = tr.temp_min; t <= tr.temp_max; t += 1) {
    const r = predict(prop, t, F, alpha);
    Ts.push(t); means.push(r.mean); los.push(r.lo); his.push(r.hi);
  }

  // 실측 평균 점 (현재 freeze가 측정점일 때만 표시)
  const obsX = [], obsY = [];
  if (MODEL.freeze_values_measured.includes(F)) {
    TEMP_MEASURED.forEach(t => {
      const key = `${t}:${F}`;
      if (MODEL.cell_means[prop][key] !== undefined) {
        obsX.push(t); obsY.push(MODEL.cell_means[prop][key]);
      }
    });
  }

  const ctx = document.getElementById('chart');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Ts,
      datasets: [
        { label: 'PI 상한', data: his, borderColor: 'rgba(37,99,235,0)', backgroundColor: 'rgba(37,99,235,0.15)', fill: '+1', pointRadius: 0 },
        { label: 'PI 하한', data: los, borderColor: 'rgba(37,99,235,0)', backgroundColor: 'rgba(37,99,235,0.15)', fill: false, pointRadius: 0 },
        { label: '예측값', data: means, borderColor: '#2563eb', backgroundColor: '#2563eb', fill: false, pointRadius: 0, borderWidth: 2 },
        { label: '실측 평균', data: obsX.map((x, i) => ({ x, y: obsY[i] })), backgroundColor: '#dc2626', borderColor: '#dc2626', type: 'scatter', pointRadius: 5, pointHoverRadius: 7 },
        { label: '현재 입력', data: [{ x: +els.temp.value, y: predict(prop, +els.temp.value, F, alpha).mean }], backgroundColor: '#16a34a', borderColor: '#16a34a', type: 'scatter', pointRadius: 6, pointStyle: 'rectRot' },
      ],
    },
    options: {
      responsive: true, animation: false,
      plugins: { legend: { position: 'top', labels: { boxWidth: 14 } }, tooltip: { mode: 'nearest', intersect: false } },
      scales: { x: { type: 'linear', title: { display: true, text: 'Soaking T (℃)' } }, y: { title: { display: true, text: prop } } },
    },
  });
}

function runReverse() {
  const targets = {};
  MODEL.props.forEach(p => {
    const use = document.getElementById(`use_${p}`).checked;
    if (use) targets[p] = +document.getElementById(`tgt_${p}`).value;
  });
  if (Object.keys(targets).length === 0) {
    els.revResults.innerHTML = '<p style="color:#b91c1c">하나 이상의 물성을 선택하고 목표값을 입력하세요.</p>';
    return;
  }

  const tr = MODEL.training_range;
  const candidates = [];
  // 그리드 서치 (T 1℃ 간격, F 1℃ 간격)
  for (let T = tr.temp_min; T <= tr.temp_max; T += 1) {
    for (let F = tr.freeze_min; F <= tr.freeze_max; F += 1) {
      let dist = 0;
      const preds = {};
      for (const [p, target] of Object.entries(targets)) {
        const r = predict(p, T, F, 0.05);
        preds[p] = r;
        // 정규화 거리 — 물성 표준편차로 나눠 단위 차이 제거
        const sd = MODEL.prop_stats.std[p] || 1;
        dist += Math.pow((r.mean - target) / sd, 2);
      }
      candidates.push({ T, F, dist: Math.sqrt(dist), preds });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);

  // 상위 3개 표시 (서로 좀 다른 조건만 — 1℃ 차이는 거의 중복이라 5℃ 이상 다른 것 우선)
  const picks = [candidates[0]];
  for (const c of candidates.slice(1)) {
    if (picks.length >= 3) break;
    const farFromAll = picks.every(p => Math.abs(p.T - c.T) >= 5 || Math.abs(p.F - c.F) >= 5);
    if (farFromAll) picks.push(c);
  }

  let html = '';
  picks.forEach((c, i) => {
    const klass = i === 0 ? 'rev-card' : 'rev-card alt';
    const label = i === 0 ? '🥇 최적' : `대안 ${i}`;
    let predHtml = '';
    for (const [p, r] of Object.entries(c.preds)) {
      const tgt = targets[p];
      const fmtN = (v) => Math.abs(v) >= 100 ? v.toFixed(0) : (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3));
      predHtml += `<span>${p}: <b>${fmtN(r.mean)}</b> <span style="color:var(--muted)">(목표 ${fmtN(tgt)}, PI ${fmtN(r.lo)}–${fmtN(r.hi)})</span></span>`;
    }
    html += `
      <div class="${klass}">
        <div class="head">
          <div class="cond">${label}: T = ${c.T}℃, freeze = ${c.F}℃</div>
          <div class="score">정규화 거리 ${c.dist.toFixed(3)}</div>
        </div>
        <div class="preds">${predHtml}</div>
      </div>`;
  });
  els.revResults.innerHTML = html;

  // 슬라이더도 1위 결과로 이동
  els.temp.value = picks[0].T; els.tempVal.textContent = picks[0].T;
  els.freeze.value = picks[0].F; els.freezeVal.textContent = picks[0].F;
  update();
}

function runBulk() {
  const start = +document.getElementById('bStart').value;
  const end = +document.getElementById('bEnd').value;
  const step = +document.getElementById('bStep').value;
  const prop = els.bProp.value;
  const alpha = +els.alpha.value;
  if (step <= 0 || start > end) { alert('범위를 확인하세요'); return; }

  const rows = [['T(℃)', 'freeze(℃)', '예측값', 'PI하한', 'PI상한']];
  for (let t = start; t <= end; t += step) {
    MODEL.freeze_values_measured.forEach(fz => {
      const r = predict(prop, t, fz, alpha);
      rows.push([t, fz, r.mean.toFixed(2), r.lo.toFixed(2), r.hi.toFixed(2)]);
    });
  }

  let html = '<table><thead><tr>' + rows[0].map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
  for (let i = 1; i < rows.length; i++) html += '<tr>' + rows[i].map(c => `<td>${c}</td>`).join('') + '</tr>';
  html += '</tbody></table>';
  els.bulkPreview.innerHTML = html;

  const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `rice_${prop}_${start}-${end}_step${step}.csv`; a.click();
  URL.revokeObjectURL(url);
}

init();
