// M3 日曆（Phase 3）：週／月視圖，任務直接讀 tasks（不另存事件），拖到別天會更新任務
import * as data from '../data.js?v=202611242148';
import { state, refreshTasks } from '../store.js?v=202611242148';
import { $, esc, toast, areaChip, foldList } from '../ui.js?v=202611242148';
import { today, addDays, weekStart, formatShort, formatTime } from '../dates.js?v=202611242148';
import { taskItemHTML } from './task-item.js?v=202611242148';
import { bindTaskList, openTaskEditor } from './task-actions.js?v=202611242148';
import { openGoogleSyncDialog, openExternalEvent, extTime } from './google-sync.js?v=202611242148';
import { bindOverdueList, overdueListHTML } from './overdue-list.js?v=202611242148';
import { bindHabitDays } from './habits.js?v=202611242148';
import { mountHealthDay } from './health.js?v=202611242148';

const VIEW_KEY = 'lifeos-cal-view';
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const MONTH_MAX = 3; // 月視圖每格最多顯示幾筆
const WEEK_MAX = 8; // 20261121：週視圖每格最多幾筆（其他天不被拉出一大片空白；點那天看全部）

const ui = { view: 'week', anchor: today(), selected: today() };
// Google 會議（唯讀）：依目前顯示的範圍讀一次，範圍改變或同步後才重讀
const ext = { key: '', events: [], loading: false };
try { ui.view = localStorage.getItem(VIEW_KEY) || 'week'; } catch { /* 忽略 */ }

/** 月視圖：該月 1 號所在週的週一起，共 6 週 */
function monthRange(anchor) {
  const first = `${anchor.slice(0, 7)}-01`;
  const start = weekStart(first);
  return { start, end: addDays(start, 41), month: anchor.slice(0, 7) };
}

export function mountCalendar(root) {
  root.innerHTML = `
    <header class="page-head cal-head">
      <h1>日曆</h1>
      <div class="cal-tools">
        <div class="seg" id="cal-view" role="group" aria-label="切換視圖">
          <button type="button" data-v="week">週</button><button type="button" data-v="month">月</button>
        </div>
        <button class="btn-ghost" id="cal-prev" aria-label="上一段">‹</button>
        <button class="btn-timer" id="cal-today">今天</button>
        <button class="btn-ghost" id="cal-next" aria-label="下一段">›</button>
        <strong id="cal-title"></strong>
        <button class="btn-timer" id="cal-google" title="Google 日曆同步設定">⇄ Google 同步</button>
      </div>
    </header>
    <section class="card cal-card">
      <div class="cal-grid" id="cal-grid"></div>
    </section>
    <section class="card">
      <div class="day-head">
        <h2 id="cal-day-title"></h2>
      </div>
      <ul class="ext-list" id="cal-day-ext"></ul>
      <form id="cal-add" class="quick-add">
        <input name="title" placeholder="在這天新增任務，按 Enter 建立" aria-label="任務名稱" autocomplete="off" required>
        <select name="area_id" aria-label="領域"></select>
        <input type="time" name="time" aria-label="排程時間（可留白）">
        <button class="btn-primary">建立</button>
      </form>
      <div id="cal-overdue-wrap" class="cal-overdue" hidden>
        <h3 id="cal-overdue-title"></h3>
        <ul class="task-list" id="cal-overdue"></ul>
      </div>
      <h3 class="cal-sub" id="cal-day-sub" hidden>這天的任務</h3>
      <ul class="task-list" id="cal-day-list"></ul>
    </section>
    <section class="card cal-habits">
      <div class="day-head"><h2 id="cal-hb-title">習慣打卡</h2><a class="sub" href="#/habits">習慣養成 ›</a></div>
      <ul class="cal-hb" id="cal-habits"></ul>
    </section>
    <div id="cal-health"></div>`;

  const grid = $('#cal-grid', root);
  const dayList = $('#cal-day-list', root);
  bindTaskList(dayList, { animateDone: () => false });
  // 20261121（使用者：點日曆的一天就能把那天的事做完）：今天＋過期未完成（同總覽）、那天的習慣打卡、飲食與保健食品
  bindOverdueList($('#cal-overdue', root));
  bindHabitDays($('#cal-habits', root));
  const health = mountHealthDay($('#cal-health', root), ui.selected);

  $('#cal-view', root).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    ui.view = b.dataset.v;
    try { localStorage.setItem(VIEW_KEY, ui.view); } catch { /* 忽略 */ }
    render();
  });
  const shift = (dir) => {
    if (ui.view === 'week') ui.anchor = addDays(ui.anchor, 7 * dir);
    else {
      const [y, m] = ui.anchor.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + dir, 1));
      ui.anchor = d.toISOString().slice(0, 10);
    }
    render();
  };
  $('#cal-prev', root).onclick = () => shift(-1);
  $('#cal-next', root).onclick = () => shift(1);
  $('#cal-today', root).onclick = () => { ui.anchor = ui.selected = today(); render(); };
  $('#cal-google', root).onclick = () => openGoogleSyncDialog(() => { ext.key = ''; render(); });
  $('#cal-day-ext', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-ext]');
    const ev = b && ext.events.find((x) => x.id === b.dataset.ext);
    if (ev) openExternalEvent(ev);
  });

  // 點日期格＝選這天；點任務＝編輯
  grid.addEventListener('click', (e) => {
    const extChip = e.target.closest('.cal-ext');
    if (extChip) {
      const ev = ext.events.find((x) => x.id === extChip.dataset.ext);
      if (ev) openExternalEvent(ev);
      return;
    }
    const chip = e.target.closest('.cal-item');
    if (chip) {
      const task = state.tasks.find((t) => t.id === chip.dataset.id);
      if (task) openTaskEditor(task);
      return;
    }
    const cell = e.target.closest('[data-day]');
    if (cell) { ui.selected = cell.dataset.day; render(); }
  });
  grid.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.cal-day')) {
      e.preventDefault();
      ui.selected = e.target.dataset.day;
      render();
    }
  });

  // 拖曳（滑鼠或觸控）：按住任務移動超過 6px 開始拖，放到別天 → 更新 tasks；沒移動就當點擊
  let drag = null;
  let suppressClick = false;
  const cellAt = (x, y) => document.elementFromPoint(x, y)?.closest('#cal-grid [data-day]');
  grid.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('.cal-item');
    if (!chip || e.button > 0) return;
    drag = { chip, x: e.clientX, y: e.clientY, active: false, pointerId: e.pointerId };
  });
  grid.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.active = true;
      drag.chip.setPointerCapture(drag.pointerId);
      drag.chip.classList.add('dragging');
      grid.classList.add('is-dragging');
    }
    e.preventDefault();
    drag.chip.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px)`;
    const cell = cellAt(e.clientX, e.clientY);
    grid.querySelectorAll('.drop-on').forEach((c) => c !== cell && c.classList.remove('drop-on'));
    cell?.classList.add('drop-on');
  });
  const endDrag = async (e) => {
    if (!drag) return;
    const { chip, active } = drag;
    drag = null;
    if (!active) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    chip.style.transform = '';
    chip.classList.remove('dragging');
    grid.classList.remove('is-dragging');
    const cell = e.type === 'pointerup' ? cellAt(e.clientX, e.clientY) : null;
    grid.querySelectorAll('.drop-on').forEach((c) => c.classList.remove('drop-on'));
    const day = cell?.dataset.day;
    if (!day || day === chip.closest('[data-day]').dataset.day) return;
    const task = state.tasks.find((t) => t.id === chip.dataset.id);
    if (!task) return;
    try {
      await data.moveOnCalendar(task, chip.dataset.kind, day);
      ui.selected = day;
      await refreshTasks();
      toast(`已移到 ${formatShort(day)}`);
    } catch (err) {
      toast(err.message, true);
    }
  };
  grid.addEventListener('pointerup', endDrag);
  grid.addEventListener('pointercancel', endDrag);
  grid.addEventListener('click', (e) => {
    if (suppressClick) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);

  const form = $('#cal-add', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const time = f.get('time');
    try {
      await data.createTask({
        title: f.get('title'),
        area_id: f.get('area_id'),
        // 有填時間＝排程在這天的那個時刻；沒填＝這天到期
        due_date: time ? null : ui.selected,
        scheduled_start: time ? new Date(`${ui.selected}T${time}:00+08:00`).toISOString() : null,
      }, state.tasks);
      form.title.value = '';
      await refreshTasks();
      toast('已建立');
    } catch (err) {
      toast(err.message, true);
    }
  });

  function itemHTML({ task, kind, time }) {
    const area = state.areasById[task.area_id];
    const label = kind === 'scheduled' ? formatTime(time) : '到期';
    return `<button type="button" class="cal-item ${task.status === 'done' ? 'done' : ''}"
      data-id="${task.id}" data-kind="${kind}" style="--c:${esc(area?.color || '#888')}"
      title="${esc(task.title)}（${esc(area?.name || '')}）">
      <span class="ci-time">${label}</span><span class="ci-title">${esc(task.title)}</span></button>`;
  }

  function extHTML(e) {
    return `<button type="button" class="cal-ext" data-ext="${e.id}" title="${esc(e.title)}（Google 日曆，唯讀）">
      <span class="ci-time">${e.all_day ? '全天' : extTime(e.starts_at)}</span><span class="ci-title">${esc(e.title)}</span></button>`;
  }

  async function loadExt(start, end) {
    const key = `${start}|${end}`;
    if (ext.key === key || ext.loading) return;
    ext.loading = true;
    try {
      ext.events = await data.listExternalEvents(start, end);
    } catch {
      ext.events = []; // 還沒執行 Google 同步的 migration 時讀不到，不影響日曆其他功能
    }
    ext.key = key;
    ext.loading = false;
    if (root.isConnected) render();
  }

  function render() {
    const t = today();
    root.querySelectorAll('#cal-view button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === ui.view)));

    let start;
    let end;
    let month = null;
    if (ui.view === 'week') {
      start = weekStart(ui.anchor);
      end = addDays(start, 6);
      $('#cal-title', root).textContent = `${formatShort(start)}–${formatShort(end)}`;
    } else {
      ({ start, end, month } = monthRange(ui.anchor));
      $('#cal-title', root).textContent = `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月`;
    }
    const items = data.calendarItems(state.life.tasks, start, end); // 工作只留在工作看板
    loadExt(start, end);
    const extDays = ext.key === `${start}|${end}` ? data.externalByDay(ext.events, start, end) : {};
    const days = Array.from({ length: ui.view === 'week' ? 7 : 42 }, (_, i) => addDays(start, i));

    grid.className = `cal-grid ${ui.view}`;
    grid.innerHTML = `
      ${WEEKDAYS.map((w) => `<div class="cal-wd">${w}</div>`).join('')}
      ${days.map((d, i) => {
        const list = items[d] || [];
        const exts = extDays[d] || [];
        // 月視圖每格最多 MONTH_MAX 筆，會議先放
        const cap = ui.view === 'month' ? MONTH_MAX : WEEK_MAX;
        const extShown = exts.slice(0, cap);
        const shown = list.slice(0, Math.max(0, cap - extShown.length));
        const more = list.length + exts.length - shown.length - extShown.length;
        const cls = ['cal-day', d === t ? 'is-today' : '', d === ui.selected ? 'is-selected' : '',
          month && d.slice(0, 7) !== month ? 'is-other' : ''].join(' ');
        return `<div class="${cls}" data-day="${d}" tabindex="0" role="button"
            aria-label="${formatShort(d)}（週${WEEKDAYS[i % 7]}），${list.length} 件任務${exts.length ? `、${exts.length} 個會議` : ''}" aria-pressed="${d === ui.selected}">
          <div class="cal-date">${ui.view === 'week' ? `<span class="wd-m">週${WEEKDAYS[i % 7]}</span>` : ''}${Number(d.slice(8))}${d === t ? '<span class="today-dot">今天</span>' : ''}</div>
          <div class="cal-items">${extShown.map(extHTML).join('')}${shown.map(itemHTML).join('')}${more > 0 ? `<span class="cal-more">+${more} 件</span>` : ''}</div>
        </div>`;
      }).join('')}`;

    // 選定日期的當日安排
    const sel = ui.selected;
    $('#cal-day-title', root).textContent = `${formatShort(sel)}（週${WEEKDAYS[(new Date(`${sel}T12:00:00+08:00`).getUTCDay() + 6) % 7]}）的安排${sel === t ? '・今天' : ''}`;
    const qa = form.area_id;
    const keep = qa.value;
    qa.innerHTML = state.life.areas.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
    if (keep) qa.value = keep;
    const dayExt = extDays[sel] || [];
    $('#cal-day-ext', root).innerHTML = dayExt.map((e) => `
      <li><button type="button" data-ext="${e.id}"><span class="ext-dot" aria-hidden="true"></span>
        <span class="ext-time">${e.all_day ? '全天' : `${extTime(e.starts_at)}${e.ends_at ? `–${extTime(e.ends_at)}` : ''}`}</span>
        <span class="ext-title">${esc(e.title)}</span><span class="sub">Google 會議</span></button></li>`).join('');
    const dayItems = data.calendarItems(state.life.tasks, sel, sel)[sel] || [];
    dayList.innerHTML = dayItems.length
      ? dayItems.map(({ task }) => taskItemHTML(task, state.areasById, {
        memos: state.memosByTask[task.id], running: state.running,
      })).join('')
      : `<li class="empty">${dayExt.length ? '這天沒有任務。' : '這天沒有安排。'}可以在上方直接新增，或從日曆把任務拖過來。</li>`;
    // 點今天：過期還沒做完的列在最上面（動作同總覽「昨天沒做完」）；其他天不列
    const ov = sel === t ? overdueListHTML(t) : { items: [] };
    $('#cal-overdue-wrap', root).hidden = !ov.items.length;
    $('#cal-day-sub', root).hidden = !ov.items.length;
    $('#cal-overdue', root).innerHTML = ov.html || '';
    if (ov.items.length) {
      $('#cal-overdue-title', root).textContent = `還沒做完的（已過期）：${ov.items.length} 件`;
      foldList($('#cal-overdue', root), 5, { unit: '件' });
    }
    renderHabits(sel, t);
    health.setDay(sel);
  }

  /** 那天的習慣打卡：一個習慣一列，點勾打卡／取消（同習慣頁的 toggleHabitDay）；未來的日子不能打卡 */
  function renderHabits(sel, t) {
    const habits = state.habits.filter((h) => !h.archived);
    const done = new Set(state.habitLogs.filter((l) => l.log_date === sel).map((l) => l.habit_id));
    const n = habits.filter((h) => done.has(h.id)).length;
    $('#cal-hb-title', root).innerHTML = `${formatShort(sel)} 的習慣打卡${habits.length ? `<span class="sub">${n}／${habits.length}</span>` : ''}`;
    const future = sel > t;
    $('#cal-habits', root).innerHTML = habits.length ? habits.map((h) => {
      const on = done.has(h.id);
      return `<li data-id="${h.id}"${state.areasById[h.area_id]?.color ? ` style="--hc:${esc(state.areasById[h.area_id].color)}"` : ''}>
        <button type="button" class="hday ${on ? 'on' : ''}" data-day="${sel}" aria-pressed="${on}" ${future ? 'disabled title="還沒到的日子不能打卡"' : ''}
          aria-label="${esc(h.name)}：${on ? '已打卡，點一下取消' : '未打卡，點一下打卡'}"><span class="hd-c">${on ? '✓' : ''}</span></button>
        <span class="cal-hb-name">${esc(h.name)}</span>${h.area_id ? areaChip(state.areasById[h.area_id]) : ''}</li>`;
    }).join('') : '<li class="empty">還沒有習慣。到「習慣養成」新增一個吧。</li>';
  }

  return render;
}
