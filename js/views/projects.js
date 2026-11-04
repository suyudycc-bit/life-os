// M9 專案與目標（Phase 5）：有「下一步」的長期事項；任務可掛專案／目標，進度＝已完成任務／全部任務
import * as data from '../data.js';
import { state, refreshProjects, refreshTasks } from '../store.js';
import { $, esc, toast, confirmDialog, areaChip } from '../ui.js';
import { formatShort, today, addDays, weekStart } from '../dates.js';
import { enableReorder } from './tasks.js';
import { openTaskEditor } from './task-actions.js';

const VIEW_KEY = 'lifeos-pj-view';
const ui = { status: 'active', view: 'cards', scale: 'week', withWork: false };
try { Object.assign(ui, JSON.parse(localStorage.getItem(VIEW_KEY) || '{}')); } catch { /* 忽略 */ }
const saveView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ view: ui.view, scale: ui.scale, withWork: ui.withWork })); } catch { /* 忽略 */ } };

// 甘特圖每一天的寬度（px）
const SCALES = { week: { label: '週', day: 32 }, month: { label: '月', day: 12 }, quarter: { label: '季', day: 5 } };
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const dowOf = (d) => new Date(`${d}T12:00:00+08:00`).getUTCDay();
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function progressHTML(pr) {
  return `<div class="pj-progress" role="img" aria-label="完成 ${pr.done}／${pr.total} 件任務">
    <div class="progress-bar"><span style="width:${pr.pct}%"></span></div>
    <span class="sub">${pr.total ? `${pr.done}/${pr.total} 件・${pr.pct}%` : '還沒有任務'}</span></div>`;
}

function areaOptions(selected) {
  return state.areas.map((a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}

function openProjectDialog(p = null) {
  const dlg = $('#project-dialog');
  const v = p || { name: '', area_id: state.areas[0]?.id, status: 'active', next_action: '', notes: '' };
  dlg.innerHTML = `
    <form>
      <h2>${p ? '編輯專案' : '新增專案'}</h2>
      <label>名稱<input name="name" required maxlength="80" value="${esc(v.name)}" placeholder="例如：轉職到藥廠 BD、XX 醫院合作案"></label>
      <div class="row">
        <label>領域<select name="area_id">${areaOptions(v.area_id)}</select></label>
        <label>狀態<select name="status">${Object.entries(data.PROJECT_STATUS).map(([k, l]) => `<option value="${k}" ${k === v.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <label>開始日<input type="date" name="start_date" value="${v.start_date || ''}"></label>
        <label>結束日<input type="date" name="end_date" value="${v.end_date || ''}"></label>
      </div>
      <p class="sub">日期可留白：甘特圖會用掛在專案上的任務日期推算（虛線）。</p>
      <label>下一步行動<input name="next_action" maxlength="200" value="${esc(v.next_action || '')}" placeholder="留白＝自動用專案裡排最前面的任務"></label>
      <label>備註<textarea name="notes" rows="3">${esc(v.notes || '')}</textarea></label>
      <div class="dialog-actions">
        ${p ? '<button type="button" class="btn-ghost danger" data-del style="margin-right:auto">刪除</button>' : ''}
        <button type="button" class="btn-ghost" data-cancel>取消</button>
        <button class="btn-primary">儲存</button>
      </div>
    </form>`;
  bindDialog(dlg, p, {
    save: (f) => data.saveProject({ id: p?.id, name: f.get('name'), area_id: f.get('area_id'), status: f.get('status'), next_action: f.get('next_action'), notes: f.get('notes'), start_date: f.get('start_date'), end_date: f.get('end_date') }),
    del: () => data.deleteProject(p.id),
    delMsg: () => `確定刪除專案「${p.name}」？掛在上面的 ${data.progressOf(state.tasks, 'project_id', p.id).total} 件任務不會被刪，只會取消關聯。`,
  });
}

/** 期間選單（Phase J）：不指定／前後一年的年、季、月；目前的值不在範圍內也保留 */
function periodOptions(selected) {
  const y = Number((selected || today()).slice(0, 4));
  const opt = (p) => `<option value="${p}" ${p === selected ? 'selected' : ''}>${data.periodLabel(p)}</option>`;
  const groups = [y - 1, y, y + 1].map((yr) => `<optgroup label="${yr}">${[String(yr), ...[1, 2, 3, 4].map((q) => `${yr}-Q${q}`),
    ...Array.from({ length: 12 }, (_, i) => `${yr}-${String(i + 1).padStart(2, '0')}`)].map(opt).join('')}</optgroup>`).join('');
  return `<option value="">不指定期間</option>${groups}`;
}

/** 目標對話框；年度手帳也用它（preset：新增時預先帶入的 period、area_id） */
export function openGoalDialog(g = null, preset = {}) {
  const dlg = $('#project-dialog');
  const v = g || { title: '', area_id: state.areas[0]?.id, due_date: '', status: 'active', period: '', ...preset };
  dlg.innerHTML = `
    <form>
      <h2>${g ? '編輯目標' : '新增目標'}</h2>
      <label>目標<input name="title" required maxlength="120" value="${esc(v.title)}" placeholder="例如：Q1 拿到 2 個面試"></label>
      <div class="row">
        <label>領域<select name="area_id">${areaOptions(v.area_id)}</select></label>
        <label>期限<input type="date" name="due_date" value="${v.due_date || ''}"></label>
      </div>
      <div class="row">
        <label>期間<select name="period">${periodOptions(v.period || '')}</select></label>
        <label>狀態<select name="status">${Object.entries(data.GOAL_STATUS).map(([k, l]) => `<option value="${k}" ${k === v.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <p class="sub">期間＝這是哪一年、哪一季或哪個月的目標，會出現在年度手帳對應的位置。</p>
      <div class="dialog-actions">
        ${g ? '<button type="button" class="btn-ghost danger" data-del style="margin-right:auto">刪除</button>' : ''}
        <button type="button" class="btn-ghost" data-cancel>取消</button>
        <button class="btn-primary">儲存</button>
      </div>
    </form>`;
  bindDialog(dlg, g, {
    save: (f) => data.saveGoal({ id: g?.id, title: f.get('title'), area_id: f.get('area_id'), due_date: f.get('due_date'), status: f.get('status'), period: f.get('period') }),
    del: () => data.deleteGoal(g.id),
    delMsg: () => `確定刪除目標「${g.title}」？掛在上面的任務不會被刪，只會取消關聯。`,
  });
}

function bindDialog(dlg, existing, { save, del, delMsg }) {
  const form = $('form', dlg);
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  const delBtn = $('[data-del]', dlg);
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!(await confirmDialog(delMsg()))) return;
      try {
        await del();
        dlg.close();
        await refreshProjects();
        toast('已刪除');
      } catch (e) {
        toast(e.message, true);
      }
    };
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await save(new FormData(form));
      dlg.close();
      await refreshProjects();
      toast(existing ? '已更新' : '已新增');
    } catch (err) {
      toast(err.message, true);
    }
  };
  dlg.showModal();
  form.querySelector('input').focus();
}

export function mountProjects(root) {
  root.innerHTML = `
    <header class="page-head cal-head">
      <h1>專案與目標</h1>
      <div class="cal-tools">
        <button class="btn-timer" id="pj-new-goal">＋ 目標</button>
        <button class="btn-primary" id="pj-new">＋ 新增專案</button>
      </div>
    </header>
    <div class="pj-bar">
      <div class="seg pj-tabs" id="pj-tabs" role="group" aria-label="依狀態篩選專案">
        ${Object.entries(data.PROJECT_STATUS).map(([k, l]) => `<button type="button" data-v="${k}">${l} <span class="count" data-n="${k}"></span></button>`).join('')}
      </div>
      <label class="check pj-withwork" id="pj-withwork-wrap"><input type="checkbox" id="pj-withwork"> 包含工作看板的專案</label>
      <div class="seg" id="pj-view" role="group" aria-label="切換檢視">
        <button type="button" data-view="cards">卡片</button><button type="button" data-view="gantt">甘特圖</button>
      </div>
    </div>
    <div class="pj-grid" id="pj-list"></div>
    <section class="card gantt-card" id="pj-gantt" hidden>
      <div class="day-head">
        <div class="seg" id="gt-scale" role="group" aria-label="時間縮放">
          ${Object.entries(SCALES).map(([k, v]) => `<button type="button" data-scale="${k}">${v.label}</button>`).join('')}
        </div>
        <button class="btn-timer" id="gt-today">回到今天</button>
      </div>
      <div class="gantt-wrap" id="gt-wrap"></div>
      <p class="sub gantt-legend">
        <span><i class="lg-bar"></i>有設定日期</span><span><i class="lg-bar inferred"></i>依任務日期推算</span>
        <span><i class="lg-dot"></i>任務（實心＝完成）</span><span><i class="lg-ms"></i>目標期限</span><span><i class="lg-today"></i>今天</span>
      </p>
    </section>
    <section class="card">
      <h2>目標</h2>
      <ul class="goal-list" id="pj-goals"></ul>
    </section>`;

  $('#pj-new', root).onclick = () => openProjectDialog();
  // 工作只留在工作看板：預設只顯示生活的專案，需要時再勾選包含
  $('#pj-withwork', root).onchange = (e) => { ui.withWork = e.target.checked; saveView(); render(); };
  $('#pj-new-goal', root).onclick = () => openGoalDialog();
  $('#pj-view', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) { ui.view = b.dataset.view; saveView(); render(); if (ui.view === 'gantt') setTimeout(() => scrollToToday(), 0); }
  });
  $('#gt-scale', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-scale]');
    if (b) { ui.scale = b.dataset.scale; saveView(); render(); setTimeout(() => scrollToToday(), 0); }
  });
  $('#gt-today', root).onclick = () => scrollToToday(true);
  $('#gt-wrap', root).addEventListener('click', (e) => {
    const bar = e.target.closest('[data-project]');
    if (bar) { const p = state.projects.find((x) => x.id === bar.dataset.project); if (p) openProjectDialog(p); return; }
    const ms = e.target.closest('[data-goal]');
    if (ms) { const g = state.goals.find((x) => x.id === ms.dataset.goal); if (g) openGoalDialog(g); }
  });

  function scrollToToday(smooth = false) {
    const wrap = $('#gt-wrap', root);
    const line = wrap.querySelector('.gt-row:not(.gt-head) .gt-today');
    if (!line) return;
    // line.offsetLeft 是在時間軸內的位置；左欄是 sticky，所以捲到「今天在可見時間軸的左邊留 3 天」即可
    const left = line.offsetLeft - 3 * SCALES[ui.scale].day;
    wrap.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' });
  }

  $('#pj-tabs', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (b) { ui.status = b.dataset.v; render(); }
  });

  const list = $('#pj-list', root);
  list.addEventListener('click', (e) => {
    // 點任務名稱：開跟任務管理同一個編輯視窗
    const tb = e.target.closest('[data-task]');
    if (tb) {
      const t = state.tasks.find((x) => x.id === tb.dataset.task);
      if (t) openTaskEditor(t);
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const p = state.projects.find((x) => x.id === b.closest('.pj-card').dataset.id);
    if (p && b.dataset.act === 'edit') openProjectDialog(p);
  });
  // 專案卡片裡的任務可拖移排序，順序和任務管理頁共用
  enableReorder(list, '.pj-task');
  // 在專案卡片上直接新增任務（掛這個專案、沿用專案的領域）
  list.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const p = state.projects.find((x) => x.id === form.closest('.pj-card').dataset.id);
    try {
      await data.createTask({ title: form.title.value, area_id: p.area_id, project_id: p.id }, state.tasks);
      await refreshTasks();
      toast('已新增任務');
      list.querySelector(`[data-id="${p.id}"] input[name=title]`)?.focus();
    } catch (err) {
      toast(err.message, true);
    }
  });
  // 勾掉「下一步」：手寫的就清空、自動任務就標成完成；下一件未完成任務自動遞補上來
  list.addEventListener('change', async (e) => {
    if (!e.target.matches('.pj-next-done')) return;
    const p = state.projects.find((x) => x.id === e.target.closest('.pj-card').dataset.id);
    const taskId = e.target.dataset.task;
    try {
      if (taskId) {
        await data.setTaskDone(taskId, true, state.running);
        await refreshTasks();
      } else {
        await data.saveProject({ ...p, next_action: '' });
        await refreshProjects();
      }
      const next = data.nextStepOf(state.projects.find((x) => x.id === p.id) || p, state.tasks);
      toast(next ? `完成！下一步：${next.kind === 'task' ? next.task.title : next.text}` : '下一步完成了！這個專案沒有待辦了');
    } catch (err) {
      e.target.checked = false;
      toast(err.message, true);
    }
  });

  $('#pj-goals', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-goal]');
    const g = b && state.goals.find((x) => x.id === b.dataset.goal);
    if (g) openGoalDialog(g);
  });

  function render() {
    root.querySelectorAll('#pj-tabs [data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === ui.status)));
    const hasWork = state.projects.length !== state.life.projects.length;
    $('#pj-withwork-wrap', root).hidden = !hasWork;
    $('#pj-withwork', root).checked = ui.withWork;
    const base = ui.withWork ? state.projects : state.life.projects;
    for (const k of Object.keys(data.PROJECT_STATUS)) {
      root.querySelector(`[data-n="${k}"]`).textContent = base.filter((p) => p.status === k).length;
    }
    const projects = base.filter((p) => p.status === ui.status);
    root.querySelectorAll('#pj-view [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === ui.view)));
    list.hidden = ui.view !== 'cards';
    $('#pj-gantt', root).hidden = ui.view !== 'gantt';
    if (ui.view === 'gantt') renderGantt(projects);
    list.innerHTML = projects.length ? projects.map((p) => {
      const pr = data.progressOf(state.tasks, 'project_id', p.id);
      const step = data.nextStepOf(p, state.tasks);
      // 已經當成「下一步」的任務不在下面重複列出
      const open = pr.tasks.filter(data.isOpen).filter((t) => !(step?.kind === 'task' && t.id === step.task.id));
      return `
      <article class="card pj-card" data-id="${p.id}">
        <div class="day-head"><h3>${esc(p.name)}</h3><button class="btn-ghost" data-act="edit">編輯</button></div>
        <div class="task-meta">${areaChip(state.areasById[p.area_id])}<span>${data.PROJECT_STATUS[p.status]}</span></div>
        <div class="pj-next ${step ? '' : 'empty'}">
          ${step
            ? `<label><input type="checkbox" class="pj-next-done" ${step.kind === 'task' ? `data-task="${step.task.id}"` : ''} aria-label="下一步完成"><span><b>下一步：</b>${esc(step.kind === 'task' ? step.task.title : step.text)}${step.kind === 'task' && step.task.due_date ? ` <span class="sub">${formatShort(step.task.due_date)}</span>` : ''}</span></label>`
            : '<span>還沒有下一步。在下方新增任務，或按「編輯」寫一件可以馬上做的事。</span>'}
        </div>
        ${progressHTML(pr)}
        ${open.length ? `<ul class="pj-tasks">${open.slice(0, 5).map((t) => `<li class="pj-task" data-id="${t.id}" data-open>
            <button class="drag" aria-label="拖移排序：${esc(t.title)}（也可用上下鍵）" title="拖移排序">⋮⋮</button>
            <button type="button" class="pj-task-title" data-task="${t.id}" title="編輯任務">${esc(t.title)}</button>
            ${t.due_date ? `<span class="sub">${formatShort(t.due_date)}</span>` : ''}</li>`).join('')}
          ${open.length > 5 ? `<li class="sub pj-more">還有 ${open.length - 5} 件…</li>` : ''}</ul>` : ''}
        <form class="pj-add"><input name="title" placeholder="新增任務到這個專案" aria-label="新增任務到 ${esc(p.name)}" required><button class="btn-timer">新增</button></form>
        ${p.notes ? `<p class="sub pj-notes">${esc(p.notes)}</p>` : ''}
      </article>`;
    }).join('') : `<div class="card empty-page"><p>${ui.status === 'active'
      ? '還沒有進行中的專案。按右上角「＋ 新增專案」，例如「轉職到藥廠 BD」。' : `沒有${data.PROJECT_STATUS[ui.status]}的專案。`}</p></div>`;

    const goals = [...state.goals].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
      || (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    $('#pj-goals', root).innerHTML = goals.length ? goals.map((g) => {
      const pr = data.progressOf(state.tasks, 'goal_id', g.id);
      const overdue = g.status === 'active' && g.due_date && g.due_date < today();
      return `<li class="${g.status !== 'active' ? 'muted' : ''}">
        <button type="button" class="goal-row" data-goal="${g.id}">
          <span class="goal-title">${g.status === 'done' ? '✓ ' : ''}${esc(g.title)}</span>
          ${areaChip(state.areasById[g.area_id])}
          ${g.period ? `<span class="sub">${data.periodLabel(g.period)}</span>` : ''}
          ${g.due_date ? `<span class="${overdue ? 'overdue' : 'sub'}">${overdue ? '已過期 ' : '期限 '}${formatShort(g.due_date)}</span>` : ''}
          <span class="sub">${data.GOAL_STATUS[g.status]}</span>
          ${progressHTML(pr)}
        </button></li>`;
    }).join('') : '<li class="empty">還沒有目標。目標是想達成的結果（例如「年底前轉職成功」），在任務的「編輯」裡可以掛上目標。</li>';
  }

  // 進頁面時若上次停在甘特圖，畫完後捲到今天
  if (ui.view === 'gantt') setTimeout(() => scrollToToday(), 0);

  /** 甘特圖：左邊固定專案名稱，右邊時間軸可左右捲動 */
  function renderGantt(projects) {
    root.querySelectorAll('#gt-scale [data-scale]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scale === ui.scale)));
    const dayW = SCALES[ui.scale].day;
    const t = today();
    const g = data.ganttData(projects, state.goals, state.tasks, t);
    // 時間範圍：資料前後各留一段，週視圖從週一開始；至少涵蓋今天前 1 週到後 4 週
    let start = [g.min, addDays(t, -7)].sort()[0];
    let end = [g.max, addDays(t, ui.scale === 'week' ? 28 : 90)].sort().at(-1);
    start = weekStart(addDays(start, -3));
    end = addDays(weekStart(addDays(end, 7)), 6);
    const n = daysBetween(start, end) + 1;
    const x = (d) => daysBetween(start, d) * dayW;
    const days = Array.from({ length: n }, (_, i) => addDays(start, i));

    // 表頭：月份＋（週視圖）日期／（其他）每週一
    const months = [];
    for (const d of days) {
      const key = d.slice(0, 7);
      if (months.at(-1)?.key !== key) months.push({ key, from: d, count: 0 });
      months.at(-1).count++;
    }
    const monthHead = months.map((m) => `<div class="gt-month" style="width:${m.count * dayW}px"><span>${Number(m.key.slice(0, 4))}/${Number(m.key.slice(5))}</span></div>`).join('');
    const tickHead = ui.scale === 'week'
      ? days.map((d) => `<div class="gt-tick ${d === t ? 'is-today' : ''} ${[0, 6].includes(dowOf(d)) ? 'wkend' : ''}" style="width:${dayW}px">
          <span>${Number(d.slice(8))}</span><small>${WEEKDAYS[dowOf(d)]}</small></div>`).join('')
      : days.filter((d) => dowOf(d) === 1).map((d) => `<div class="gt-tick" style="width:${7 * dayW}px"><span>${formatShort(d)}</span></div>`).join('');

    const track = (inner) => `<div class="gt-track" style="width:${n * dayW}px;--dw:${dayW}px">${inner}<div class="gt-today" style="left:${x(t) + dayW / 2}px"></div></div>`;
    const rowsHTML = g.rows.map((r) => {
      const p = r.project;
      const area = state.areasById[p.area_id];
      const color = esc(area?.color || '#888');
      const label = `<div class="gt-label"><b>${esc(p.name)}</b>${areaChip(area)}</div>`;
      if (!r.start) {
        return `<div class="gt-row">${label}${track(`<span class="gt-empty">沒有日期：在專案「編輯」填開始／結束日，或幫任務設日期</span>`)}</div>`;
      }
      const left = x(r.start);
      const width = (daysBetween(r.start, r.end) + 1) * dayW;
      const dates = `${formatShort(r.start)}–${formatShort(r.end)}`;
      const bar = `<button type="button" class="gt-bar ${r.inferred ? 'inferred' : ''}" data-project="${p.id}"
          style="left:${left}px;width:${width}px;--c:${color}"
          aria-label="${esc(p.name)}，${dates}，進度 ${r.progress.pct}%${r.inferred ? '（依任務日期推算）' : ''}，點一下編輯">
          <span class="gt-fill" style="width:${r.progress.pct}%"></span>
          <span class="gt-text">${esc(p.name)}・${r.progress.total ? `${r.progress.pct}%` : dates}</span>
        </button>`;
      const dots = r.marks.map((m) => `<span class="gt-dot ${m.task.status === 'done' ? 'done' : ''} ${m.task.status !== 'done' && m.day < t ? 'late' : ''}"
          style="left:${x(m.day) + dayW / 2}px;--c:${color}" title="${esc(m.task.title)}（${formatShort(m.day)}${m.task.status === 'done' ? '・完成' : ''}）"></span>`).join('');
      return `<div class="gt-row">${label}${track(bar + dots)}</div>`;
    }).join('');
    const msHTML = g.milestones.map((goal) => {
      const area = state.areasById[goal.area_id];
      return `<div class="gt-row gt-ms-row"><div class="gt-label"><span class="gt-ms-icon" aria-hidden="true">◆</span><span>${esc(goal.title)}</span></div>${track(`
        <button type="button" class="gt-ms ${goal.status === 'done' ? 'done' : ''}" data-goal="${goal.id}" style="left:${x(goal.due_date) + dayW / 2}px;--c:${esc(area?.color || '#888')}"
          aria-label="目標：${esc(goal.title)}，期限 ${formatShort(goal.due_date)}" title="${esc(goal.title)}（期限 ${formatShort(goal.due_date)}）"></button>`)}</div>`;
    }).join('');

    $('#gt-wrap', root).innerHTML = g.rows.length || g.milestones.length ? `
      <div class="gantt ${ui.scale}" style="width:calc(var(--gt-label) + ${n * dayW}px)">
        <div class="gt-row gt-head"><div class="gt-label gt-corner">專案</div><div class="gt-track gt-head-track" style="width:${n * dayW}px">
          <div class="gt-months">${monthHead}</div><div class="gt-ticks">${tickHead}</div></div></div>
        ${rowsHTML}
        ${msHTML ? `<div class="gt-row gt-section"><div class="gt-label">目標</div>${track('')}</div>${msHTML}` : ''}
      </div>` : '<p class="sub gt-none">這個分頁沒有專案。切換上方的狀態，或新增專案。</p>';
  }

  return render;
}
