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
