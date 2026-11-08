// 年度手帳（Phase J，#/year）：bullet journal 的年度頁
// 年／季目標＝goals（period），Future Log＝future_events＋只讀的到期目標與星號任務，
// Year in Pixels＝daily_reviews 的 mood／energy（和每日復盤同一份），回顧＝period_reviews。
// 數字的算法都在 data.js（yearStats、futureLogMonths），這裡只顯示。
// 終點身分（20261108 顯化規劃・階段二）＝年度那一筆 period_reviews 的 vision_identity／vision_senses；
// 身分主線＝goals.mainline（不另存清單；目標對話框、專案卡片、總覽讀同一欄）。
import * as data from '../data.js';
import { state, refreshProjects } from '../store.js';
import { $, esc, toast, confirmDialog, areaChip } from '../ui.js';
import { today, formatShort } from '../dates.js';
import { openGoalDialog, projectOptions, goalProjectTag } from './projects.js';
import { openTaskEditor } from './task-actions.js';

const SAVE_DELAY = 800; // 回顧停止輸入多久後自動儲存（同每日復盤）
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const REVIEW_FIELDS = [
  ['wins', '做到了什麼', '完成了什麼、累積了什麼？'],
  ['lessons', '學到或卡住什麼', '哪裡順、哪裡卡？為什麼？'],
  ['next_focus', '', '接下來最想顧好的一兩件事'],
];
const SCALES = {
  mood: { label: '心情', levels: data.MOOD_LEVELS },
  energy: { label: '能量', levels: data.ENERGY_LEVELS },
};

const ui = { year: Number(today().slice(0, 4)), by: 'mood' };
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekday = (day) => WEEKDAYS[new Date(`${day}T12:00:00+08:00`).getUTCDay()];

/** 心情／能量 1–5 的單選列（年度頁的對話框與每日復盤共用同一個樣式 .mood-scale） */
function scaleRadios(kind, value) {
  const s = SCALES[kind];
  return `<fieldset class="mood-scale" data-kind="${kind}"><legend>${s.label}</legend>
    ${[1, 2, 3, 4, 5].map((v) => `<label class="mood-opt"><input type="radio" name="${kind}" value="${v}" ${Number(value) === v ? 'checked' : ''}>
      <i class="sw ${kind === 'mood' ? 'm' : 'e'}${v}" aria-hidden="true"></i><span>${v} ${esc(s.levels[v])}</span></label>`).join('')}
  </fieldset>`;
}

export function mountYear(root) {
  root.innerHTML = `
    <header class="page-head cal-head yr-head">
      <div><h1 id="yr-title"></h1><p class="sub" id="yr-sub"></p></div>
      <div class="cal-tools">
        <button class="btn-ghost" id="yr-prev" aria-label="上一年">‹</button>
        <strong id="yr-label" class="yr-label"></strong>
        <button class="btn-ghost" id="yr-next" aria-label="下一年">›</button>
        <button class="btn-timer" id="yr-this">今年</button>
      </div>
    </header>
    <div id="yr-body" class="yr"></div>`;
  // 事件掛在這頁自己的元素上（#main 換頁會重用，掛在 root 會一直累加）
  const body = $('#yr-body', root);

  let cache = null; // { year, events, moods, media, entries }
  let reviewsFor = null; // 回顧文字已填入的年份
  let loadSeq = 0;
  const dirty = new Map(); // period → 等待儲存的計時器

  const go = async (year) => {
    await flushAll();
    ui.year = year;
    cache = null;
    reviewsFor = null;
    build();
    load();
  };
  $('#yr-prev', root).onclick = () => go(ui.year - 1);
  $('#yr-next', root).onclick = () => go(ui.year + 1);
  $('#yr-this', root).onclick = () => go(Number(today().slice(0, 4)));

  /** 這一年的骨架：表單、回顧欄位只在換年時重建，資料更新時只重畫清單，不會吃掉正在打的字 */
  function build() {
    const y = ui.year;
    const t = today();
    const nowQ = t.slice(0, 4) === String(y) ? data.quarterOf(t) : '';
    const nowM = t.slice(0, 4) === String(y) ? t.slice(0, 7) : '';
    const days = lastDay(y, 2) === 29 ? 366 : 365;
    $('#yr-title', root).textContent = `${y} 年度手帳`;
    $('#yr-label', root).textContent = y;
    if (t.slice(0, 4) === String(y)) {
      const n = Math.round((Date.parse(t) - Date.parse(`${y}-01-01`)) / 86400000) + 1;
      $('#yr-sub', root).textContent = `今年第 ${n} 天，還有 ${days - n} 天`;
    } else {
      $('#yr-sub', root).textContent = `${String(y) < t.slice(0, 4) ? '已經過去的一年' : '還沒開始的一年'}・共 ${days} 天`;
    }

    const addForm = (period) => `
      <form class="yr-add" data-period="${period}">
        <input name="title" required maxlength="120" placeholder="新增目標" aria-label="新增${esc(data.periodLabel(period))}的目標">
        <select name="area_id" aria-label="領域">${areaOptions()}</select>
        <select name="project_id" aria-label="所屬專案（可不掛）">${projectOptions('', { none: '不掛專案' })}</select>
        <button class="btn-timer">新增</button>
      </form>`;
    const reviewFields = (period, nextLabel) => `
      <div class="yr-rv" data-rv="${period}">
        ${REVIEW_FIELDS.map(([k, label, ph]) => `<label>${label || nextLabel}<textarea name="${k}" rows="3" placeholder="${ph}"></textarea></label>`).join('')}
      </div>`;

    const vk = `v:${y}`;
    $('#yr-body', root).innerHTML = `
      <section class="card yr-vision" aria-labelledby="yr-vision-h">
        <div class="day-head"><h2 id="yr-vision-h">終點身分</h2><span class="sub" data-save="${vk}" role="status"></span></div>
        <div data-vision="${y}">
          <label class="yr-vi">我想成為的人
            <input name="vision_identity" maxlength="200" placeholder="例如：在藥廠做 BD、能把科學講成生意的人" autocomplete="off">
          </label>
          <details class="yr-senses">
            <summary>活在終點：用五感描述那時的一天 <span class="sub" data-senses-count></span></summary>
            <p class="sub">像已經活在那裡一樣寫，用現在式。寫得越具體，每天越容易用這個身分做決定。</p>
            <div class="yr-sense-grid">
              ${data.VISION_SENSES.map(([k, label, ph]) => `<label>${label}<textarea name="${k}" rows="2" placeholder="${ph}"></textarea></label>`).join('')}
            </div>
          </details>
        </div>
        <div class="yr-ml">
          <div class="yr-ml-head"><h3>身分主線</h3><span class="sub" id="yr-ml-count"></span></div>
          <p class="sub">從目標裡挑 2～3 條最能讓你成為那個人的。總覽會用主線目標所屬專案的下一步，提醒你今天先做它。</p>
          <ul class="yr-ml-list" id="yr-ml-list"></ul>
          <div class="yr-ml-tools">
            <select id="yr-ml-pick" aria-label="從目標加入身分主線"></select>
            <form class="yr-ml-add" id="yr-ml-add">
              <input name="title" required maxlength="120" placeholder="或新增一個主線目標" aria-label="新增主線目標">
              <select name="project_id" aria-label="所屬專案"></select>
              <button class="btn-timer">新增主線</button>
            </form>
          </div>
        </div>
      </section>

      <section class="card yr-annual">
        <div class="day-head"><h2>今年的年度目標</h2><span class="sub" data-count="${y}"></span></div>
        <ul class="yr-goals" data-goals="${y}"></ul>
        ${addForm(String(y))}
      </section>

      <div class="yr-quarters">
        ${[1, 2, 3, 4].map((q) => {
          const p = `${y}-Q${q}`;
          const now = p === nowQ;
          return `<section class="card yr-q ${now ? 'is-now' : ''}" aria-label="第 ${q} 季">
            <div class="yr-q-head"><h2>Q${q}<small>${q * 3 - 2}–${q * 3} 月</small></h2>
              ${now ? '<span class="yr-now">本季</span>' : ''}<span class="sub" data-count="${p}"></span></div>
            <ul class="yr-goals" data-goals="${p}"></ul>
            ${addForm(p)}
            <details class="yr-review" ${now ? 'open' : ''}>
              <summary>季回顧 <span class="sub" data-save="${p}" role="status"></span></summary>
              ${reviewFields(p, '下一季的重點')}
            </details>
          </section>`;
        }).join('')}
      </div>

      <section class="card">
        <div class="day-head"><h2>Future Log</h2><span class="sub">◆ 目標期限・★ 星號任務（點了可以編輯）</span></div>
        <div class="yr-future">
          ${Array.from({ length: 12 }, (_, i) => {
            const m = `${y}-${pad(i + 1)}`;
            return `<section class="yr-m ${m === nowM ? 'is-now' : ''}" aria-label="${i + 1} 月">
              <h3><a href="#/month/${m}" title="打開 ${i + 1} 月的月度頁">${i + 1}<small>月</small></a>${m === nowM ? '<span class="yr-now">本月</span>' : ''}</h3>
              <ul class="yr-m-list" data-month-list="${m}"></ul>
              <form class="yr-fe-add" data-month="${m}">
                <input name="day" type="number" min="1" max="${lastDay(y, i + 1)}" inputmode="numeric" placeholder="日" aria-label="${i + 1} 月幾日（可留白）">
                <input name="title" required maxlength="120" placeholder="記一件事" aria-label="${i + 1} 月要記的事">
                <button class="btn-ghost" aria-label="新增到 ${i + 1} 月">＋</button>
              </form>
            </section>`;
          }).join('')}
        </div>
      </section>

      <section class="card yr-pixels-card">
        <div class="day-head yr-px-head"><h2>Year in Pixels</h2>
          <div class="seg" role="group" aria-label="上色依據">
            ${Object.entries(SCALES).map(([k, s]) => `<button type="button" data-by="${k}" aria-pressed="${ui.by === k}">${s.label}</button>`).join('')}
          </div></div>
        <div class="yr-px-wrap">
          <div class="yr-px" id="yr-px" aria-label="${y} 年每一天的${SCALES[ui.by].label}"></div>
          <ul class="yr-legend" id="yr-legend"></ul>
        </div>
        <p class="sub">點一格記下那天的心情與能量（可用方向鍵移動）。和「每日復盤」的心情／能量是同一份。</p>
      </section>

      <section class="card">
        <h2>年度數據</h2>
        <div class="yr-stats" id="yr-stats"></div>
      </section>

      <section class="card">
        <div class="day-head"><h2>年度回顧</h2><span class="sub" data-save="${y}" role="status"></span></div>
        ${reviewFields(String(y), '明年的重點')}
      </section>`;
    renderAll();
  }

  function areaOptions() {
    const first = state.life.areas[0]?.id || state.areas[0]?.id;
    return state.areas.map((a) => `<option value="${a.id}" ${a.id === first ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  }

  // ===== 讀資料 =====
  async function load() {
    const seq = ++loadSeq;
    const y = ui.year;
    const periods = [String(y), 1, 2, 3, 4].map((q) => (typeof q === 'number' ? `${y}-Q${q}` : q));
    let reviews, events, moods, media, entries;
    try {
      [reviews, events, moods, media, entries] = await Promise.all([
        Promise.all(periods.map((p) => data.getPeriodReview(p))),
        data.listFutureEvents(y),
        data.listMoods(y),
        data.listMedia().catch(() => []), // 書影單還沒有資料表或讀不到時當作 0
        data.listEntriesBetween(`${y}-01-01`, `${y}-12-31`),
      ]);
    } catch (e) {
      if (seq === loadSeq) toast(`讀取年度資料失敗：${e.message}`, true);
      return;
    }
    if (seq !== loadSeq || y !== ui.year) return; // 已換到別年
    cache = { year: y, events, moods, media, entries };
    // 換年一定填入；同一年的背景更新不蓋掉正在打、還沒存的回顧
    periods.forEach((p, i) => {
      const box = root.querySelector(`[data-rv="${p}"]`);
      if (!box || dirty.has(p) || (reviewsFor === y && box.contains(document.activeElement))) return;
      for (const [k] of REVIEW_FIELDS) box.querySelector(`[name=${k}]`).value = reviews[i]?.[k] || '';
    });
    // 終點身分：年度那一筆（reviews[0]）；同樣不蓋掉正在打、還沒存的字
    const vbox = root.querySelector(`[data-vision="${y}"]`);
    if (vbox && !dirty.has(`v:${y}`) && !(reviewsFor === y && vbox.contains(document.activeElement))) fillVision(vbox, reviews[0]);
    reviewsFor = y;
    renderAll();
  }

  function fillVision(box, rec) {
    const senses = rec?.vision_senses || {};
    box.querySelector('[name=vision_identity]').value = rec?.vision_identity || '';
    for (const [k] of data.VISION_SENSES) box.querySelector(`[name=${k}]`).value = senses[k] || '';
    // 第一次載入這一年：寫過五感就展開；完全沒寫（第一次用）也展開引導；只寫了身分、五感空著＝收起
    if (reviewsFor !== ui.year) box.querySelector('.yr-senses').open = Object.keys(senses).length > 0 || !rec?.vision_identity;
    sensesCount(box);
  }
  function sensesCount(box) {
    const n = data.VISION_SENSES.filter(([k]) => box.querySelector(`[name=${k}]`).value.trim()).length;
    const el = box.querySelector('[data-senses-count]');
    if (el) el.textContent = n ? `已寫 ${n}／${data.VISION_SENSES.length}` : '還沒寫';
  }

  // ===== 畫面 =====
  function renderAll() {
    renderGoals();
    if (!cache || cache.year !== ui.year) return;
    renderFuture();
    renderPixels();
    renderStats();
  }

  function goalLi(g) {
    const pr = data.progressOf(state.tasks, 'goal_id', g.id);
    const done = g.status === 'done';
    return `<li class="yr-goal ${done ? 'done' : ''} ${g.status === 'dropped' ? 'muted' : ''}">
      <input type="checkbox" class="task-done" data-goal-done="${g.id}" ${done ? 'checked' : ''} ${g.status === 'dropped' ? 'disabled' : ''}
        aria-label="${done ? '取消達成' : '標成達成'}：${esc(g.title)}">
      <div class="yr-goal-main">
        <button type="button" class="yr-goal-t" data-goal-edit="${g.id}" title="編輯目標">${esc(g.title)}</button>${g.mainline ? ' <span class="ml-tag" title="身分主線">★主線</span>' : ''}
        <div class="yr-goal-meta">${areaChip(state.areasById[g.area_id])}${goalProjectTag(g)}
          ${g.due_date ? `<span>期限 ${formatShort(g.due_date)}</span>` : ''}
          ${g.status === 'dropped' ? '<span>已放棄</span>' : ''}
          <span class="yr-pr" role="img" aria-label="任務完成 ${pr.done}／${pr.total}"><span class="progress-bar"><span style="width:${pr.pct}%"></span></span>
            ${pr.total ? `${pr.done}/${pr.total}` : '還沒掛任務'}</span></div>
      </div></li>`;
  }

  /** 身分主線：列出所有主線（不分年份，和總覽一致），下拉選單列這一年的候選 */
  function renderMainline() {
    const ul = $('#yr-ml-list', root);
    if (!ul) return;
    const list = data.mainlineGoals(state.goals);
    ul.innerHTML = list.length ? list.map((g) => {
      const pr = data.progressOf(state.tasks, 'goal_id', g.id);
      return `<li class="yr-ml-item ${g.status === 'done' ? 'done' : ''}">
        <span class="ml-mark" aria-hidden="true">★</span>
        <div class="yr-goal-main">
          <button type="button" class="yr-goal-t" data-goal-edit="${g.id}" title="編輯目標">${esc(g.title)}</button>
          <div class="yr-goal-meta">${goalProjectTag(g) || '<span>沒有掛專案</span>'}
            ${g.period ? `<span>${esc(data.periodLabel(g.period))}</span>` : ''}
            ${g.status === 'done' ? '<span>已達成</span>' : ''}
            <span class="yr-pr" role="img" aria-label="任務完成 ${pr.done}／${pr.total}"><span class="progress-bar"><span style="width:${pr.pct}%"></span></span>
              ${pr.total ? `${pr.done}/${pr.total}` : '還沒掛任務'}</span></div>
        </div>
        <button type="button" class="btn-ghost yr-ml-off" data-ml-off="${g.id}" aria-label="不再當主線：${esc(g.title)}">取消主線</button>
      </li>`;
    }).join('') : '<li class="empty">還沒有主線。從下面選一個目標，或直接新增。</li>';
    const cnt = $('#yr-ml-count', root);
    const active = list.filter((g) => g.status !== 'done').length;
    if (cnt) {
      cnt.textContent = list.length ? `${active} 條進行中${active > data.MAINLINE_SUGGEST_MAX ? `・建議不超過 ${data.MAINLINE_SUGGEST_MAX} 條` : ''}` : '';
      cnt.classList.toggle('warn', active > data.MAINLINE_SUGGEST_MAX);
    }
    const cands = data.mainlineCandidates(state.goals, ui.year);
    const pick = $('#yr-ml-pick', root);
    pick.innerHTML = `<option value="">${cands.length ? `從目標加入主線…（${cands.length} 個可選）` : '沒有可加入的目標'}</option>`
      + cands.map((g) => {
        const p = g.project_id && state.projects.find((x) => x.id === g.project_id);
        const where = [g.period ? data.periodLabel(g.period) : '', p ? p.name : ''].filter(Boolean).join('・');
        return `<option value="${g.id}">${esc(g.title)}${where ? `（${esc(where)}）` : ''}</option>`;
      }).join('');
    pick.disabled = !cands.length;
    const ps = $('#yr-ml-add [name=project_id]', root);
    if (ps) ps.innerHTML = projectOptions(ps.value, { none: '不掛專案' });
  }

  /** 加入主線前：已有 3 條進行中的主線時提醒（不硬擋，使用者確認就加） */
  async function confirmMainlineRoom() {
    const n = data.mainlineGoals(state.goals).filter((g) => g.status !== 'done').length;
    if (n < data.MAINLINE_SUGGEST_MAX) return true;
    return confirmDialog(`已經有 ${n} 條進行中的主線。主線建議 2～3 條，太多每天就分不出先後。確定還要再加一條？`, '仍要加入');
  }

  function renderGoals() {
    renderMainline();
    // 專案清單可能在別頁改過：新增表單的專案選單跟著更新（保留目前選的）
    root.querySelectorAll('.yr-add [name=project_id]').forEach((sel) => { sel.innerHTML = projectOptions(sel.value, { none: '不掛專案' }); });
    root.querySelectorAll('[data-goals]').forEach((ul) => {
      const p = ul.dataset.goals;
      const goals = data.goalsOfPeriod(state.goals, p)
        .sort((a, b) => (a.status === 'dropped') - (b.status === 'dropped') || (a.created_at || '').localeCompare(b.created_at || ''));
      ul.innerHTML = goals.length ? goals.map(goalLi).join('')
        : `<li class="empty">${p.includes('Q') ? '這一季還沒有目標。' : '還沒有年度目標。寫下今年最想達成的一兩件事。'}</li>`;
      const active = goals.filter((g) => g.status !== 'dropped');
      const cnt = root.querySelector(`[data-count="${p}"]`);
      if (cnt) cnt.textContent = active.length ? `達成 ${active.filter((g) => g.status === 'done').length}／${active.length}` : '';
    });
  }

  function renderFuture() {
    // 生活頁面：星號任務只讀生活那一份；目標不分工作與生活（同專案與目標頁）
    const months = data.futureLogMonths(ui.year, cache.events, state.goals, state.life.tasks);
    for (const m of months) {
      const ul = root.querySelector(`[data-month-list="${m.month}"]`);
      if (!ul) continue;
      const items = [
        ...m.events.map((e) => ({ day: e.day, html: `<li class="yr-fe"><span class="yr-d">${e.day ? `${e.day}日` : '・'}</span>
          <span class="yr-fe-t">${esc(e.title)}</span>
          <button type="button" class="btn-ghost danger yr-x" data-fe-del="${e.id}" aria-label="刪除「${esc(e.title)}」">×</button></li>` })),
        ...m.goals.map((g) => ({ day: Number(g.due_date.slice(8)), html: `<li class="yr-fe ${g.status === 'done' ? 'done' : ''}"><span class="yr-d">${Number(g.due_date.slice(8))}日</span>
          <button type="button" class="yr-fe-link" data-goal-edit="${g.id}"><span class="yr-mark" aria-label="目標">◆</span>${esc(g.title)}</button></li>` })),
        ...m.starred.map((t) => ({ day: Number(t.due_date.slice(8)), html: `<li class="yr-fe ${t.status === 'done' ? 'done' : ''}"><span class="yr-d">${Number(t.due_date.slice(8))}日</span>
          <button type="button" class="yr-fe-link" data-task="${t.id}"><span class="yr-mark star" aria-label="星號任務">★</span>${esc(t.title)}</button></li>` })),
      ].sort((a, b) => (a.day || 0) - (b.day || 0));
      ul.innerHTML = items.map((x) => x.html).join('') || '<li class="empty">—</li>';
    }
  }

  function renderPixels() {
    const box = $('#yr-px', root);
    if (!box) return;
    const y = ui.year;
    const t = today();
    const focused = document.activeElement?.closest?.('#yr-px [data-day]')?.dataset.day;
    const tabDay = focused || (t.slice(0, 4) === String(y) ? t : `${y}-01-01`);
    const kind = ui.by;
    const levels = SCALES[kind].levels;
    let html = '<span class="px-h"></span>' + Array.from({ length: 12 }, (_, i) => `<span class="px-h">${i + 1}</span>`).join('');
    for (let d = 1; d <= 31; d++) {
      html += `<span class="px-d">${d}</span>`;
      for (let m = 1; m <= 12; m++) {
        if (d > lastDay(y, m)) { html += '<span class="px none"></span>'; continue; }
        const day = `${y}-${pad(m)}-${pad(d)}`;
        const rec = cache.moods[day] || {};
        const v = rec[kind];
        const future = day > t;
        const label = `${m}月${d}日（${weekday(day)}）`
          + `：心情 ${rec.mood ? `${rec.mood} ${data.MOOD_LEVELS[rec.mood]}` : '沒記錄'}`
          + `，能量 ${rec.energy ? `${rec.energy} ${data.ENERGY_LEVELS[rec.energy]}` : '沒記錄'}`
          + (day === t ? '（今天）' : '') + (future ? '（還沒到）' : '');
        html += `<button type="button" class="px ${v ? `${kind === 'mood' ? 'm' : 'e'}${v}` : ''} ${day === t ? 'is-today' : ''} ${future ? 'future' : ''}"
          data-day="${day}" tabindex="${day === tabDay ? 0 : -1}" aria-label="${label}" title="${esc(label)}"
          ${future ? 'aria-disabled="true"' : ''}></button>`;
      }
    }
    box.innerHTML = html;
    box.setAttribute('aria-label', `${y} 年每一天的${SCALES[kind].label}`);
    if (focused) box.querySelector(`[data-day="${focused}"]`)?.focus();
    const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of Object.values(cache.moods)) if (r[kind]) counts[r[kind]]++;
    $('#yr-legend', root).innerHTML = [5, 4, 3, 2, 1].map((v) => `<li><i class="sw ${kind === 'mood' ? 'm' : 'e'}${v}" aria-hidden="true"></i>${v} ${esc(levels[v])}<b>${counts[v] || ''}</b></li>`).join('')
      + '<li><i class="sw none" aria-hidden="true"></i>沒記錄</li>';
  }

  function renderStats() {
    const s = data.yearStats({ year: ui.year, tasks: state.tasks, entries: cache.entries, goals: state.goals,
      habitLogs: state.habitLogs, media: cache.media, areasById: state.areasById });
    const h = Math.floor(s.timeSec / 3600);
    const m = Math.floor((s.timeSec % 3600) / 60);
    const sec = Math.round(s.timeSec % 60);
    const timeNum = h ? `${h}<small>小時</small>${m}<small>分</small>` : `${m}<small>分</small>${sec}<small>秒</small>`;
    const mediaKinds = Object.entries(data.MEDIA_KINDS).filter(([k]) => s.media[k]).map(([k, l]) => `${l} ${s.media[k]}`).join('・');
    const stat = (label, num, note) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-num">${num}</div><div class="stat-note">${note}</div></div>`;
    $('#yr-stats', root).innerHTML = [
      stat('完成的生活任務', `${s.tasksDone}<small>件</small>`, '完成日在這一年；不含工作看板'),
      stat('計時總長', timeNum, '這一年開始的生活計時加總'),
      stat('年度目標', `${s.yearGoals.done}<small>／${s.yearGoals.total} 達成</small>`, s.yearGoals.total ? '不含放棄的' : '還沒有年度目標'),
      stat('各季目標達成', s.quarterGoals.map((q) => `<span class="yr-qn">Q${q.q}<b>${q.done}</b><small>/${q.total}</small></span>`).join(''), '每季達成數／目標數'),
      stat('書影單看完', `${s.media.total}<small>部</small>`, mediaKinds || '書影單裡這一年還沒有看完的'),
      stat('習慣打卡', `${s.habitDays}<small>天</small>`, `至少打一個卡的天數・共 ${s.habitLogs} 次`),
    ].join('');
  }

  // ===== 操作 =====
  body.addEventListener('submit', async (e) => {
    const f = e.target;
    e.preventDefault();
    try {
      if (f.matches('.yr-add')) {
        await data.projectSaveGoal({ title: f.title.value, area_id: f.area_id.value, period: f.dataset.period, status: 'active', project_id: f.project_id.value || null });
        f.title.value = '';
        await refreshProjects();
        toast('已新增目標');
      } else if (f.matches('.yr-ml-add')) {
        if (!(await confirmMainlineRoom())) return;
        const p = state.projects.find((x) => x.id === f.project_id.value);
        const area = p?.area_id || state.life.areas[0]?.id || state.areas[0]?.id;
        // 新增的主線目標放在這一年的年度目標（period＝這一年），年度目標清單也看得到
        await data.projectSaveGoal({ title: f.title.value, area_id: area, period: String(ui.year), status: 'active', project_id: p?.id || null, mainline: true });
        f.title.value = '';
        await refreshProjects();
        toast('已新增主線目標');
      } else if (f.matches('.yr-fe-add')) {
        const saved = await data.saveFutureEvent({ month: f.dataset.month, day: f.day.value, title: f.title.value });
        f.day.value = '';
        f.title.value = '';
        if (cache) { cache.events = [...cache.events, saved]; renderFuture(); }
        f.title.focus();
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  body.addEventListener('change', async (e) => {
    if (e.target.id === 'yr-ml-pick') {
      const sel = e.target;
      const g = state.goals.find((x) => x.id === sel.value);
      if (!g) return;
      if (!(await confirmMainlineRoom())) { sel.value = ''; return; }
      try {
        await data.setGoalMainline(g.id, true);
        await refreshProjects();
        toast(`已設為主線：${g.title}`);
      } catch (err) {
        sel.value = '';
        toast(err.message, true);
      }
      return;
    }
    // 新增目標時選了專案：領域跟著改成專案的領域
    if (e.target.matches('.yr-add [name=project_id]')) {
      const p = state.projects.find((x) => x.id === e.target.value);
      if (p) e.target.form.area_id.value = p.area_id;
      return;
    }
    const cb = e.target.closest('[data-goal-done]');
    if (!cb) return;
    const g = state.goals.find((x) => x.id === cb.dataset.goalDone);
    if (!g) return;
    try {
      await data.saveGoal({ id: g.id, title: g.title, area_id: g.area_id, due_date: g.due_date, period: g.period, status: cb.checked ? 'done' : 'active' });
      await refreshProjects();
      toast(cb.checked ? `達成：${g.title}` : '已改回進行中');
    } catch (err) {
      cb.checked = !cb.checked;
      toast(err.message, true);
    }
  });

  body.addEventListener('click', async (e) => {
    const by = e.target.closest('[data-by]');
    if (by) {
      ui.by = by.dataset.by;
      root.querySelectorAll('[data-by]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.by === ui.by)));
      if (cache) renderPixels();
      return;
    }
    const off = e.target.closest('[data-ml-off]');
    if (off) {
      const g = state.goals.find((x) => x.id === off.dataset.mlOff);
      if (!g) return;
      try {
        await data.setGoalMainline(g.id, false);
        await refreshProjects();
        toast(`「${g.title}」不再是主線（目標本身還在）`);
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    const ge = e.target.closest('[data-goal-edit]');
    if (ge) {
      const g = state.goals.find((x) => x.id === ge.dataset.goalEdit);
      if (g) openGoalDialog(g);
      return;
    }
    const tk = e.target.closest('[data-task]');
    if (tk) {
      const t = state.tasks.find((x) => x.id === tk.dataset.task);
      if (t) openTaskEditor(t);
      return;
    }
    const del = e.target.closest('[data-fe-del]');
    if (del) {
      const ev = cache?.events.find((x) => x.id === del.dataset.feDel);
      if (!ev || !(await confirmDialog(`確定刪除 Future Log 的「${ev.title}」？`))) return;
      try {
        await data.deleteFutureEvent(ev.id);
        cache.events = cache.events.filter((x) => x.id !== ev.id);
        renderFuture();
        toast('已刪除');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    const px = e.target.closest('#yr-px [data-day]');
    if (px) {
      if (px.classList.contains('future')) { toast('還沒到這一天'); return; }
      openMoodDialog(px.dataset.day);
    }
  });

  // Year in Pixels：方向鍵移動（上下＝前後一天、左右＝前後一個月），只有一格在 Tab 順序裡
  body.addEventListener('keydown', (e) => {
    const px = e.target.closest?.('#yr-px [data-day]');
    if (!px) return;
    const step = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (!step) return;
    e.preventDefault();
    const [y, m, d] = px.dataset.day.split('-').map(Number);
    const nm = Math.min(12, Math.max(1, m + step[0]));
    const nd = Math.min(lastDay(y, nm), Math.max(1, d + step[1]));
    const next = root.querySelector(`#yr-px [data-day="${y}-${pad(nm)}-${pad(nd)}"]`);
    if (!next) return;
    px.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  });

  // 回顧：停止輸入 0.8 秒後自動存；離開欄位時立刻存
  body.addEventListener('input', (e) => {
    const vbox = e.target.closest('[data-vision]');
    if (vbox) {
      const k = `v:${vbox.dataset.vision}`;
      clearTimeout(dirty.get(k));
      dirty.set(k, setTimeout(() => flush(k), SAVE_DELAY));
      setSaveText(k, '編輯中…');
      sensesCount(vbox);
      return;
    }
    const box = e.target.closest('[data-rv]');
    if (!box) return;
    const p = box.dataset.rv;
    clearTimeout(dirty.get(p));
    dirty.set(p, setTimeout(() => flush(p), SAVE_DELAY));
    setSaveText(p, '編輯中…');
  });
  body.addEventListener('focusout', (e) => {
    const vbox = e.target.closest?.('[data-vision]');
    if (vbox) { if (dirty.has(`v:${vbox.dataset.vision}`)) flush(`v:${vbox.dataset.vision}`); return; }
    const box = e.target.closest?.('[data-rv]');
    if (box && dirty.has(box.dataset.rv)) flush(box.dataset.rv);
  });

  function setSaveText(p, text) {
    const el = root.querySelector(`[data-save="${p}"]`);
    if (el) el.textContent = text;
  }

  async function flush(p) {
    clearTimeout(dirty.get(p));
    dirty.delete(p);
    if (p.startsWith('v:')) return flushVision(p);
    const box = root.querySelector(`[data-rv="${p}"]`);
    if (!box) return;
    const values = Object.fromEntries(REVIEW_FIELDS.map(([k]) => [k, box.querySelector(`[name=${k}]`).value]));
    try {
      await data.savePeriodReview(p, values);
      setSaveText(p, `已自動儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`);
    } catch (err) {
      setSaveText(p, `儲存失敗：${err.message}（會再試一次）`);
      dirty.set(p, setTimeout(() => flush(p), 3000));
    }
  }
  async function flushVision(k) {
    const y = k.slice(2);
    const box = root.querySelector(`[data-vision="${y}"]`);
    if (!box) return;
    const vision_identity = box.querySelector('[name=vision_identity]').value;
    const vision_senses = Object.fromEntries(data.VISION_SENSES.map(([s]) => [s, box.querySelector(`[name=${s}]`).value]));
    try {
      await data.saveVision(y, { vision_identity, vision_senses });
      setSaveText(k, `已自動儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`);
    } catch (err) {
      setSaveText(k, `儲存失敗：${err.message}（會再試一次）`);
      dirty.set(k, setTimeout(() => flush(k), 3000));
    }
  }
  const flushAll = () => Promise.all([...dirty.keys()].map(flush));

  /** 點一格：設定那天的心情與能量（data.saveMood，只寫這兩欄，不動復盤文字） */
  function openMoodDialog(day) {
    let dlg = document.getElementById('mood-dialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'mood-dialog';
      document.body.append(dlg);
    }
    const rec = cache?.moods[day] || {};
    dlg.innerHTML = `
      <form>
        <h2>${formatShort(day)}（${weekday(day)}）${day === today() ? '<span class="today-dot">今天</span>' : ''}</h2>
        ${scaleRadios('mood', rec.mood)}
        ${scaleRadios('energy', rec.energy)}
        <p class="sub">和每日復盤那天的心情／能量是同一份。</p>
        <div class="dialog-actions">
          <button type="button" class="btn-ghost danger" data-clear style="margin-right:auto" ${rec.mood || rec.energy ? '' : 'disabled'}>清除</button>
          <button type="button" class="btn-ghost" data-cancel>取消</button>
          <button class="btn-primary">儲存</button>
        </div>
      </form>`;
    const form = $('form', dlg);
    const save = async (values) => {
      try {
        await data.saveMood(day, values);
        dlg.close();
        if (cache) {
          if (values.mood || values.energy) cache.moods[day] = { mood: values.mood || null, energy: values.energy || null };
          else delete cache.moods[day];
          renderPixels();
        }
        toast(values.mood || values.energy ? '已記錄' : '已清除');
      } catch (err) {
        toast(err.message, true);
      }
    };
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    $('[data-clear]', dlg).onclick = () => save({ mood: null, energy: null });
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(form);
      save({ mood: Number(f.get('mood')) || null, energy: Number(f.get('energy')) || null });
    };
    dlg.showModal();
    (form.querySelector('input:checked') || form.querySelector('input')).focus();
  }

  build();
  load();
  // 目標、任務、習慣有變動時重讀（例如在專案頁勾掉目標、完成任務）
  return function render() {
    if (cache) load();
    else renderGoals();
  };
}
