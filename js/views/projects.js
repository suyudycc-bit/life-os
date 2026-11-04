// M9 專案與目標（Phase 5）：有「下一步」的長期事項；任務可掛專案／目標，進度＝已完成任務／全部任務
import * as data from '../data.js';
import { state, refreshProjects, refreshTasks, refreshHabits } from '../store.js';
import { $, esc, toast, confirmDialog, areaChip } from '../ui.js';
import { formatShort, today, addDays, weekStart } from '../dates.js';
import { enableReorder } from './tasks.js';
import { openTaskEditor } from './task-actions.js';
import { toggleHabitDay, streakBadge } from './habits.js';

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
    delMsg: () => `確定刪除專案「${p.name}」？掛在上面的 ${data.progressOf(state.tasks, 'project_id', p.id).total} 件任務、${data.goalsOfProject(state.goals, p.id).length} 個目標、${data.habitsOfProject(state.habits, p.id).length} 個習慣不會被刪，只會取消關聯（目標會移到「未歸屬」）。30 天內可以從垃圾桶還原，關聯也會接回去。`,
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

/** 「所屬專案」選單（20261106：目標掛在專案底下）；完成的專案放後面，目前的值一定在 */
export function projectOptions(selected, { none = '不歸屬（未歸屬的目標）' } = {}) {
  const rank = { active: 0, paused: 1, done: 2 };
  const list = [...state.projects].filter((p) => p.status !== 'done' || p.id === selected)
    .sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name, 'zh-Hant'));
  return `<option value="">${none}</option>${list.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}${p.status !== 'active' ? `（${data.PROJECT_STATUS[p.status]}）` : ''}</option>`).join('')}`;
}

/** 目標列上的所屬專案小標籤（年度、月度手帳共用） */
export function goalProjectTag(g) {
  const p = g.project_id && state.projects.find((x) => x.id === g.project_id);
  return p ? `<span class="pj-tag" title="所屬專案">${esc(p.name)}</span>` : '';
}

/** 目標對話框；年度手帳也用它（preset：新增時預先帶入的 period、area_id、project_id） */
export function openGoalDialog(g = null, preset = {}) {
  const dlg = $('#project-dialog');
  const v = g || { title: '', area_id: state.areas[0]?.id, due_date: '', status: 'active', period: '', project_id: '', ...preset };
  dlg.innerHTML = `
    <form>
      <h2>${g ? '編輯目標' : '新增目標'}</h2>
      <label>目標<input name="title" required maxlength="120" value="${esc(v.title)}" placeholder="例如：Q1 拿到 2 個面試"></label>
      <label>所屬專案<select name="project_id">${projectOptions(v.project_id || '')}</select></label>
      <div class="row">
        <label>領域<select name="area_id">${areaOptions(v.area_id)}</select></label>
        <label>期限<input type="date" name="due_date" value="${v.due_date || ''}"></label>
      </div>
      <div class="row">
        <label>期間<select name="period">${periodOptions(v.period || '')}</select></label>
        <label>狀態<select name="status">${Object.entries(data.GOAL_STATUS).map(([k, l]) => `<option value="${k}" ${k === v.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <p class="sub">期間＝這是哪一年、哪一季或哪個月的目標，會出現在年度手帳對應的位置。掛了專案的目標會出現在那張專案卡片裡。</p>
      <div class="dialog-actions">
        ${g ? '<button type="button" class="btn-ghost danger" data-del style="margin-right:auto">刪除</button>' : ''}
        <button type="button" class="btn-ghost" data-cancel>取消</button>
        <button class="btn-primary">儲存</button>
      </div>
    </form>`;
  // 選了專案：領域跟著改成專案的領域（之後仍可自己改）
  $('[name=project_id]', dlg).onchange = (e) => {
    const p = state.projects.find((x) => x.id === e.target.value);
    if (p) $('[name=area_id]', dlg).value = p.area_id;
  };
  bindDialog(dlg, g, {
    save: (f) => data.projectSaveGoal({ id: g?.id, title: f.get('title'), area_id: f.get('area_id'), due_date: f.get('due_date'), status: f.get('status'), period: f.get('period'), project_id: f.get('project_id') || null }),
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
        // 刪專案／目標會取消習慣的關聯：習慣也重讀，習慣頁與專案卡片才不會顯示舊的掛法
        await Promise.all([refreshProjects(), refreshHabits()]);
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
        <button class="btn-timer" id="pj-import">匯入規劃表</button>
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
      <div class="day-head"><h2>未歸屬的目標</h2><span class="sub">沒有掛專案的目標；可以直接指定到專案</span></div>
      <ul class="goal-list" id="pj-goals"></ul>
    </section>`;

  $('#pj-new', root).onclick = () => openProjectDialog();
  $('#pj-import', root).onclick = () => openCfaImport();
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
    const tb = e.target.closest('button[data-task]');
    if (tb) {
      const t = state.tasks.find((x) => x.id === tb.dataset.task);
      if (t) openTaskEditor(t);
      return;
    }
    // 卡片裡的目標：點開編輯
    const gb = e.target.closest('[data-goal-edit]');
    if (gb) {
      const g = state.goals.find((x) => x.id === gb.dataset.goalEdit);
      if (g) openGoalDialog(g);
      return;
    }
    // 卡片裡的習慣：今天打卡／取消（和習慣頁同一個函式，連續 21 天會跳鼓勵）
    const hb = e.target.closest('[data-habit-today]');
    if (hb) { toggleHabitDay(hb.dataset.habitToday, today(), hb); return; }
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
    // 卡片內新增目標：掛這個專案、沿用專案的領域
    if (form.matches('.pj-goal-add')) {
      try {
        await data.projectSaveGoal({ title: form.title.value, area_id: p.area_id, status: 'active', due_date: form.due_date.value || null, project_id: p.id });
        await refreshProjects();
        toast('已新增目標');
        list.querySelector(`[data-id="${p.id}"] .pj-goal-add input[name=title]`)?.focus();
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
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
    if (e.target.matches('.pj-goal-done')) {
      const g = state.goals.find((x) => x.id === e.target.dataset.goal);
      if (!g) return;
      try {
        await data.saveGoal({ id: g.id, title: g.title, area_id: g.area_id, due_date: g.due_date, status: e.target.checked ? 'done' : 'active' });
        await refreshProjects();
        toast(e.target.checked ? `目標達成：${g.title}` : '已改回進行中');
      } catch (err) {
        e.target.checked = !e.target.checked;
        toast(err.message, true);
      }
      return;
    }
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
    const b = e.target.closest('button[data-goal]');
    const g = b && state.goals.find((x) => x.id === b.dataset.goal);
    if (g) openGoalDialog(g);
  });
  // 未歸屬的目標：一鍵指定專案
  $('#pj-goals', root).addEventListener('change', async (e) => {
    if (!e.target.matches('.pj-assign')) return;
    const g = state.goals.find((x) => x.id === e.target.dataset.goal);
    const p = state.projects.find((x) => x.id === e.target.value);
    if (!g || !p) return;
    try {
      await data.setGoalProject(g.id, p.id);
      await refreshProjects();
      toast(`「${g.title}」已掛到「${p.name}」`);
    } catch (err) {
      e.target.value = '';
      toast(err.message, true);
    }
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
        ${goalsBlock(p)}
        ${habitsBlock(p)}
        ${p.notes ? `<p class="sub pj-notes">${esc(p.notes)}</p>` : ''}
      </article>`;
    }).join('') : `<div class="card empty-page"><p>${ui.status === 'active'
      ? '還沒有進行中的專案。按右上角「＋ 新增專案」，例如「轉職到藥廠 BD」。' : `沒有${data.PROJECT_STATUS[ui.status]}的專案。`}</p></div>`;

    const goals = data.unassignedGoals(state.goals).sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
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
        </button>
        ${state.projects.length ? `<select class="pj-assign" data-goal="${g.id}" aria-label="把「${esc(g.title)}」指定到專案">${projectOptions('', { none: '指定到專案…' })}</select>` : ''}</li>`;
    }).join('') : `<li class="empty">${state.goals.length ? '每個目標都掛在專案底下了。' : '還沒有目標。'}目標是想達成的結果（例如「年底前轉職成功」）；在專案卡片裡新增的目標會直接掛在那個專案，年度、月度手帳新增的可以選擇不掛。</li>`;
  }

  /** 專案卡片的「目標」區塊：狀態、期間、期限、進度；可勾達成、點開編輯、直接新增 */
  function goalsBlock(p) {
    const goals = data.projectGoals(state.goals, p.id);
    return `<div class="pj-sec">
      <div class="pj-sec-head"><b>目標</b>${goals.length ? `<span class="sub">達成 ${goals.filter((g) => g.status === 'done').length}／${goals.filter((g) => g.status !== 'dropped').length}</span>` : ''}</div>
      ${goals.length ? `<ul class="pj-goals">${goals.map((g) => {
        const pr = data.progressOf(state.tasks, 'goal_id', g.id);
        const overdue = g.status === 'active' && g.due_date && g.due_date < today();
        return `<li class="pj-goal ${g.status !== 'active' ? 'muted' : ''}">
          <input type="checkbox" class="task-done pj-goal-done" data-goal="${g.id}" ${g.status === 'done' ? 'checked' : ''} ${g.status === 'dropped' ? 'disabled' : ''}
            aria-label="${g.status === 'done' ? '取消達成' : '標成達成'}：${esc(g.title)}">
          <button type="button" class="pj-goal-main" data-goal-edit="${g.id}" title="編輯目標">
            <span class="goal-title ${g.status === 'done' ? 'is-done' : ''}">${esc(g.title)}</span>
            <span class="pj-goal-meta">
              ${g.period ? `<span class="pj-period">${data.periodLabel(g.period)}</span>` : ''}
              ${g.due_date ? `<span class="${overdue ? 'overdue' : ''}">${overdue ? '已過期 ' : '期限 '}${formatShort(g.due_date)}</span>` : ''}
              ${g.status !== 'active' ? `<span>${data.GOAL_STATUS[g.status]}</span>` : ''}
              <span class="pj-goal-pr" role="img" aria-label="任務完成 ${pr.done}／${pr.total}"><span class="progress-bar"><span style="width:${pr.pct}%"></span></span>${pr.total ? `${pr.done}/${pr.total}` : '還沒掛任務'}</span>
            </span>
          </button></li>`;
      }).join('')}</ul>` : ''}
      <form class="pj-add pj-goal-add">
        <input name="title" placeholder="新增目標到這個專案" aria-label="新增目標到 ${esc(p.name)}" required maxlength="120">
        <input type="date" name="due_date" aria-label="目標期限（可留白）" title="期限（可留白）">
        <button class="btn-timer">新增</button>
      </form>
    </div>`;
  }

  /** 專案卡片的「相關習慣」：本週打卡、連續天數、21 天徽章；今天可直接打卡 */
  function habitsBlock(p) {
    const stats = data.habitStats(data.habitsOfProject(state.habits, p.id), state.habitLogs);
    if (!stats.length) return '';
    return `<div class="pj-sec">
      <div class="pj-sec-head"><b>相關習慣</b><a class="sub" href="#/habits">到習慣養成</a></div>
      <ul class="pj-habits">${stats.map((s) => `<li class="pj-habit">
        <button type="button" class="pj-hday ${s.doneToday ? 'on' : ''}" data-habit-today="${s.habit.id}" aria-pressed="${s.doneToday}"
          aria-label="${esc(s.habit.name)}：今天${s.doneToday ? '已打卡，點一下取消' : '還沒打卡，點一下打卡'}">${s.doneToday ? '✓' : '今'}</button>
        <span class="pj-habit-name">${esc(s.habit.name)}</span>
        <span class="pj-habit-meta"><span class="${s.weekMet ? 'met' : ''}">本週 ${s.weekCount}/${s.weekTarget}</span>
          <span>${s.streak ? `連續 ${s.streak} 天` : '尚未連續'}</span>${streakBadge(s)}</span>
      </li>`).join('')}</ul>
    </div>`;
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
    // 20261106：掛專案的目標畫在那個專案的那一列；沒掛（或專案不在這個分頁）的留在下方「目標」區
    const shown = new Set(g.rows.map((r) => r.project.id));
    const msOf = (pid) => g.milestones.filter((m) => m.project_id === pid);
    const msButton = (goal, color) => `<button type="button" class="gt-ms ${goal.status === 'done' ? 'done' : ''}" data-goal="${goal.id}" style="left:${x(goal.due_date) + dayW / 2}px;--c:${color}"
          aria-label="目標：${esc(goal.title)}，期限 ${formatShort(goal.due_date)}" title="${esc(goal.title)}（期限 ${formatShort(goal.due_date)}）"></button>`;
    const rowsHTML = g.rows.map((r) => {
      const p = r.project;
      const area = state.areasById[p.area_id];
      const color = esc(area?.color || '#888');
      const label = `<div class="gt-label"><b>${esc(p.name)}</b>${areaChip(area)}</div>`;
      const ms = msOf(p.id).map((goal) => msButton(goal, color)).join('');
      if (!r.start) {
        return `<div class="gt-row">${label}${track(`<span class="gt-empty">沒有日期：在專案「編輯」填開始／結束日，或幫任務設日期</span>${ms}`)}</div>`;
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
      return `<div class="gt-row">${label}${track(bar + dots + ms)}</div>`;
    }).join('');
    const msHTML = g.milestones.filter((goal) => !shown.has(goal.project_id)).map((goal) => {
      const area = state.areasById[goal.area_id];
      return `<div class="gt-row gt-ms-row"><div class="gt-label"><span class="gt-ms-icon" aria-hidden="true">◆</span><span>${esc(goal.title)}</span></div>${track(msButton(goal, esc(area?.color || '#888')))}</div>`;
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

// ===== CFA 規劃表匯入（20261106）：選 CSV → 預覽筆數 → 確認才寫入；解析與寫入都在 data.js =====
function cfaDialog() {
  let dlg = $('#cfa-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'cfa-dialog';
    dlg.className = 'wide';
    document.body.append(dlg);
  }
  return dlg;
}

function openCfaImport() {
  const dlg = cfaDialog();
  dlg.innerHTML = `
    <form class="cfa-form">
      <h2>匯入 CFA 規劃表</h2>
      <p class="sub">在 Google 試算表打開「CFA 2027｜每日進度與下一步」→ 切到「每日進度」分頁 →「檔案 → 下載 → 逗號分隔值（.csv）」，再選這個檔案。</p>
      <label>CSV 檔案<input type="file" name="file" accept=".csv,text/csv" required></label>
      <div id="cfa-preview" aria-live="polite"></div>
      <div class="dialog-actions">
        <button type="button" class="btn-ghost" data-cancel>取消</button>
        <button class="btn-primary" id="cfa-go" disabled>匯入</button>
      </div>
    </form>`;
  const form = $('form', dlg);
  const preview = $('#cfa-preview', dlg);
  const go = $('#cfa-go', dlg);
  let plan = null;
  $('[data-cancel]', dlg).onclick = () => dlg.close();

  form.file.onchange = async () => {
    plan = null;
    go.disabled = true;
    const file = form.file.files[0];
    if (!file) { preview.innerHTML = ''; return; }
    try {
      plan = data.cfaPlanImport(await file.text(), { projects: state.projects, goals: state.goals, tasks: state.tasks, areas: state.areas });
    } catch (err) {
      preview.innerHTML = `<p class="warn">${esc(err.message)}</p>`;
      return;
    }
    const writes = plan.creates.length + plan.updates.length;
    const skipped = Object.entries(plan.skipped);
    const areaPick = plan.project ? '' : `<label>領域<select name="area_id" required>
        ${plan.suggestedArea ? '' : '<option value="">請選擇領域</option>'}
        ${plan.areaChoices.map((a) => `<option value="${a.id}" ${a.id === plan.suggestedArea ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>`;
    preview.innerHTML = `
      <div class="cfa-sum">
        <div><b>${plan.creates.length}</b><span>新增</span></div>
        <div><b>${plan.updates.length}</b><span>更新</span></div>
        <div><b>${plan.unchanged.length}</b><span>已是最新</span></div>
        <div><b>${skipped.reduce((n, [, c]) => n + c, 0)}</b><span>略過</span></div>
      </div>
      ${skipped.length ? `<p class="sub">略過的原因：${skipped.map(([r, c]) => `${esc(r)} ${c} 列`).join('、')}（只匯入今天以後、有讀書時數的日子）</p>` : ''}
      <p class="sub">專案：<b>${esc(data.CFA_PROJECT_NAME)}</b>${plan.project ? '（已存在，沿用）' : '（會新建）'}</p>
      ${areaPick}
      ${plan.goals.length ? `<ul class="cfa-goals">${plan.goals.map((g) => `<li>◆ ${esc(g.title)}・期限 ${g.due_date ? g.due_date.replaceAll('-', '/') : '—'}・${g.existing ? '沿用' : '新增'}</li>`).join('')}</ul>` : ''}
      ${writes ? `<ul class="cfa-rows">${[...plan.creates.map((it) => ['新增', it]), ...plan.updates.map((it) => ['更新', it])].slice(0, 8)
        .map(([k, it]) => `<li><span class="cfa-k">${k}</span><span class="sub">${formatShort(it.day)}</span> ${esc(it.title)}${it.done ? ' ✓' : ''}</li>`).join('')}
        ${writes > 8 ? `<li class="sub">…還有 ${writes - 8} 筆</li>` : ''}</ul>` : '<p class="sub">沒有需要寫入的內容。</p>'}
      ${plan.pushAhead ? `<p class="cfa-note">這些任務都有到期日。如果有開「寫入 Google 日曆」，未來 180 天內的 ${plan.pushAhead} 筆會同步到 Google 的「Life OS」日曆。</p>` : ''}
      <p class="sub">同一天的 CFA 任務會更新標題、說明、預計時間與目標，不會重複建立；已在 Life OS 標完成的不會被改回未完成。</p>`;
    go.disabled = !writes;
    go.textContent = writes ? `匯入 ${writes} 筆` : '匯入';
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!plan) return;
    const writes = plan.creates.length + plan.updates.length;
    if (!(await confirmDialog(`確定寫入？新增 ${plan.creates.length} 筆、更新 ${plan.updates.length} 筆任務${plan.goals.some((g) => !g.existing) ? `，新增 ${plan.goals.filter((g) => !g.existing).length} 個階段目標` : ''}。`, `寫入 ${writes} 筆`))) return;
    go.disabled = true;
    try {
      const res = await data.cfaRunImport(plan, { areaId: form.area_id?.value });
      dlg.close();
      await refreshProjects();
      toast(`已匯入：新增 ${res.created} 筆、更新 ${res.updated} 筆`);
    } catch (err) {
      go.disabled = false;
      toast(err.message, true);
    }
  };
  dlg.showModal();
}
