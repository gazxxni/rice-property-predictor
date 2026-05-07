// 쌀 물성 예측 — 브라우저 사이드 OLS 추론
// 모델 계수는 Python statsmodels에서 model.json으로 export됨

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
      `<p style="color:#b91c1c">모델 로드 실패: ${e.message}<br>같은 폴더에 model.json이 있어야 합니다.</p>`;
    return;
  }
  setupUI();
  document.getElementById('app').style.display = 'none';
  document.getElementById('main').style.display = 'block';
  update();
}

function setupUI() {
  // freeze 라디오 생성
  const fr = document.getElementById('freezeRow');
  fr.innerHTML = '';
  MODEL.freeze_categories.forEach((fz, i) => {
    const id = `fz_${fz}`;
    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.textContent = `${fz} ℃`;
    const inp = document.createElement('input');
    inp.type = 'radio';
    inp.name = 'freeze';
    inp.value = fz;
    inp.id = id;
    if (i === 1) { inp.checked = true; lbl.classList.add('active'); }
    inp.addEventListener('change', () => {
      fr.querySelectorAll('label').forEach(l => l.classList.remove('active'));
      lbl.classList.add('active');
      update();
    });
    lbl.prepend(inp);
    fr.appendChild(lbl);
  });

  els.temp = document.getElementById('temp');
  els.tempVal = document.getElementById('tempVal');
  els.alpha = document.getElementById('alpha');
  els.rangeWarn = document.getElementById('rangeWarn');
  els.rehyVal = document.getElementById('rehyVal');
  els.rehyPI = document.getElementById('rehyPI');
  els.hardVal = document.getElementById('hardVal');
  els.hardPI = document.getElementById('hardPI');
  els.resultBody = document.getElementById('resultBody');
  els.chartProp = document.getElementById('chartProp');
  els.bProp = document.getElementById('bProp');
  els.bRun = document.getElementById('bRun');
  els.bulkPreview = document.getElementById('bulkPreview');

  els.temp.min = MODEL.training_range.temp_min;
  els.temp.max = MODEL.training_range.temp_max;

  // 물성 선택 채우기
  MODEL.props.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    if (p === 'Rehydration') opt.selected = true;
    els.chartProp.appendChild(opt);
    els.bProp.appendChild(opt.cloneNode(true));
  });

  els.temp.addEventListener('input', () => {
    els.tempVal.textContent = els.temp.value;
    update();
  });
  els.alpha.addEventListener('change', update);
  els.chartProp.addEventListener('change', drawChart);

  els.bRun.addEventListener('click', runBulk);
}

function getFreeze() {
  const r = document.querySelector('input[name=freeze]:checked');
  return r ? r.value : MODEL.freeze_categories[0];
}

// ===== 핵심 예측 함수 =====
function buildDesignRow(paramNames, T, freeze) {
  return paramNames.map(n => {
    if (n === 'Intercept') return 1.0;
    if (n === 'temp') return T;
    if (n === 'I(temp ** 2)') return T * T;
    if (n.startsWith('C(freeze)[T.')) {
      const cat = n.slice('C(freeze)[T.'.length, -1);
      return freeze === cat ? 1.0 : 0.0;
    }
    if (n.startsWith('temp:C(freeze)[T.')) {
      const cat = n.slice('temp:C(freeze)[T.'.length, -1);
      return freeze === cat ? T : 0.0;
    }
    throw new Error(`Unknown term: ${n}`);
  });
}

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

function quadForm(x, A) {
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    let row = 0;
    for (let j = 0; j < x.length; j++) row += A[i][j] * x[j];
    s += x[i] * row;
  }
  return s;
}

function predict(prop, T, freeze, alpha) {
  const M = MODEL.models[prop];
  const x = buildDesignRow(M.param_names, T, freeze);
  const yhat = dot(x, M.params);
  const varPred = M.mse_resid * (1.0 + quadForm(x, M.ncp));
  const se = Math.sqrt(varPred);
  const t = M.t_quantiles[(1 - alpha).toFixed(2)];
  let lo = yhat - t * se;
  let hi = yhat + t * se;
  let mean = yhat;
  if (MODEL.log_targets.includes(prop)) {
    mean = Math.exp(yhat);
    lo = Math.exp(lo);
    hi = Math.exp(hi);
  }
  return { mean, lo, hi };
}

// ===== UI 업데이트 =====
function fmt(v, p) {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(p ?? 2);
}

function update() {
  const T = +els.temp.value;
  const freeze = getFreeze();
  const alpha = +els.alpha.value;
  const tr = MODEL.training_range;

  if (T < tr.temp_min || T > tr.temp_max) {
    els.rangeWarn.style.display = 'block';
    els.rangeWarn.textContent = `⚠ T=${T}℃는 학습 범위(${tr.temp_min}–${tr.temp_max}℃) 밖 (외삽).`;
  } else {
    els.rangeWarn.style.display = 'none';
  }

  // 메트릭 카드
  const rehy = predict('Rehydration', T, freeze, alpha);
  els.rehyVal.textContent = rehy.mean.toFixed(2);
  els.rehyPI.textContent = `PI ${rehy.lo.toFixed(1)} – ${rehy.hi.toFixed(1)}`;
  const hard = predict('Hardness', T, freeze, alpha);
  els.hardVal.textContent = hard.mean.toFixed(0);
  els.hardPI.textContent = `PI ${hard.lo.toFixed(0)} – ${hard.hi.toFixed(0)}`;

  // 결과 표
  els.resultBody.innerHTML = '';
  MODEL.props.forEach(p => {
    const r = predict(p, T, freeze, alpha);
    const tr2 = document.createElement('tr');
    tr2.innerHTML = `<td>${p}</td><td>${fmt(r.mean)}</td><td>${fmt(r.lo)}</td><td>${fmt(r.hi)}</td>`;
    els.resultBody.appendChild(tr2);
  });

  drawChart();
}

function drawChart() {
  const prop = els.chartProp.value;
  const freeze = getFreeze();
  const alpha = +els.alpha.value;
  const tr = MODEL.training_range;

  const Ts = [];
  const means = [];
  const los = [];
  const his = [];
  for (let t = tr.temp_min; t <= tr.temp_max; t += 1) {
    const r = predict(prop, t, freeze, alpha);
    Ts.push(t); means.push(r.mean); los.push(r.lo); his.push(r.hi);
  }

  // 실측 평균 점
  const obsX = []; const obsY = [];
  [tr.temp_min, 50, tr.temp_max].forEach(t => {
    const key = `${t}:${freeze}`;
    if (MODEL.cell_means[prop][key] !== undefined) {
      obsX.push(t);
      obsY.push(MODEL.cell_means[prop][key]);
    }
  });

  const ctx = document.getElementById('chart');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Ts,
      datasets: [
        {
          label: 'PI 상한',
          data: his,
          borderColor: 'rgba(37, 99, 235, 0)',
          backgroundColor: 'rgba(37, 99, 235, 0.15)',
          fill: '+1',
          pointRadius: 0,
        },
        {
          label: 'PI 하한',
          data: los,
          borderColor: 'rgba(37, 99, 235, 0)',
          backgroundColor: 'rgba(37, 99, 235, 0.15)',
          fill: false,
          pointRadius: 0,
        },
        {
          label: '예측값',
          data: means,
          borderColor: '#2563eb',
          backgroundColor: '#2563eb',
          fill: false,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: '실측 평균',
          data: obsX.map((x, i) => ({ x, y: obsY[i] })),
          backgroundColor: '#dc2626',
          borderColor: '#dc2626',
          type: 'scatter',
          pointRadius: 5,
          pointHoverRadius: 7,
        },
        {
          label: '현재 입력',
          data: [{ x: +els.temp.value, y: predict(prop, +els.temp.value, freeze, alpha).mean }],
          backgroundColor: '#16a34a',
          borderColor: '#16a34a',
          type: 'scatter',
          pointRadius: 6,
          pointStyle: 'rectRot',
        },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 14 } },
        tooltip: { mode: 'nearest', intersect: false },
      },
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Soaking T (℃)' } },
        y: { title: { display: true, text: prop } },
      },
    },
  });
}

function runBulk() {
  const start = +document.getElementById('bStart').value;
  const end = +document.getElementById('bEnd').value;
  const step = +document.getElementById('bStep').value;
  const prop = els.bProp.value;
  const alpha = +els.alpha.value;

  if (step <= 0 || start > end) {
    alert('범위를 확인하세요'); return;
  }

  const rows = [['T(℃)', 'freeze(℃)', '예측값', 'PI하한', 'PI상한']];
  for (let t = start; t <= end; t += step) {
    MODEL.freeze_categories.forEach(fz => {
      const r = predict(prop, t, fz, alpha);
      rows.push([t, fz, r.mean.toFixed(2), r.lo.toFixed(2), r.hi.toFixed(2)]);
    });
  }

  // 미리보기 표
  let html = '<table><thead><tr>' + rows[0].map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
  for (let i = 1; i < rows.length; i++) {
    html += '<tr>' + rows[i].map(c => `<td>${c}</td>`).join('') + '</tr>';
  }
  html += '</tbody></table>';
  els.bulkPreview.innerHTML = html;

  // CSV 다운로드 (UTF-8 BOM 포함 — Excel 호환)
  const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rice_${prop}_${start}-${end}_step${step}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

init();
