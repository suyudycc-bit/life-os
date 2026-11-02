// M1 總覽（Phase 1：今日完成率、今日待辦數、最重要 3 件事、今日待辦清單）
import * as data from '../data.js';
import { state } from '../store.js';
import { $, durationHTML, toast, esc, areaChip } from '../ui.js';
import { refreshNotes } from '../store.js';
import { habitRowHTML, bindHabitDays } from './habits.js';
import { openNoteDialog } from './notes.js';
import { openExternalEvent, extTime } from './google-sync.js';
import { today, formatShort, localDate } from '../dates.js';
import { taskItemHTML } from './task-item.js';
import { bindTaskList } from './task-actions.js';

export function mountOverview(root) {
  root.innerHTML = `
    <header class="page-head">
      <h1>今天，也好好生活。</h1>
      <p class="sub" id="ov-date"></p>
    </header>
    <section class="stats">
      <div class="card stat">
        <div class="stat-label">今日任務完成率</div>
        <div class="stat-num" id="ov-rate">—</div>
        <div class="stat-note" id="ov-rate-note"></div>
      </div>
      <div class="card stat">
        <div class="stat-label">今日待辦</div>
        <div class="stat-num" id="ov-todo">0<small>件</small></div>
        <div class="stat-note">今天到期或排程、尚未完成</div>
      </div>
      <div class="card stat">
        <div class="stat-label">今日用時</div>
        <div class="stat-num" id="ov-time">0s</div>
        <div class="stat-note" id="ov-time-note"></div>
      </div>
    </section>
    <div class="grid-2">
      <section class="card">
        <h2>今日最重要的 3 件事</h2>
        <ul class="task-list compact" id="ov-top3"></ul>
      </section>
      <section class="card">
        <h2>今日待辦</h2>
        <ul class="ext-list" id="ov-ext"></ul>
        <ul class="task-list compact" id="ov-list"></ul>
      </section>
    </div>
    <section class="card ov-projects">
      <div class="day-head"><h2>各領域專案的下一步</h2><a class="sub" href="#/projects">專案與目標 ›</a></div>
      <div id="ov-projects"></div>
    </section>
    <div class="grid-2 ov-row2">
      <section class="card">
        <div class="day-head"><h2>近 7 天習慣打卡</h2><a class="sub" href="#/habits">管理習慣 ›</a></div>
        <ul class="habit-list" id="ov-habits"></ul>
      </section>
      <section class="card">
        <div class="day-head"><h2>快速記錄靈感</h2><a class="sub" href="#/notes">靈感知識庫 ›</a></div>
        <form id="ov-note" class="ov-note">
          <input name="title" placeholder="一句話記下想法（標題）" aria-label="靈感標題" required maxlength="120">
          <textarea name="body" rows="3" placeholder="補充內容（選填）" aria-label="靈感內容"></textarea>
          <div class="dialog-actions">
            <button type="button" class="btn-ghost" id="ov-note-more">更多欄位…</button>
            <button class="btn-primary">記錄</button>
          </div>
        </form>
      </section>
    </div>`;
  bindTaskList($('#ov-top3', root));
  bindTaskList($('#ov-list', root));
  bindHabitDays($('#ov-habits', root));
  // 今天的 Google 會議（唯讀）；還沒設定同步或沒執行 migration 時就不顯示
  let todayExt = [];
  data.listExternalEvents(today(), today()).then((evs) => {
    todayExt = data.externalByDay(evs, today(), today())[today()] || [];
    renderExt();
  }).catch(() => {});
  function renderExt() {
    const ul = $('#ov-ext', root);
    if (!ul) return;
    ul.innerHTML = todayExt.map((e) => `
      <li><button type="button" data-ext="${e.id}"><span class="ext-dot" aria-hidden="true"></span>
        <span class="ext-time">${e.all_day ? '全天' : extTime(e.starts_at)}</span>
        <span class="ext-title">${esc(e.title)}</span><span class="sub">Google 會議</span></button></li>`).join('');
  }
  $('#ov-ext', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-ext]');
    const ev = b && todayExt.find((x) => x.id === b.dataset.ext);
    if (ev) openExternalEvent(ev);
  });
  const noteForm = $('#ov-note', root);
  noteForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await data.saveNote({ title: noteForm.title.value, body: noteForm.body.value });
      noteForm.reset();
      await refreshNotes();
      toast('已記錄到靈感知識庫');
    } catch (err) {
      toast(err.message, true);
    }
  };
  $('#ov-note-more', root).onclick = () => {
    openNoteDialog(null, { title: noteForm.title.value, body: noteForm.body.value });
    noteForm.reset();
  };

  return function render() {
    const day = today();
    // 生活的總覽：不含工作看板的工作（工作只留在工作看板）
    const { todo, top3 } = data.todayOverview(state.life.tasks, day);
    const s = state.summary;
    $('#ov-date', root).textContent = `${formatShort(day)}（台北時間）`;
    $('#ov-rate', root).innerHTML = s.completion_pct == null ? '—' : `${s.completion_pct}<small>%</small>`;
    $('#ov-rate-note', root).textContent = s.tasks_total
      ? `今日 ${s.tasks_total} 件中完成 ${s.tasks_done} 件`
      : '今天還沒有排定的任務';
    $('#ov-todo', root).innerHTML = `${todo.length}<small>件</small>`;
    const ts = data.timeStats(state.life.entries, state.life.tasks, day);
    const live = state.running && localDate(state.running.started_at) === day && !state.areasById[state.running.area_id]?.on_board ? state.running.started_at : null;
    $('#ov-time', root).innerHTML = durationHTML(ts.todaySec, live);
    $('#ov-time-note', root).textContent = live ? '含進行中的計時（即時）' : '今天的計時加總';
    $('#ov-top3', root).innerHTML = top3.length
      ? top3.map((t) => taskItemHTML(t, state.areasById, { actions: false, memos: state.memosByTask[t.id], running: state.running })).join('')
      : '<li class="empty">在任務上點 ☆ 星標，最重要的事就會出現在這裡。</li>';
    $('#ov-list', root).innerHTML = todo.length
      ? todo.map((t) => taskItemHTML(t, state.areasById, { actions: false, memos: state.memosByTask[t.id], running: state.running })).join('')
      : '<li class="empty">今天沒有待辦了，到「任務管理」新增或安排一件事吧。</li>';
    const groups = data.activeProjectsByArea(state.life.projects, state.life.areas);
    $('#ov-projects', root).innerHTML = groups.length ? `<div class="ovp-grid">${groups.map((g) => `
      <div class="ovp-area">${areaChip(g.area)}
        <ul>${g.projects.map((p) => {
          const pr = data.progressOf(state.tasks, 'project_id', p.id);
          const step = data.nextStepOf(p, state.tasks);
          return `<li><b>${esc(p.name)}</b>${pr.total ? ` <span class="sub">${pr.pct}%</span>` : ''}
            <div class="${step ? '' : 'sub'}">→ ${step ? esc(step.kind === 'task' ? step.task.title : step.text) : '還沒有下一步'}</div></li>`;
        }).join('')}</ul></div>`).join('')}</div>`
      : '<p class="sub">還沒有進行中的專案。到「專案與目標」新增，例如轉職、BD 案件、接案專案。</p>';
    const hs = data.habitStats(state.habits.filter((h) => !h.archived), state.habitLogs, day);
    $('#ov-habits', root).innerHTML = hs.length ? hs.map((x) => habitRowHTML(x, { compact: true })).join('')
      : '<li class="empty">還沒有習慣。到「習慣養成」新增一個吧。</li>';

  };
}
