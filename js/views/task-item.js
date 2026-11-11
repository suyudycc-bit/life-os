// 任務列（任務管理與總覽共用）
import { esc, areaChip, PRIORITY, linkChip, formatDateTime } from '../ui.js';
import { state } from '../store.js';
import { taskDay, isOpen } from '../data.js';
import { formatShort, formatTime, today, formatMin, formatHMS, formatClock } from '../dates.js';

/**
 * @param {object} t 任務
 * @param {object} opts actions＝顯示編輯／刪除；draggable＝顯示拖移把手；memos＝此任務的進度 memo（新的在前）；
 *   running＝目前進行中的計時（整個帳號最多一筆）
 */
export function taskItemHTML(t, areasById, { actions = true, draggable = false, memos = [], running = null } = {}) {
  const timing = running?.task_id === t.id;
  const done = t.status === 'done';
  const open = isOpen(t);
  const day = taskDay(t);
  const overdue = day && day < today() && open;
  const when = [
    day ? formatShort(day) : '',
    t.scheduled_start ? formatTime(t.scheduled_start) : '',
  ].filter(Boolean).join(' ');
  const links = (t.links || []).filter((u) => /^https?:\/\//i.test(u));
  const latest = memos[0];
  return `
  <li class="task ${done ? 'done' : ''} ${timing ? 'timing' : ''}" data-id="${t.id}" ${open ? 'data-open' : ''}>
    ${draggable ? (open
      ? `<button class="drag" data-act="drag" aria-label="拖移排序：${esc(t.title)}（也可用上下鍵）" title="拖移排序">⋮⋮</button>`
      : '<span class="drag-spacer"></span>') : ''}
    <input type="checkbox" class="task-done" ${done ? 'checked' : ''} aria-label="標記完成：${esc(t.title)}">
    <button class="star ${t.starred ? 'on' : ''}" data-act="star" aria-pressed="${t.starred}" aria-label="星標" title="星標">${t.starred ? '★' : '☆'}</button>
    <div class="task-main">
      <div class="task-title"><span class="tt">${esc(t.title)}</span></div>
      <div class="task-meta">
        ${areaChip(areasById[t.area_id])}
        ${t.project_id && state.projects.find((p) => p.id === t.project_id) ? `<a class="proj-chip" href="#/projects" title="專案">📁 ${esc(state.projects.find((p) => p.id === t.project_id).name)}</a>` : ''}
        <span class="prio p${t.priority}">${PRIORITY[t.priority]}優先</span>
        ${when ? `<span class="${overdue ? 'overdue' : ''}">${overdue ? '已過期 ' : ''}${esc(when)}</span>` : ''}
        ${t.estimate_min || t.actual_sec ? `<span>${t.actual_sec ? `實際 ${formatHMS(t.actual_sec)}` : ''}${t.actual_sec && t.estimate_min ? '／' : ''}${t.estimate_min ? `預計 ${formatMin(t.estimate_min)}` : ''}</span>` : ''}
        ${links.map((u) => linkChip(u)).join('')}
      </div>
      ${latest ? `<div class="memo-latest" title="點「進度」看全部紀錄">📝 最新進度 <span class="memo-time">${formatDateTime(latest.created_at)}</span>：${esc(latest.body)}</div>` : ''}
    </div>
    ${open ? `
    <div class="timer-ctl">
      ${timing
        ? `<span class="clock" data-since="${running.started_at}">${formatClock((Date.now() - new Date(running.started_at)) / 1000)}</span>
           <button class="btn-timer on" data-act="pause" aria-label="暫停計時：${esc(t.title)}">⏸ 暫停</button>`
        : `<button class="btn-timer" data-act="start" aria-label="開始計時：${esc(t.title)}">▶ 計時</button>`}
    </div>` : ''}
    ${actions ? `
    <div class="task-actions">
      <button class="btn-ghost btn-memo" data-act="memo" aria-label="進度紀錄${memos.length ? `（${memos.length} 則）` : ''}">進度${memos.length ? `<span class="count" aria-hidden="true">${memos.length}</span>` : ''}</button>
      <button class="btn-ghost" data-act="edit">編輯</button>
      <button class="btn-ghost danger" data-act="delete">刪除</button>
    </div>` : ''}
  </li>`;
}
