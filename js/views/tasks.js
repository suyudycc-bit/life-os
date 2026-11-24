// M2 任務管理（Phase 1：建立、列表、篩選、星標、編輯、刪除、完成；計時於 Phase 2）
import * as data from '../data.js?v=202611242049';
import { state, refreshTasks, refreshAreas } from '../store.js?v=202611242049';
import { $, esc, toast, PRIORITY } from '../ui.js?v=202611242049';
import { today } from '../dates.js?v=202611242049';
import { taskItemHTML } from './task-item.js?v=202611242049';
import { bindTaskList } from './task-actions.js?v=202611242049';
import { openAreaDialog } from './area-dialog.js?v=202611242049';

const ADD_AREA = '__add__';

const FILTER_KEY = 'lifeos-task-filter';
const filter = { range: 'all', areaId: '', projectId: '', priority: '', showDone: false, group: true, q: '' };
try { Object.assign(filter, JSON.parse(localStorage.getItem(FILTER_KEY) || '{}'), { q: '' }); } catch { /* 忽略 */ }

export function mountTasks(root) {
  root.innerHTML = `
    <header class="page-head"><h1>任務管理</h1></header>
    <section class="card">
      <form id="quick-add" class="quick-add">
        <input name="title" placeholder="新增任務，按 Enter 建立" aria-label="任務名稱" autocomplete="off" required>
        <select name="area_id" aria-label="領域"></select>
        <select name="project_id" aria-label="專案"></select>
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
        <select id="f-project" aria-label="篩選專案"></select>
        <select id="f-priority" aria-label="篩選優先級">
          <option value="">全部優先級</option>
          ${[1, 2, 3].map((p) => `<option value="${p}">${PRIORITY[p]}優先</option>`).join('')}
        </select>
        <label class="check"><input type="checkbox" id="f-done"> 顯示已完成</label>
        <label class="check"><input type="checkbox" id="f-group"> 依日期分組</label>
        <input type="search" id="f-q" class="f-q" placeholder="搜尋任務名稱" aria-label="搜尋任務名稱" autocomplete="off">
      </div>
      <div id="task-list"></div>
    </section>`;

  const form = $('#quick-add', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try {
      const created = await data.createTask({
        title: f.get('title'),
        area_id: f.get('area_id'),
        project_id: f.get('project_id') || null,
        priority: Number(f.get('priority')),
        due_date: f.get('due_date') || null,
      }, state.tasks);
      form.title.value = '';
      await refreshTasks();
      form.title.focus({ preventScroll: true });
      showCreated(created);
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
  $('#f-project', root).onchange = (e) => setFilter({ projectId: e.target.value });
  // 20261124（回饋 91d0f64e）：選了專案，領域跟著專案走（任務和專案同一個領域）
  form.project_id.addEventListener('change', () => {
    const p = state.projects.find((x) => x.id === form.project_id.value);
    if (p && state.life.areas.some((a) => a.id === p.area_id)) form.area_id.value = lastArea = p.area_id;
  });
  $('#f-priority', root).onchange = (e) => setFilter({ priority: e.target.value });
  $('#f-done', root).onchange = (e) => setFilter({ showDone: e.target.checked });
  $('#f-group', root).onchange = (e) => setFilter({ group: e.target.checked });
  $('#f-q', root).oninput = (e) => setFilter({ q: e.target.value.trim() });
  // 20261121：清單可能分成好幾組（每組一個 ul），事件都掛在外層；拖移只在同一組內
  const ul = $('#task-list', root);
  bindTaskList(ul, { animateDone: () => !filter.showDone });
  enableReorder(ul);

  // 20261121：依日期分組後，新任務在「今天」那組，前面的「已過期」很長時會在畫面外，看起來像沒新增。
  // 建立後捲到那一列並閃一下；被目前的篩選擋掉時直接說原因。
  function showCreated(t) {
    const li = $(`#task-list .task[data-id="${t.id}"]`, root);
    if (!li) {
      toast('已建立，但目前的篩選看不到它（換成「全部」或清掉搜尋就看得到）');
      return;
    }
    const r = li.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    li.classList.add('just-added');
    setTimeout(() => li.classList.remove('just-added'), 2400);
    toast('已建立');
  }

  function setFilter(patch) {
    Object.assign(filter, patch);
    try { localStorage.setItem(FILTER_KEY, JSON.stringify({ ...filter, q: '' })); } catch { /* 忽略 */ } // 搜尋字不記（下次進來不會莫名少一堆任務）
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

    // 專案：新增欄只列進行中的生活專案；篩選列出全部生活專案（記住的專案不見了就清掉）
    const lifeProjects = [...state.life.projects].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.name.localeCompare(b.name, 'zh-Hant'));
    const qp = form.project_id;
    const keepP = qp.value;
    qp.innerHTML = `<option value="">不掛專案</option>${lifeProjects.filter((p) => p.status === 'active').map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}`;
    qp.value = keepP || (filter.projectId && filter.projectId !== 'none' ? filter.projectId : '');
    if (filter.projectId && filter.projectId !== 'none' && !lifeProjects.some((p) => p.id === filter.projectId)) filter.projectId = '';
    const fp = $('#f-project', root);
    fp.innerHTML = `<option value="">全部專案</option><option value="none">沒有專案</option>${lifeProjects.map((p) => `<option value="${p.id}">${esc(p.name)}${p.status === 'active' ? '' : '（' + (data.PROJECT_STATUS?.[p.status] || p.status) + '）'}</option>`).join('')}`;
    fp.value = filter.projectId;

    const fa = $('#f-area', root);
    fa.innerHTML = `<option value="">全部領域</option>${areaOpts}`;
    // 記住的領域篩選若已不存在、或已列入工作看板（不在這裡顯示），就清掉，避免整個清單空白
    if (filter.areaId && !state.life.areas.some((a) => a.id === filter.areaId)) filter.areaId = '';
    fa.value = filter.areaId;
    $('#f-priority', root).value = filter.priority;
    $('#f-done', root).checked = filter.showDone;
    $('#f-group', root).checked = filter.group;
    root.querySelectorAll('#f-range button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.v === filter.range));
    });

    const list = data.filterTasks(state.life.tasks, filter);
    const items = (ts) => ts.map((t) => taskItemHTML(t, state.areasById, { draggable: true, memos: state.memosByTask[t.id], running: state.running })).join('');
    const empty = filter.q ? `找不到名稱有「${esc(filter.q)}」的任務。`
      : state.life.tasks.length ? '這個篩選條件下沒有任務，換個條件看看。' : '還沒有任務。在上方輸入第一件要做的事吧！';
    $('#task-list', root).innerHTML = !list.length ? `<ul class="task-list"><li class="empty">${empty}</li></ul>`
      : filter.group ? data.taskDateGroups(list).map((g) => `
        <section class="tl-group tl-${g.key}"><h3>${g.label}<span class="sub">${g.tasks.length}</span></h3>
          <ul class="task-list">${items(g.tasks)}</ul></section>`).join('')
      : `<ul class="task-list">${items(list)}</ul>`;
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
