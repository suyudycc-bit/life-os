// 延期原因（20261121，使用者：「任務過期改日期後，沒辦法統計有沒有照計畫走；塞車要系統性處理」）
// 資料庫觸發器在任務往後移時記一筆改期紀錄；store.refreshTasks 看到新的、還沒填原因的紀錄就發 lifeos:tasks-postponed。
// 這裡在畫面下方問一下原因（點一下、可略過）；同一件延到第 3 次（data.POSTPONE_NUDGE_AT）時，多問要怎麼處理。
// 只問生活的任務（工作看板換欄也會改日期，那是看板的日常操作，不打擾）。
import * as data from '../data.js?v=202611242202';
import { state, refreshTasks } from '../store.js?v=202611242202';
import { esc, toast, confirmDialog } from '../ui.js?v=202611242202';
import { formatShort } from '../dates.js?v=202611242202';
import { openTaskEditor } from './task-actions.js?v=202611242202';

const SHOW_MS = 20000; // 沒動作 20 秒自動收起（原因留白）
let bar = null;
let timer = null;

function close() {
  clearTimeout(timer);
  bar?.remove();
  bar = null;
}

function open(rows) {
  const life = new Set(state.life.tasks.map((t) => t.id));
  rows = rows.filter((r) => life.has(r.task_id));
  if (!rows.length) return;
  const tasks = [...new Set(rows.map((r) => r.task_id))].map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean);
  if (!tasks.length) return;
  // 延很多次的那件（取次數最多的一件）
  const counts = tasks.map((t) => ({ t, history: state.reschedulesByTask[t.id] || [] }))
    .sort((a, b) => b.history.length - a.history.length);
  const worst = counts[0].history.length >= data.POSTPONE_NUDGE_AT && data.isOpen(counts[0].t) ? counts[0] : null;

  close();
  bar = document.createElement('div');
  bar.className = 'energy-bar postpone-bar';
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', '延期原因');
  const name = tasks.length === 1 ? `「${esc(tasks[0].title.slice(0, 30))}」` : `這 ${tasks.length} 件`;
  bar.innerHTML = `
    <p class="eb-title">${name}延期了，為什麼？</p>
    <div class="pp-reasons">${Object.entries(data.RESCHEDULE_REASONS).map(([k, l]) => `<button type="button" data-reason="${k}">${l}</button>`).join('')}</div>
    ${worst ? `<div class="pp-nudge">
      <p>「${esc(worst.t.title.slice(0, 30))}」已經延第 <b>${worst.history.length}</b> 次了（原本 ${formatShort(worst.history[0].from_day)}）。要換個方式嗎？</p>
      <div class="pp-acts">
        <button type="button" class="btn-ghost" data-nudge="split" title="打開任務，把它改成更小的第一步">拆小一點</button>
        <button type="button" class="btn-ghost" data-nudge="slot" title="打開任務，排一個確定的開始時間">排確定時段</button>
        <button type="button" class="btn-ghost danger" data-nudge="drop">不做了</button>
      </div></div>` : ''}
    <div class="eb-actions"><button type="button" class="btn-ghost" data-skip>${worst ? '照樣延' : '略過'}</button></div>`;
  document.body.append(bar);
  const reset = () => { clearTimeout(timer); timer = setTimeout(close, SHOW_MS); };
  reset();
  bar.addEventListener('focusin', () => clearTimeout(timer));
  bar.addEventListener('click', async (e) => {
    reset();
    const r = e.target.closest('[data-reason]');
    if (r) {
      const reason = r.dataset.reason;
      bar.querySelectorAll('[data-reason]').forEach((b) => { b.disabled = true; });
      try {
        await data.setRescheduleReason(rows.map((x) => x.id), reason);
        for (const x of state.reschedules || []) if (rows.some((y) => y.id === x.id)) x.reason = reason; // 只是補原因，不必整個重讀
        toast(`已記下：${data.RESCHEDULE_REASONS[reason]}`);
        if (!worst) close(); else r.setAttribute('aria-pressed', 'true');
      } catch (err) {
        bar?.querySelectorAll('[data-reason]').forEach((b) => { b.disabled = false; });
        toast(err.message, true);
      }
      return;
    }
    if (e.target.closest('[data-skip]')) { close(); return; }
    const n = e.target.closest('[data-nudge]');
    if (!n || !worst) return;
    const t = worst.t;
    if (n.dataset.nudge === 'drop') {
      if (!(await confirmDialog(`把「${t.title}」標成「不做了」（放棄）？${state.running?.task_id === t.id ? '正在計時的會先停止。' : ''}`, '不做了'))) return;
      try {
        await data.migrateTasks([t.id], 'drop', { tasks: state.tasks, running: state.running });
        close();
        await refreshTasks();
        toast('已標成不做了');
      } catch (err) { toast(err.message, true); }
      return;
    }
    close();
    openTaskEditor(t);
    const field = document.querySelector(`#task-dialog [name="${n.dataset.nudge === 'slot' ? 'scheduled_start' : 'title'}"]`);
    field?.focus();
    if (n.dataset.nudge === 'split') toast('把名稱改成「最小的第一步」，剩下的再新增一件');
  });
}

export function initPostponePrompt() {
  window.addEventListener('lifeos:tasks-postponed', (e) => open(e.detail?.rows || []));
}
