// 任務列上的操作（完成、星標、編輯、刪除），任務管理與總覽共用
import * as data from '../data.js';
import { state, refreshTasks } from '../store.js';
import { $, esc, toast, confirmDialog, linkify, formatDateTime, pastedLink } from '../ui.js';
import { toLocalInput, fromLocalInput } from '../dates.js';

async function run(fn, okMsg) {
  try {
    await fn();
    await refreshTasks();
    if (okMsg) toast(okMsg);
  } catch (e) {
    toast(e.message, true);
  }
}

// 完成動畫的時間軸（毫秒）：畫刪除線（CSS 0.5 秒）→ 停留 → 淡出 → 收合 → 重新讀取
const FADE_AT = 1800;
const COLLAPSE_AT = 2400;
const DONE_AT = 3000;
const pending = new Map(); // taskId → 計時器，動畫期間再點一次勾勾可取消

const rowsOf = (id) => [...document.querySelectorAll(`.task[data-id="${CSS.escape(id)}"]`)];

/**
 * 打勾完成：資料立刻寫入，但畫面先播「畫線 → 淡出 → 收合」動畫（約 3 秒）才重新整理，
 * 讓使用者看得到自己完成了什麼。動畫期間再點一次勾勾＝取消完成。
 */
async function completeWithAnimation(id) {
  const rows = rowsOf(id);
  rows.forEach((li) => {
    li.classList.add('completing');
    li.querySelector('.task-done').checked = true;
  });
  const timers = [
    setTimeout(() => rowsOf(id).forEach((li) => li.classList.add('leaving')), FADE_AT),
    setTimeout(() => rowsOf(id).forEach((li) => {
      li.style.height = `${li.offsetHeight}px`;
      void li.offsetHeight; // 先固定高度，下一格才有收合動畫
      li.classList.add('collapsing');
    }), COLLAPSE_AT),
    setTimeout(() => {
      pending.delete(id);
      refreshTasks();
    }, DONE_AT),
  ];
  pending.set(id, timers);
  try {
    await data.setTaskDone(id, true, state.running);
    toast('已完成 ✓');
  } catch (e) {
    cancelAnimation(id);
    toast(e.message, true);
    refreshTasks();
  }
}

function cancelAnimation(id) {
  (pending.get(id) || []).forEach(clearTimeout);
  pending.delete(id);
  rowsOf(id).forEach((li) => {
    li.classList.remove('completing', 'leaving', 'collapsing');
    li.style.height = '';
    li.querySelector('.task-done').checked = false;
  });
}

/**
 * 綁在 <ul> 上的事件委派
 * @param {{ animateDone?: () => boolean }} opts animateDone＝完成後任務會從這個清單消失時回傳 true
 */
export function bindTaskList(ul, { animateDone = () => true } = {}) {
  ul.addEventListener('change', (e) => {
    if (!e.target.matches('.task-done')) return;
    const id = e.target.closest('.task').dataset.id;
    if (pending.has(id)) { // 動畫中再點一次：取消完成
      cancelAnimation(id);
      run(() => data.setTaskDone(id, false), '已取消完成');
      return;
    }
    if (e.target.checked && animateDone()) return completeWithAnimation(id);
    run(() => data.setTaskDone(id, e.target.checked, state.running), e.target.checked ? '已完成 ✓' : '已改回未完成');
  });
  ul.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.task').dataset.id;
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    if (btn.dataset.act === 'star') run(() => data.updateTask(id, { starred: !task.starred }));
    if (btn.dataset.act === 'edit') openTaskEditor(task);
    if (btn.dataset.act === 'memo') openMemoDialog(task.id);
    if (btn.dataset.act === 'start') startTimer(task);
    if (btn.dataset.act === 'pause') run(() => data.stopTimer(state.running), '已暫停，用時已記錄');
    if (btn.dataset.act === 'delete') {
      if (state.running?.task_id === id) return toast('這個任務正在計時，請先暫停再刪除', true);
      if (await confirmDialog(`確定刪除「${task.title}」？此操作無法復原。`)) {
        run(() => data.deleteTask(id), '已刪除');
      }
    }
  });
}

/** 開始計時；若別的任務正在計時，先問要不要切換（同時只能有一個計時） */
export async function startTimer(task) {
  const running = state.running;
  if (running) {
    const other = state.tasks.find((t) => t.id === running.task_id);
    const ok = await confirmDialog(`目前正在計時「${other?.title || '其他任務'}」。要先結束它，改計時「${task.title}」嗎？`, '切換計時');
    if (!ok) return;
  }
  run(async () => {
    if (running) await data.stopTimer(running);
    await data.startTimer(task);
  }, '開始計時');
}

export function openTaskEditor(task) {
  const dlg = $('#task-dialog');
  const form = $('form', dlg);
  form.innerHTML = `
    <h2>編輯任務${task.case_no ? ` <span class="wb-case">${esc(task.case_no)}</span>` : ''}</h2>
    <label>任務名稱<input name="title" required value="${esc(task.title)}"></label>
    <div class="row">
      <label>領域<select name="area_id">${state.areas.map((a) =>
        `<option value="${a.id}" ${a.id === task.area_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
      <label>優先級<select name="priority">
        ${[1, 2, 3].map((p) => `<option value="${p}" ${p === task.priority ? 'selected' : ''}>${['', '高', '中', '低'][p]}</option>`).join('')}
      </select></label>
    </div>
    <div class="row">
      <label>到期日<input type="date" name="due_date" value="${task.due_date || ''}"></label>
      <label>排程開始<input type="datetime-local" name="scheduled_start" value="${toLocalInput(task.scheduled_start)}"></label>
    </div>
    <div class="row">
      <label>預計分鐘<input type="number" min="0" step="5" name="estimate_min" value="${task.estimate_min ?? ''}"></label>
      <label>狀態<select name="status">
        ${[['todo', '待辦'], ['doing', '進行中'], ['done', '已完成'], ['dropped', '放棄']]
          .map(([v, l]) => `<option value="${v}" ${v === task.status ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
    </div>
    <div class="row">
      <label>專案<select name="project_id"><option value="">（無）</option>
        ${state.projects.filter((p) => p.status !== 'done' || p.id === task.project_id)
          .map((p) => `<option value="${p.id}" ${p.id === task.project_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select></label>
      <label>目標<select name="goal_id"><option value="">（無）</option>
        ${state.goals.filter((g) => g.status === 'active' || g.id === task.goal_id)
          .map((g) => `<option value="${g.id}" ${g.id === task.goal_id ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}
      </select></label>
    </div>
    ${state.workTags.length ? `<label>工作種類<select name="work_type_id"><option value="">（無）</option>
      ${state.workTags.filter((w) => w.active || w.id === task.work_type_id)
        .map((w) => `<option value="${w.id}" ${w.id === task.work_type_id ? 'selected' : ''}>${esc(w.label)}</option>`).join('')}
    </select></label>` : ''}
    <label class="check"><input type="checkbox" name="starred" ${task.starred ? 'checked' : ''}> 星標（列入今日最重要的 3 件事）</label>
    <label>相關連結（一行一個）<textarea name="links" rows="2" placeholder="https://docs.google.com/...">${esc((task.links || []).join('\n'))}</textarea></label>
    <label>備註<textarea name="notes" rows="3">${esc(task.notes || '')}</textarea></label>
    <div class="dialog-actions">
      <button type="button" class="btn-ghost" value="cancel" formnovalidate>取消</button>
      <button type="submit" class="btn-primary">儲存</button>
    </div>`;
  $('button[value=cancel]', form).onclick = () => dlg.close();
  // 任務名稱貼上帶連結的文字：文字留在名稱，網址加到「相關連結」
  form.title.addEventListener('paste', (e) => {
    const got = pastedLink(e.clipboardData);
    if (!got) return;
    e.preventDefault();
    const input = e.target;
    const s = input.selectionStart ?? input.value.length;
    input.value = `${input.value.slice(0, s)}${got.text}${input.value.slice(input.selectionEnd ?? s)}`.trim();
    form.links.value = [form.links.value.trim(), got.url].filter(Boolean).join('\n');
    toast('已把連結加到「相關連結」');
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    let links;
    try { links = data.parseLinks(f.get('links')); } catch (err) { return toast(err.message, true); }
    const patch = {
      links,
      title: f.get('title').trim(),
      area_id: f.get('area_id'),
      priority: Number(f.get('priority')),
      due_date: f.get('due_date') || null,
      scheduled_start: fromLocalInput(f.get('scheduled_start')),
      estimate_min: f.get('estimate_min') === '' ? null : Number(f.get('estimate_min')),
      status: f.get('status'),
      starred: f.has('starred'),
      project_id: f.get('project_id') || null,
      goal_id: f.get('goal_id') || null,
      notes: f.get('notes').trim() || null,
    };
    if (f.has('work_type_id')) patch.work_type_id = f.get('work_type_id') || null;
    if (!patch.title) return toast('請輸入任務名稱', true);
    dlg.close();
    run(() => data.updateTask(task.id, patch), '已儲存');
  };
  dlg.showModal();
  $('input[name=title]', form).focus();
}

/** 任務進度 memo：一則一筆、帶時間，新的在上 */
export function openMemoDialog(taskId) {
  const dlg = $('#memo-dialog');
  const render = () => {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return dlg.close();
    const memos = state.memosByTask[taskId] || [];
    dlg.innerHTML = `
      <form class="memo-form">
        <h2>進度紀錄</h2>
        <p class="sub">${esc(task.title)}</p>
        <label>新增進度<textarea name="body" rows="3" placeholder="今天做到哪裡、卡在哪、下一步…（網址會自動變成連結）" required></textarea></label>
        <div class="dialog-actions">
          <button type="button" class="btn-ghost" data-close>關閉</button>
          <button class="btn-primary">新增</button>
        </div>
      </form>
      <ul class="memo-list">
        ${memos.length ? memos.map((m) => `
          <li data-id="${m.id}">
            <div class="memo-time">${formatDateTime(m.created_at)}
              <button class="btn-ghost danger" data-del aria-label="刪除這則進度">刪除</button></div>
            <div class="memo-body">${linkify(m.body)}</div>
          </li>`).join('') : '<li class="empty">還沒有進度紀錄。寫下第一則吧！</li>'}
      </ul>`;
    const form = $('form', dlg);
    $('[data-close]', dlg).onclick = () => dlg.close();
    form.onsubmit = async (e) => {
      e.preventDefault();
      await run(() => data.addMemo(taskId, form.body.value), '已新增進度');
      render();
      $('textarea', dlg).focus();
    };
    dlg.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const id = b.closest('li').dataset.id;
        if (!(await confirmDialog('確定刪除這則進度？'))) return;
        await run(() => data.deleteMemo(id), '已刪除');
        render();
      };
    });
  };
  render();
  if (!dlg.open) dlg.showModal();
  $('textarea', dlg).focus();
}
