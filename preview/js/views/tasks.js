// M2 任務管理（Phase 1：建立、列表、篩選、星標、編輯、刪除、完成；計時於 Phase 2）
import * as data from '../data.js';
import { state, refreshTasks, refreshAreas } from '../store.js';
import { $, esc, toast, PRIORITY } from '../ui.js';
import { today } from '../dates.js';
import { taskItemHTML } from './task-item.js';
import { bindTaskList } from './task-actions.js';
import { openAreaDialog } from './area-dialog.js';

const ADD_AREA = '__add__';

const FILTER_KEY = 'lifeos-task-filter';
const filter = { range: 'all', areaId: '', priority: '', showDone: false };
try { Object.assign(filter, JSON.parse(localStorage.getItem(FILTER_KEY) || '{}')); } catch { /* 忽略 */ }

export function mountTasks(root) {
  root.innerHTML = `
    <header class="page-head"><h1>任務管理</h1></header>
    <section class="card">
      <form id="quick-add" class="quick-add">
        <input name="title" placeholder="新增任務，按 Enter 建立" aria-label="任務名稱" autocomplete="off" required>
        <select name="area_id" aria-label="領域"></select>
        <select name="priority" aria-label="優先級">
          <option value="1">高</option><option value="2" selected>中</option><option value="3">低</option>
        </select>
        <input type="date" name="due_date" aria-label="到期日" value="${today()}">
        <button class="btn-primary">建立</button>
      </form>
    </section>
    <section class="card">
      <div class="filters" role="group" aria-label="篩選">
        <div class="seg" id="f-range">
          ${Object.entries(data.RANGES).map(([k, l]) => `<button type="button" data-v="${k}">${l}</button>`).join('')}
        </div>
        <select id="f-area" aria-label="篩選領域"></select>
        <select id="f-priority" aria-label="篩選優先級">
          <option value="">全部優先級</option>
          ${[1, 2, 3].map((p) => `<option value="${p}">${PRIORITY[p]}優先</option>`).join('')}
        </select>
        <label class="check"><input type="checkbox" id="f-done"> 顯示已完成</label>
      </div>
      <ul class="task-list" id="task-list"></ul>
    </section>`;

  const form = $('#quick-add', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try {
      await data.createTask({
        title: f.get('title'),
        area_id: f.get('area_id'),
        priority: Number(f.get('priority')),
        due_date: f.get('due_date') || null,
      }, state.tasks);
      form.title.value = '';
      form.title.focus();
      await refreshTasks();
      toast('已建立');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // 領域下拉選「＋ 新增領域…」→ 開新增視窗，建立後自動選取
  let lastArea = '';
  form.area_id.addEventListener('change', async () => {
    if (form.area_id.value !== ADD_AREA) {
      lastArea = form.area_id.value;
      return;
    }
    form.area_id.value = lastArea || state.life.areas[0]?.id || '';
    const created = await openAreaDialog(state.areas);
    if (created) {
      await refreshAreas();
      form.area_id.value = lastArea = created.id;
      toast(`已新增領域「${created.name}」`);
    }
  });

  $('#f-range', root).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setFilter({ range: b.dataset.v });
  });
  $('#f-area', root).onchange = (e) => setFilter({ areaId: e.target.value });
  $('#f-priority', root).onchange = (e) => setFilter({ priority: e.target.value });
  $('#f-done', root).onchange = (e) => setFilter({ showDone: e.target.checked });
  const ul = $('#task-list', root);
  bindTaskList(ul, { animateDone: () => !filter.showDone });
  enableReorder(ul);

  function setFilter(patch) {
    Object.assign(filter, patch);
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filter)); } catch { /* 忽略 */ }
    render();
  }

  function render() {
    // 工作看板的領域不在這裡（工作只留在工作看板）
    const areaOpts = state.life.areas.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
    const qa = form.area_id;
    const keep = qa.value === ADD_AREA ? '' : qa.value;
    qa.innerHTML = `${areaOpts}<option value="${ADD_AREA}">＋ 新增領域…</option>`;
    qa.value = keep || filter.areaId || state.life.areas[0]?.id || '';
    if (!qa.value && state.life.areas[0]) qa.value = state.life.areas[0].id;

    const fa = $('#f-area', root);
    fa.innerHTML = `<option value="">全部領域</option>${areaOpts}`;
    // 記住的領域篩選若已不存在、或已列入工作看板（不在這裡顯示），就清掉，避免整個清單空白
    if (filter.areaId && !state.life.areas.some((a) => a.id === filter.areaId)) filter.areaId = '';
    fa.value = filter.areaId;
    $('#f-priority', root).value = filter.priority;
    $('#f-done', root).checked = filter.showDone;
    root.querySelectorAll('#f-range button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.v === filter.range));
    });

    const list = data.filterTasks(state.life.tasks, filter);
    $('#task-list', root).innerHTML = list.length
      ? list.map((t) => taskItemHTML(t, state.areasById, { draggable: true, memos: state.memosByTask[t.id], running: state.running })).join('')
      : `<li class="empty">${state.life.tasks.length ? '這個篩選條件下沒有任務，換個條件看看。' : '還沒有任務。在上方輸入第一件要做的事吧！'}</li>`;
  }

  return render;
}

/**
 * 拖移排序：滑鼠／觸控拖把手，或聚焦把手後按上下鍵。
 * root 可以包含多個清單（例如每張專案卡片一個），只在同一個清單內移動；順序寫回 tasks.sort_order，任務管理頁同步。
 * @param {string} item 清單項目的選擇器（需有 data-id；未完成的加 data-open）
 */
export function enableReorder(root, item = '.task') {
  let dragging = null;

  const openItems = (li) => [...li.parentElement.querySelectorAll(`:scope > ${item}[data-open]`)];

  async function commit(li) {
    const items = openItems(li);
    const i = items.indexOf(li);
    const order = data.moveTask(state.tasks, li.dataset.id, items[i + 1]?.dataset.id, items[i - 1]?.dataset.id);
    const byId = Object.fromEntries(state.tasks.map((t) => [t.id, t]));
    try {
      await data.reorderTasks(order, byId);
    } catch (e) {
      toast(e.message, true);
    }
    await refreshTasks();
  }

  root.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag');
    if (!handle) return;
    e.preventDefault();
    dragging = handle.closest(item);
    dragging.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });

  root.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const others = openItems(dragging).filter((x) => x !== dragging);
    const before = others.find((x) => {
      const r = x.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (before) before.before(dragging);
    else if (others.length) others.at(-1).after(dragging);
  });

  const end = () => {
    if (!dragging) return;
    const li = dragging;
    dragging = null;
    li.classList.remove('dragging');
    commit(li);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  root.addEventListener('keydown', async (e) => {
    const handle = e.target.closest('.drag');
    if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const li = handle.closest(item);
    const items = openItems(li);
    const i = items.indexOf(li);
    const target = items[e.key === 'ArrowUp' ? i - 1 : i + 1];
    if (!target) return;
    if (e.key === 'ArrowUp') target.before(li); else target.after(li);
    const id = li.dataset.id;
    await commit(li);
    root.querySelector(`${item}[data-id="${id}"] .drag`)?.focus();
  });
}
