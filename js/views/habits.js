// M7 習慣養成（Phase 4）：新增／封存習慣、每日打卡（可補近 7 天）、連續天數、每週目標
// 只記錄「有沒有做」，不設計病歷或診斷類欄位
import * as data from '../data.js';
import { state, refreshHabits } from '../store.js';
import { $, esc, toast, confirmDialog, areaChip } from '../ui.js';
import { today, formatShort } from '../dates.js';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const wd = (d) => WEEKDAYS[new Date(`${d}T12:00:00+08:00`).getUTCDay()];

/** 近 7 天打卡格（習慣頁與總覽共用） */
export function habitRowHTML(s, { compact = false } = {}) {
  const h = s.habit;
  const color = state.areasById[h.area_id]?.color; // 打卡格用所屬領域的顏色；沒有領域時用預設綠色
  return `
    <li class="habit ${compact ? 'compact' : ''}" data-id="${h.id}"${color ? ` style="--hc:${esc(color)}"` : ''}>
      <div class="habit-main">
        <div class="habit-name">${esc(h.name)}</div>
        <div class="task-meta">
          ${h.area_id ? areaChip(state.areasById[h.area_id]) : ''}
          <span class="${s.weekMet ? 'met' : ''}">本週 ${s.weekCount}/${s.weekTarget}${s.weekMet ? ' ✓' : ''}</span>
          <span>${s.streak ? `🔥 連續 ${s.streak} 天` : '尚未連續'}</span>
        </div>
      </div>
      <div class="habit-days" role="group" aria-label="${esc(h.name)} 近 7 天打卡">
        ${s.last7.map((x) => `
          <button type="button" class="hday ${x.done ? 'on' : ''} ${x.day === today() ? 'is-today' : ''}" data-day="${x.day}"
            aria-pressed="${x.done}" aria-label="${formatShort(x.day)}（${wd(x.day)}）${x.done ? '已打卡，點一下取消' : '未打卡，點一下打卡'}">
            <span class="hd-w">${x.day === today() ? '今' : wd(x.day)}</span><span class="hd-c">${x.done ? '✓' : ''}</span>
          </button>`).join('')}
      </div>
      ${compact ? '' : `
      <div class="task-actions">
        <button class="btn-ghost" data-act="edit">編輯</button>
        <button class="btn-ghost" data-act="archive">封存</button>
      </div>`}
    </li>`;
}

/** 打卡格的點擊（習慣頁與總覽共用） */
export function bindHabitDays(container) {
  container.addEventListener('click', async (e) => {
    const b = e.target.closest('.hday');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    b.disabled = true;
    try {
      const done = await data.toggleHabitLog(id, b.dataset.day, state.habitLogs);
      await refreshHabits();
      toast(done ? '已打卡 ✓' : '已取消打卡');
    } catch (err) {
      b.disabled = false;
      toast(err.message, true);
    }
  });
}

function openHabitDialog(habit = null) {
  const dlg = $('#habit-dialog');
  const h = habit || { name: '', area_id: '', target_per_week: 7 };
  dlg.innerHTML = `
    <form>
      <h2>${habit ? '編輯習慣' : '新增習慣'}</h2>
      <label>名稱<input name="name" required maxlength="60" value="${esc(h.name)}" placeholder="例如：運動 30 分鐘、23 點前睡覺"></label>
      <div class="row">
        <label>領域<select name="area_id"><option value="">（不分領域）</option>
          ${state.areas.map((a) => `<option value="${a.id}" ${a.id === h.area_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select></label>
        <label>每週目標<select name="target_per_week">
          ${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${n === h.target_per_week ? 'selected' : ''}>${n === 7 ? '每天' : `每週 ${n} 天`}</option>`).join('')}
        </select></label>
      </div>
      <p class="sub">只記錄「有沒有做」，不記錄身體數據或病歷。</p>
      <div class="dialog-actions">
        <button type="button" class="btn-ghost" data-cancel>取消</button>
        <button class="btn-primary">儲存</button>
      </div>
    </form>`;
  const form = $('form', dlg);
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const row = { name: f.get('name'), area_id: f.get('area_id'), target_per_week: f.get('target_per_week') };
    try {
      if (habit) await data.updateHabit(habit.id, row);
      else await data.createHabit(row);
      dlg.close();
      await refreshHabits();
      toast(habit ? '已更新' : '已新增習慣');
    } catch (err) {
      toast(err.message, true);
    }
  };
  dlg.showModal();
  form.name.focus();
}

export function mountHabits(root) {
  root.innerHTML = `
    <header class="page-head cal-head">
      <h1>習慣養成</h1>
      <button class="btn-primary" id="hb-new">＋ 新增習慣</button>
    </header>
    <section class="card">
      <ul class="habit-list" id="hb-list"></ul>
      <p class="sub hb-hint">點格子打卡，再點一次取消；可以補打最近 7 天。連續天數從今天往回算，今天還沒打卡不算中斷。</p>
    </section>
    <details class="card hb-archived" id="hb-archived-box">
      <summary>已封存 <span class="count" id="hb-archived-count">0</span></summary>
      <ul class="habit-list" id="hb-archived"></ul>
    </details>`;

  $('#hb-new', root).onclick = () => openHabitDialog();
  const list = $('#hb-list', root);
  bindHabitDays(list);
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const habit = state.habits.find((h) => h.id === b.closest('[data-id]').dataset.id);
    if (!habit) return;
    if (b.dataset.act === 'edit') openHabitDialog(habit);
    if (b.dataset.act === 'archive') {
      try {
        await data.updateHabit(habit.id, { archived: true });
        await refreshHabits();
        toast(`已封存「${habit.name}」，打卡紀錄會保留`);
      } catch (err) {
        toast(err.message, true);
      }
    }
  });
  $('#hb-archived', root).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const habit = state.habits.find((h) => h.id === b.closest('[data-id]').dataset.id);
    if (!habit) return;
    try {
      if (b.dataset.act === 'restore') {
        await data.updateHabit(habit.id, { archived: false });
        toast(`已恢復「${habit.name}」`);
      }
      if (b.dataset.act === 'delete') {
        const n = state.habitLogs.filter((l) => l.habit_id === habit.id).length;
        if (!(await confirmDialog(`確定永久刪除「${habit.name}」？它的 ${n} 筆打卡紀錄也會一起刪除，無法復原。`))) return;
        await data.deleteHabit(habit.id);
        toast('已刪除');
      }
      await refreshHabits();
    } catch (err) {
      toast(err.message, true);
    }
  });

  return function render() {
    const active = state.habits.filter((h) => !h.archived);
    const archived = state.habits.filter((h) => h.archived);
    const stats = data.habitStats(active, state.habitLogs);
    list.innerHTML = stats.length ? stats.map((s) => habitRowHTML(s)).join('')
      : '<li class="empty">還沒有習慣。按右上角「＋ 新增習慣」開始，例如「每天閱讀 30 分鐘」。</li>';
    $('#hb-archived-count', root).textContent = archived.length;
    $('#hb-archived-box', root).hidden = !archived.length;
    $('#hb-archived', root).innerHTML = data.habitStats(archived, state.habitLogs).map((s) => `
      <li class="habit" data-id="${s.habit.id}">
        <div class="habit-main"><div class="habit-name">${esc(s.habit.name)}</div>
          <div class="task-meta"><span>共打卡 ${s.total} 天</span></div></div>
        <div class="task-actions">
          <button class="btn-ghost" data-act="restore">恢復</button>
          <button class="btn-ghost danger" data-act="delete">刪除</button>
        </div>
      </li>`).join('');
  };
}
