// 동결건조밥 물성·재수화율 예측 — 브라우저 사이드 OLS 추론

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
  // 탭 스위치
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      // 역예측 탭으로 처음 들어갈 때 자동 실행
      if (btn.dataset.tab === 'reverse' && !els.revAutoRun) {
        runReverse();
        els.revAutoRun = true;
      }
    });
  });

  els.temp = document.getElementById('temp');
  els.tempVal = document.getElementById('tempVal');
  els.freeze = document.getElementById('freeze');
  els.freezeVal = document.getElementById('freezeVal');
  els.alpha = document.getElementById('alpha');
  els.rangeWarn = document.getElementById('rangeWarn');

  els.hardVal = document.getElementById('hardVal');
  els.hardPI = document.getElementById('hardPI');
  els.cohVal = document.getElementById('cohVal');
  els.cohPI = document.getElementById('cohPI');
  els.rehyVal = document.getElementById('rehyVal');
  els.rehyPI = document.getElementById('rehyPI');
  els.hardBadge = document.getElementById('hardBadge');
  els.cohBadge = document.getElementById('cohBadge');
  els.rehyBadge = document.getElementById('rehyBadge');

  els.simGrid = document.getElementById('simGrid');

  els.chartProp = document.getElementById('chartProp');
  els.bProp = document.getElementById('bProp');
  els.bRun = document.getElementById('bRun');
  els.bulkPreview = document.getElementById('bulkPreview');

  els.bestMatch = document.getElementById('bestMatch');
  els.topTableBody = document.getElementById('topTableBody');
  els.revRun = document.getElementById('revRun');
  els.matchHetbahn = document.getElementById('matchHetbahn');
  els.highRehy = document.getElementById('highRehy');

  const tr = MODEL.training_range;
  els.temp.min = tr.temp_min; els.temp.max = tr.temp_max;
  els.freeze.min = tr.freeze_min; els.freeze.max = tr.freeze_max;

  const labelOf = p => p === 'Rehydration' ? 'Rehydration rate' : p;
  MODEL.props.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = labelOf(p);
    if (p === 'Rehydration') opt.selected = true;
    els.chartProp.appendChild(opt);
    els.bProp.appendChild(opt.cloneNode(true));
  });

  els.temp.addEventListener('input', () => { els.tempVal.textContent = els.temp.value; update(); });
  els.freeze.addEventListener('input', () => { els.freezeVal.textContent = els.freeze.value; update(); });
  els.alpha.addEventListener('change', update);
  els.chartProp.addEventListener('change', drawChart);
  els.bRun.addEventListener('click', runBulk);

  // 이분 신뢰도 배지 (좋음/나쁨)
  const setBadge = (el, prop) => {
    const nrmse = MODEL.loto[prop].avg_nRMSE;
    const good = nrmse < 0.30;
    el.className = `badge ${good ? 'good' : 'bad'}`;
    el.textContent = good ? '좋음' : '나쁨';
    el.title = `LOTO nRMSE ${nrmse.toFixed(3)}`;
  };
  setBadge(els.hardBadge, 'Hardness');
  setBadge(els.cohBadge, 'Cohesiveness');
  setBadge(els.rehyBadge, 'Rehydration');

  // 햇반 유사도 행
  const simProps = ['Hardness', 'Cohesiveness'];
  simProps.forEach(p => {
    const row = document.createElement('div');
    row.className = 'sim-row';
    row.innerHTML = `
      <span>${labelOf(p)}</span>
      <div class="sim-bar"><div class="sim-fill" id="sim_fill_${p}" style="width:0%; background:#16a34a;"></div></div>
      <span class="sim-val" id="sim_val_${p}">—</span>
    `;
    els.simGrid.appendChild(row);
  });
  const overall = document.createElement('div');
  overall.className = 'sim-row';
  overall.innerHTML = `
    <span><b>Overall</b></span>
    <div class="sim-bar"><div class="sim-fill" id="sim_fill_overall" style="width:0%; background:#f97316;"></div></div>
    <span class="sim-val" id="sim_val_overall">—</span>
  `;
  els.simGrid.appendChild(overall);

  // 역예측 입력 use 토글 연동
  ['Hardness', 'Cohesiveness', 'Rehydration'].forEach(p => {
    const useEl = document.getElementById(`use_${p}`);
    const tgtEl = document.getElementById(`tgt_${p}`);
    useEl.addEventListener('change', () => { tgtEl.disabled = !useEl.checked; });
  });

  els.revRun.addEventListener('click', runReverse);
  els.matchHetbahn.addEventListener('click', () => {
    document.getElementById('use_Hardness').checked = true;
    document.getElementById('tgt_Hardness').value = MODEL.hetbahn.Hardness.toFixed(2);
    document.getElementById('tgt_Hardness').disabled = false;

    document.getElementById('use_Cohesiveness').checked = true;
    document.getElementById('tgt_Cohesiveness').value = MODEL.hetbahn.Cohesiveness.toFixed(3);
    document.getElementById('tgt_Cohesiveness').disabled = false;

    document.getElementById('use_Rehydration').checked = false;
    document.getElementById('tgt_Rehydration').disabled = true;
    runReverse();
  });
  els.highRehy.addEventListener('click', () => {
    // 데이터셋 최대 재수화율 근처
    document.getElementById('use_Rehydration').checked = true;
    document.getElementById('tgt_Rehydration').value = 280;
    document.getElementById('tgt_Rehydration').disabled = false;

    document.getElementById('use_Hardness').checked = false;
    document.getElementById('tgt_Hardness').disabled = true;

    document.getElementById('use_Cohesiveness').checked = false;
    document.getElementById('tgt_Cohesiveness').disabled = true;
    runReverse();
  });
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

const TEMP_MEASURED = [20, 50, 90];

function update() {
  const T = +els.temp.value;
  const F = +els.freeze.value;
  const alpha = +els.alpha.value;
  const tr = MODEL.training_range;

  const outOfRange = (T < tr.temp_min || T > tr.temp_max || F < tr.freeze_min || F > tr.freeze_max);
  if (outOfRange) {
    els.rangeWarn.style.display = 'block';
    els.rangeWarn.textContent = `⚠ 학습 범위(RT ${tr.temp_min}~${tr.temp_max}℃, FT ${tr.freeze_min}~${tr.freeze_max}℃) 밖 — 외삽`;
  } else {
    els.rangeWarn.style.display = 'none';
  }

  const hard = predict('Hardness', T, F, alpha);
  els.hardVal.textContent = hard.mean.toFixed(0);
  els.hardPI.textContent = `PI ${hard.lo.toFixed(0)} – ${hard.hi.toFixed(0)}`;

  const coh = predict('Cohesiveness', T, F, alpha);
  els.cohVal.textContent = coh.mean.toFixed(3);
  els.cohPI.textContent = `PI ${coh.lo.toFixed(2)} – ${coh.hi.toFixed(2)}`;

  const rehy = predict('Rehydration', T, F, alpha);
  els.rehyVal.textContent = rehy.mean.toFixed(2);
  els.rehyPI.textContent = `PI ${rehy.lo.toFixed(1)} – ${rehy.hi.toFixed(1)}`;

  updateSimilarity({ Hardness: hard.mean, Cohesiveness: coh.mean });
  drawChart();
}

function similarityPct(predicted, target, scale) {
  const d = Math.abs(predicted - target) / scale;
  return Math.max(0, Math.min(1, 1 - d));
}

function updateSimilarity(predicted) {
  const sims = {};
  ['Hardness', 'Cohesiveness'].forEach(p => {
    const tgt = MODEL.hetbahn[p];
    const scale = MODEL.prop_stats.std[p];
    sims[p] = similarityPct(predicted[p], tgt, scale);
  });
  const overall = (sims.Hardness + sims.Cohesiveness) / 2;
  const colorFor = (s) => s >= 0.7 ? '#16a34a' : (s >= 0.4 ? '#f59e0b' : '#ef4444');
  ['Hardness', 'Cohesiveness'].forEach(p => {
    document.getElementById(`sim_fill_${p}`).style.width = `${(sims[p] * 100).toFixed(0)}%`;
    document.getElementById(`sim_fill_${p}`).style.background = colorFor(sims[p]);
    document.getElementById(`sim_val_${p}`).textContent = `${(sims[p] * 100).toFixed(0)}%`;
  });
  document.getElementById('sim_fill_overall').style.width = `${(overall * 100).toFixed(0)}%`;
  document.getElementById('sim_fill_overall').style.background = colorFor(overall);
  document.getElementById('sim_val_overall').textContent = `${(overall * 100).toFixed(0)}%`;
}

function drawChart() {
  const prop = els.chartProp.value;
  const propLabel = prop === 'Rehydration' ? 'Rehydration rate (%)' : (prop === 'Hardness' ? 'Hardness (g)' : prop);
  const F = +els.freeze.value;
  const alpha = +els.alpha.value;
  const tr = MODEL.training_range;

  const Ts = [], means = [], los = [], his = [];
  for (let t = tr.temp_min; t <= tr.temp_max; t += 1) {
    const r = predict(prop, t, F, alpha);
    Ts.push(t); means.push(r.mean); los.push(r.lo); his.push(r.hi);
  }

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
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Rehydration Temperature (℃)' } },
        y: { title: { display: true, text: propLabel } },
      },
    },
  });
}

// ===== 역예측 =====
function runReverse() {
  const targets = {};
  ['Hardness', 'Cohesiveness', 'Rehydration'].forEach(p => {
    const use = document.getElementById(`use_${p}`).checked;
    if (use) targets[p] = +document.getElementById(`tgt_${p}`).value;
  });
  if (Object.keys(targets).length === 0) {
    els.bestMatch.innerHTML = '<p style="color:#b91c1c">하나 이상의 물성을 선택하세요.</p>';
    els.topTableBody.innerHTML = '';
    return;
  }

  const tr = MODEL.training_range;
  const candidates = [];
  for (let T = tr.temp_min; T <= tr.temp_max; T += 1) {
    for (let F = tr.freeze_min; F <= tr.freeze_max; F += 1) {
      let dist = 0;
      const preds = {};
      // 모든 물성 예측 (표시용)
      for (const p of MODEL.props) {
        preds[p] = predict(p, T, F, 0.05);
      }
      // 선택된 물성만 거리 계산
      for (const [p, target] of Object.entries(targets)) {
        const sd = MODEL.prop_stats.std[p] || 1;
        dist += Math.pow((preds[p].mean - target) / sd, 2);
      }
      candidates.push({ T, F, dist: Math.sqrt(dist), preds });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);

  // 상위 5개 — 서로 5℃ 이상 다른 조건만
  const picks = [candidates[0]];
  for (const c of candidates.slice(1)) {
    if (picks.length >= 5) break;
    const farFromAll = picks.every(p => Math.abs(p.T - c.T) >= 5 || Math.abs(p.F - c.F) >= 5);
    if (farFromAll) picks.push(c);
  }

  // Best Match 카드
  const best = picks[0];
  els.bestMatch.innerHTML = `
    <div class="best-match">
      <div class="title">Best Match</div>
      <div class="cond-row">
        <div class="cond-item">
          <div class="cap">Freezing Temp.</div>
          <div class="val">${best.F}℃</div>
        </div>
        <div class="cond-item">
          <div class="cap">Rehydration Temp.</div>
          <div class="val">${best.T}℃</div>
        </div>
      </div>
      <div class="props-row">
        <div class="prop-item">
          <div class="cap">Hardness (g)</div>
          <div class="val">${best.preds.Hardness.mean.toFixed(0)}</div>
        </div>
        <div class="prop-item">
          <div class="cap">Cohesiveness</div>
          <div class="val">${best.preds.Cohesiveness.mean.toFixed(3)}</div>
        </div>
        <div class="prop-item">
          <div class="cap">Rehydration (%)</div>
          <div class="val">${best.preds.Rehydration.mean.toFixed(1)}</div>
        </div>
      </div>
    </div>
  `;

  // Top 5 표
  let rows = '';
  picks.forEach((c, i) => {
    rows += `
      <tr>
        <td class="rank">#${i + 1}</td>
        <td>${c.F}℃</td>
        <td>${c.T}℃</td>
        <td>${c.preds.Hardness.mean.toFixed(0)}</td>
        <td>${c.preds.Cohesiveness.mean.toFixed(3)}</td>
        <td>${c.preds.Rehydration.mean.toFixed(1)}</td>
      </tr>
    `;
  });
  els.topTableBody.innerHTML = rows;

  // 예측 탭 슬라이더도 동기화
  els.temp.value = best.T; els.tempVal.textContent = best.T;
  els.freeze.value = best.F; els.freezeVal.textContent = best.F;
  update();
}

// ===== 일괄 예측 =====
function runBulk() {
  const start = +document.getElementById('bStart').value;
  const end = +document.getElementById('bEnd').value;
  const step = +document.getElementById('bStep').value;
  const prop = els.bProp.value;
  const propLabel = prop === 'Rehydration' ? 'Rehydration rate' : prop;
  const alpha = +els.alpha.value;
  if (step <= 0 || start > end) { alert('범위를 확인하세요'); return; }

  const rows = [['Rehydration Temp. (℃)', 'Freeze Temp. (℃)', '예측값', 'PI하한', 'PI상한']];
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
  a.href = url; a.download = `rice_${propLabel}_${start}-${end}_step${step}.csv`; a.click();
  URL.revokeObjectURL(url);
}

init();
