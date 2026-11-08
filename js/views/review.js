// M5 每日復盤（Phase 3）：數字全讀 daily_summary 與當天 time_entries（唯讀）；只有文字欄是手寫存檔
// 顯化規劃・階段一（20261108）：晚上多「里程碑／心想事成」「感恩」兩格；頁首顯示當天的今日身分與肯定語（和總覽同一筆 daily_reviews）
import * as data from '../data.js';
import { state } from '../store.js';
import { $, esc, areaChip, linkify } from '../ui.js';
import { today, addDays, formatShort, formatHMS, formatSignedHMS } from '../dates.js';

const CHART_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/auto/+esm';
let chartLib = null;
const loadChart = () => (chartLib ||= import(CHART_CDN).then((m) => m.default));

const SAVE_DELAY = 800; // 停止輸入多久後自動儲存（毫秒）
const FIELDS = [
  ['gains', '今日收獲', '今天做成了什麼、學到什麼？'],
  ['problems', '問題反思', '哪裡卡住？為什麼？'],
  ['tomorrow_improve', '明日改進', '明天要怎麼做得更好？'],
  ['milestones', '里程碑／心想事成', '今天有什麼往終點身分靠近一步、或心想事成的事？'],
  ['gratitude', '感恩', '今天想感謝的人、事、物'],
];
// 早上那兩欄（總覽也能寫，同一筆資料）：這裡讓使用者補寫或修改過去某天的
const INTENT_FIELDS = [
  ['identity', '今日身分', '今天我是……'],
  ['affirmation', '肯定語', '對自己說一句肯定的話'],
];
const ALL_FIELDS = [...FIELDS, ...INTENT_FIELDS];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
// 心情／能量（Phase J）：寫入 daily_reviews 的 mood／energy（data.saveMood），年度手帳的 Year in Pixels 讀同一份
const MOOD_ROWS = [['mood', '心情', data.MOOD_LEVELS], ['energy', '能量', data.ENERGY_LEVELS]];

const ui = { day: today() };

export function mountReview(root) {
  root.innerHTML = `
    <header class="page-head cal-head">
      <h1>每日復盤</h1>
      <div class="cal-tools">
        <button class="btn-ghost" id="rv-prev" aria-label="前一天">‹</button>
        <input type="date" id="rv-date" aria-label="選擇日期">
        <button class="btn-ghost" id="rv-next" aria-label="後一天">›</button>
        <button class="btn-timer" id="rv-today">今天</button>
      </div>
    </header>
    <form class="rv-intent" id="rv-intent" aria-label="這天的今日身分與肯定語">
      ${INTENT_FIELDS.map(([k, label, ph]) => `<label><span>${label}</span><input name="${k}" maxlength="200" placeholder="${ph}" autocomplete="off"></label>`).join('')}
      <p class="sub rv-intent-note">早上在<a href="#/overview">總覽</a>寫的就是這兩格（同一份資料）；也可以在這裡補寫。</p>
    </form>
    <section class="stats stats-4">
      <div class="card stat"><div class="stat-label">任務總數</div><div class="stat-num" id="rv-total">—</div><div class="stat-note">當天完成，或當天到期／排程未完成</div></div>
      <div class="card stat"><div class="stat-label">完成率</div><div class="stat-num" id="rv-rate">—</div><div class="stat-note" id="rv-rate-note"></div></div>
      <div class="card stat"><div class="stat-label">當日用時</div><div class="stat-num" id="rv-time">—</div><div class="stat-note">當天開始的計時加總</div></div>
      <div class="card stat"><div class="stat-label">預計與實際差</div><div class="stat-num" id="rv-diff">—</div><div class="stat-note" id="rv-diff-note"></div></div>
    </section>
    <div class="grid-2">
      <section class="card">
        <h2>時間分布（依領域）</h2>
        <div class="chart-box donut"><canvas id="rv-donut" aria-label="當天各領域用時占比"></canvas></div>
        <ul class="legend" id="rv-legend"></ul>
      </section>
      <section class="card">
        <h2>任務完成情況</h2>
        <div class="progress" id="rv-progress" role="img"></div>
        <ul class="rv-tasks" id="rv-tasks"></ul>
      </section>
    </div>
    <section class="card rv-mood">
      <div class="day-head"><h2 id="rv-mood-title">今天的心情／能量</h2><span class="sub" id="rv-mood-save" role="status"></span></div>
      ${MOOD_ROWS.map(([k, label, levels]) => `<div class="mood-row"><span class="mood-k">${label}</span>
        <div class="mood-pick" role="group" aria-label="${label}">${[1, 2, 3, 4, 5].map((v) => `
          <button type="button" data-mood="${k}" data-v="${v}" aria-pressed="false" title="${v} ${levels[v]}"><i class="sw ${k === 'mood' ? 'm' : 'e'}${v}" aria-hidden="true"></i>${v}<span class="mood-word"> ${levels[v]}</span></button>`).join('')}
        </div></div>`).join('')}
      <p class="sub">和「年度手帳」的 Year in Pixels 是同一份；再點一次已選的可以取消。</p>
    </section>
    <section class="card">
      <div class="day-head"><h2>復盤筆記</h2><span class="sub" id="rv-save" role="status"></span></div>
      <form id="rv-form" class="rv-form">
        ${FIELDS.map(([k, label, ph]) => `<label>${label}<textarea name="${k}" rows="4" placeholder="${ph}"></textarea></label>`).join('')}
      </form>
    </section>
    <section class="card">
      <h2>歷史復盤</h2>
      <ul class="rv-history" id="rv-history"></ul>
    </section>`;

  ui.data = null;
  const form = $('#rv-form', root);
  const intentForm = $('#rv-intent', root);
  const fieldEl = (k) => form.elements[k] || intentForm.elements[k];
  const dirtyKeys = new Set(); // 只存改過的欄位，避免蓋掉總覽剛存的今日身分
  const saveEl = $('#rv-save', root);
  const dateInput = $('#rv-date', root);
  let saveTimer = null;
  let dirtyDay = null;
  let loadSeq = 0;
  let donut = null;

  const go = async (day) => {
    await flush(); // 換日前先存好正在打的內容
    ui.day = day;
    load();
  };
  $('#rv-prev', root).onclick = () => go(addDays(ui.day, -1));
  $('#rv-next', root).onclick = () => go(addDays(ui.day, 1));
  $('#rv-today', root).onclick = () => go(today());
  dateInput.onchange = () => dateInput.value && go(dateInput.value);
  // 點歷史：跳出當天摘要框；框內可再「到這天編輯」
  $('#rv-history', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (b) openDigest(b.dataset.day);
  });

  async function openDigest(day) {
    const dlg = $('#digest-dialog');
    const wd = WEEKDAYS[new Date(`${day}T12:00:00+08:00`).getUTCDay()];
    dlg.innerHTML = `<div class="digest"><h2>${formatShort(day)}（${wd}）復盤</h2><p class="sub">載入中…</p></div>`;
    dlg.showModal();
    let review;
    let entries;
    try {
      [review, entries] = await Promise.all([data.getReview(day), data.listEntriesOn(day)]);
      entries = entries.filter((e) => !state.areasById[e.area_id]?.on_board);
    } catch (err) {
      dlg.querySelector('.sub').textContent = `讀取失敗：${err.message}`;
      return;
    }
    const { done, open } = data.dayDigest(state.life.tasks, day); // 生活的復盤，不含工作看板的工作
    const secByTask = {};
    for (const e of entries.filter((x) => x.ended_at)) {
      secByTask[e.task_id] = (secByTask[e.task_id] || 0) + data.entrySeconds(e);
    }
    const totalSec = Object.values(secByTask).reduce((n, v) => n + v, 0);
    const taskLi = (t) => `<li>${areaChip(state.areasById[t.area_id])}<span class="dg-t">${esc(t.title)}</span>
      ${secByTask[t.id] ? `<span class="sub">當天 ${formatHMS(secByTask[t.id])}</span>` : ''}</li>`;
    const note = (k, label) => `<div class="dg-note"><h3>${label}</h3>
      <p>${review?.[k]?.trim() ? linkify(review[k]) : '<span class="sub">（沒有寫）</span>'}</p></div>`;
    dlg.innerHTML = `
      <div class="digest">
        <div class="day-head"><h2>${formatShort(day)}（${wd}）復盤</h2><span class="sub">當天計時 ${formatHMS(totalSec)}</span></div>
        <section><h3>進行中的任務 <span class="count">${open.length}</span></h3>
          <ul class="dg-list">${open.length ? open.map(taskLi).join('') : '<li class="sub">沒有</li>'}</ul></section>
        <section><h3>完成的任務 <span class="count">${done.length}</span></h3>
          <ul class="dg-list done">${done.length ? done.map(taskLi).join('') : '<li class="sub">沒有</li>'}</ul></section>
        ${INTENT_FIELDS.some(([k]) => review?.[k]?.trim()) ? `<section class="dg-intent">${INTENT_FIELDS.filter(([k]) => review[k]?.trim()).map(([k, label]) => `<p><b>${label}：</b>${esc(review[k])}</p>`).join('')}</section>` : ''}
        <section class="dg-notes">${FIELDS.map(([k, label]) => note(k, label)).join('')}</section>
        <div class="dialog-actions">
          <button type="button" class="btn-ghost" data-close>關閉</button>
          <button type="button" class="btn-primary" data-edit>到這天編輯</button>
        </div>
      </div>`;
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    dlg.querySelector('[data-edit]').onclick = () => {
      dlg.close();
      go(day);
      root.querySelector('#rv-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }

  // 心情／能量：點了立刻存（只寫這兩欄，不動三格筆記）
  $('.rv-mood', root).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mood]');
    if (!b) return;
    const k = b.dataset.mood;
    const day = ui.day;
    const v = ui.mood?.[k] === Number(b.dataset.v) ? null : Number(b.dataset.v); // 再點一次＝取消
    try {
      await data.saveMood(day, { [k]: v });
      if (day !== ui.day) return;
      ui.mood = { ...ui.mood, [k]: v };
      renderMood();
      $('#rv-mood-save', root).textContent = v ? `已記錄：${b.title}` : '已取消';
    } catch (err) {
      $('#rv-mood-save', root).textContent = `儲存失敗：${err.message}`;
    }
  });
  function renderMood() {
    $('#rv-mood-title', root).textContent = `${ui.day === today() ? '今天' : `${formatShort(ui.day)} `}的心情／能量`;
    root.querySelectorAll('[data-mood]').forEach((b) => {
      b.setAttribute('aria-pressed', String(ui.mood?.[b.dataset.mood] === Number(b.dataset.v)));
    });
  }

  // 自動儲存：停止輸入 0.8 秒後存；離開欄位時立刻存
  for (const f of [form, intentForm]) {
    f.addEventListener('input', (e) => {
      if (!e.target.name) return;
      if (dirtyDay && dirtyDay !== ui.day) dirtyKeys.clear();
      dirtyDay = ui.day;
      dirtyKeys.add(e.target.name);
      saveEl.textContent = '編輯中…';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, SAVE_DELAY);
    });
    f.addEventListener('focusout', () => flush());
    f.addEventListener('submit', (e) => { e.preventDefault(); flush(); });
  }

  async function flush() {
    clearTimeout(saveTimer);
    if (!dirtyDay) return;
    const day = dirtyDay;
    const keys = [...dirtyKeys];
    dirtyDay = null;
    dirtyKeys.clear();
    if (!keys.length) return;
    const values = Object.fromEntries(keys.map((k) => [k, fieldEl(k).value.trim() || null]));
    try {
      await data.saveReview(day, values);
      if (day === ui.day) saveEl.textContent = `已自動儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
      loadHistory();
    } catch (e) {
      dirtyDay = day;
      keys.forEach((k) => dirtyKeys.add(k));
      saveEl.textContent = `儲存失敗：${e.message}（會再試一次）`;
      saveTimer = setTimeout(flush, 3000);
    }
  }

  async function loadHistory() {
    const rows = await data.listReviewDates();
    $('#rv-history', root).innerHTML = rows.length ? rows.map((r) => `
      <li><button type="button" class="rv-hist ${r.review_date === ui.day ? 'on' : ''}" data-day="${r.review_date}">
        <b>${formatShort(r.review_date)}（${WEEKDAYS[new Date(`${r.review_date}T12:00:00+08:00`).getUTCDay()]}）</b>
        <span>${esc((data.REVIEW_NOTE_KEYS.map((k) => r[k]).find((v) => v?.trim()) || '').slice(0, 60))}</span>
      </button></li>`).join('')
      : '<li class="empty">還沒有寫過復盤。寫下今天的收獲吧！</li>';
  }

  /** 讀這一天的彙總、計時與筆記 */
  async function load() {
    const seq = ++loadSeq;
    const day = ui.day;
    dateInput.value = day;
    const [summary, allEntries, review] = await Promise.all([
      data.getDailySummary(day), data.listEntriesOn(day), data.getReview(day),
    ]);
    const entries = allEntries.filter((e) => !state.areasById[e.area_id]?.on_board); // 只算生活的計時
    if (seq !== loadSeq) return; // 已切到別天
    const dayChanged = ui.data?.day !== day;
    ui.data = { day, summary, entries };
    // 換日一定換成那天的筆記；同一天的背景更新（例如別處完成任務）則不蓋掉正在輸入的內容
    if (dayChanged || (dirtyDay !== day && !form.contains(document.activeElement) && !intentForm.contains(document.activeElement))) {
      for (const [k] of ALL_FIELDS) fieldEl(k).value = review?.[k] || '';
      saveEl.textContent = review ? '' : '尚未填寫';
    }

    if (dayChanged) $('#rv-mood-save', root).textContent = '';
    ui.mood = { mood: review?.mood ?? null, energy: review?.energy ?? null };
    renderMood();
    renderStats();
    loadHistory();
  }

  function renderStats() {
    if (!ui.data) return;
    const s = data.reviewStats(ui.data.summary, ui.data.entries, state.life.tasks, ui.day);
    $('#rv-total', root).innerHTML = `${s.tasksTotal}<small>件</small>`;
    $('#rv-rate', root).innerHTML = s.completionPct == null ? '—' : `${s.completionPct}<small>%</small>`;
    $('#rv-rate-note', root).textContent = s.tasksTotal ? `${s.tasksTotal} 件中完成 ${s.tasksDone} 件` : '這天沒有排定的任務';
    $('#rv-time', root).textContent = formatHMS(s.timeSec);
    const diffEl = $('#rv-diff', root);
    diffEl.textContent = s.diffSec == null ? '—' : formatSignedHMS(s.diffSec);
    diffEl.className = `stat-num ${s.diffSec > 0 ? 'over' : ''}`;
    $('#rv-diff-note', root).textContent = s.diffSec == null ? '當天任務沒有填預計時間' : '當天任務的實際 − 預計；+ 表示超過預計';

    $('#rv-legend', root).innerHTML = s.areaShare.length
      ? s.areaShare.map((x) => `<li>${areaChip(state.areasById[x.area_id])}<span>${formatHMS(x.sec)}</span><b>${x.pct}%</b></li>`).join('')
      : '<li class="empty">這天沒有計時紀錄。</li>';

    const open = s.dayTasks.filter(data.isOpen).length;
    const done = s.dayTasks.length - open;
    const pct = s.dayTasks.length ? Math.round((100 * done) / s.dayTasks.length) : 0;
    const prog = $('#rv-progress', root);
    prog.setAttribute('aria-label', `完成 ${done} 件，未完成 ${open} 件`);
    prog.innerHTML = s.dayTasks.length
      ? `<div class="progress-bar"><span style="width:${pct}%"></span></div><div class="progress-text">完成 ${done} 件・未完成 ${open} 件</div>`
      : '';
    // 已完成的算完成那天（migration 20261104b），所以提早或延後完成的也會在這裡
    $('#rv-tasks', root).innerHTML = s.dayTasks.length ? s.dayTasks.map((t) => `
      <li class="${t.status === 'done' ? 'done' : ''}">
        <span class="mark" aria-label="${t.status === 'done' ? '已完成' : '未完成'}">${t.status === 'done' ? '✓' : '○'}</span>
        <span class="rv-t">${esc(t.title)}</span>${areaChip(state.areasById[t.area_id])}
        <span class="sub">${t.actual_sec ? formatHMS(t.actual_sec) : ''}</span>
      </li>`).join('') : '<li class="empty">這天沒有到期、排程或完成的任務。</li>';

    drawDonut(s);
  }

  async function drawDonut(s) {
    let Chart;
    try { Chart = await loadChart(); } catch { return; }
    const canvas = $('#rv-donut', root);
    if (!canvas?.isConnected) return;
    const cfg = {
      labels: s.areaShare.map((x) => state.areasById[x.area_id]?.name ?? '其他'),
      datasets: [{
        data: s.areaShare.length ? s.areaShare.map((x) => x.sec) : [1],
        backgroundColor: s.areaShare.length ? s.areaShare.map((x) => state.areasById[x.area_id]?.color || '#888') : ['#ecebe6'],
        borderWidth: 0,
      }],
    };
    if (donut) {
      donut.data = cfg;
      donut.options.plugins.tooltip.enabled = s.areaShare.length > 0;
      donut.update();
      return;
    }
    donut = new Chart(canvas, {
      type: 'doughnut',
      data: cfg,
      options: {
        maintainAspectRatio: false, animation: false, cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: s.areaShare.length > 0, callbacks: { label: (c) => `${c.label}：${formatHMS(c.raw)}` } },
        },
      },
    });
  }

  load();
  // 任務或計時有變動（例如在別頁完成任務）時，重新讀這一天的彙總
  return function render() {
    if (ui.data) load();
  };
}
