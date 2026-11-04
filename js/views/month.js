// 月度手帳（Phase J）：bullet journal 的月誌——月目標、本月一覽（日期直列）、遷移、月回顧。
// 只讀生活的任務（state.life）；目標是同一份 goals（period＝'YYYY-MM'），「專案與目標」看得到同一筆。
// 網址：#/month＝本月；#/month/2026-10＝指定月份（年度頁等其他頁可以直接連進來）。
import * as data from '../data.js';
import { state, refreshTasks, refreshProjects } from '../store.js';
import { $, esc, toast, confirmDialog, areaChip } from '../ui.js';
import { today, formatShort, formatTime, formatHMS } from '../dates.js';
import { openTaskEditor } from './task-actions.js';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const SAVE_DELAY = 800; // 月回顧：停止輸入多久後自動儲存（毫秒）
const REVIEW_FIELDS = [
  ['wins', '做到了什麼', '這個月完成、值得記下的事'],
  ['lessons', '學到或卡住什麼', '學到的、卡住的、想調整的'],
  ['next_focus', '下個月的重點', '下個月最想專注的一兩件事'],
];
const GROUP_LABEL = { earlier: '更早', last: '上個月', this: '本月已過期' };

/** 網址上的月份（#/month/2026-10）；沒有或格式不對就用本月 */
function monthFromHash() {
  const m = location.hash.match(/^#\/month\/(\d{4}-(0[1-9]|1[0-2]))$/);
  return m ? m[1] : data.monthOf(today());
}
const monthTitle = (m) => `${m.slice(0, 4)} 年 ${Number(m.slice(5))} 月`;

function progressHTML(pr) {
  return `<div class="pj-progress" role="img" aria-label="完成 ${pr.done}／${pr.total} 件任務">
    <div class="progress-bar"><span style="width:${pr.pct}%"></span></div>
    <span class="sub">${pr.total ? `${pr.done}/${pr.total} 件・${pr.pct}%` : '還沒有掛任務'}</span></div>`;
}

export function mountMonth(root) {
  const ui = { month: monthFromHash() };
  const picked = new Set(); // 遷移清單裡勾選的任務
  let events = { year: '', list: [] };
  let monthEntries = { month: '', list: [] };
  let review = { month: '', dirty: false };
  let saveTimer = null;
  let entriesSeq = 0;

  root.innerHTML = `
    <header class="page-head cal-head">
      <h1>月度手帳</h1>
      <div class="cal-tools">
        <button class="btn-ghost" id="mo-prev" aria-label="上個月">‹</button>
        <button class="btn-timer" id="mo-now">本月</button>
        <button class="btn-ghost" id="mo-next" aria-label="下個月">›</button>
        <strong id="mo-title"></strong>
      </div>
    </header>
    <div class="mo-grid">
      <section class="card mo-log">
        <div class="day-head"><h2>本月一覽</h2><span class="sub mo-legend">• 待辦　× 完成　○ 事件</span></div>
        <ul class="mo-undated" id="mo-undated"></ul>
        <ol class="mo-days" id="mo-days"></ol>
        <p class="sub">點任務可以編輯；事件來自年度頁的 Future Log（這裡唯讀）。要排新任務請用「任務管理」或「日曆」。</p>
      </section>
      <div class="mo-side">
        <section class="card" id="mo-migrate-card"></section>
        <section class="card">
          <div class="day-head"><h2>月目標</h2><button class="btn-timer" id="mo-new-goal">＋ 月目標</button></div>
          <ul class="goal-list mo-goals" id="mo-goals"></ul>
          <div class="mo-quarter" id="mo-quarter"></div>
        </section>
        <section class="card">
          <div class="day-head"><h2>月回顧</h2><span class="sub" id="mo-save" role="status"></span></div>
          <div class="stats mo-stats" id="mo-stats"></div>
          <form class="mo-review" id="mo-review">
            ${REVIEW_FIELDS.map(([k, l, ph]) => `<label>${l}<textarea name="${k}" rows="3" placeholder="${ph}"></textarea></label>`).join('')}
          </form>
        </section>
      </div>
    </div>`;

  const form = $('#mo-review', root);
  const saveEl = $('#mo-save', root);

  // --- 換月份：網址用 replaceState 更新（不觸發 hashchange，不重新進頁） ---
  function go(month) {
    flushReview();
    ui.month = month;
    picked.clear();
    const hash = month === data.monthOf(today()) ? '#/month' : `#/month/${month}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
    render();
  }
  $('#mo-prev', root).onclick = () => go(data.shiftMonth(ui.month, -1));
  $('#mo-next', root).onclick = () => go(data.shiftMonth(ui.month, 1));
  $('#mo-now', root).onclick = () => go(data.monthOf(today()));

  // --- 本月一覽：點任務＝編輯 ---
  $('#mo-days', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-task]');
    const t = b && state.tasks.find((x) => x.id === b.dataset.task);
    if (t) openTaskEditor(t);
  });

  // --- 月目標 ---
  $('#mo-new-goal', root).onclick = () => openGoalDialog(null);
  $('#mo-goals', root).addEventListener('change', async (e) => {
    if (!e.target.matches('.mo-goal-done')) return;
    const g = state.goals.find((x) => x.id === e.target.closest('[data-goal]').dataset.goal);
    if (!g) return;
    try {
      await data.saveGoal({ ...g, status: e.target.checked ? 'done' : 'active' });
      await refreshProjects();
      toast(e.target.checked ? '目標達成 ✓' : '已改回進行中');
    } catch (err) { toast(err.message, true); render(); }
  });
  $('#mo-goals', root).addEventListener('click', (e) => {
    const b = e.target.closest('.mo-goal-edit');
    const g = b && state.goals.find((x) => x.id === b.closest('[data-goal]').dataset.goal);
    if (g) openGoalDialog(g);
  });

  function openGoalDialog(g) {
    const dlg = $('#journal-dialog');
    const lifeFirst = state.life.areas[0]?.id || state.areas[0]?.id;
    const v = g || { title: '', area_id: lifeFirst, due_date: '', status: 'active', period: ui.month };
    dlg.innerHTML = `
      <form>
        <h2>${g ? '編輯月目標' : `新增 ${Number(ui.month.slice(5))} 月目標`}</h2>
        <label>目標<input name="title" required maxlength="120" value="${esc(v.title)}" placeholder="例如：讀完一本書、跑步 8 次"></label>
        <div class="row">
          <label>領域<select name="area_id">${state.areas.map((a) => `<option value="${a.id}" ${a.id === v.area_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
          <label>期限（可留白）<input type="date" name="due_date" value="${v.due_date || ''}"></label>
        </div>
        <label>狀態<select name="status">${Object.entries(data.GOAL_STATUS).map(([k, l]) => `<option value="${k}" ${k === v.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <p class="sub">月目標和「專案與目標」是同一份；任務的「編輯」裡可以掛上這個目標，進度就會跟著算。</p>
        <div class="dialog-actions">
          ${g ? '<button type="button" class="btn-ghost danger" data-del style="margin-right:auto">刪除</button>' : ''}
          <button type="button" class="btn-ghost" data-cancel>取消</button>
          <button class="btn-primary">儲存</button>
        </div>
      </form>`;
    const f = $('form', dlg);
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    const del = $('[data-del]', dlg);
    if (del) {
      del.onclick = async () => {
        if (!(await confirmDialog(`確定刪除目標「${g.title}」？掛在上面的任務不會被刪，只會取消關聯。`))) return;
        try { await data.deleteGoal(g.id); dlg.close(); await refreshProjects(); toast('已刪除'); } catch (e) { toast(e.message, true); }
      };
    }
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      try {
        await data.saveGoal({ id: g?.id, title: fd.get('title'), area_id: fd.get('area_id'), due_date: fd.get('due_date'),
          status: fd.get('status'), period: g ? g.period : ui.month });
        dlg.close();
        await refreshProjects();
        toast(g ? '已更新' : '已新增月目標');
      } catch (err) { toast(err.message, true); }
    };
    dlg.showModal();
  }

  // --- 遷移 ---
  const migrateCard = $('#mo-migrate-card', root);
  migrateCard.addEventListener('change', (e) => {
    if (e.target.matches('.mg-pick')) {
      const id = e.target.closest('[data-id]').dataset.id;
      if (e.target.checked) picked.add(id); else picked.delete(id);
      renderMigrate();
    }
    if (e.target.id === 'mg-all') {
      const all = data.migrationCandidates(state.life.tasks).map((c) => c.task.id);
      picked.clear();
      if (e.target.checked) all.forEach((id) => picked.add(id));
      renderMigrate();
    }
  });
  migrateCard.addEventListener('click', async (e) => {
    const edit = e.target.closest('.mg-title');
    if (edit) {
      const t = state.tasks.find((x) => x.id === edit.closest('[data-id]').dataset.id);
      if (t) openTaskEditor(t);
      return;
    }
    const one = e.target.closest('[data-act]');
    const batch = e.target.closest('[data-batch]');
    if (!one && !batch) return;
    const action = (one || batch).dataset.act || batch.dataset.batch;
    const ids = one ? [one.closest('[data-id]').dataset.id] : [...picked];
    if (!ids.length) return;
    const targetDay = $('#mg-day', migrateCard)?.value;
    const label = action === 'forward' ? `遷移到 ${formatShort(targetDay)}`
      : action === 'later' ? `排到下個月 ${formatShort(`${data.nextMonth(data.monthOf(today()))}-01`)}` : '標成「不做了」（放棄）';
    // 批次一律先確認筆數；單筆只有「不做了」要確認（.claude/rules/data-integrity.md）
    if (batch || action === 'drop') {
      const title = ids.length === 1 ? `「${state.tasks.find((t) => t.id === ids[0])?.title || ''}」` : `選取的 ${ids.length} 件任務`;
      if (!(await confirmDialog(`把${title}${label}？`, '確定'))) return;
    }
    try {
      const n = await data.migrateTasks(ids, action, { targetDay, tasks: state.tasks, running: state.running });
      ids.forEach((id) => picked.delete(id));
      await refreshTasks();
      toast(`已${data.MIGRATE_ACTIONS[action]}：${n} 件`);
    } catch (err) { toast(err.message, true); }
  });

  function renderMigrate() {
    const t = today();
    const isNow = ui.month === data.monthOf(t);
    const list = isNow ? data.migrationCandidates(state.life.tasks, t) : [];
    migrateCard.hidden = !isNow;
    if (!isNow) return;
    for (const id of [...picked]) if (!list.some((c) => c.task.id === id)) picked.delete(id);
    const keepDay = $('#mg-day', migrateCard)?.value;
    const { to } = data.periodRange(ui.month);
    const n = picked.size;
    const later = formatShort(`${data.nextMonth(ui.month)}-01`);
    let lastGroup = '';
    migrateCard.innerHTML = `
      <div class="day-head"><h2>遷移</h2><span class="sub">${list.length ? `${list.length} 件過期未完成` : ''}</span></div>
      ${list.length ? `
      <p class="sub mg-help">月初把過期沒做完的事整理一次：<b>&gt;</b> 遷移到本月、<b>&lt;</b> 排到下個月 1 日、<b>✕</b> 不做了。改的是任務本身，不會複製。</p>
      <div class="mg-bar">
        <label class="check"><input type="checkbox" id="mg-all" ${n && n === list.length ? 'checked' : ''}> 全選</label>
        <label class="mg-daypick">遷移到<input type="date" id="mg-day" min="${t}" max="${to}" value="${keepDay && keepDay >= t && keepDay <= to ? keepDay : t}"></label>
      </div>
      <div class="mg-bar mg-batch" role="group" aria-label="批次處理選取的任務">
        <button type="button" class="btn-timer" data-batch="forward" ${n ? '' : 'disabled'}>&gt; 遷移${n ? `（${n}）` : ''}</button>
        <button type="button" class="btn-timer" data-batch="later" ${n ? '' : 'disabled'}>&lt; 排到 ${later}${n ? `（${n}）` : ''}</button>
        <button type="button" class="btn-ghost danger" data-batch="drop" ${n ? '' : 'disabled'}>✕ 不做了${n ? `（${n}）` : ''}</button>
      </div>
      <ul class="mg-list">${list.map((c) => {
        const head = c.group !== lastGroup ? `<li class="mg-group">${GROUP_LABEL[c.group]}</li>` : '';
        lastGroup = c.group;
        return `${head}<li class="mg-row" data-id="${c.task.id}">
          <input type="checkbox" class="mg-pick" ${picked.has(c.task.id) ? 'checked' : ''} aria-label="選取：${esc(c.task.title)}">
          <div class="mg-main"><button type="button" class="mg-title">${esc(c.task.title)}</button>
            <span class="mg-meta"><span class="overdue">${formatShort(c.day)}</span>${areaChip(state.areasById[c.task.area_id])}</span></div>
          <span class="mg-acts">
            <button type="button" class="btn-ghost" data-act="forward" title="遷移到選定的日子" aria-label="遷移到本月：${esc(c.task.title)}">&gt;</button>
            <button type="button" class="btn-ghost" data-act="later" title="排到下個月 ${later}" aria-label="排到下個月：${esc(c.task.title)}">&lt;</button>
            <button type="button" class="btn-ghost danger" data-act="drop" title="不做了" aria-label="不做了：${esc(c.task.title)}">✕</button>
          </span></li>`;
      }).join('')}</ul>` : '<p class="sub">沒有過期未完成的任務，這個月從乾淨的一頁開始。</p>'}`;
  }

  // --- 月回顧：自動儲存（停止輸入 0.8 秒後存；離開欄位時立刻存） ---
  form.addEventListener('input', () => {
    review.dirty = true;
    saveEl.textContent = '編輯中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushReview, SAVE_DELAY);
  });
  form.addEventListener('focusout', () => flushReview());
  // 打字中直接點側欄換頁：表單已被換掉，但值還在，先存再走
  window.addEventListener('hashchange', () => flushReview(), { once: true });

  async function flushReview() {
    clearTimeout(saveTimer);
    if (!review.dirty) return;
    review.dirty = false;
    const month = review.month;
    const values = Object.fromEntries(REVIEW_FIELDS.map(([k]) => [k, form[k].value]));
    try {
      await data.savePeriodReview(month, values);
      if (month === ui.month) saveEl.textContent = `已自動儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    } catch (e) {
      if (month === ui.month) { review.dirty = true; saveEl.textContent = `儲存失敗：${e.message}（會再試一次）`; saveTimer = setTimeout(flushReview, 3000); }
    }
  }

  async function loadReview() {
    const month = ui.month;
    review = { month, dirty: false };
    REVIEW_FIELDS.forEach(([k]) => { form[k].value = ''; });
    form.querySelectorAll('textarea').forEach((x) => { x.disabled = true; });
    saveEl.textContent = '';
    try {
      const row = await data.getPeriodReview(month);
      if (ui.month !== month) return;
      REVIEW_FIELDS.forEach(([k]) => { form[k].value = row?.[k] || ''; });
    } catch (e) { saveEl.textContent = `讀取失敗：${e.message}`; }
    form.querySelectorAll('textarea').forEach((x) => { x.disabled = false; });
  }

  // --- 非同步資料：Future Log（依年）、本月計時（月回顧的計時總長） ---
  async function loadEvents() {
    const year = ui.month.slice(0, 4);
    if (events.year === year) return;
    events = { year, list: [] };
    try { events.list = await data.listFutureEvents(year); } catch { events.list = []; }
    if (ui.month.slice(0, 4) === year) renderJournal();
  }
  async function loadEntries() {
    const seq = ++entriesSeq;
    const month = ui.month;
    const { from, to } = data.periodRange(month);
    try {
      const list = await data.listEntriesBetween(from, to);
      if (seq !== entriesSeq) return;
      monthEntries = { month, list: list.filter((e) => !state.areasById[e.area_id]?.on_board) }; // 只算生活的計時
    } catch { if (seq === entriesSeq) monthEntries = { month, list: [] }; }
    renderStats();
  }

  function renderStats() {
    const s = data.monthStats({ tasks: state.life.tasks, entries: monthEntries.month === ui.month ? monthEntries.list : [], goals: state.goals, month: ui.month });
    $('#mo-stats', root).innerHTML = `
      <div class="stat card"><div class="stat-label">完成任務</div><div class="stat-num">${s.doneCount}<small>件</small></div><div class="stat-note">生活，完成日在本月</div></div>
      <div class="stat card"><div class="stat-label">計時總長</div><div class="stat-num mo-time">${formatHMS(s.timeSec)}</div><div class="stat-note">本月已結束的計時</div></div>
      <div class="stat card ${s.goalsTotal ? '' : 'muted'}"><div class="stat-label">月目標達成</div><div class="stat-num">${s.goalsDone}<small>／${s.goalsTotal}</small></div><div class="stat-note">放棄的不算</div></div>`;
  }

  function renderJournal() {
    const t = today();
    const j = data.monthJournal(state.life.tasks, ui.month, events.year === ui.month.slice(0, 4) ? events.list : []);
    $('#mo-undated', root).innerHTML = j.undated.map((e) => `<li class="mo-ev"><span class="bj" aria-hidden="true">○</span>${esc(e.title)}<span class="sub">本月</span></li>`).join('');
    $('#mo-days', root).innerHTML = j.days.map((d) => `
      <li class="mo-day ${d.day === t ? 'is-today' : ''} ${d.weekend ? 'is-weekend' : ''} ${d.day < t ? 'is-past' : ''}">
        <span class="mo-date"><b>${Number(d.day.slice(8))}</b><i>${WEEKDAYS[d.dow]}</i>${d.day === t ? '<span class="today-dot">今天</span>' : ''}</span>
        <ul class="mo-items">
          ${d.events.map((e) => `<li class="mo-ev"><span class="bj" aria-hidden="true">○</span>${esc(e.title)}</li>`).join('')}
          ${d.items.map(({ task, kind, time }) => {
            const done = task.status === 'done';
            const area = state.areasById[task.area_id];
            return `<li><button type="button" class="mo-task ${done ? 'done' : ''}" data-task="${task.id}" style="--c:${esc(area?.color || '#888')}"
              aria-label="${done ? '已完成' : '待辦'}：${esc(task.title)}（點一下編輯）"><span class="bj" aria-hidden="true">${done ? '×' : '•'}</span>
              <span class="mo-t">${esc(task.title)}</span>${time ? `<span class="mo-when">${formatTime(time)}</span>` : ''}${kind === 'due' && task.scheduled_start ? '<span class="mo-when">到期</span>' : ''}</button></li>`;
          }).join('')}
        </ul>
      </li>`).join('');
  }

  function renderGoals() {
    const goals = data.goalsOfPeriod(state.goals, ui.month)
      .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (a.created_at || '').localeCompare(b.created_at || ''));
    $('#mo-goals', root).innerHTML = goals.length ? goals.map((g) => `
      <li class="mo-goal ${g.status !== 'active' ? 'muted' : ''}" data-goal="${g.id}">
        <input type="checkbox" class="task-done mo-goal-done" ${g.status === 'done' ? 'checked' : ''} ${g.status === 'dropped' ? 'disabled' : ''} aria-label="標記達成：${esc(g.title)}">
        <button type="button" class="goal-row mo-goal-edit">
          <span class="goal-title ${g.status === 'done' ? 'is-done' : ''}">${esc(g.title)}</span>
          ${areaChip(state.areasById[g.area_id])}
          ${g.status === 'dropped' ? '<span class="sub">放棄</span>' : ''}
          ${progressHTML(data.progressOf(state.tasks, 'goal_id', g.id))}
        </button></li>`).join('')
      : '<li class="empty">這個月還沒有目標。按「＋ 月目標」寫下一兩件這個月想達成的事。</li>';
    const q = data.quarterOf(`${ui.month}-01`);
    const qGoals = data.goalsOfPeriod(state.goals, q);
    $('#mo-quarter', root).innerHTML = qGoals.length ? `
      <h3>本季目標 <span class="sub">${q}</span></h3>
      <ul>${qGoals.map((g) => `<li><a href="#/year" title="到年度頁編輯季目標">${g.status === 'done' ? '✓ ' : ''}${esc(g.title)}</a></li>`).join('')}</ul>
      <p class="sub">季目標在年度頁編輯。</p>` : '';
  }

  let loadedMonth = '';
  function render() {
    $('#mo-title', root).textContent = monthTitle(ui.month);
    $('#mo-now', root).disabled = ui.month === data.monthOf(today());
    if (loadedMonth !== ui.month) {
      loadedMonth = ui.month;
      loadReview();
      loadEvents();
    }
    renderJournal();
    renderGoals();
    renderMigrate();
    renderStats();
    loadEntries(); // 計時有變動（停止、補記、刪除）時重讀本月計時
  }

  return render;
}
