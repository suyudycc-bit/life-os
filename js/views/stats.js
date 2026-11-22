// M4 時間統計（Phase 2）：數字卡、近 7 天長條圖、領域占比、本週任務預計與實際、手動補記、計時紀錄
import * as data from '../data.js?v=202611221644';
import { state, refreshTasks } from '../store.js?v=202611221644';
import { $, esc, toast, confirmDialog, areaChip, durationHTML } from '../ui.js?v=202611221644';
import { today, addDays, formatShort, formatMin, formatHMS, formatSignedHMS, formatTime, localDate, fromLocalInput, toLocalInput } from '../dates.js?v=202611221644';

// Chart.js 固定版本，從 jsDelivr 載入（CLAUDE.md 技術棧）
const CHART_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/auto/+esm';
let chartLib = null;
const loadChart = () => (chartLib ||= import(CHART_CDN).then((m) => m.default));

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
const weekdayOf = (d) => WEEKDAY[new Date(`${d}T12:00:00+08:00`).getUTCDay()];

// 20261121「照計畫走了嗎」的期間（不記住，預設近 30 天）
const SCHED_RANGES = { d7: ['近 7 天', 6], d30: ['近 30 天', 29], d90: ['近 90 天', 89] };
let schedRange = 'd30';

export function mountStats(root) {
  root.innerHTML = `
    <header class="page-head"><h1>時間統計</h1><p class="sub" id="st-range"></p></header>
    <section class="stats stats-4">
      <div class="card stat"><div class="stat-label">今日累計</div><div class="stat-num" id="st-today"></div><div class="stat-note" id="st-today-note"></div></div>
      <div class="card stat"><div class="stat-label">本週累計</div><div class="stat-num" id="st-week"></div><div class="stat-note" id="st-week-note"></div></div>
      <div class="card stat"><div class="stat-label">本週預計</div><div class="stat-num" id="st-est"></div><div class="stat-note"></div></div>
      <div class="card stat"><div class="stat-label">預計與實際差</div><div class="stat-num" id="st-diff"></div><div class="stat-note" id="st-diff-note"></div></div>
    </section>
    <div class="grid-2">
      <section class="card">
        <h2>近 7 天每日用時</h2>
        <div class="chart-box"><canvas id="st-bar" aria-label="近 7 天每日用時長條圖"></canvas></div>
        <p class="sub chart-text" id="st-bar-text"></p>
      </section>
      <section class="card">
        <h2>本週領域占比</h2>
        <div class="chart-box donut"><canvas id="st-donut" aria-label="本週各領域用時占比"></canvas></div>
        <ul class="legend" id="st-legend"></ul>
      </section>
    </div>
    <section class="card">
      <h2>本週任務：預計與實際</h2>
      <div class="table-wrap"><table class="table" id="st-table"></table></div>
    </section>
    <section class="card" id="st-sched">
      <div class="card-head"><h2>照計畫走了嗎</h2>
        <div class="seg" id="sc-range">${Object.entries(SCHED_RANGES).map(([k, [l]]) => `<button type="button" data-v="${k}">${l}</button>`).join('')}</div></div>
      <div class="sc-grid">
        <div><b id="sc-rate"></b><span id="sc-rate-note"></span></div>
        <div><b id="sc-late"></b><span>晚完成的平均晚幾天</span></div>
        <div><b id="sc-moves"></b><span id="sc-moves-note"></span></div>
        <div><b id="sc-push"></b><span>每次平均往後延幾天</span></div>
      </div>
      <div class="sc-cols">
        <div><h3>延期原因</h3><ol id="sc-reasons"></ol></div>
        <div><h3>一直被延的（還沒做完）</h3><ul id="sc-repeat"></ul></div>
      </div>
    </section>
    <div class="grid-2">
      <section class="card">
        <h2>手動補記</h2>
        <form id="st-manual" class="manual-form">
          <label>任務<select name="task_id" required></select></label>
          <div class="row">
            <label>開始<input type="datetime-local" name="start" required></label>
            <label>結束<input type="datetime-local" name="end" required></label>
          </div>
          <div class="dialog-actions"><button class="btn-primary">補記</button></div>
        </form>
      </section>
      <section class="card">
        <h2>最近的計時紀錄</h2>
        <ul class="entry-list" id="st-entries"></ul>
      </section>
    </div>`;

  const form = $('#st-manual', root);
  const now = new Date();
  form.end.value = toLocalInput(now.toISOString());
  form.start.value = toLocalInput(new Date(now - 30 * 60000).toISOString());
  form.onsubmit = async (e) => {
    e.preventDefault();
    const task = state.tasks.find((t) => t.id === form.task_id.value);
    try {
      await data.addManualEntry(task, fromLocalInput(form.start.value), fromLocalInput(form.end.value));
      await refreshTasks();
      toast('已補記');
    } catch (err) {
      toast(err.message, true);
    }
  };

  $('#st-entries', root).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    if (!(await confirmDialog('確定刪除這筆計時紀錄？任務的實際用時會跟著扣掉。'))) return;
    try {
      await data.deleteEntry(b.dataset.del);
      await refreshTasks();
      toast('已刪除');
    } catch (err) {
      toast(err.message, true);
    }
  });

  let bar = null;
  let donut = null;

  $('#sc-range', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) { schedRange = b.dataset.v; renderSchedule(); }
  });

  function renderSchedule() {
    const to = today();
    const from = addDays(to, -SCHED_RANGES[schedRange][1]);
    root.querySelectorAll('#sc-range button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === schedRange)));
    const sc = data.scheduleStats({ tasks: state.life.tasks, reschedules: state.reschedules || [], from, to });
    $('#sc-rate', root).textContent = sc.onTimeRate == null ? '—' : `${sc.onTimeRate}%`;
    $('#sc-rate-note', root).textContent = sc.finished ? `準時完成（${sc.onTime}／${sc.finished} 件）` : '這段期間還沒有完成有日期的任務';
    $('#sc-late', root).textContent = sc.avgLateDays == null ? '—' : `${sc.avgLateDays} 天`;
    $('#sc-moves', root).textContent = `${sc.postponements} 次`;
    $('#sc-moves-note', root).textContent = `延期（${sc.postponedTasks} 件任務）`;
    $('#sc-push', root).textContent = sc.avgPushDays == null ? '—' : `${sc.avgPushDays} 天`;
    $('#sc-reasons', root).innerHTML = sc.reasons.length
      ? sc.reasons.map((r) => `<li>${esc(r.label)}：${r.n} 次</li>`).join('') : '<li class="empty">這段期間沒有延期</li>';
    $('#sc-repeat', root).innerHTML = sc.repeat.length
      ? sc.repeat.map((r) => `<li>${esc(r.task.title)}<span class="sub">・延 ${r.count} 次，原本 ${formatShort(r.original)}</span></li>`).join('')
      : '<li class="empty">沒有延兩次以上的任務</li>';
  }

  return function render() {
    renderSchedule();
    const s = data.timeStats(state.life.entries, state.life.tasks); // 生活的時間統計，不含工作看板的工作
    const area = (id) => state.areasById[id];
    $('#st-range', root).textContent = `本週 ${formatShort(s.weekStart)}–${formatShort(s.weekEnd)}（台北時間）`;
    const r = state.running;
    const rDay = r ? localDate(r.started_at) : null;
    $('#st-today', root).innerHTML = durationHTML(s.todaySec, rDay === today() ? r.started_at : null);
    $('#st-today-note', root).textContent = rDay === today() ? '含進行中的計時（即時）' : '今天的計時加總';
    $('#st-week', root).innerHTML = durationHTML(s.weekSec, rDay && rDay >= s.weekStart ? r.started_at : null);
    $('#st-est', root).textContent = formatMin(s.weekEstimate);
    const diffEl = $('#st-diff', root);
    if (s.weekDiffSec == null) {
      diffEl.textContent = '—';
      $('#st-diff-note', root).textContent = '本週任務還沒有填預計時間';
    } else {
      const d = s.weekDiffSec;
      // 任務可能還沒做完，負數不代表「省」，所以只用正負號、超過預計才標紅
      diffEl.textContent = formatSignedHMS(d);
      diffEl.className = `stat-num ${d > 0 ? 'over' : ''}`;
      $('#st-diff-note', root).textContent = '實際 − 預計；+ 表示超過預計（只計有預計時間的任務）';
    }

    // 文字版（顏色不是唯一資訊，docs/03）
    $('#st-bar-text', root).textContent = s.last7.map((d) => `${formatShort(d.day)} ${formatHMS(d.totalSec)}`).join('・');
    $('#st-legend', root).innerHTML = s.weekAreaShare.length
      ? s.weekAreaShare.map((x) => `<li>${areaChip(area(x.area_id))}<span>${formatHMS(x.sec)}</span><b>${x.pct}%</b></li>`).join('')
      : '<li class="empty">本週還沒有計時紀錄。到任務上按「▶ 計時」開始吧。</li>';

    $('#st-table', root).innerHTML = s.weekTasks.length ? `
      <thead><tr><th>任務</th><th>領域</th><th>預計</th><th>實際</th><th title="實際 − 預計；+ 表示超過預計">差異（實際−預計）</th></tr></thead>
      <tbody>${s.weekTasks.map((r) => `
        <tr>
          <td>${esc(r.task.title)}${r.task.status === 'done' ? ' <span class="tag">完成</span>' : ''}</td>
          <td>${areaChip(area(r.task.area_id))}</td>
          <td>${r.estimate == null ? '—' : formatMin(r.estimate)}</td>
          <td>${formatHMS(r.actualSec)}</td>
          <td class="${r.diffSec > 0 ? 'over' : ''}">${r.diffSec == null ? '—' : formatSignedHMS(r.diffSec)}</td>
        </tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="empty">本週還沒有任務或計時紀錄。</td></tr></tbody>';

    // 補記的任務選單：未完成在前，保留目前選擇
    const sel = form.task_id;
    const keep = sel.value;
    sel.innerHTML = [...state.life.tasks].sort(data.compareTasks)
      .map((t) => `<option value="${t.id}">${data.isOpen(t) ? '' : '（已完成）'}${esc(t.title)}</option>`).join('');
    if (keep && state.life.tasks.some((t) => t.id === keep)) sel.value = keep;

    const title = (id) => state.tasks.find((t) => t.id === id)?.title ?? '（已刪除的任務）';
    $('#st-entries', root).innerHTML = state.life.entries.length ? state.life.entries.slice(0, 20).map((e) => `
      <li>
        <div>
          <div>${esc(title(e.task_id))}</div>
          <div class="task-meta">
            ${areaChip(area(e.area_id))}
            <span>${formatShort(localDate(e.started_at))} ${formatTime(e.started_at)}–${e.ended_at ? formatTime(e.ended_at) : '進行中'}</span>
            <span class="tag">${e.source === 'manual' ? '補記' : '計時'}</span>
          </div>
        </div>
        <span class="entry-min">${e.ended_at ? formatHMS(data.entrySeconds(e)) : '計時中'}</span>
        ${e.ended_at ? `<button class="btn-ghost danger" data-del="${e.id}" aria-label="刪除這筆紀錄">刪除</button>` : ''}
      </li>`).join('') : '<li class="empty">還沒有計時紀錄。</li>';

    drawCharts(s);
  };

  async function drawCharts(s) {
    let Chart;
    try {
      Chart = await loadChart();
    } catch {
      $('#st-bar-text', root).textContent += '（圖表元件載入失敗，請檢查網路）';
      return;
    }
    if (!root.isConnected || !$('#st-bar', root)) return;
    const areas = state.life.areas;
    const barData = {
      labels: s.last7.map((d) => (d.day === today() ? '今天' : `${formatShort(d.day)}(${weekdayOf(d.day)})`)),
      datasets: areas.map((a) => ({
        label: a.name,
        data: s.last7.map((d) => Math.round(((d.byArea[a.id] || 0) / 60) * 10) / 10),
        backgroundColor: a.color || '#888',
        borderRadius: 4,
      })).filter((ds) => ds.data.some(Boolean)),
    };
    const tooltipFor = (toSec) => ({ callbacks: { label: (c) => `${c.dataset.label || c.label}：${formatHMS(toSec(c.raw))}` } });
    if (bar) {
      bar.data = barData;
      bar.update();
    } else {
      // 圖表文字跟頁面同一套字型與墨水色（DESIGN.md）
      const css = getComputedStyle(document.documentElement);
      Chart.defaults.font.family = css.fontFamily;
      Chart.defaults.color = css.getPropertyValue('--sub').trim() || '#5a6662';
      bar = new Chart($('#st-bar', root), {
        type: 'bar',
        data: barData,
        options: {
          maintainAspectRatio: false,
          animation: false,
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, title: { display: true, text: '分鐘' } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } }, tooltip: tooltipFor((m) => m * 60) },
        },
      });
    }
    const donutData = {
      labels: s.weekAreaShare.map((x) => state.areasById[x.area_id]?.name ?? '其他'),
      datasets: [{
        data: s.weekAreaShare.map((x) => x.sec),
        backgroundColor: s.weekAreaShare.map((x) => state.areasById[x.area_id]?.color || '#888'),
        borderWidth: 0,
      }],
    };
    if (donut) {
      donut.data = donutData;
      donut.update();
    } else {
      donut = new Chart($('#st-donut', root), {
        type: 'doughnut',
        data: donutData,
        options: { maintainAspectRatio: false, animation: false, cutout: '62%', plugins: { legend: { display: false }, tooltip: tooltipFor((sec) => sec) } },
      });
    }
  }
}
